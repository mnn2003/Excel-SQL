import { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { FileDown, Table2 } from 'lucide-react';
import { parseSqlInserts, type ParsedSql } from '@/lib/sql-parser';

const SAMPLE = `INSERT INTO students (name, email, age)
VALUES
('Aman Kumar','akt@email.com',21),
('Aman Tiwari','aman20@email.com',22);`;

/** Converts pasted SQL INSERT statements back into a downloadable spreadsheet */
const SqlToExcelPanel = () => {
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<ParsedSql | null>(null);
  const [error, setError] = useState('');

  const handleParse = useCallback(() => {
    setError('');
    try {
      setResult(parseSqlInserts(sql));
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'Could not read those statements.');
    }
  }, [sql]);

  const download = useCallback(
    (type: 'xlsx' | 'csv') => {
      if (!result) return;
      const sheet = XLSX.utils.aoa_to_sheet([result.headers, ...result.rows]);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, result.tableName.slice(0, 31) || 'Sheet1');
      XLSX.writeFile(book, `${result.tableName || 'data'}.${type}`, { bookType: type });
    },
    [result]
  );

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="sql-input" className="text-sm font-medium text-foreground">
          Paste SQL INSERT statements
        </label>
        <textarea
          id="sql-input"
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          rows={10}
          placeholder={SAMPLE}
          className="w-full rounded-lg border border-input bg-card px-3 py-2 font-mono text-xs leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleParse}
          disabled={!sql.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          <Table2 className="h-4 w-4" />
          Convert to table
        </button>
        <button
          onClick={() => setSql(SAMPLE)}
          className="rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Use example
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {result.tableName}{' '}
              <span className="font-normal text-muted-foreground">
                — {result.rows.length} row{result.rows.length !== 1 ? 's' : ''}
              </span>
            </h3>
            <div className="flex gap-1.5">
              <button
                onClick={() => download('csv')}
                className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
              >
                <FileDown className="h-3.5 w-3.5" />
                Download .csv
              </button>
              <button
                onClick={() => download('xlsx')}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <FileDown className="h-3.5 w-3.5" />
                Download .xlsx
              </button>
            </div>
          </div>
          <div className="max-h-64 overflow-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-secondary">
                <tr>
                  {result.headers.map((h, i) => (
                    <th
                      key={i}
                      className="whitespace-nowrap px-3 py-2 text-left font-mono text-xs font-semibold text-secondary-foreground"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.slice(0, 50).map((row, ri) => (
                  <tr key={ri} className="border-t border-border transition-colors hover:bg-muted/40">
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className={`whitespace-nowrap px-3 py-1.5 ${
                          cell === null ? 'italic text-muted-foreground' : 'text-foreground'
                        }`}
                      >
                        {cell === null ? 'NULL' : String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.rows.length > 50 && (
            <p className="text-xs text-muted-foreground">
              Showing first 50 of {result.rows.length} rows
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default SqlToExcelPanel;
