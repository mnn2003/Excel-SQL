import type { ParsedData } from '@/lib/excel-parser';

interface DataPreviewTableProps {
  data: ParsedData;
  maxRows?: number;
}

/** Shows a preview of parsed Excel data in a scrollable table */
const DataPreviewTable = ({ data, maxRows = 50 }: DataPreviewTableProps) => {
  const displayRows = data.rows.slice(0, maxRows);
  const hasMore = data.rows.length > maxRows;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Data Preview
        </h3>
        <span className="text-xs text-muted-foreground">
          {data.rows.length} row{data.rows.length !== 1 ? 's' : ''} × {data.headers.length} column{data.headers.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="max-h-64 overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-secondary">
            <tr>
              {data.headers.map((h, i) => (
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
            {displayRows.map((row, ri) => (
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
      {hasMore && (
        <p className="text-xs text-muted-foreground">
          Showing first {maxRows} of {data.rows.length} rows
        </p>
      )}
    </div>
  );
};

export default DataPreviewTable;
