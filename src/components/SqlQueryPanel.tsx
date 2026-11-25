import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Play,
  Search,
  Table2,
  Trash2,
} from 'lucide-react';
import {
  buildGlobalSearchQuery,
  quoteIdentifier,
  type DatabaseQueryEngine,
  type SqlQueryResult,
} from '@/lib/database-query';
import type { DatabaseValue, ParsedDatabase } from '@/lib/database-parser';

interface SqlQueryPanelProps {
  database: ParsedDatabase;
  engine: DatabaseQueryEngine;
  selectedTableName: string;
  onDatabaseChange: (database: ParsedDatabase) => void;
}

function displayValue(value: DatabaseValue): string {
  return value === null ? 'NULL' : String(value);
}

function selectExample(tableName: string): string {
  return tableName ? `SELECT * FROM ${quoteIdentifier(tableName)}\nLIMIT 100;` : 'SELECT 1 AS result;';
}

/** Run local SQL batches and present every result with paging and CSV export. */
const SqlQueryPanel = ({ database, engine, selectedTableName, onDatabaseChange }: SqlQueryPanelProps) => {
  const [sql, setSql] = useState(() => selectExample(selectedTableName || database.tables[0]?.name || ''));
  const [results, setResults] = useState<SqlQueryResult[]>([]);
  const [activeResult, setActiveResult] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const current = results[activeResult] ?? null;
  const totalPages = Math.max(1, Math.ceil((current?.rows.length ?? 0) / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = current?.rows.slice((currentPage - 1) * pageSize, currentPage * pageSize) ?? [];
  const firstRow = current?.rows.length ? (currentPage - 1) * pageSize + 1 : 0;
  const lastRow = Math.min(currentPage * pageSize, current?.rows.length ?? 0);

  const joinExample = useMemo(() => {
    if (database.tables.length < 2) return '';
    const first = database.tables.find((table) => table.name === selectedTableName) ?? database.tables[0];
    const second = database.tables.find((table) => table.name !== first.name);
    if (!second) return '';
    const shared = first.columns.find((left) =>
      second.columns.some((right) => right.name.toLowerCase() === left.name.toLowerCase())
    );
    if (!shared) return '';
    const rightColumn = second.columns.find((column) => column.name.toLowerCase() === shared.name.toLowerCase())!;
    return `SELECT a.*, b.*\nFROM ${quoteIdentifier(first.name)} AS a\nJOIN ${quoteIdentifier(second.name)} AS b\n  ON a.${quoteIdentifier(shared.name)} = b.${quoteIdentifier(rightColumn.name)}\nLIMIT 100;`;
  }, [database, selectedTableName]);

  const runQuery = async (query: string) => {
    if (!query.trim()) {
      setError('Enter at least one SQL statement.');
      return;
    }
    setRunning(true);
    setError('');
    setStatus('');
    // Let the busy state paint before a large local query occupies the main thread.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    try {
      const execution = engine.run(query);
      setResults(execution.results);
      setActiveResult(execution.results.findIndex((result) => result.columns.length > 0) >= 0
        ? execution.results.findIndex((result) => result.columns.length > 0)
        : 0);
      setPage(1);
      if (execution.changed) onDatabaseChange(engine.snapshot());
      setStatus(`${execution.results.length} statement${execution.results.length === 1 ? '' : 's'} completed in ${execution.elapsedMs} ms.${execution.changed ? ' Table browser updated.' : ''}`);
    } catch (reason) {
      setResults([]);
      setError(reason instanceof Error ? reason.message : 'The SQL batch could not be completed.');
    } finally {
      setRunning(false);
    }
  };

  const searchEveryTable = async () => {
    try {
      const query = buildGlobalSearchQuery(database, globalSearch);
      setSql(query);
      await runQuery(query);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Enter text to search for.');
    }
  };

  const exportResult = () => {
    if (!current?.columns.length) return;
    const sheet = XLSX.utils.aoa_to_sheet([current.columns, ...current.rows]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Query result');
    XLSX.writeFile(book, `query-result-${activeResult + 1}.csv`, { bookType: 'csv' });
  };

  return (
    <div className="space-y-5 p-4" role="tabpanel" aria-label="SQL query workspace">
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="global-database-search" className="mb-1.5 block text-xs font-medium text-foreground">
              Search every table and column
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                id="global-database-search"
                type="search"
                value={globalSearch}
                onChange={(event) => setGlobalSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void searchEveryTable();
                }}
                placeholder="e.g. Delhi or VEND-001"
                className="w-full rounded-md border border-input bg-card py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => void searchEveryTable()}
            disabled={running || !globalSearch.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-secondary px-4 py-2 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
          >
            <Search className="h-3.5 w-3.5" />
            Search all tables
          </button>
        </div>
      </div>

      <div>
        <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label htmlFor="database-sql-query" className="text-sm font-semibold text-foreground">SQL query / queries</label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSql(selectExample(selectedTableName || database.tables[0]?.name || ''))}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Table2 className="h-3.5 w-3.5" />Select table
            </button>
            {joinExample && (
              <button
                type="button"
                onClick={() => setSql(joinExample)}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Join example
              </button>
            )}
            <button
              type="button"
              onClick={() => { setSql(''); setResults([]); setError(''); setStatus(''); }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" />Clear
            </button>
          </div>
        </div>
        <textarea
          id="database-sql-query"
          value={sql}
          onChange={(event) => setSql(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              void runQuery(sql);
            }
          }}
          spellCheck={false}
          rows={10}
          placeholder="SELECT * FROM customers WHERE city = 'Delhi';"
          className="min-h-56 w-full resize-y rounded-lg border border-input bg-code p-4 font-mono text-sm leading-relaxed text-code-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            SQLite-compatible SQL · Ctrl/⌘ + Enter to run · Changes last only while this file is open.
          </p>
          <button
            type="button"
            onClick={() => void runQuery(sql)}
            disabled={running || !sql.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? 'Running…' : 'Run SQL'}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">
          {error}
        </div>
      )}
      {status && <p className="text-xs font-medium text-primary" role="status">{status}</p>}

      {results.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="flex gap-1 overflow-x-auto border-b border-border bg-muted/40 p-2" role="tablist" aria-label="Statement results">
            {results.map((result, index) => (
              <button
                key={index}
                type="button"
                role="tab"
                aria-selected={activeResult === index}
                onClick={() => { setActiveResult(index); setPage(1); }}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium ${
                  activeResult === index ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {index + 1}. {result.type} {result.columns.length ? `(${result.rows.length.toLocaleString()} rows)` : ''}
              </button>
            ))}
          </div>

          {current && (
            <div>
              <div className="flex flex-col gap-2 border-b border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  {current.rowsAffected !== null
                    ? `${current.rowsAffected.toLocaleString()} row${current.rowsAffected === 1 ? '' : 's'} affected`
                    : current.columns.length
                      ? `${current.rows.length.toLocaleString()} result row${current.rows.length === 1 ? '' : 's'}${current.truncated ? ' (first 10,000 shown)' : ''}`
                      : 'Statement completed'}
                </p>
                {current.columns.length > 0 && (
                  <button
                    type="button"
                    onClick={exportResult}
                    className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted"
                  >
                    <Download className="h-3.5 w-3.5" />Export result CSV
                  </button>
                )}
              </div>

              {current.columns.length > 0 ? (
                <>
                  <div className="max-h-[480px] overflow-auto">
                    <table className="w-full min-w-max text-sm">
                      <thead className="sticky top-0 z-10 bg-secondary">
                        <tr>
                          <th className="w-14 px-3 py-2 text-left text-xs font-medium text-muted-foreground">#</th>
                          {current.columns.map((column, index) => (
                            <th key={`${column}-${index}`} className="whitespace-nowrap px-3 py-2 text-left font-mono text-xs font-semibold text-secondary-foreground">
                              {column || `column_${index + 1}`}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map((row, rowIndex) => (
                          <tr key={rowIndex} className="border-t border-border hover:bg-muted/40">
                            <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">{firstRow + rowIndex}</td>
                            {row.map((value, columnIndex) => (
                              <td
                                key={columnIndex}
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
                    {!pageRows.length && <p className="px-4 py-12 text-center text-sm text-muted-foreground">The query returned no rows.</p>}
                  </div>
                  <div className="flex flex-col gap-3 border-t border-border p-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                    <span>{current.rows.length ? `Showing ${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${current.rows.length.toLocaleString()}` : '0 rows'}</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-2">
                        Rows
                        <select
                          value={pageSize}
                          onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}
                          className="rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground"
                          aria-label="Query rows per page"
                        >
                          {[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={() => setPage((value) => Math.max(1, value - 1))}
                        disabled={currentPage === 1}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 hover:bg-muted disabled:opacity-40"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />Previous
                      </button>
                      <span className="tabular-nums">Page {currentPage} of {totalPages}</span>
                      <button
                        type="button"
                        onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                        disabled={currentPage === totalPages}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 hover:bg-muted disabled:opacity-40"
                      >
                        Next<ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words bg-code p-4 font-mono text-xs text-code-foreground">{current.statement}</pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SqlQueryPanel;
