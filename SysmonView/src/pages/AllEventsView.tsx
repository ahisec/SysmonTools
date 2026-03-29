import { useEffect, useState, useCallback, useRef } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import type { AllEventsRow } from '../types/events';
import EventDetailPanel from '../components/EventDetailPanel';
import GroupableGrid from '../components/GroupableGrid';

/**
 * All Events tab — mirrors Delphi TabSheetAllEvents.
 *
 * Uses server-side pagination (SQL LIMIT/OFFSET) for performance.
 * Supports hierarchical grouping, sorting, and filtering.
 */

const columnHelper = createColumnHelper<AllEventsRow>();

const columns = [
  columnHelper.accessor('EventTypeName', {
    header: 'Event Type',
    size: 220,
  }),
  columnHelper.accessor('UtcTime', {
    header: 'Time (UTC)',
    size: 180,
  }),
  columnHelper.accessor('CorrelationGuid', {
    header: 'Session GUID',
    size: 280,
  }),
  columnHelper.accessor('EventDetails', {
    header: 'Details',
    size: 400,
  }),
  columnHelper.accessor('Computer', {
    header: 'Computer',
    size: 150,
  }),
  columnHelper.accessor('RuleName', {
    header: 'Rule',
    size: 120,
  }),
  columnHelper.accessor('GID', {
    header: 'ID',
    size: 60,
  }),
];

const DEFAULT_PAGE_SIZE = 500;

export default function AllEventsView() {
  const [rowData, setRowData] = useState<AllEventsRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [filterText, setFilterText] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailWindows, setDetailWindows] = useState<{ eventType: number; gid: number; key: number }[]>([]);
  const [topZ, setTopZ] = useState(50);
  const [windowZ, setWindowZ] = useState<Record<number, number>>({});
  const initialLoad = useRef(true);

  const loadPage = useCallback(async (p: number, size: number, filter: string) => {
    if (initialLoad.current) {
      setLoading(true);
      initialLoad.current = false;
    }
    try {
      const offset = (p - 1) * size;

      if (filter) {
        // Server-side filter: search across key text columns
        const likeParam = `%${filter}%`;
        const countRows: any[] = await window.sysmonApi.db.query(
          `SELECT COUNT(*) as cnt FROM AllEvents
           WHERE EventTypeName LIKE ? OR EventDetails LIKE ? OR Computer LIKE ? OR RuleName LIKE ? OR CorrelationGuid LIKE ?`,
          [likeParam, likeParam, likeParam, likeParam, likeParam]
        );
        setTotalRows(countRows[0]?.cnt ?? 0);

        const rows = await window.sysmonApi.db.query(
          `SELECT * FROM AllEvents
           WHERE EventTypeName LIKE ? OR EventDetails LIKE ? OR Computer LIKE ? OR RuleName LIKE ? OR CorrelationGuid LIKE ?
           ORDER BY UtcTime DESC LIMIT ? OFFSET ?`,
          [likeParam, likeParam, likeParam, likeParam, likeParam, size, offset]
        );
        setRowData(rows as AllEventsRow[]);
      } else {
        const countRows: any[] = await window.sysmonApi.db.query(
          'SELECT COUNT(*) as cnt FROM AllEvents'
        );
        setTotalRows(countRows[0]?.cnt ?? 0);

        const rows = await window.sysmonApi.db.query(
          'SELECT * FROM AllEvents ORDER BY UtcTime DESC LIMIT ? OFFSET ?',
          [size, offset]
        );
        setRowData(rows as AllEventsRow[]);
      }
    } catch (err) {
      console.error('Failed to load events:', err);
      setRowData([]);
      setTotalRows(0);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load data when page, pageSize, or filter changes
  useEffect(() => {
    loadPage(page, pageSize, filterText);
  }, [page, pageSize, filterText, loadPage]);

  const onPageChange = useCallback((newPage: number) => {
    setPage(newPage);
  }, []);

  const onPageSizeChange = useCallback((newSize: number) => {
    setPageSize(newSize);
    setPage(1); // Reset to first page
  }, []);

  const onFilterChange = useCallback((value: string) => {
    setFilterText(value);
    setPage(1); // Reset to first page on filter
  }, []);

  const onRowDoubleClick = useCallback((row: AllEventsRow) => {
    const key = Date.now();
    setDetailWindows((prev) => [...prev, { eventType: row.EventType, gid: row.GID, key }]);
    setTopZ((z) => z + 1);
    setWindowZ((prev) => ({ ...prev, [key]: topZ + 1 }));
  }, [topZ]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Loading events...
      </div>
    );
  }

  if (totalRows === 0 && !filterText) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        No events. Import Sysmon XML logs to begin.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <GroupableGrid<AllEventsRow>
        data={rowData}
        columns={columns}
        onRowDoubleClick={onRowDoubleClick}
        globalFilterPlaceholder="Filter events..."
        onGlobalFilterChange={onFilterChange}
        pagination={{
          page,
          pageSize,
          totalRows,
          onPageChange,
          onPageSizeChange,
        }}
      />
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
