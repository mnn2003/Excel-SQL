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
 * Infer a SQL column type from an array of cell values.
 */
function inferColumnType(rows: (string | number | null | Date)[][], colIndex: number): string {
  let hasNumber = false;
  let hasDate = false;
  let maxLen = 0;

  for (const row of rows) {
    const cell = row[colIndex];
    if (cell === null || cell === undefined) continue;
    if (typeof cell === 'number') { hasNumber = true; continue; }
    if (cell instanceof Date) { hasDate = true; continue; }
    const str = String(cell);
    if (isDateString(str)) { hasDate = true; continue; }
    if (/^-?\d+(\.\d+)?$/.test(str)) { hasNumber = true; continue; }
    maxLen = Math.max(maxLen, str.length);
  }

  if (hasDate && !hasNumber && maxLen === 0) return 'DATE';
  if (hasNumber && !hasDate && maxLen === 0) return 'NUMERIC';
  if (maxLen <= 255) return `VARCHAR(${Math.max(maxLen, 50)})`;
  return 'TEXT';
}

/**
 * Generate a CREATE TABLE statement from headers and inferred types.
 */
export function generateCreateTable(
  tableName: string,
  headers: string[],
  rows: (string | number | null | Date)[][],
): string {
  const sanitizedTable = tableName.trim().replace(/[^a-zA-Z0-9_]/g, '_');
  const columns = headers.map((h, i) => {
    const colName = h.replace(/[^a-zA-Z0-9_]/g, '_');
    const colType = inferColumnType(rows, i);
    return `  ${colName} ${colType}`;
  });
  return `CREATE TABLE ${sanitizedTable} (\n${columns.join(',\n')}\n);`;
}

export interface GenerateSQLOptions {
  tableName: string;
  headers: string[];
  rows: (string | number | null | Date)[][];
  selectedColumns?: boolean[];
  includeCreateTable?: boolean;
  batchSize?: number;
}

/**
 * Generate SQL statements from parsed data.
 * Supports column filtering and optional CREATE TABLE.
 */
export function generateSQL(options: GenerateSQLOptions): string;
export function generateSQL(
  tableName: string,
  headers: string[],
  rows: (string | number | null | Date)[][],
  batchSize?: number
): string;
export function generateSQL(
  optionsOrTableName: GenerateSQLOptions | string,
  headers?: string[],
  rows?: (string | number | null | Date)[][],
  batchSize?: number
): string {
  let opts: GenerateSQLOptions;
  if (typeof optionsOrTableName === 'string') {
    opts = { tableName: optionsOrTableName, headers: headers!, rows: rows!, batchSize };
  } else {
    opts = optionsOrTableName;
  }

  const { tableName, includeCreateTable = false, batchSize: bs = 100 } = opts;
  let { headers: hdrs, rows: rws, selectedColumns } = opts;

  if (!tableName.trim()) return '-- Please specify a table name';
  if (hdrs.length === 0 || rws.length === 0) return '-- No data to generate';

  // Filter by selected columns
  if (selectedColumns && selectedColumns.length === hdrs.length) {
    const indices = selectedColumns.map((sel, i) => sel ? i : -1).filter(i => i !== -1);
    if (indices.length === 0) return '-- No columns selected';
    hdrs = indices.map(i => hdrs[i]);
    rws = rws.map(row => indices.map(i => row[i]));
  }

  const sanitizedTable = tableName.trim().replace(/[^a-zA-Z0-9_]/g, '_');
  const columnList = hdrs.map((h) => h.replace(/[^a-zA-Z0-9_]/g, '_')).join(', ');

  const parts: string[] = [];

  if (includeCreateTable) {
    parts.push(generateCreateTable(tableName, hdrs, rws));
    parts.push('');
  }

  for (let i = 0; i < rws.length; i += bs) {
    const batch = rws.slice(i, i + bs);
    const valueLines = batch
      .map((row) => `(${row.map(formatSqlValue).join(',')})`)
      .join(',\n');

    parts.push(
      `INSERT INTO ${sanitizedTable} (${columnList})\nVALUES\n${valueLines};`
    );
  }

  return parts.join('\n\n');
}
