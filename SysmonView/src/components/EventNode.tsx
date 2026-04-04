import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

/**
 * Custom React Flow node for session diagram events.
 * Renders the event info with a collapse/expand toggle button.
 */

interface EventNodeData {
  label: string;
  bgColor: string;
  isPinned: boolean;
  isCollapsed: boolean;
  hiddenCount: number;
  hasChildren: boolean;
  onToggleCollapse?: (gid: number) => void;
  gid: number;
  [key: string]: unknown;
}

function EventNode({ data }: NodeProps) {
  const {
    label,
    bgColor,
    isPinned,
    isCollapsed,
    hiddenCount,
    hasChildren,
    onToggleCollapse,
    gid,
  } = data as unknown as EventNodeData;

  return (
    <div
      title={label}
      style={{
        background: bgColor,
        color: '#fff',
        fontSize: '11px',
        width: 420,
        borderRadius: '6px',
        border: isPinned ? '3px solid #facc15' : 'none',
        padding: '8px 12px',
        whiteSpace: 'pre-line',
        wordBreak: 'break-all',
        overflow: 'hidden',
        lineHeight: '1.4',
        cursor: 'pointer',
        textShadow: '0 1px 2px rgba(0,0,0,0.3)',
        boxShadow: isPinned ? '0 0 12px rgba(250, 204, 21, 0.4)' : 'none',
        position: 'relative',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />

      {/* Collapse/Expand button */}
      {hasChildren && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse?.(gid);
          }}
          style={{
            position: 'absolute',
            left: -28,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: isCollapsed ? '#3b82f6' : '#374151',
            border: '1px solid #6b7280',
            color: '#fff',
            fontSize: '14px',
            lineHeight: '18px',
            textAlign: 'center',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
          title={isCollapsed ? `Expand (${hiddenCount} hidden)` : 'Collapse children'}
        >
          {isCollapsed ? '+' : '\u2212'}
        </button>
      )}

      {label}

      {/* Hidden count badge */}
      {isCollapsed && hiddenCount > 0 && (
        <div
          style={{
            marginTop: '4px',
            fontSize: '10px',
            opacity: 0.8,
            fontStyle: 'italic',
          }}
        >
          {hiddenCount} event{hiddenCount !== 1 ? 's' : ''} collapsed
        </div>
      )}

      <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
    </div>
  );
}

export default memo(EventNode);
