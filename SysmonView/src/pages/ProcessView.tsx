import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import SessionDiagram from '../components/SessionDiagram';
import EventDetailPanel from '../components/EventDetailPanel';

/**
 * Process View tab — mirrors Delphi TabSheetImages.
 *
 * Layout (from Delphi MainForm):
 *   Left panel:    List of executable names (ImageExe)
 *   Center panel:  List of full image paths for selected exe
 *   Right top:     Process sessions (ProcessGuid) for selected image
 *   Right bottom:  SESSION DIAGRAM — the signature visualization
 *
 * The diagram shows events as a vertical chain of color-coded nodes,
 * ordered chronologically, connected like an org chart. This is the core
 * feature that earned the Delphi app 1600+ GitHub stars.
 */

interface SessionRow {
  ProcessGuid: string;
}

interface SessionEvent {
  GID: number;
  UtcTime: string;
  EventType: number;
  EventTypeName: string;
  EventDetails: string;
  Computer: string;
  RuleName: string;
}

export default function ProcessView() {
  const [exeList, setExeList] = useState<string[]>([]);
  const [selectedExe, setSelectedExe] = useState<string | null>(null);
  const [imagePaths, setImagePaths] = useState<string[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [sessionEvents, setSessionEvents] = useState<SessionEvent[]>([]);
  const [tooManyEvents, setTooManyEvents] = useState(false);
  const [detailWindows, setDetailWindows] = useState<{ eventType: number; gid: number; key: number }[]>([]);
  const [topZ, setTopZ] = useState(50);
  const [windowZ, setWindowZ] = useState<Record<number, number>>({});
  const [exeFilter, setExeFilter] = useState('');
  const [pinnedGids, setPinnedGids] = useState<Set<number>>(new Set());
  const [pinMode, setPinMode] = useState(false);
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const [contextRange, setContextRange] = useState(0);
  const [hiddenEventTypes, setHiddenEventTypes] = useState<Set<number>>(new Set());
  const [eventTypeFilterOpen, setEventTypeFilterOpen] = useState(false);
  const [collapsedGids, setCollapsedGids] = useState<Set<number>>(new Set());
  const filterDropdownRef = useRef<HTMLDivElement>(null);

  // Close event type filter dropdown on outside click
  useEffect(() => {
    if (!eventTypeFilterOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target as HTMLElement)) {
        setEventTypeFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [eventTypeFilterOpen]);

  // Distinct event types in the current session for the filter dropdown
  const distinctEventTypes = useMemo(() => {
    const map = new Map<number, string>();
    for (const evt of sessionEvents) {
      if (!map.has(evt.EventType)) map.set(evt.EventType, evt.EventTypeName);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [sessionEvents]);

  // Events filtered by event type
  const typeFilteredEvents = useMemo(() => {
    if (hiddenEventTypes.size === 0) return sessionEvents;
    return sessionEvents.filter((e) => !hiddenEventTypes.has(e.EventType));
  }, [sessionEvents, hiddenEventTypes]);

  const toggleEventType = useCallback((eventType: number) => {
    setHiddenEventTypes((prev) => {
      const next = new Set(prev);
      if (next.has(eventType)) next.delete(eventType);
      else next.add(eventType);
      return next;
    });
  }, []);

  const toggleCollapse = useCallback((gid: number) => {
    setCollapsedGids((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  }, []);

  const togglePin = useCallback((gid: number) => {
    setPinnedGids((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  }, []);

  const clearPins = useCallback(() => {
    setPinnedGids(new Set());
    setShowPinnedOnly(false);
    setPinMode(false);
  }, []);

  // Enrich events with the field of interest from the event-specific table.
  // Each event type has a key field that the diagram node should display.
  const enrichEvents = useCallback(async (events: SessionEvent[]): Promise<SessionEvent[]> => {
    if (events.length === 0) return events;

    // Map: eventType → { table, field, formatter }
    const FOCUS_FIELDS: Record<number, { table: string; field: string; shorten?: 'filename' | 'keyname' }> = {
      1:  { table: 'ProcessCreate', field: 'CommandLine' },
      2:  { table: 'FileCreationTimeChanged', field: 'TargetFilename', shorten: 'filename' },
      3:  { table: 'NetworkConnectionDetected', field: "SourceIp || ':' || SourcePort || ' → ' || DestinationIp || ':' || DestinationPort" },
      5:  { table: 'ProcessTerminated', field: 'Image', shorten: 'filename' },
      6:  { table: 'DriverLoaded', field: 'ImageLoaded', shorten: 'filename' },
      7:  { table: 'ImageLoaded', field: 'ImageLoaded', shorten: 'filename' },
      8:  { table: 'CreateRemoteThreadDetected', field: 'TargetImage', shorten: 'filename' },
      9:  { table: 'RawAccessReadDetected', field: 'Device' },
      10: { table: 'ProcessAccessed', field: 'TargetImage', shorten: 'filename' },
      11: { table: 'FileCreated', field: 'TargetFilename', shorten: 'filename' },
      12: { table: 'RegistryObjectAddedOrDeleted', field: 'TargetObject', shorten: 'keyname' },
      13: { table: 'RegistryValueSet', field: 'TargetObject', shorten: 'keyname' },
      14: { table: 'RegistryObjectRenamed', field: 'TargetObject', shorten: 'keyname' },
      15: { table: 'FileStreamCreated', field: 'TargetFilename', shorten: 'filename' },
      17: { table: 'PipeCreated', field: 'PipeName' },
      18: { table: 'PipeConnected', field: 'PipeName' },
      22: { table: 'DNSQuery', field: 'QueryName' },
      23: { table: 'FileDeleteArchived', field: 'TargetFilename', shorten: 'filename' },
      25: { table: 'ProcessTampering', field: 'EventType2' },
      26: { table: 'FileDeleteDetected', field: 'TargetFilename', shorten: 'filename' },
    };

    // Group events by type for batch queries
    const byType = new Map<number, SessionEvent[]>();
    for (const evt of events) {
      if (!byType.has(evt.EventType)) byType.set(evt.EventType, []);
      byType.get(evt.EventType)!.push(evt);
    }

    // focusDetail map: GID → focused string
    const focusMap = new Map<number, string>();

    for (const [eventType, evts] of byType) {
      const spec = FOCUS_FIELDS[eventType];
      if (!spec) continue;

      const gids = evts.map((e) => e.GID);
      const placeholders = gids.map(() => '?').join(',');
      try {
        const rows: any[] = await window.sysmonApi.db.query(
          `SELECT FID, ${spec.field} AS FocusValue FROM ${spec.table} WHERE FID IN (${placeholders})`,
          gids
        );
        for (const row of rows) {
          let val = row.FocusValue || '';
          if (spec.shorten === 'filename') {
            const lastSlash = val.lastIndexOf('\\');
            if (lastSlash >= 0) val = val.substring(lastSlash + 1);
          } else if (spec.shorten === 'keyname') {
            const lastSlash = val.lastIndexOf('\\');
            if (lastSlash >= 0) val = val.substring(lastSlash + 1);
          }
          focusMap.set(row.FID, val);
        }
      } catch {
        // If query fails for this type, leave EventDetails as-is
      }
    }

    // Replace EventDetails with the focused value where available
    return events.map((evt) => {
      const focused = focusMap.get(evt.GID);
      if (focused) {
        return { ...evt, EventDetails: focused };
      }
      return evt;
    });
  }, []);

  const filteredExeList = useMemo(() => {
    if (!exeFilter) return exeList;
    const lower = exeFilter.toLowerCase();
    return exeList.filter((exe) => exe.toLowerCase().includes(lower));
  }, [exeList, exeFilter]);

  // Load the list of unique executable names
  useEffect(() => {
    window.sysmonApi.db
      .query('SELECT ImageExe FROM AllImageExes GROUP BY LOWER(ImageExe) ORDER BY ImageExe')
      .then((rows: any[]) => setExeList(rows.map((r) => r.ImageExe).filter(Boolean)))
      .catch(() => setExeList([]));
  }, []);

  // When exe is selected → load image paths
  useEffect(() => {
    if (!selectedExe) { setImagePaths([]); return; }
    window.sysmonApi.db
      .query('SELECT Image FROM AllImageExes WHERE LOWER(ImageExe) = LOWER(?) GROUP BY LOWER(Image)', [selectedExe])
      .then((rows: any[]) => setImagePaths(rows.map((r) => r.Image).filter(Boolean)))
      .catch(() => setImagePaths([]));
    setSelectedImage(null);
    setSessions([]);
    setSelectedSession(null);
    setSessionEvents([]);
    setTooManyEvents(false);
  }, [selectedExe]);

  // When image path is selected → load sessions (ProcessGuids)
  useEffect(() => {
    if (!selectedImage) { setSessions([]); return; }
    window.sysmonApi.db
      .query('SELECT ProcessGuid FROM AllImageExes WHERE LOWER(Image) = LOWER(?) GROUP BY UPPER(ProcessGuid)', [selectedImage])
      .then((rows: any[]) => setSessions(rows as SessionRow[]))
      .catch(() => setSessions([]));
    setSelectedSession(null);
    setSessionEvents([]);
    setTooManyEvents(false);
    setPinnedGids(new Set());
    setShowPinnedOnly(false);
    setPinMode(false);
    setHiddenEventTypes(new Set());
    setCollapsedGids(new Set());
  }, [selectedImage]);

  // When session is selected → load correlated events from AllEvents
  // Mirrors Delphi: FDQueryGetSessionEvents with ProcessGuid param, ORDER BY UtcTime
  useEffect(() => {
    if (!selectedSession) { setSessionEvents([]); setTooManyEvents(false); return; }

    // First check count (Delphi warns if > 1000 events)
    window.sysmonApi.db
      .query(
        'SELECT COUNT(*) as cnt FROM AllEvents WHERE UPPER(CorrelationGuid) = UPPER(?)',
        [selectedSession]
      )
      .then((rows: any[]) => {
        const count = rows[0]?.cnt ?? 0;
        if (count > 2000) {
          setTooManyEvents(true);
          setSessionEvents([]);
          return;
        }
        setTooManyEvents(false);
        return window.sysmonApi.db.query(
          'SELECT * FROM AllEvents WHERE UPPER(CorrelationGuid) = UPPER(?) ORDER BY UtcTime',
          [selectedSession]
        );
      })
      .then(async (rows) => {
        if (rows) {
          const enriched = await enrichEvents(rows as SessionEvent[]);
          setSessionEvents(enriched);
        }
      })
      .catch(() => { setSessionEvents([]); setTooManyEvents(false); });
  }, [selectedSession]);

  return (
    <div className="flex h-full">
      {/* Left panel: Executable list */}
      <div className="w-56 border-r border-gray-700 flex flex-col">
        <PanelHeader>Executables ({filteredExeList.length})</PanelHeader>
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
          {exeList.length === 0 ? (
            <div className="p-4 text-sm text-gray-500 text-center">
              No data. Import Sysmon XML logs to begin.
            </div>
          ) : filteredExeList.length === 0 ? (
            <div className="p-4 text-sm text-gray-500 text-center">
              No matches
            </div>
          ) : (
            filteredExeList.map((exe) => (
              <ListItem key={exe} selected={selectedExe === exe} onClick={() => setSelectedExe(exe)}>
                {exe}
              </ListItem>
            ))
          )}
        </div>
      </div>

      {/* Center panel: Image paths */}
      <div className="w-72 border-r border-gray-700 flex flex-col">
        <PanelHeader>Image Paths {selectedExe ? `(${imagePaths.length})` : ''}</PanelHeader>
        <div className="flex-1 overflow-y-auto">
          {imagePaths.map((img) => (
            <ListItem key={img} selected={selectedImage === img} onClick={() => setSelectedImage(img)}>
              {img}
            </ListItem>
          ))}
        </div>
      </div>

      {/* Right panel: Sessions + Diagram */}
      <div className="flex-1 flex flex-col">
        {/* Sessions list */}
        <div className="h-36 border-b border-gray-700 flex flex-col">
          <PanelHeader>Sessions {selectedImage ? `(${sessions.length})` : ''}</PanelHeader>
          <div className="flex-1 overflow-y-auto">
            {sessions.map((s) => (
              <ListItem
                key={s.ProcessGuid}
                selected={selectedSession === s.ProcessGuid}
                onClick={() => setSelectedSession(s.ProcessGuid)}
              >
                {s.ProcessGuid}
              </ListItem>
            ))}
          </div>
        </div>

        {/* Pin toolbar + Session Event Diagram */}
        <div className="flex-1 flex flex-col relative">
          {/* Pin toolbar — shown when a session is selected */}
          {selectedSession && sessionEvents.length > 0 && !tooManyEvents && (
            <div className="flex items-center gap-3 px-3 py-1.5 bg-surface-800 border-b border-gray-700 shrink-0 text-xs flex-wrap">
              {/* Event type filter dropdown */}
              <div className="relative" ref={filterDropdownRef}>
                <button
                  onClick={() => setEventTypeFilterOpen((v) => !v)}
                  className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                    hiddenEventTypes.size > 0
                      ? 'bg-blue-600 text-white'
                      : 'bg-surface-700 text-gray-400 hover:bg-surface-600 hover:text-white'
                  }`}
                  title="Filter which event types to display"
                >
                  Event Filter {hiddenEventTypes.size > 0 ? `(${hiddenEventTypes.size} hidden)` : ''}
                </button>
                {eventTypeFilterOpen && (
                  <div className="absolute top-full left-0 mt-1 z-50 bg-surface-900 border border-gray-700 rounded shadow-xl py-1 min-w-[220px] max-h-[300px] overflow-y-auto">
                    <div className="px-3 py-1 border-b border-gray-700 flex gap-2">
                      <button
                        onClick={() => setHiddenEventTypes(new Set())}
                        className="text-[10px] text-blue-400 hover:text-blue-300"
                      >
                        Show All
                      </button>
                      <button
                        onClick={() => setHiddenEventTypes(new Set(distinctEventTypes.map(([id]) => id)))}
                        className="text-[10px] text-blue-400 hover:text-blue-300"
                      >
                        Hide All
                      </button>
                    </div>
                    {distinctEventTypes.map(([id, name]) => (
                      <label key={id} className="flex items-center gap-2 px-3 py-1 hover:bg-surface-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!hiddenEventTypes.has(id)}
                          onChange={() => toggleEventType(id)}
                          className="accent-blue-500"
                        />
                        <span className="text-gray-300 text-xs">{name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="w-px h-4 bg-gray-700" />

              {/* Pin controls */}
              <button
                onClick={() => setPinMode((v) => !v)}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  pinMode
                    ? 'bg-yellow-600 text-white'
                    : 'bg-surface-700 text-gray-400 hover:bg-surface-600 hover:text-white'
                }`}
                title={pinMode ? 'Disable pin mode' : 'Enable pin mode — click nodes to pin them'}
              >
                {pinMode ? 'Pin Mode ON' : 'Pin Mode'}
              </button>
              {pinMode && (
                <span className="text-gray-500">Click nodes to pin/unpin</span>
              )}
              {pinnedGids.size > 0 && (
                <span className="text-gray-400">{pinnedGids.size} pinned</span>
              )}
              {pinnedGids.size > 0 && (
                <>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showPinnedOnly}
                      onChange={(e) => setShowPinnedOnly(e.target.checked)}
                      className="accent-yellow-500"
                    />
                    <span className="text-gray-300">Show pinned only</span>
                  </label>
                  {showPinnedOnly && (
                    <label className="flex items-center gap-1.5">
                      <span className="text-gray-400">Context:</span>
                      <select
                        value={contextRange}
                        onChange={(e) => setContextRange(Number(e.target.value))}
                        className="bg-surface-950 border border-gray-700 rounded text-gray-200 text-xs px-1 py-0.5 focus:outline-none focus:border-blue-500"
                      >
                        <option value={0}>Pinned only</option>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                          <option key={n} value={n}>{n} before/after</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button
                    onClick={clearPins}
                    className="px-2 py-0.5 bg-surface-700 text-gray-400 rounded hover:bg-surface-600 hover:text-white"
                  >
                    Clear pins
                  </button>
                </>
              )}
            </div>
          )}

          <div className="flex-1">
          {tooManyEvents ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm p-4 text-center">
              Too many events for this session (over 2,000).<br />
              Use the "All Events" tab and filter by this session GUID instead.
            </div>
          ) : selectedSession ? (
            <SessionDiagram
              exeName={selectedExe || ''}
              sessionGuid={selectedSession}
              events={typeFilteredEvents}
              pinnedGids={pinnedGids}
              onTogglePin={pinMode ? togglePin : undefined}
              showPinnedOnly={showPinnedOnly}
              contextRange={contextRange}
              collapsedGids={collapsedGids}
              onToggleCollapse={toggleCollapse}
              onEventDoubleClick={(evt) => {
                const key = Date.now();
                setDetailWindows((prev) => [...prev, { eventType: evt.EventType, gid: evt.GID, key }]);
                setTopZ((z) => z + 1);
                setWindowZ((prev) => ({ ...prev, [key]: topZ + 1 }));
              }}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">
              {selectedImage
                ? 'Select a session to view the event diagram'
                : selectedExe
                  ? 'Select an image path'
                  : 'Select an executable from the left panel'}
            </div>
          )}
          </div>
        </div>
      </div>
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

function PanelHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-2 text-xs font-semibold text-gray-400 bg-surface-800 border-b border-gray-700 shrink-0">
      {children}
    </div>
  );
}

function ListItem({
  children,
  selected,
  onClick,
}: {
  children: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-xs truncate transition-colors ${
        selected
          ? 'bg-accent-600 text-white'
          : 'text-gray-300 hover:bg-surface-700'
      }`}
    >
      {children}
    </button>
  );
}
