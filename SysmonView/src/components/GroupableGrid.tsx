import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getGroupedRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type GroupingState,
  type ExpandedState,
  type Row,
} from '@tanstack/react-table';

interface PaginationInfo {
  page: number;
  pageSize: number;
  totalRows: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

interface GroupableGridProps<T> {
  data: T[];
  columns: ColumnDef<T, any>[];
  onRowDoubleClick?: (row: T) => void;
  globalFilterPlaceholder?: string;
  /** Server-side pagination info. When provided, the grid shows pagination controls. */
  pagination?: PaginationInfo;
  /** Called when the global filter text changes (for server-side filtering). */
  onGlobalFilterChange?: (value: string) => void;
}

const PAGE_SIZE_OPTIONS = [100, 250, 500, 1000, 5000];

/**
 * A dark-themed data grid with:
 *  - Drag column headers into a "group by" zone to create hierarchical grouping
 *  - Expand/collapse grouped rows
 *  - Global text filter
 *  - Column sorting
 *  - Optional server-side pagination
 */
export default function GroupableGrid<T>({
  data,
  columns,
  onRowDoubleClick,
  globalFilterPlaceholder = 'Filter events...',
  pagination,
  onGlobalFilterChange: onExternalFilterChange,
}: GroupableGridProps<T>) {
  const [grouping, setGrouping] = useState<GroupingState>([]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [expanded, setExpanded] = useState<ExpandedState>(true);
  const [globalFilter, setGlobalFilter] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFilterChange = useCallback((value: string) => {
    setGlobalFilter(value);
    if (onExternalFilterChange) {
      // Debounce server-side filter
      if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
      filterDebounceRef.current = setTimeout(() => {
        onExternalFilterChange(value);
      }, 300);
    }
  }, [onExternalFilterChange]);

  const table = useReactTable({
    data,
    columns,
    state: {
      grouping,
      sorting,
      expanded,
      // Only use client-side filter when no server-side pagination
      globalFilter: pagination ? '' : globalFilter,
    },
    onGroupingChange: setGrouping,
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    getExpandedRowModel: getExpandedRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  // Column id → header label map
  const columnLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const col of columns) {
      const id = (col as any).accessorKey ?? (col as any).id ?? '';
      const header = typeof col.header === 'string' ? col.header : id;
      if (id) map[id] = header;
    }
    return map;
  }, [columns]);

  // Drag from header
  const onDragStartHeader = useCallback((e: React.DragEvent, columnId: string) => {
    e.dataTransfer.setData('text/plain', columnId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  // Drop onto group zone
  const onDropGroupZone = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const columnId = e.dataTransfer.getData('text/plain');
    if (columnId && !grouping.includes(columnId)) {
      setGrouping((prev) => [...prev, columnId]);
    }
  }, [grouping]);

  const removeGrouping = useCallback((columnId: string) => {
    setGrouping((prev) => prev.filter((g) => g !== columnId));
  }, []);

  // Keyboard navigation
  const rows = table.getRowModel().rows;
  const selectedIndex = useMemo(() => {
    if (!selectedRowId) return -1;
    return rows.findIndex((r) => r.id === selectedRowId);
  }, [selectedRowId, rows]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(selectedIndex + 1, rows.length - 1);
      if (rows[next]) setSelectedRowId(rows[next].id);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = Math.max(selectedIndex - 1, 0);
      if (rows[prev]) setSelectedRowId(rows[prev].id);
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      const row = rows[selectedIndex];
      if (row.getIsGrouped()) {
        row.toggleExpanded();
      } else if (onRowDoubleClick && row.original) {
        onRowDoubleClick(row.original);
      }
    }
  }, [selectedIndex, rows, onRowDoubleClick]);

  // Auto-scroll selected row into view
  useEffect(() => {
    if (!selectedRowId || !tableContainerRef.current) return;
    const el = tableContainerRef.current.querySelector(`[data-row-id="${selectedRowId}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedRowId]);

  const toggleExpanded = useCallback((row: Row<T>) => {
    row.toggleExpanded();
  }, []);

  // Pagination calculations
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.totalRows / pagination.pageSize)) : 1;
  const displayedRowCount = pagination
    ? pagination.totalRows
    : table.getFilteredRowModel().rows.length;

  return (
    <div className="flex flex-col h-full text-gray-200" onKeyDown={handleKeyDown} tabIndex={0}>
      {/* Top bar: filter + group zone */}
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-800 border-b border-gray-700 shrink-0">
        {/* Filter input */}
        <div className="relative">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={globalFilter}
            onChange={(e) => handleFilterChange(e.target.value)}
            placeholder={globalFilterPlaceholder}
            className="pl-7 pr-2 py-1 text-xs bg-surface-950 border border-gray-700 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 w-56"
          />
          {globalFilter && (
            <button
              onClick={() => handleFilterChange('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
            >
              x
            </button>
          )}
        </div>

        {/* Group zone */}
        <div
          className={`flex-1 flex items-center gap-1 min-h-[28px] px-2 py-1 rounded border border-dashed text-xs transition-colors ${
            dragOver
              ? 'border-blue-400 bg-blue-500/10'
              : grouping.length > 0
              ? 'border-gray-600 bg-surface-900'
              : 'border-gray-700 bg-surface-900'
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDropGroupZone}
        >
          {grouping.length === 0 ? (
            <span className="text-gray-500 select-none">Drag column headers here to group</span>
          ) : (
            grouping.map((colId, i) => (
              <span key={colId} className="flex items-center gap-1">
                {i > 0 && <span className="text-gray-600 mx-0.5">&rsaquo;</span>}
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-600/20 text-blue-300 rounded text-xs border border-blue-500/30">
                  {columnLabels[colId] || colId}
                  <button
                    onClick={() => removeGrouping(colId)}
                    className="hover:text-white ml-0.5"
                  >
                    &times;
                  </button>
                </span>
              </span>
            ))
          )}
        </div>

        {/* Row count */}
        <span className="text-xs text-gray-500 shrink-0">
          {displayedRowCount.toLocaleString()} rows
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto" ref={tableContainerRef}>
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-3 py-2 text-left font-semibold text-gray-300 bg-[#0f1320] border-b border-gray-700 select-none whitespace-nowrap cursor-pointer hover:bg-[#1a1f2e]"
                    style={{ width: header.getSize() }}
                    draggable={!header.isPlaceholder}
                    onDragStart={(e) => onDragStartHeader(e, header.column.id)}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <span className="flex items-center gap-1">
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === 'asc' && <span className="text-blue-400">&#9650;</span>}
                      {header.column.getIsSorted() === 'desc' && <span className="text-blue-400">&#9660;</span>}
                      {grouping.includes(header.column.id) && (
                        <span className="text-blue-400 text-[10px] ml-1">(grouped)</span>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row) => {
              const isSelected = row.id === selectedRowId;
              const isGrouped = row.getIsGrouped();
              const depth = row.depth;

              return (
                <tr
                  key={row.id}
                  data-row-id={row.id}
                  className={`border-b border-gray-800 transition-colors ${
                    isSelected
                      ? 'bg-[#1e3a5f]'
                      : isGrouped
                      ? 'bg-[#0f1320] hover:bg-[#151928]'
                      : row.index % 2 === 0
                      ? 'bg-[#1a1f2e] hover:bg-[#1e293b]'
                      : 'bg-[#151928] hover:bg-[#1e293b]'
                  } cursor-pointer`}
                  onClick={() => {
                    setSelectedRowId(row.id);
                    if (isGrouped) toggleExpanded(row);
                  }}
                  onDoubleClick={() => {
                    if (!isGrouped && onRowDoubleClick && row.original) {
                      onRowDoubleClick(row.original);
                    }
                  }}
                >
                  {row.getVisibleCells().map((cell, cellIndex) => {
                    const isGroupCell = cell.getIsGrouped();
                    const isAggregated = cell.getIsAggregated();
                    const isPlaceholder = cell.getIsPlaceholder();

                    return (
                      <td
                        key={cell.id}
                        className={`px-3 py-1.5 whitespace-nowrap overflow-hidden text-ellipsis max-w-[500px] ${
                          isGrouped && cellIndex === 0 ? 'font-semibold text-gray-100' : 'text-gray-300'
                        }`}
                        style={cellIndex === 0 ? { paddingLeft: `${depth * 20 + 12}px` } : undefined}
                      >
                        {isGroupCell ? (
                          <span className="flex items-center gap-1.5">
                            <span className="text-gray-500 text-[10px]">
                              {row.getIsExpanded() ? '▼' : '▶'}
                            </span>
                            <span>{flexRender(cell.column.columnDef.cell, cell.getContext())}</span>
                            <span className="text-gray-500 font-normal">
                              ({row.subRows.length})
                            </span>
                          </span>
                        ) : isAggregated ? (
                          flexRender(cell.column.columnDef.aggregatedCell ?? cell.column.columnDef.cell, cell.getContext())
                        ) : isPlaceholder ? null : (
                          flexRender(cell.column.columnDef.cell, cell.getContext())
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination bar */}
      {pagination && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-surface-800 border-t border-gray-700 shrink-0 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Rows per page:</span>
            <select
              value={pagination.pageSize}
              onChange={(e) => pagination.onPageSizeChange(Number(e.target.value))}
              className="bg-surface-950 border border-gray-700 rounded text-gray-200 text-xs px-1 py-0.5 focus:outline-none focus:border-blue-500"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size.toLocaleString()}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-gray-500 mr-2">
              {((pagination.page - 1) * pagination.pageSize + 1).toLocaleString()}
              –
              {Math.min(pagination.page * pagination.pageSize, pagination.totalRows).toLocaleString()}
              {' of '}
              {pagination.totalRows.toLocaleString()}
            </span>
            <button
              onClick={() => pagination.onPageChange(1)}
              disabled={pagination.page <= 1}
              className="px-1.5 py-0.5 rounded bg-surface-700 text-gray-400 hover:bg-surface-600 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
              title="First page"
            >
              &#x276E;&#x276E;
            </button>
            <button
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="px-1.5 py-0.5 rounded bg-surface-700 text-gray-400 hover:bg-surface-600 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
              title="Previous page"
            >
              &#x276E;
            </button>
            <span className="text-gray-300 mx-1">
              Page {pagination.page} of {totalPages.toLocaleString()}
            </span>
            <button
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              disabled={pagination.page >= totalPages}
              className="px-1.5 py-0.5 rounded bg-surface-700 text-gray-400 hover:bg-surface-600 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
              title="Next page"
            >
              &#x276F;
            </button>
            <button
              onClick={() => pagination.onPageChange(totalPages)}
              disabled={pagination.page >= totalPages}
              className="px-1.5 py-0.5 rounded bg-surface-700 text-gray-400 hover:bg-surface-600 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
              title="Last page"
            >
              &#x276F;&#x276F;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
