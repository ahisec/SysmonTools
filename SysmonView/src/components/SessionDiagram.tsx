import { useEffect, useMemo, useCallback, useRef } from 'react';
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
import EventNode from './EventNode';

/**
 * Session Event Diagram — the signature visualization of Sysmon View.
 *
 * Displays events for a process session as a vertical chain of color-coded nodes.
 * Supports pinning, event type filtering, and collapsible nodes.
 */

// Register custom node types
const nodeTypes = { eventNode: EventNode };

// ─── Event Type Colors ─────────────────────────────────────────────────────────
const EVENT_TYPE_COLORS: Record<number, string> = {
  1:  '#FF8080',   // Process Create
  2:  '#FF80FF',   // File Creation Time Changed
  3:  '#FF8000',   // Network Connection Detected
  5:  '#FF8080',   // Process Terminated
  6:  '#A9A9A9',   // Driver Loaded
  7:  '#B0B000',   // Image Loaded
  8:  '#B87070',   // CreateRemoteThread
  9:  '#800080',   // RawAccessRead
  10: '#EA3795',   // Process Accessed
  11: '#2894FF',   // File Created
  12: '#9370DB',   // Registry Add/Delete
  13: '#DDA0DD',   // Registry Value Set
  14: '#CD853F',   // Registry Renamed
  15: '#D2B48C',   // File Stream Created
  17: '#00B359',   // Pipe Created
  18: '#FF6347',   // Pipe Connected
  19: '#C0C0C0',   // WMI Filter
  20: '#C0C0C0',   // WMI Consumer
  21: '#C0C0C0',   // WMI Binding
  22: '#CF0390',   // DNS Query
  23: '#008080',   // File Delete Archived
  24: '#0000FF',   // Clipboard Change
  25: '#000080',   // Process Tampering
  26: '#008080',   // File Delete Detected
};

const NODE_WIDTH = 420;
const NODE_HEIGHT = 60;
const NODE_SPACING_Y = 20;

interface SessionEvent {
  GID: number;
  UtcTime: string;
  EventType: number;
  EventTypeName: string;
  EventDetails: string;
  Computer: string;
  RuleName: string;
}

interface SessionDiagramProps {
  exeName: string;
  sessionGuid: string;
  events: SessionEvent[];
  onEventDoubleClick?: (event: SessionEvent) => void;
  pinnedGids?: Set<number>;
  onTogglePin?: (gid: number) => void;
  showPinnedOnly?: boolean;
  contextRange?: number;
  collapsedGids?: Set<number>;
  onToggleCollapse?: (gid: number) => void;
}

/**
 * Filter events to show only pinned nodes + context events around them.
 */
function filterByPins(
  events: SessionEvent[],
  pinnedGids: Set<number>,
  contextRange: number,
): SessionEvent[] {
  if (pinnedGids.size === 0) return [];

  const visible = new Set<number>(); // indices to include

  for (let i = 0; i < events.length; i++) {
    if (pinnedGids.has(events[i].GID)) {
      const start = Math.max(0, i - contextRange);
      const end = Math.min(events.length - 1, i + contextRange);
      for (let j = start; j <= end; j++) {
        visible.add(j);
      }
    }
  }

  return Array.from(visible).sort((a, b) => a - b).map((i) => events[i]);
}

/**
 * Apply collapse logic: when a node is collapsed, all nodes after it in the chain
 * are hidden until the chain ends. Returns the visible events and a map of
 * GID → count of hidden children for each collapsed node.
 */
function applyCollapse(
  events: SessionEvent[],
  collapsedGids: Set<number>,
): { visible: SessionEvent[]; hiddenCounts: Map<number, number> } {
  if (collapsedGids.size === 0) {
    return { visible: events, hiddenCounts: new Map() };
  }

  const visible: SessionEvent[] = [];
  const hiddenCounts = new Map<number, number>();
  let collapsingFrom: number | null = null; // GID of the node that triggered collapse
  let hiddenCount = 0;

  for (const evt of events) {
    if (collapsingFrom !== null) {
      // We're in a collapsed section — check if this event is itself collapsed
      // (meaning it was explicitly toggled) which would start a new collapse scope,
      // or if it's uncollapsed, keep hiding
      if (collapsedGids.has(evt.GID)) {
        // Store count for previous collapsed node, start new collapse scope
        hiddenCounts.set(collapsingFrom, hiddenCount);
        visible.push(evt);
        collapsingFrom = evt.GID;
        hiddenCount = 0;
      } else {
        // Hidden under the collapsed parent
        hiddenCount++;
      }
    } else {
      // Not in a collapsed section — show this event
      visible.push(evt);
      if (collapsedGids.has(evt.GID)) {
        collapsingFrom = evt.GID;
        hiddenCount = 0;
      }
    }
  }

  // Finalize the last collapsed section
  if (collapsingFrom !== null) {
    hiddenCounts.set(collapsingFrom, hiddenCount);
  }

  return { visible, hiddenCounts };
}

function SessionDiagramInner({
  exeName,
  sessionGuid,
  events: allEvents,
  onEventDoubleClick,
  pinnedGids = new Set(),
  onTogglePin,
  showPinnedOnly = false,
  contextRange = 0,
  collapsedGids = new Set(),
  onToggleCollapse,
}: SessionDiagramProps) {
  const { fitView } = useReactFlow();
  const prevKey = useRef('');

  // Filter events when showing pinned only
  const pinFiltered = useMemo(() => {
    if (!showPinnedOnly || pinnedGids.size === 0) return allEvents;
    return filterByPins(allEvents, pinnedGids, contextRange);
  }, [allEvents, showPinnedOnly, pinnedGids, contextRange]);

  // Apply collapse logic
  const { visible: events, hiddenCounts } = useMemo(
    () => applyCollapse(pinFiltered, collapsedGids),
    [pinFiltered, collapsedGids]
  );

  // Build the node + edge arrays from the events
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    let y = 0;
    const x = 0;

    // ── Node 1: Executable name (orange) ──
    const rootId = 'root';
    nodes.push({
      id: rootId,
      position: { x, y },
      data: { label: exeName },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      style: {
        background: '#FF8C00',
        color: '#fff',
        fontWeight: 'bold',
        fontSize: '13px',
        width: NODE_WIDTH,
        borderRadius: '6px',
        border: 'none',
        padding: '10px 16px',
        textAlign: 'center' as const,
      },
    });
    y += NODE_HEIGHT + NODE_SPACING_Y;

    // ── Node 2: Computer name (coral) ──
    const computerName = allEvents.length > 0 ? allEvents[0].Computer : '';
    if (computerName) {
      const computerId = 'computer';
      nodes.push({
        id: computerId,
        position: { x, y },
        data: { label: computerName },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        style: {
          background: '#FF7F50',
          color: '#fff',
          fontWeight: '600',
          fontSize: '12px',
          width: NODE_WIDTH,
          borderRadius: '6px',
          border: 'none',
          padding: '8px 16px',
          textAlign: 'center' as const,
        },
      });
      edges.push({
        id: `e-root-computer`,
        source: rootId,
        target: computerId,
        type: 'smoothstep',
        style: { stroke: '#4B5563' },
      });
      y += NODE_HEIGHT + NODE_SPACING_Y;

      // ── Node 3: Stats summary (dark, rounded) ──
      const sourceEvents = showPinnedOnly && pinnedGids.size > 0 ? allEvents : pinFiltered;
      const statsCounts: Record<string, number> = {};
      for (const evt of sourceEvents) {
        statsCounts[evt.EventTypeName] = (statsCounts[evt.EventTypeName] || 0) + 1;
      }
      const statsLines = Object.entries(statsCounts)
        .map(([name, count]) => `${name} (${count})`)
        .join('\n');
      const pinnedInfo = showPinnedOnly && pinnedGids.size > 0
        ? `\nShowing ${events.length} of ${allEvents.length} events (${pinnedGids.size} pinned)`
        : '';
      const collapsedInfo = collapsedGids.size > 0
        ? `\n${collapsedGids.size} node${collapsedGids.size !== 1 ? 's' : ''} collapsed`
        : '';
      const statsLabel = `Summary of Events\n\n${statsLines}${pinnedInfo}${collapsedInfo}`;

      const statsId = 'stats';
      nodes.push({
        id: statsId,
        position: { x, y },
        data: { label: statsLabel },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        style: {
          background: '#1a1a2e',
          color: '#e0e0e0',
          fontSize: '11px',
          width: NODE_WIDTH,
          borderRadius: '12px',
          border: '1px solid #333',
          padding: '10px 16px',
          whiteSpace: 'pre-line' as const,
          lineHeight: '1.5',
          textAlign: 'center' as const,
        },
      });
      edges.push({
        id: `e-computer-stats`,
        source: computerId,
        target: statsId,
        type: 'smoothstep',
        style: { stroke: '#4B5563' },
      });

      const statsLineCount = statsLabel.split('\n').length;
      const statsHeight = Math.max(NODE_HEIGHT, 30 + statsLineCount * 18);
      y += statsHeight + NODE_SPACING_Y;

      // ── Event nodes: chain in time order ──
      let prevId = statsId;
      for (let i = 0; i < events.length; i++) {
        const evt = events[i];
        const nodeId = `event-${evt.GID}`;
        const bgColor = EVENT_TYPE_COLORS[evt.EventType] || '#6B7280';
        const isPinned = pinnedGids.has(evt.GID);
        const isCollapsed = collapsedGids.has(evt.GID);
        const hiddenCount = hiddenCounts.get(evt.GID) ?? 0;
        const hasChildren = i < events.length - 1 || (isCollapsed && hiddenCount > 0);

        let details = evt.EventDetails || evt.EventTypeName;
        if (details.length > 120) details = details.substring(0, 117) + '...';

        const timeStr = evt.UtcTime || '';
        const pinMarker = isPinned ? ' \u{1F4CC}' : '';
        const label = `${timeStr}\n${evt.EventTypeName}${pinMarker}\n${details}`;

        nodes.push({
          id: nodeId,
          type: 'eventNode',
          position: { x, y },
          data: {
            label,
            event: evt,
            bgColor,
            isPinned,
            isCollapsed,
            hiddenCount,
            hasChildren,
            onToggleCollapse,
            gid: evt.GID,
          },
          sourcePosition: Position.Bottom,
          targetPosition: Position.Top,
        });

        edges.push({
          id: `e-${prevId}-${nodeId}`,
          source: prevId,
          target: nodeId,
          type: 'smoothstep',
          style: { stroke: '#4B5563' },
        });

        prevId = nodeId;
        const nodeHeight = isCollapsed && hiddenCount > 0 ? NODE_HEIGHT + 30 : NODE_HEIGHT + 20;
        y += nodeHeight + NODE_SPACING_Y;
      }
    }

    return { nodes, edges };
  }, [exeName, events, allEvents, pinFiltered, pinnedGids, showPinnedOnly, collapsedGids, hiddenCounts, onToggleCollapse]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edgesState, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes/edges when events or pins change
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // Fit view only when the set of displayed events changes (not on pin toggle)
  const eventsKey = `${events.length}-${events.map((e) => e.GID).join(',')}`;
  useEffect(() => {
    if (eventsKey !== prevKey.current) {
      prevKey.current = eventsKey;
      setTimeout(() => fitView({ padding: 0.1 }), 100);
    }
  }, [eventsKey, fitView]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const evt = (node.data as any)?.event as SessionEvent | undefined;
      if (evt && onTogglePin) {
        onTogglePin(evt.GID);
      }
    },
    [onTogglePin]
  );

  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const evt = (node.data as any)?.event as SessionEvent | undefined;
      if (evt && onEventDoubleClick) {
        onEventDoubleClick(evt);
      }
    },
    [onEventDoubleClick]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edgesState}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onNodeDoubleClick={onNodeDoubleClick}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.1 }}
      minZoom={0.1}
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
        nodeColor={(node) => {
          const bg = (node.data as any)?.bgColor;
          return bg || ((node.style?.background as string) ?? '#6B7280');
        }}
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

export default function SessionDiagram(props: SessionDiagramProps) {
  if (props.events.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        Select a session to view the event diagram
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <SessionDiagramInner {...props} />
    </ReactFlowProvider>
  );
}
