import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  ReactFlow,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
  Position,
  ReactFlowProvider,
  useReactFlow,
  Controls,
  MiniMap,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import EventDetailPanel from '../components/EventDetailPanel';

/**
 * Hierarchy View — process creation tree visualization.
 *
 * Shows parent-child process relationships as a tree graph.
 * Explorer → Word → Cmd, etc. Orphan processes (no parent in logs)
 * appear as standalone root nodes.
 */

interface ProcessRecord {
  FID: number;
  ProcessGuid: string;
  ParentProcessGuid: string;
  ImageExe: string;
  ParentImageExe: string;
  Image: string;
  CommandLine: string;
  User: string;
  UtcTime: string;
  Computer: string;
}

interface TreeNode {
  process: ProcessRecord;
  children: TreeNode[];
  terminated: boolean;
}

// ─── Layout Constants ──────────────────────────────────────────────────────────
const NODE_W = 260;
const NODE_H = 50;
const H_GAP = 40;   // horizontal gap between siblings
const V_GAP = 80;   // vertical gap between levels

// ─── Colors ────────────────────────────────────────────────────────────────────
const COLOR_ROOT = '#7B68EE';      // medium purple — root/top node
const COLOR_ORPHAN = '#8A2BE2';    // violet — orphan process (no parent in logs)
const COLOR_RUNNING = '#FF4500';   // orange-red — running process
const COLOR_TERMINATED = '#56AC73'; // green-tan — terminated process
const COLOR_FOCUSED = '#FF8C00';   // orange — focused/selected process

/**
 * Build the tree from flat ProcessCreate records.
 */
function buildForest(
  records: ProcessRecord[],
  terminatedGuids: Set<string>,
): TreeNode[] {
  const byGuid = new Map<string, TreeNode>();
  const childrenOf = new Map<string, TreeNode[]>();

  // Create tree nodes for every process
  for (const rec of records) {
    const node: TreeNode = {
      process: rec,
      children: [],
      terminated: terminatedGuids.has(rec.ProcessGuid),
    };
    byGuid.set(rec.ProcessGuid, node);
  }

  // Build parent→children relationships
  for (const rec of records) {
    const parentGuid = rec.ParentProcessGuid;
    if (parentGuid && byGuid.has(parentGuid)) {
      byGuid.get(parentGuid)!.children.push(byGuid.get(rec.ProcessGuid)!);
    }
  }

  // Roots = nodes whose parent is not in the dataset
  const roots: TreeNode[] = [];
  for (const rec of records) {
    if (!rec.ParentProcessGuid || !byGuid.has(rec.ParentProcessGuid)) {
      roots.push(byGuid.get(rec.ProcessGuid)!);
    }
  }

  return roots;
}

/**
 * Collect all GUIDs in a subtree (the node and all descendants).
 */
function collectGuids(node: TreeNode): Set<string> {
  const guids = new Set<string>();
  const stack = [node];
  while (stack.length > 0) {
    const n = stack.pop()!;
    guids.add(n.process.ProcessGuid);
    for (const c of n.children) stack.push(c);
  }
  return guids;
}

/**
 * Find the root chain for a given GUID — walk up to the topmost ancestor,
 * then return that subtree.
 */
function findSubtreeForExe(
  forest: TreeNode[],
  allByGuid: Map<string, TreeNode>,
  exe: string,
): TreeNode[] {
  // Find all nodes matching this exe
  const matching: TreeNode[] = [];
  for (const [, node] of allByGuid) {
    if (node.process.ImageExe.toLowerCase() === exe.toLowerCase()) {
      matching.push(node);
    }
  }
  if (matching.length === 0) return forest;

  // For each match, walk up to find the root, collect unique root subtrees
  const rootGuids = new Set<string>();
  const roots: TreeNode[] = [];

  for (const node of matching) {
    // Walk up to find the root of this node's chain
    let current = node;
    let parentGuid = current.process.ParentProcessGuid;
    while (parentGuid && allByGuid.has(parentGuid)) {
      current = allByGuid.get(parentGuid)!;
      parentGuid = current.process.ParentProcessGuid;
    }
    if (!rootGuids.has(current.process.ProcessGuid)) {
      rootGuids.add(current.process.ProcessGuid);
      roots.push(current);
    }
  }

  return roots;
}

/**
 * Layout a tree node and its children recursively.
 * Returns the total width consumed by this subtree.
 */
function layoutTree(
  treeNode: TreeNode,
  x: number,
  y: number,
  nodes: Node[],
  edges: Edge[],
  parentId: string | null,
  focusedExe: string | null,
  isOrphan: boolean,
): number {
  const nodeId = `p-${treeNode.process.ProcessGuid}`;

  // Determine color
  let bgColor: string;
  if (focusedExe && treeNode.process.ImageExe.toLowerCase() === focusedExe.toLowerCase()) {
    bgColor = COLOR_FOCUSED;
  } else if (isOrphan) {
    bgColor = COLOR_ORPHAN;
  } else if (treeNode.terminated) {
    bgColor = COLOR_TERMINATED;
  } else {
    bgColor = COLOR_RUNNING;
  }

  // Layout children first to know total width
  if (treeNode.children.length === 0) {
    // Leaf node
    nodes.push(makeNode(nodeId, x, y, treeNode, bgColor));
    if (parentId) edges.push(makeEdge(parentId, nodeId));
    return NODE_W;
  }

  // Layout children
  let childX = x;
  const childWidths: number[] = [];
  for (const child of treeNode.children) {
    const w = layoutTree(child, childX, y + NODE_H + V_GAP, nodes, edges, nodeId, focusedExe, false);
    childWidths.push(w);
    childX += w + H_GAP;
  }

  const totalChildrenWidth = childWidths.reduce((a, b) => a + b, 0) + H_GAP * (childWidths.length - 1);

  // Center this node over its children
  const nodeX = x + totalChildrenWidth / 2 - NODE_W / 2;
  nodes.push(makeNode(nodeId, nodeX, y, treeNode, bgColor));
  if (parentId) edges.push(makeEdge(parentId, nodeId));

  return Math.max(NODE_W, totalChildrenWidth);
}

function makeNode(id: string, x: number, y: number, treeNode: TreeNode, bgColor: string): Node {
  const proc = treeNode.process;
  const label = `${proc.ImageExe}\n${proc.UtcTime || ''}`;
  return {
    id,
    position: { x, y },
    data: { label, process: proc, bgColor },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    style: {
      background: bgColor,
      color: '#fff',
      fontSize: '11px',
      width: NODE_W,
      borderRadius: '6px',
      border: 'none',
      padding: '8px 12px',
      whiteSpace: 'pre-line' as const,
      lineHeight: '1.4',
      cursor: 'pointer',
      textShadow: '0 1px 2px rgba(0,0,0,0.3)',
    },
  };
}

function makeEdge(sourceId: string, targetId: string): Edge {
  return {
    id: `e-${sourceId}-${targetId}`,
    source: sourceId,
    target: targetId,
    type: 'smoothstep',
    style: { stroke: '#4B5563' },
  };
}

// ─── Inner Diagram Component ───────────────────────────────────────────────────

interface HierarchyDiagramProps {
  forest: TreeNode[];
  allByGuid: Map<string, TreeNode>;
  selectedExe: string | null; // null = "Show All"
  onNodeDoubleClick?: (fid: number, eventType: number) => void;
}

function HierarchyDiagramInner({ forest, allByGuid, selectedExe, onNodeDoubleClick }: HierarchyDiagramProps) {
  const { fitView } = useReactFlow();
  const prevKey = useRef('');

  // Determine which subtrees to show
  const displayForest = useMemo(() => {
    if (!selectedExe) return forest;
    return findSubtreeForExe(forest, allByGuid, selectedExe);
  }, [forest, allByGuid, selectedExe]);

  // Build nodes and edges
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    let x = 0;

    for (const root of displayForest) {
      const isOrphan = !root.process.ParentProcessGuid || !allByGuid.has(root.process.ParentProcessGuid);
      const width = layoutTree(root, x, 0, nodes, edges, null, selectedExe, isOrphan);
      x += width + H_GAP * 2;
    }

    return { nodes, edges };
  }, [displayForest, selectedExe, allByGuid]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edgesState, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // Fit view when displayed forest changes
  const eventsKey = `${displayForest.length}-${selectedExe || 'all'}`;
  useEffect(() => {
    if (eventsKey !== prevKey.current) {
      prevKey.current = eventsKey;
      setTimeout(() => fitView({ padding: 0.2 }), 100);
    }
  }, [eventsKey, fitView]);

  const handleDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const proc = (node.data as any)?.process as ProcessRecord | undefined;
      if (proc && onNodeDoubleClick) {
        onNodeDoubleClick(proc.FID, 1); // EventType 1 = Process Create
      }
    },
    [onNodeDoubleClick]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edgesState}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDoubleClick={handleDoubleClick}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.05}
      maxZoom={2}
      panOnDrag
      zoomOnScroll
      proOptions={{ hideAttribution: true }}
      style={{ background: '#0f1320' }}
    >
      <Controls
        position="top-left"
        showInteractive={false}
        style={{
          background: '#1a1f2e',
          border: '1px solid #374151',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        }}
      />
      <MiniMap
        position="bottom-right"
        pannable
        zoomable
        nodeColor={(node) => (node.data as any)?.bgColor ?? '#6B7280'}
        maskColor="rgba(15, 19, 32, 0.6)"
        style={{
          background: '#1a1f2e',
          border: '1px solid #374151',
          borderRadius: '8px',
          width: 180,
          height: 120,
          cursor: 'grab',
        }}
      />
    </ReactFlow>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function HierarchyView() {
  const [forest, setForest] = useState<TreeNode[]>([]);
  const [allByGuid, setAllByGuid] = useState<Map<string, TreeNode>>(new Map());
  const [exeList, setExeList] = useState<string[]>([]);
  const [selectedExe, setSelectedExe] = useState<string | null>(null);
  const [exeFilter, setExeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [processCount, setProcessCount] = useState(0);
  const [detailWindows, setDetailWindows] = useState<{ eventType: number; gid: number; key: number }[]>([]);
  const [topZ, setTopZ] = useState(50);
  const [windowZ, setWindowZ] = useState<Record<number, number>>({});

  // Load process hierarchy data
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        // Get all process create events
        const rows: ProcessRecord[] = await window.sysmonApi.db.query(
          `SELECT FID, ProcessGuid, ParentProcessGuid, ImageExe, ParentImageExe,
                  Image, CommandLine, User, UtcTime, Computer
           FROM ProcessCreate
           ORDER BY UtcTime ASC`
        ) as ProcessRecord[];

        // Get terminated process GUIDs
        const termRows: any[] = await window.sysmonApi.db.query(
          `SELECT ProcessGuid FROM ProcessTerminated`
        );
        const terminatedGuids = new Set(termRows.map((r: any) => r.ProcessGuid));

        // Build forest
        const treeForest = buildForest(rows, terminatedGuids);

        // Build guid lookup for all nodes
        const guidMap = new Map<string, TreeNode>();
        function indexTree(node: TreeNode) {
          guidMap.set(node.process.ProcessGuid, node);
          for (const child of node.children) indexTree(child);
        }
        for (const root of treeForest) indexTree(root);

        setForest(treeForest);
        setAllByGuid(guidMap);
        setProcessCount(rows.length);

        // Build unique exe list
        const exes = new Set<string>();
        for (const r of rows) {
          if (r.ImageExe) exes.add(r.ImageExe);
        }
        setExeList(Array.from(exes).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
      } catch {
        setForest([]);
        setExeList([]);
      }
      setLoading(false);
    }
    load();
  }, []);

  const filteredExeList = useMemo(() => {
    if (!exeFilter) return exeList;
    const lower = exeFilter.toLowerCase();
    return exeList.filter((e) => e.toLowerCase().includes(lower));
  }, [exeList, exeFilter]);

  const handleNodeDoubleClick = useCallback((fid: number, eventType: number) => {
    const key = Date.now();
    setDetailWindows((prev) => [...prev, { eventType, gid: fid, key }]);
    setTopZ((z) => z + 1);
    setWindowZ((prev) => ({ ...prev, [key]: topZ + 1 }));
  }, [topZ]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        Building process hierarchy...
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left panel: Process list */}
      <div className="w-56 border-r border-gray-700 flex flex-col">
        <div className="px-3 py-2 text-xs font-semibold text-gray-400 bg-surface-800 border-b border-gray-700 shrink-0">
          Processes ({exeList.length})
        </div>
        <div className="px-2 py-1.5 border-b border-gray-700 shrink-0">
          <div className="relative">
            <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={exeFilter}
              onChange={(e) => setExeFilter(e.target.value)}
              placeholder="Filter processes..."
              className="w-full pl-6 pr-6 py-1 text-xs bg-surface-950 border border-gray-700 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            {exeFilter && (
              <button
                onClick={() => setExeFilter('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
              >
                x
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* Show All option */}
          <button
            onClick={() => setSelectedExe(null)}
            className={`w-full text-left px-3 py-1.5 text-xs truncate transition-colors font-medium ${
              selectedExe === null
                ? 'bg-accent-600 text-white'
                : 'text-gray-300 hover:bg-surface-700'
            }`}
          >
            Show All ({processCount})
          </button>
          {filteredExeList.map((exe) => (
            <button
              key={exe}
              onClick={() => setSelectedExe(exe)}
              className={`w-full text-left px-3 py-1.5 text-xs truncate transition-colors ${
                selectedExe === exe
                  ? 'bg-accent-600 text-white'
                  : 'text-gray-300 hover:bg-surface-700'
              }`}
            >
              {exe}
            </button>
          ))}
        </div>

        {/* Legend */}
        <div className="px-3 py-2 border-t border-gray-700 bg-surface-800 space-y-1 shrink-0">
          <div className="text-[10px] text-gray-500 font-medium mb-1">Legend</div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded" style={{ background: COLOR_ORPHAN }} />
            <span className="text-[10px] text-gray-400">Orphan (no parent in logs)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded" style={{ background: COLOR_RUNNING }} />
            <span className="text-[10px] text-gray-400">Running</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded" style={{ background: COLOR_TERMINATED }} />
            <span className="text-[10px] text-gray-400">Terminated</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded" style={{ background: COLOR_FOCUSED }} />
            <span className="text-[10px] text-gray-400">Selected process</span>
          </div>
        </div>
      </div>

      {/* Diagram area */}
      <div className="flex-1">
        {forest.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            No process creation data. Import Sysmon XML logs to begin.
          </div>
        ) : (
          <ReactFlowProvider>
            <HierarchyDiagramInner
              forest={forest}
              allByGuid={allByGuid}
              selectedExe={selectedExe}
              onNodeDoubleClick={handleNodeDoubleClick}
            />
          </ReactFlowProvider>
        )}
      </div>

      {/* Detail panels */}
      {detailWindows.map((dw, i) => (
        <EventDetailPanel
          key={dw.key}
          eventType={dw.eventType}
          gid={dw.gid}
          index={i}
          zIndex={windowZ[dw.key] ?? 50}
          onFocus={() => {
            setTopZ((z) => z + 1);
            setWindowZ((prev) => ({ ...prev, [dw.key]: topZ + 1 }));
          }}
          onClose={() => setDetailWindows((prev) => prev.filter((w) => w.key !== dw.key))}
        />
      ))}
    </div>
  );
}
