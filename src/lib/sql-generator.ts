/**
 * Escape a SQL string value (handle single quotes).
 */
function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Check if a string looks like a date in YYYY-MM-DD format.
 */
function isDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Format a single cell value for SQL.
 * - NULL → NULL
 * - Number → unquoted
 * - Date string → quoted as-is
 * - String → escaped and quoted
 */
function formatSqlValue(value: string | number | null | Date): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `'${y}-${m}-${d}'`;
  }
  const str = String(value);
  if (isDateString(str)) return `'${str}'`;
  return `'${escapeSqlString(str)}'`;
}

/**
 * Generate SQL INSERT statements from parsed data.
 * Groups rows into batches for readability.
 */
export function generateSQL(
  tableName: string,
  headers: string[],
  rows: (string | number | null | Date)[][],
  batchSize = 100
): string {
  if (!tableName.trim()) return '-- Please specify a table name';
  if (headers.length === 0 || rows.length === 0) return '-- No data to generate';

  const sanitizedTable = tableName.trim().replace(/[^a-zA-Z0-9_]/g, '_');
  const columnList = headers.map((h) => h.replace(/[^a-zA-Z0-9_]/g, '_')).join(', ');

  const statements: string[] = [];

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const valueLines = batch
      .map((row) => `(${row.map(formatSqlValue).join(',')})`)
      .join(',\n');

    statements.push(
      `INSERT INTO ${sanitizedTable} (${columnList})\nVALUES\n${valueLines};`
    );
  }

  return statements.join('\n\n');
}
