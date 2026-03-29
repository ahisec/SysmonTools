import { useEffect, useState, useRef, useCallback } from 'react';
import { EVENT_TABLE_MAP, SYSMON_EVENT_TYPES } from '../types/events';
import TermsDialog from './TermsDialog';

/**
 * Event Detail Panel — replaces the 24 Delphi TcxDBVerticalGrid detail forms.
 *
 * All Delphi detail forms follow the same pattern:
 *   SELECT * FROM [TableName] WHERE FID = [GID]
 *   → display as vertical field-name / value pairs
 *
 * This single component handles ALL event types by dynamically
 * querying the right table and rendering all columns.
 *
 * Opened via double-click on diagram node or grid row.
 */

// ─── Field display config per event type ──────────────────────────────────────
// Controls field ordering and human-readable labels.
// Fields not listed here are still shown, just at the bottom.

const FIELD_CONFIG: Record<number, { label: string; field: string; category?: string }[]> = {
  1: [ // Process Create
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Process GUID', field: 'ProcessGuid' },
    { label: 'Process ID', field: 'ProcessId' },
    { label: 'Image', field: 'Image' },
    { label: 'Command Line', field: 'CommandLine' },
    { label: 'Current Directory', field: 'CurrentDirectory' },
    { label: 'User', field: 'User' },
    { label: 'Integrity Level', field: 'IntegrityLevel' },
    { label: 'Original File Name', field: 'OriginalFileName' },
    { label: 'Hashes', field: 'Hashes', category: 'Hashes' },
    { label: 'MD5', field: 'MD5', category: 'Hashes' },
    { label: 'SHA1', field: 'SHA1', category: 'Hashes' },
    { label: 'SHA256', field: 'SHA256', category: 'Hashes' },
    { label: 'IMPHASH', field: 'IMPHASH', category: 'Hashes' },
    { label: 'Parent Process GUID', field: 'ParentProcessGuid', category: 'Parent' },
    { label: 'Parent Process ID', field: 'ParentProcessId', category: 'Parent' },
    { label: 'Parent Image', field: 'ParentImage', category: 'Parent' },
    { label: 'Parent Command Line', field: 'ParentCommandLine', category: 'Parent' },
    { label: 'Logon GUID', field: 'LogonGuid' },
    { label: 'Logon ID', field: 'LogonId' },
    { label: 'Terminal Session ID', field: 'TerminalSessionId' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
  3: [ // Network Connection Detected
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Process GUID', field: 'ProcessGuid' },
    { label: 'Process ID', field: 'ProcessId' },
    { label: 'Image', field: 'Image' },
    { label: 'User', field: 'User' },
    { label: 'Protocol', field: 'Protocol' },
    { label: 'Initiated', field: 'Initiated' },
    { label: 'Source IP', field: 'SourceIp', category: 'Source' },
    { label: 'Source Hostname', field: 'SourceHostname', category: 'Source' },
    { label: 'Source Port', field: 'SourcePort', category: 'Source' },
    { label: 'Source Port Name', field: 'SourcePortName', category: 'Source' },
    { label: 'Source Country', field: 'SourceCountry', category: 'Source' },
    { label: 'Source Is IPv6', field: 'SourceIsIpv6', category: 'Source' },
    { label: 'Destination IP', field: 'DestinationIp', category: 'Destination' },
    { label: 'Destination Hostname', field: 'DestinationHostname', category: 'Destination' },
    { label: 'Destination Port', field: 'DestinationPort', category: 'Destination' },
    { label: 'Destination Port Name', field: 'DestinationPortName', category: 'Destination' },
    { label: 'Destination Country', field: 'DestinationCountry', category: 'Destination' },
    { label: 'Destination Is IPv6', field: 'DestinationIsIpv6', category: 'Destination' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
  7: [ // Image Loaded
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Process GUID', field: 'ProcessGuid' },
    { label: 'Process ID', field: 'ProcessId' },
    { label: 'Image', field: 'Image' },
    { label: 'Image Loaded', field: 'ImageLoaded' },
    { label: 'Original File Name', field: 'OriginalFileName' },
    { label: 'Signed', field: 'Signed' },
    { label: 'Signature', field: 'Signature' },
    { label: 'Hashes', field: 'Hashes', category: 'Hashes' },
    { label: 'MD5', field: 'MD5', category: 'Hashes' },
    { label: 'SHA1', field: 'SHA1', category: 'Hashes' },
    { label: 'SHA256', field: 'SHA256', category: 'Hashes' },
    { label: 'IMPHASH', field: 'IMPHASH', category: 'Hashes' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
  2: [ // File Creation Time Changed
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Process GUID', field: 'ProcessGuid' },
    { label: 'Process ID', field: 'ProcessId' },
    { label: 'Image', field: 'Image' },
    { label: 'Target Filename', field: 'TargetFilename' },
    { label: 'Creation UTC Time', field: 'CreationUtcTime' },
    { label: 'Previous Creation UTC Time', field: 'PreviousCreationUtcTime' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
  5: [ // Process Terminated
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Process GUID', field: 'ProcessGuid' },
    { label: 'Process ID', field: 'ProcessId' },
    { label: 'Image', field: 'Image' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
  6: [ // Driver Loaded
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Image Loaded', field: 'ImageLoaded' },
    { label: 'Signed', field: 'Signed' },
    { label: 'Signature', field: 'Signature' },
    { label: 'Hashes', field: 'Hashes', category: 'Hashes' },
    { label: 'MD5', field: 'MD5', category: 'Hashes' },
    { label: 'SHA1', field: 'SHA1', category: 'Hashes' },
    { label: 'SHA256', field: 'SHA256', category: 'Hashes' },
    { label: 'IMPHASH', field: 'IMPHASH', category: 'Hashes' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
  8: [ // CreateRemoteThread Detected
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Source Process GUID', field: 'SourceProcessGuid', category: 'Source' },
    { label: 'Source Process ID', field: 'SourceProcessId', category: 'Source' },
    { label: 'Source Image', field: 'SourceImage', category: 'Source' },
    { label: 'Target Process GUID', field: 'TargetProcessGuid', category: 'Target' },
    { label: 'Target Process ID', field: 'TargetProcessId', category: 'Target' },
    { label: 'Target Image', field: 'TargetImage', category: 'Target' },
    { label: 'New Thread ID', field: 'NewThreadId' },
    { label: 'Start Address', field: 'StartAddress' },
    { label: 'Start Module', field: 'StartModule' },
    { label: 'Start Function', field: 'StartFunction' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
  9: [ // RawAccessRead Detected
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Process GUID', field: 'ProcessGuid' },
    { label: 'Process ID', field: 'ProcessId' },
    { label: 'Image', field: 'Image' },
    { label: 'Device', field: 'Device' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
  10: [ // Process Accessed
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Source Process GUID', field: 'SourceProcessGUID', category: 'Source' },
    { label: 'Source Process ID', field: 'SourceProcessId', category: 'Source' },
    { label: 'Source Thread ID', field: 'SourceThreadId', category: 'Source' },
    { label: 'Source Image', field: 'SourceImage', category: 'Source' },
    { label: 'Target Process GUID', field: 'TargetProcessGUID', category: 'Target' },
    { label: 'Target Process ID', field: 'TargetProcessId', category: 'Target' },
    { label: 'Target Image', field: 'TargetImage', category: 'Target' },
    { label: 'Granted Access', field: 'GrantedAccess' },
    { label: 'Call Trace', field: 'CallTrace' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
  11: [ // File Created
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Process GUID', field: 'ProcessGuid' },
    { label: 'Process ID', field: 'ProcessId' },
    { label: 'Image', field: 'Image' },
    { label: 'Target Filename', field: 'TargetFilename' },
    { label: 'Creation UTC Time', field: 'CreationUtcTime' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
  12: [ // Registry Object Added or Deleted
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Process GUID', field: 'ProcessGuid' },
    { label: 'Process ID', field: 'ProcessId' },
    { label: 'Image', field: 'Image' },
    { label: 'Event Type', field: 'EventType2' },
    { label: 'Target Object', field: 'TargetObject' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
  13: [ // Registry Value Set
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Process GUID', field: 'ProcessGuid' },
    { label: 'Process ID', field: 'ProcessId' },
    { label: 'Image', field: 'Image' },
    { label: 'Event Type', field: 'EventType2' },
    { label: 'Target Object', field: 'TargetObject' },
    { label: 'Details', field: 'Details' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
  14: [ // Registry Object Renamed
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Process GUID', field: 'ProcessGuid' },
    { label: 'Process ID', field: 'ProcessId' },
    { label: 'Image', field: 'Image' },
    { label: 'Event Type', field: 'EventType2' },
    { label: 'Target Object', field: 'TargetObject' },
    { label: 'New Name', field: 'NewName' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
  15: [ // File Stream Created
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Process GUID', field: 'ProcessGuid' },
    { label: 'Process ID', field: 'ProcessId' },
    { label: 'Image', field: 'Image' },
    { label: 'Target Filename', field: 'TargetFilename' },
    { label: 'Creation UTC Time', field: 'CreationUtcTime' },
    { label: 'Hashes', field: 'Hashes', category: 'Hashes' },
    { label: 'MD5', field: 'MD5', category: 'Hashes' },
    { label: 'SHA1', field: 'SHA1', category: 'Hashes' },
    { label: 'SHA256', field: 'SHA256', category: 'Hashes' },
    { label: 'IMPHASH', field: 'IMPHASH', category: 'Hashes' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
  17: [ // Pipe Created
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Process GUID', field: 'ProcessGuid' },
    { label: 'Process ID', field: 'ProcessId' },
    { label: 'Pipe Name', field: 'PipeName' },
    { label: 'Image', field: 'Image' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
  18: [ // Pipe Connected
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Process GUID', field: 'ProcessGuid' },
    { label: 'Process ID', field: 'ProcessId' },
    { label: 'Pipe Name', field: 'PipeName' },
    { label: 'Image', field: 'Image' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
  19: [ // WMI Event Filter Activity
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Operation', field: 'Operation' },
    { label: 'User', field: 'User' },
    { label: 'Event Namespace', field: 'EventNamespace' },
    { label: 'Name', field: 'Name' },
    { label: 'Query', field: 'Query' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
  20: [ // WMI Event Consumer Activity
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Operation', field: 'Operation' },
    { label: 'User', field: 'User' },
    { label: 'Name', field: 'Name' },
    { label: 'Type', field: 'Type' },
    { label: 'Destination', field: 'Destination' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
  21: [ // WMI Event Consumer To Filter Activity
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Operation', field: 'Operation' },
    { label: 'User', field: 'User' },
    { label: 'Consumer', field: 'Consumer' },
    { label: 'Filter', field: 'Filter' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
  22: [ // DNS Query
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Process GUID', field: 'ProcessGuid' },
    { label: 'Process ID', field: 'ProcessId' },
    { label: 'Image', field: 'Image' },
    { label: 'Query Name', field: 'QueryName' },
    { label: 'Query Status', field: 'QueryStatus' },
    { label: 'Query Status Description', field: 'QueryStatusDescription' },
    { label: 'Query Results', field: 'QueryResults' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
  23: [ // File Delete Archived
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Process GUID', field: 'ProcessGuid' },
    { label: 'Process ID', field: 'ProcessId' },
    { label: 'Image', field: 'Image' },
    { label: 'User', field: 'User' },
    { label: 'Target Filename', field: 'TargetFilename' },
    { label: 'Is Executable', field: 'IsExecutable' },
    { label: 'Archived', field: 'Archived' },
    { label: 'Hashes', field: 'Hashes', category: 'Hashes' },
    { label: 'MD5', field: 'MD5', category: 'Hashes' },
    { label: 'SHA1', field: 'SHA1', category: 'Hashes' },
    { label: 'SHA256', field: 'SHA256', category: 'Hashes' },
    { label: 'IMPHASH', field: 'IMPHASH', category: 'Hashes' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
  24: [ // Clipboard Change
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Process GUID', field: 'ProcessGuid' },
    { label: 'Process ID', field: 'ProcessId' },
    { label: 'Image', field: 'Image' },
    { label: 'Session', field: 'Session' },
    { label: 'Client Info', field: 'ClientInfo' },
    { label: 'Archived', field: 'Archived' },
    { label: 'Hashes', field: 'Hashes', category: 'Hashes' },
    { label: 'MD5', field: 'MD5', category: 'Hashes' },
    { label: 'SHA1', field: 'SHA1', category: 'Hashes' },
    { label: 'SHA256', field: 'SHA256', category: 'Hashes' },
    { label: 'IMPHASH', field: 'IMPHASH', category: 'Hashes' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
  25: [ // Process Tampering
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Process GUID', field: 'ProcessGuid' },
    { label: 'Process ID', field: 'ProcessId' },
    { label: 'Image', field: 'Image' },
    { label: 'Type', field: 'EventType2' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
  26: [ // File Delete Detected
    { label: 'UTC Time', field: 'UtcTime' },
    { label: 'Process GUID', field: 'ProcessGuid' },
    { label: 'Process ID', field: 'ProcessId' },
    { label: 'Image', field: 'Image' },
    { label: 'User', field: 'User' },
    { label: 'Target Filename', field: 'TargetFilename' },
    { label: 'Is Executable', field: 'IsExecutable' },
    { label: 'Hashes', field: 'Hashes', category: 'Hashes' },
    { label: 'MD5', field: 'MD5', category: 'Hashes' },
    { label: 'SHA1', field: 'SHA1', category: 'Hashes' },
    { label: 'SHA256', field: 'SHA256', category: 'Hashes' },
    { label: 'IMPHASH', field: 'IMPHASH', category: 'Hashes' },
    { label: 'Rule Name', field: 'RuleName' },
    { label: 'Computer', field: 'Computer' },
  ],
};

// Fields to exclude from the "remaining" auto-display
const META_FIELDS = new Set(['EventType', 'EventTypeName', 'FID', 'ImageExe', 'ParentImageExe',
  'ImageLoadedExe', 'SourceImageExe', 'TargetImageExe', 'EventType2']);

interface EventDetailPanelProps {
  eventType: number;
  gid: number;
  onClose: () => void;
  /** Stagger offset so multiple windows don't stack exactly */
  index?: number;
  onFocus?: () => void;
  zIndex?: number;
}

export default function EventDetailPanel({ eventType, gid, onClose, index = 0, onFocus, zIndex = 50 }: EventDetailPanelProps) {
  const [record, setRecord] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dragging state
  const [pos, setPos] = useState({ x: 120 + index * 30, y: 60 + index * 30 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const windowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tableName = EVENT_TABLE_MAP[eventType];
    if (!tableName) {
      setError(`Unknown event type: ${eventType}`);
      setLoading(false);
      return;
    }

    setLoading(true);
    window.sysmonApi.db
      .query(`SELECT * FROM ${tableName} WHERE FID = ?`, [gid])
      .then((rows: any[]) => {
        if (rows.length > 0) {
          setRecord(rows[0]);
        } else {
          setError('Event record not found');
        }
      })
      .catch((err: any) => setError(err.message))
      .finally(() => setLoading(false));
  }, [eventType, gid]);

  // Drag handlers
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag from the title bar area
    e.preventDefault();
    onFocus?.();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setPos({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
    };
    const onMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [pos.x, pos.y, onFocus]);

  const eventTypeName = (SYSMON_EVENT_TYPES as any)[eventType] ?? `Event ${eventType}`;

  return (
    <div
      ref={windowRef}
      className="fixed bg-surface-800 border border-gray-600 rounded-lg shadow-2xl flex flex-col"
      style={{
        left: pos.x,
        top: pos.y,
        width: 700,
        height: '70vh',
        maxHeight: '85vh',
        minHeight: 200,
        zIndex,
        resize: 'both',
        overflow: 'hidden',
      }}
      onMouseDown={() => onFocus?.()}
    >
      {/* Title bar — draggable */}
      <div
        className="flex items-center justify-between px-4 py-2 bg-surface-950 rounded-t-lg border-b border-gray-700 cursor-move select-none shrink-0"
        onMouseDown={onMouseDown}
      >
        <h2 className="text-sm font-semibold text-gray-200 truncate pr-4">
          {eventTypeName} — Event Details (GID: {gid})
        </h2>
        <button
          onClick={onClose}
          onMouseDown={(e) => e.stopPropagation()}
          className="text-gray-400 hover:text-white hover:bg-red-600/40 rounded text-lg leading-none px-2 py-0.5"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-1">
        {loading && (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        )}
        {error && (
          <div className="p-8 text-center text-red-400">{error}</div>
        )}
        {record && (
          <FieldGrid eventType={eventType} record={record} />
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 px-4 py-2 border-t border-gray-700 shrink-0">
        <button
          onClick={() => {
            if (record) {
              const text = Object.entries(record)
                .filter(([k]) => !META_FIELDS.has(k))
                .map(([k, v]) => `${k}: ${v ?? ''}`)
                .join('\n');
              navigator.clipboard.writeText(text);
            }
          }}
          className="px-3 py-1.5 text-xs bg-surface-700 text-gray-300 rounded hover:bg-surface-600"
        >
          Copy All
        </button>
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs bg-accent-600 text-white rounded hover:bg-accent-500"
        >
          Close
        </button>
      </div>
    </div>
  );
}

/**
 * Renders the field-name / value vertical grid.
 * Uses FIELD_CONFIG for known event types (ordered, labeled, categorized).
 * Falls back to displaying all columns for event types without explicit config.
 */
function FieldGrid({ eventType, record }: { eventType: number; record: Record<string, unknown> }) {
  const config = FIELD_CONFIG[eventType];

  if (config) {
    // Render with known field ordering and categories
    const shownFields = new Set(config.map((f) => f.field));
    const remainingFields = Object.keys(record).filter(
      (k) => !shownFields.has(k) && !META_FIELDS.has(k)
    );

    let currentCategory: string | undefined = undefined;

    return (
      <table className="w-full text-xs">
        <tbody>
          {config.map((field) => {
            const value = record[field.field];
            const showCategoryHeader = field.category && field.category !== currentCategory;
            if (field.category) currentCategory = field.category;

            return (
              <FieldRowWithCategory
                key={field.field}
                label={field.label}
                value={value}
                categoryHeader={showCategoryHeader ? field.category : undefined}
              />
            );
          })}
          {remainingFields.map((key) => (
            <FieldRow key={key} label={key} value={record[key]} />
          ))}
        </tbody>
      </table>
    );
  }

  // Fallback: show all fields in database order
  return (
    <table className="w-full text-xs">
      <tbody>
        {Object.entries(record)
          .filter(([k]) => !META_FIELDS.has(k))
          .map(([key, value]) => (
            <FieldRow key={key} label={key} value={value} />
          ))}
      </tbody>
    </table>
  );
}

function FieldRowWithCategory({
  label,
  value,
  categoryHeader,
}: {
  label: string;
  value: unknown;
  categoryHeader?: string;
}) {
  return (
    <>
      {categoryHeader && (
        <tr>
          <td
            colSpan={2}
            className="px-4 py-1.5 bg-surface-950 text-gray-500 font-semibold text-[10px] uppercase tracking-wider"
          >
            {categoryHeader}
          </td>
        </tr>
      )}
      <FieldRow label={label} value={value} />
    </>
  );
}

// VT-lookupable hash labels
const VT_HASH_LABELS = new Set(['MD5', 'SHA1', 'SHA256', 'IMPHASH']);

// IP address field labels
const IP_LABELS = new Set([
  'Source IP', 'Destination IP', 'SourceIp', 'DestinationIp',
]);

// IPv4 pattern for validating IP values
const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

// Private/reserved IP ranges — same as electron/geoip.ts, ported from Delphi Utilities.pas
function ipToNum(ip: string): number {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

const PRIVATE_RANGES: [number, number][] = [
  [ipToNum('0.0.0.0'),       ipToNum('0.255.255.255')],
  [ipToNum('10.0.0.0'),      ipToNum('10.255.255.255')],
  [ipToNum('127.0.0.0'),     ipToNum('127.255.255.255')],
  [ipToNum('169.254.0.0'),   ipToNum('169.254.255.255')],
  [ipToNum('172.16.0.0'),    ipToNum('172.31.255.255')],
  [ipToNum('192.0.2.0'),     ipToNum('192.0.2.255')],
  [ipToNum('192.88.99.0'),   ipToNum('192.88.99.255')],
  [ipToNum('192.168.0.0'),   ipToNum('192.168.255.255')],
  [ipToNum('198.18.0.0'),    ipToNum('198.19.255.255')],
  [ipToNum('198.51.100.0'),  ipToNum('198.51.100.255')],
  [ipToNum('203.0.113.0'),   ipToNum('203.0.113.255')],
  [ipToNum('224.0.0.0'),     ipToNum('239.255.255.255')],
  [ipToNum('240.0.0.0'),     ipToNum('255.255.255.255')],
];

function isPrivateIp(ip: string): boolean {
  if (!IPV4_RE.test(ip)) return true;
  const num = ipToNum(ip);
  return PRIVATE_RANGES.some(([lo, hi]) => num >= lo && num <= hi);
}

type VtLookupType = 'hash' | 'ip';

function FieldRow({ label, value }: { label: string; value: unknown }) {
  const displayValue = value === null || value === undefined ? '' : String(value);
  const isHash = ['MD5', 'SHA1', 'SHA256', 'IMPHASH'].includes(label) ||
                 label.toLowerCase().includes('hash');
  const isPath = label === 'Image' || label === 'Parent Image' || label === 'Image Loaded' ||
                 label === 'Command Line' || label === 'Parent Command Line' ||
                 label === 'Target Filename' || label === 'Current Directory';
  const isIpField = IP_LABELS.has(label);

  const canLookupHash = VT_HASH_LABELS.has(label) && displayValue && displayValue !== 'nohash';
  const canLookupIp = isIpField && displayValue && IPV4_RE.test(displayValue) &&
                      !isPrivateIp(displayValue);
  const canLookupVt = canLookupHash || canLookupIp;
  const lookupType: VtLookupType = canLookupHash ? 'hash' : 'ip';

  const [vtHashResult, setVtHashResult] = useState<VtResult | null>(null);
  const [vtIpResult, setVtIpResult] = useState<VtIpResult | null>(null);
  const [vtLoading, setVtLoading] = useState(false);
  const [vtError, setVtError] = useState<string | null>(null);
  const [showTerms, setShowTerms] = useState(false);
  const [showKeyPrompt, setShowKeyPrompt] = useState(false);
  const [vtKeyInput, setVtKeyInput] = useState('');

  const hasResult = vtHashResult || vtIpResult;

  const doVtLookup = useCallback(async (val: string, type: VtLookupType) => {
    const accepted = await window.sysmonApi.settings.get('acceptedVirusTotalToS');
    if (accepted !== 'true') {
      setShowTerms(true);
      return;
    }

    let key = await window.sysmonApi.vt.getKey();
    if (!key) {
      setShowKeyPrompt(true);
      return;
    }

    setVtLoading(true);
    setVtError(null);
    try {
      if (type === 'hash') {
        const result = await window.sysmonApi.vt.lookup(key, val);
        setVtHashResult(result);
      } else {
        const result = await window.sysmonApi.vt.lookupIp(key, val);
        setVtIpResult(result);
      }
    } catch (err: any) {
      setVtError(err.message);
    } finally {
      setVtLoading(false);
    }
  }, []);

  return (
    <>
      <tr className="border-b border-gray-800 hover:bg-surface-700">
        <td className="px-4 py-2 text-gray-400 font-medium w-48 align-top whitespace-nowrap">
          {label}
        </td>
        <td className={`px-4 py-2 text-gray-200 break-all ${
          isHash ? 'font-mono text-[11px] text-amber-300' :
          isPath || isIpField ? 'font-mono text-[11px]' : ''
        }`}>
          {displayValue || <span className="text-gray-600">—</span>}
          {canLookupVt && !hasResult && !vtLoading && (
            <button
              onClick={() => doVtLookup(displayValue, lookupType)}
              className="ml-2 px-1.5 py-0.5 text-[10px] bg-surface-700 text-gray-400 rounded hover:bg-surface-600 hover:text-white"
              title={`Check on VirusTotal (${lookupType === 'hash' ? 'file report' : 'IP report'})`}
            >
              VT
            </button>
          )}
          {canLookupVt && displayValue && (
            <button
              onClick={() => {
                const url = lookupType === 'hash'
                  ? `https://www.virustotal.com/gui/search/${encodeURIComponent(displayValue)}`
                  : `https://www.virustotal.com/gui/ip-address/${encodeURIComponent(displayValue)}`;
                window.sysmonApi.shell.openExternal(url);
              }}
              className="ml-2 px-1.5 py-0.5 text-[10px] text-blue-400 hover:text-blue-300 underline cursor-pointer"
              title="View on VirusTotal"
            >
              VT Report
            </button>
          )}
          {vtLoading && (
            <span className="ml-2 text-[10px] text-blue-400">Checking VT...</span>
          )}
          {vtError && (
            <span className="ml-2 text-[10px] text-red-400">{vtError}</span>
          )}
        </td>
      </tr>

      {/* VT hash result row */}
      {vtHashResult && (
        <tr className="border-b border-gray-800 bg-surface-900">
          <td className="px-4 py-1.5 text-gray-500 text-[10px] align-top">VT Result</td>
          <td className="px-4 py-1.5 text-[11px]">
            {vtHashResult.found ? (
              <span className="flex items-center gap-3 flex-wrap">
                <span className={vtHashResult.positives > 0 ? 'text-red-400 font-bold' : 'text-green-400'}>
                  {vtHashResult.positives}/{vtHashResult.total} detections
                </span>
                <span className="text-gray-500">{vtHashResult.scanDate}</span>
                {vtHashResult.permalink && (
                  <button
                    onClick={() => window.sysmonApi.shell.openExternal(vtHashResult.permalink)}
                    className="text-blue-400 hover:text-blue-300 underline cursor-pointer"
                  >
                    Full Report
                  </button>
                )}
              </span>
            ) : (
              <span className="text-gray-500">{vtHashResult.verboseMsg}</span>
            )}
          </td>
        </tr>
      )}

      {/* VT IP result row */}
      {vtIpResult && (
        <tr className="border-b border-gray-800 bg-surface-900">
          <td className="px-4 py-1.5 text-gray-500 text-[10px] align-top">VT IP Report</td>
          <td className="px-4 py-1.5 text-[11px]">
            {vtIpResult.found ? (
              <span className="flex items-center gap-3 flex-wrap">
                <span className={vtIpResult.detectedUrls > 0 || vtIpResult.detectedSamples > 0
                  ? 'text-red-400 font-bold' : 'text-green-400'}>
                  {vtIpResult.detectedUrls} malicious URLs, {vtIpResult.detectedSamples} malicious samples
                </span>
                {vtIpResult.country && (
                  <span className="text-gray-400">Country: {vtIpResult.country}</span>
                )}
                {vtIpResult.asOwner && (
                  <span className="text-gray-500">AS: {vtIpResult.asOwner}</span>
                )}
                <button
                  onClick={() => window.sysmonApi.shell.openExternal(`https://www.virustotal.com/gui/ip-address/${encodeURIComponent(displayValue)}`)}
                  className="text-blue-400 hover:text-blue-300 underline cursor-pointer"
                >
                  Full Report
                </button>
              </span>
            ) : (
              <span className="text-gray-500">{vtIpResult.verboseMsg}</span>
            )}
          </td>
        </tr>
      )}

      {/* T&C dialog */}
      {showTerms && (
        <tr><td colSpan={2} className="p-0">
          <TermsDialog
            serviceName="VirusTotal"
            termsUrl="https://www.virustotal.com/about/terms-of-service"
            onAccept={async () => {
              await window.sysmonApi.settings.set('acceptedVirusTotalToS', 'true');
              setShowTerms(false);
              doVtLookup(displayValue, lookupType);
            }}
            onCancel={() => setShowTerms(false)}
          />
        </td></tr>
      )}

      {/* API key prompt */}
      {showKeyPrompt && (
        <tr className="border-b border-gray-800 bg-surface-900">
          <td className="px-4 py-2 text-gray-400 text-[10px] align-middle">VT API Key</td>
          <td className="px-4 py-2 flex items-center gap-2">
            <input
              type="password"
              value={vtKeyInput}
              onChange={(e) => setVtKeyInput(e.target.value)}
              placeholder="Enter VirusTotal API key"
              className="px-2 py-1 text-xs bg-surface-700 border border-gray-600 rounded text-gray-200 w-64 focus:outline-none focus:border-blue-500"
              autoFocus
            />
            <button
              onClick={async () => {
                if (vtKeyInput) {
                  await window.sysmonApi.vt.setKey(vtKeyInput);
                  setShowKeyPrompt(false);
                  doVtLookup(displayValue, lookupType);
                }
              }}
              className="px-2 py-1 text-xs bg-accent-600 text-white rounded hover:bg-accent-500"
            >
              Save & Lookup
            </button>
            <button
              onClick={() => setShowKeyPrompt(false)}
              className="px-2 py-1 text-xs bg-surface-700 text-gray-400 rounded hover:bg-surface-600"
            >
              Cancel
            </button>
          </td>
        </tr>
      )}
    </>
  );
}
