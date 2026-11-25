import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  FileArchive,
  FileCode2,
  KeyRound,
  Loader2,
  Search,
  Table2,
  Upload,
  X,
} from 'lucide-react';
import {
  isDatabaseFile,
  readDatabaseFile,
  type DatabaseTable,
  type DatabaseValue,
  type ParsedDatabase,
} from '@/lib/database-parser';
import SqlQueryPanel from '@/components/SqlQueryPanel';
import {
  createDatabaseQueryEngine,
  type DatabaseQueryEngine,
} from '@/lib/database-query';

type SortState = { columnIndex: number; direction: 'asc' | 'desc' } | null;
type IndexedRow = { row: DatabaseValue[]; originalIndex: number };

function displayValue(value: DatabaseValue): string {
  return value === null ? 'NULL' : String(value);
}

/** Upload a SQL dump and browse its tables without sending data to a server. */
const DatabaseBrowserPanel = () => {
  const [database, setDatabase] = useState<ParsedDatabase | null>(null);
  const [fileName, setFileName] = useState('');
  const [selectedTableName, setSelectedTableName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [tableFilter, setTableFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<SortState>(null);
  const [view, setView] = useState<'browse' | 'structure' | 'sql'>('browse');
  const [queryEngine, setQueryEngine] = useState<DatabaseQueryEngine | null>(null);
  const [sessionId, setSessionId] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryEngineRef = useRef<DatabaseQueryEngine | null>(null);

  const selectedTable = database?.tables.find((table) => table.name === selectedTableName) ?? null;
  const visibleTables = useMemo(() => {
    if (!database) return [];
    const query = tableFilter.trim().toLowerCase();
    return database.tables.filter((table) => table.name.toLowerCase().includes(query));
  }, [database, tableFilter]);

  const filteredRows = useMemo<IndexedRow[]>(() => {
    if (!selectedTable) return [];
    const query = search.trim().toLowerCase();
    const rows = selectedTable.rows
      .map((row, originalIndex) => ({ row, originalIndex }))
      .filter(({ row }) => !query || row.some((value) => displayValue(value).toLowerCase().includes(query)));

    if (sort) {
      const { columnIndex, direction } = sort;
      rows.sort((a, b) => {
        const left = a.row[columnIndex];
        const right = b.row[columnIndex];
        if (left === null && right === null) return 0;
        if (left === null) return 1;
        if (right === null) return -1;
        const comparison = typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
        return direction === 'asc' ? comparison : -comparison;
      });
    }
    return rows;
  }, [selectedTable, search, sort]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const firstRow = filteredRows.length ? (currentPage - 1) * pageSize + 1 : 0;
  const lastRow = Math.min(currentPage * pageSize, filteredRows.length);

  useEffect(() => {
    setSearch('');
    setPage(1);
    setSort(null);
    setView('browse');
  }, [selectedTableName]);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize]);

  useEffect(() => () => queryEngineRef.current?.close(), []);

  const loadFile = async (file: File) => {
    if (!isDatabaseFile(file.name)) {
      setError('Please choose a .sql, .sql.gz, or .zip archive containing SQL dumps.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = await readDatabaseFile(file);
      const nextEngine = await createDatabaseQueryEngine(result);
      queryEngineRef.current?.close();
      queryEngineRef.current = nextEngine;
      setQueryEngine(nextEngine);
      setDatabase(result);
      setFileName(file.name);
      setSelectedTableName(result.tables[0]?.name ?? '');
      setTableFilter('');
      setView('browse');
      setSessionId((value) => value + 1);
      setPage(1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open this database dump.');
    } finally {
      setLoading(false);
    }
  };

  const clearDatabase = () => {
    queryEngineRef.current?.close();
    queryEngineRef.current = null;
    setQueryEngine(null);
    setDatabase(null);
    setFileName('');
    setSelectedTableName('');
    setTableFilter('');
    setSearch('');
    setError('');
    setSort(null);
    setPage(1);
  };

  const handleDatabaseChange = (nextDatabase: ParsedDatabase) => {
    setDatabase(nextDatabase);
    setSelectedTableName((current) =>
      nextDatabase.tables.some((table) => table.name === current)
        ? current
        : nextDatabase.tables[0]?.name ?? ''
    );
  };

  const toggleSort = (columnIndex: number) => {
    setSort((current) => {
      if (!current || current.columnIndex !== columnIndex) return { columnIndex, direction: 'asc' };
      if (current.direction === 'asc') return { columnIndex, direction: 'desc' };
      return null;
    });
  };

  const exportTable = (table: DatabaseTable) => {
    const sheet = XLSX.utils.aoa_to_sheet([
      table.columns.map((column) => column.name),
      ...table.rows,
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, table.name.slice(0, 31) || 'Table');
    XLSX.writeFile(book, `${table.name}.csv`, { bookType: 'csv' });
  };

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".sql,.sql.gz,.zip"
      className="hidden"
      aria-label="Choose SQL, SQL.GZ, or ZIP database file"
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void loadFile(file);
        event.target.value = '';
      }}
    />
  );

  if (!database) {
    return (
      <section className="space-y-4" aria-label="Database browser">
        {fileInput}
        {error && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <div
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files[0];
            if (file) void loadFile(file);
          }}
          onClick={() => !loading && inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
            dragging ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/50 hover:bg-muted/40'
          }`}
        >
          {loading ? (
            <Loader2 className="h-11 w-11 animate-spin text-primary" aria-label="Opening database" />
          ) : (
            <Database className="h-11 w-11 text-primary" />
          )}
          <h2 className="mt-4 text-lg font-semibold text-foreground">
            {loading ? 'Opening database…' : 'Drop your database dump here'}
          </h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Upload a MySQL-style .sql, .sql.gz, or .zip containing SQL dumps to browse every table.
          </p>
          {!loading && (
            <span className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">
              <Upload className="h-4 w-4" />
              Choose database file
            </span>
          )}
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Your database never leaves this browser. Large results are shown in pages for faster browsing.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4" aria-label="Database browser">
      {fileInput}
      {error && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {/\.(zip|gz)$/i.test(fileName) ? (
            <FileArchive className="h-8 w-8 shrink-0 text-primary" />
          ) : (
            <FileCode2 className="h-8 w-8 shrink-0 text-primary" />
          )}
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">{fileName}</h2>
            <p className="text-xs text-muted-foreground">
              {database.tables.length} table{database.tables.length === 1 ? '' : 's'} · {database.totalRows.toLocaleString()} total rows
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={loading}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted sm:flex-none"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Replace
          </button>
          <button
            type="button"
            onClick={clearDatabase}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground sm:flex-none"
          >
            <X className="h-3.5 w-3.5" />
            Close
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="min-w-0 rounded-lg border border-border bg-card">
          <div className="border-b border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Tables</h2>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">{database.tables.length}</span>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="search"
                value={tableFilter}
                onChange={(event) => setTableFilter(event.target.value)}
                placeholder="Filter tables"
                aria-label="Filter tables"
                className="w-full rounded-md border border-input bg-background py-2 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
          <nav className="max-h-52 space-y-1 overflow-y-auto p-2 lg:max-h-[520px]" aria-label="Database tables">
            {visibleTables.map((table) => (
              <button
                type="button"
                key={table.name}
                onClick={() => setSelectedTableName(table.name)}
                aria-current={selectedTable?.name === table.name ? 'page' : undefined}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  selectedTable?.name === table.name
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Table2 className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate" title={table.name}>{table.name}</span>
                <span className="text-xs tabular-nums opacity-70">{table.rows.length.toLocaleString()}</span>
              </button>
            ))}
            {!visibleTables.length && <p className="px-3 py-6 text-center text-xs text-muted-foreground">No matching tables</p>}
          </nav>
        </aside>

        <div className="min-w-0 rounded-lg border border-border bg-card">
          {selectedTable ? (
            <>
              <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h2 className="truncate font-mono text-base font-semibold text-foreground" title={view === 'sql' ? 'SQL workspace' : selectedTable.name}>
                    {view === 'sql' ? 'SQL workspace' : selectedTable.name}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {view === 'sql'
                      ? `Query and change all ${database.tables.length} tables in this browser session`
                      : `${selectedTable.rows.length.toLocaleString()} rows · ${selectedTable.columns.length} columns`}
                  </p>
                </div>
                {view !== 'sql' && (
                  <button
                    type="button"
                    onClick={() => exportTable(selectedTable)}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted"
                    title="Export all rows in this table"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export CSV
                  </button>
                )}
              </div>

              <div className="flex border-b border-border px-4" role="tablist" aria-label="Table view">
                {(['browse', 'structure', 'sql'] as const).map((tab) => (
                  <button
                    type="button"
                    key={tab}
                    role="tab"
                    aria-selected={view === tab}
                    onClick={() => setView(tab)}
                    className={`border-b-2 px-4 py-3 text-sm font-medium capitalize transition-colors ${
                      view === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tab === 'sql' ? 'SQL' : tab}
                  </button>
                ))}
              </div>

              {view === 'sql' && queryEngine ? (
                <SqlQueryPanel
                  key={sessionId}
                  database={database}
                  engine={queryEngine}
                  selectedTableName={selectedTableName}
                  onDatabaseChange={handleDatabaseChange}
                />
              ) : view === 'structure' ? (
                <div className="overflow-x-auto p-4" role="tabpanel">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Column</th>
                        <th className="px-3 py-2 font-medium">Type</th>
                        <th className="px-3 py-2 font-medium">Nullable</th>
                        <th className="px-3 py-2 font-medium">Key</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedTable.columns.map((column) => (
                        <tr key={column.name} className="border-b border-border last:border-0">
                          <td className="px-3 py-3 font-mono text-xs font-medium text-foreground">{column.name}</td>
                          <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{column.type || '—'}</td>
                          <td className="px-3 py-3 text-xs text-muted-foreground">{column.nullable ? 'Yes' : 'No'}</td>
                          <td className="px-3 py-3 text-xs text-foreground">
                            {column.primaryKey ? <span className="inline-flex items-center gap-1"><KeyRound className="h-3.5 w-3.5 text-primary" />Primary</span> : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div role="tabpanel">
                  <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="relative flex-1 sm:max-w-sm">
                      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <input
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search all columns…"
                        aria-label={`Search rows in ${selectedTable.name}`}
                        className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      Rows per page
                      <select
                        value={pageSize}
                        onChange={(event) => setPageSize(Number(event.target.value))}
                        className="rounded-md border border-input bg-background px-2 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        {[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
                      </select>
                    </label>
                  </div>

                  <div className="max-h-[560px] overflow-auto border-y border-border">
                    <table className="w-full min-w-max text-sm">
                      <thead className="sticky top-0 z-10 bg-secondary">
                        <tr>
                          <th className="w-14 whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-muted-foreground">#</th>
                          {selectedTable.columns.map((column, columnIndex) => (
                            <th key={column.name} className="whitespace-nowrap px-1 py-1 text-left" aria-sort={sort?.columnIndex === columnIndex ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                              <button
                                type="button"
                                onClick={() => toggleSort(columnIndex)}
                                className="inline-flex max-w-56 items-center gap-1.5 rounded px-2 py-1 font-mono text-xs font-semibold text-secondary-foreground hover:bg-background/60"
                                title={`Sort by ${column.name}`}
                              >
                                <span className="truncate">{column.name}</span>
                                {sort?.columnIndex !== columnIndex ? <ArrowUpDown className="h-3 w-3 shrink-0 opacity-50" /> : sort.direction === 'asc' ? <ArrowUp className="h-3 w-3 shrink-0" /> : <ArrowDown className="h-3 w-3 shrink-0" />}
                              </button>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map(({ row, originalIndex }) => (
                          <tr key={originalIndex} className="border-t border-border hover:bg-muted/40">
                            <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-muted-foreground">{originalIndex + 1}</td>
                            {row.map((value, columnIndex) => (
                              <td
                                key={`${originalIndex}-${columnIndex}`}
                                className={`max-w-72 truncate whitespace-nowrap px-3 py-2 font-mono text-xs ${value === null ? 'italic text-muted-foreground' : 'text-foreground'}`}
                                title={displayValue(value)}
                              >
                                {displayValue(value)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!pageRows.length && (
                      <div className="px-4 py-14 text-center text-sm text-muted-foreground">
                        {selectedTable.rows.length ? 'No rows match your search.' : 'This table has no rows.'}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-3 p-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      {filteredRows.length ? `Showing ${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${filteredRows.length.toLocaleString()} rows` : '0 rows'}
                      {search && filteredRows.length !== selectedTable.rows.length ? ` (filtered from ${selectedTable.rows.length.toLocaleString()})` : ''}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPage((value) => Math.max(1, value - 1))}
                        disabled={currentPage === 1}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />Previous
                      </button>
                      <span className="px-2 tabular-nums">Page {currentPage} of {totalPages}</span>
                      <button
                        type="button"
                        onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                        disabled={currentPage === totalPages}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Next<ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="p-12 text-center text-sm text-muted-foreground">Select a table to browse its data.</p>
          )}
        </div>
      </div>
    </section>
  );
};

export default DatabaseBrowserPanel;
