import JSZip from 'jszip';

export type DatabaseValue = string | number | null;

export interface DatabaseColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  definition: string;
}

export interface DatabaseTable {
  name: string;
  columns: DatabaseColumn[];
  rows: DatabaseValue[][];
}

export interface ParsedDatabase {
  tables: DatabaseTable[];
  totalRows: number;
}

const IDENTIFIER_SOURCE = String.raw`(?:\`(?:[^\`]|\`\`)+\`|"(?:[^"]|"")+"|\[[^\]]+\]|[A-Za-z0-9_$-]+)`;

/** Remove SQL identifier quoting and return the table name without its schema. */
function cleanIdentifier(identifier: string): string {
  const value = identifier.trim();
  if (value.startsWith('`') && value.endsWith('`')) {
    return value.slice(1, -1).replace(/``/g, '`');
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/""/g, '"');
  }
  if (value.startsWith('[') && value.endsWith(']')) return value.slice(1, -1);
  return value;
}

function cleanTableName(qualifiedName: string): string {
  const identifiers = qualifiedName.match(new RegExp(IDENTIFIER_SOURCE, 'g'));
  return identifiers?.length ? cleanIdentifier(identifiers[identifiers.length - 1]) : qualifiedName;
}

/** Split a dump into statements without breaking on semicolons inside strings. */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let quote = '';
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];

    if (lineComment) {
      if (char === '\n') {
        current += '\n';
        lineComment = false;
      }
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i++;
      } else if (char === '\n') {
        current += '\n';
      }
      continue;
    }
    if (!quote && char === '-' && next === '-' && (i + 2 >= sql.length || /\s/.test(sql[i + 2]))) {
      lineComment = true;
      i++;
      continue;
    }
    if (!quote && char === '#') {
      lineComment = true;
      continue;
    }
    if (!quote && char === '/' && next === '*') {
      blockComment = true;
      i++;
      continue;
    }

    if (quote) {
      current += char;
      if (char === '\\' && quote !== '`' && next !== undefined) {
        current += next;
        i++;
        continue;
      }
      if (char === quote) {
        if (next === quote) {
          current += next;
          i++;
        } else {
          quote = '';
        }
      }
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      current += char;
    } else if (char === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

/** Split comma-separated SQL while ignoring commas in values and type parentheses. */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote = '';

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];
    if (quote) {
      current += char;
      if (char === '\\' && quote !== '`' && next !== undefined) {
        current += next;
        i++;
      } else if (char === quote) {
        if (next === quote) {
          current += next;
          i++;
        } else {
          quote = '';
        }
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    if (!quote && char === '(') depth++;
    if (!quote && char === ')') depth--;
    if (!quote && char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function findClosingParenthesis(input: string, start: number): number {
  let depth = 0;
  let quote = '';
  for (let i = start; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];
    if (quote) {
      if (char === '\\' && quote !== '`' && next !== undefined) i++;
      else if (char === quote) {
        if (next === quote) i++;
        else quote = '';
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '(') depth++;
    else if (char === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Extract every top-level VALUES tuple from one INSERT statement. */
function extractTuples(valuesClause: string): string[] {
  const tuples: string[] = [];
  let depth = 0;
  let start = -1;
  let quote = '';

  for (let i = 0; i < valuesClause.length; i++) {
    const char = valuesClause[i];
    const next = valuesClause[i + 1];
    if (quote) {
      if (char === '\\' && quote !== '`' && next !== undefined) i++;
      else if (char === quote) {
        if (next === quote) i++;
        else quote = '';
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '(') {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (char === ')') {
      depth--;
      if (depth === 0 && start >= 0) tuples.push(valuesClause.slice(start, i));
    }
  }
  return tuples;
}

function unescapeString(value: string, quote: string): string {
  let output = '';
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    const next = value[i + 1];
    if (char === quote && next === quote) {
      output += quote;
      i++;
    } else if (char === '\\' && next !== undefined) {
      const escapes: Record<string, string> = {
        '0': '\0',
        b: '\b',
        n: '\n',
        r: '\r',
        t: '\t',
        Z: '\x1a',
      };
      output += escapes[next] ?? next;
      i++;
    } else {
      output += char;
    }
  }
  return output;
}

function parseLiteral(token: string): DatabaseValue {
  const value = token.trim();
  if (/^null$/i.test(value)) return null;
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    return unescapeString(value.slice(1, -1), value[0]);
  }
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return value;
}

function parseCreateTable(statement: string): DatabaseTable | null {
  const namePattern = new RegExp(
    `^create\\s+(?:temporary\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?(${IDENTIFIER_SOURCE}(?:\\s*\\.\\s*${IDENTIFIER_SOURCE})?)`,
    'i'
  );
  const match = statement.match(namePattern);
  if (!match) return null;

  const open = statement.indexOf('(', match[0].length);
  if (open < 0) return null;
  const close = findClosingParenthesis(statement, open);
  if (close < 0) return null;

  const definitions = splitTopLevel(statement.slice(open + 1, close));
  const columns: DatabaseColumn[] = [];
  const primaryKeys = new Set<string>();

  for (const definition of definitions) {
    const trimmed = definition.trim();
    const primaryKey = trimmed.match(/^primary\s+key\s*\(([^)]*)\)/i);
    if (primaryKey) {
      for (const column of splitTopLevel(primaryKey[1])) primaryKeys.add(cleanIdentifier(column));
      continue;
    }
    if (/^(?:unique|key|constraint|foreign\s+key|check|fulltext|spatial|index)\b/i.test(trimmed)) continue;

    const columnMatch = trimmed.match(new RegExp(`^(${IDENTIFIER_SOURCE})`));
    if (!columnMatch) continue;
    const name = cleanIdentifier(columnMatch[1]);
    const remainder = trimmed.slice(columnMatch[0].length).trim();
    const type = remainder.match(/^([\w]+(?:\s*\([^)]*\))?)/)?.[1] ?? '';

    columns.push({
      name,
      type,
      nullable: !/\bnot\s+null\b/i.test(remainder),
      primaryKey: primaryKeys.has(name) || /\bprimary\s+key\b/i.test(remainder),
      definition: trimmed,
    });
  }

  for (const column of columns) {
    if (primaryKeys.has(column.name)) column.primaryKey = true;
  }
  return { name: cleanTableName(match[1]), columns, rows: [] };
}

interface ParsedInsert {
  tableName: string;
  columns: string[];
  rows: DatabaseValue[][];
}

function parseInsert(statement: string): ParsedInsert | null {
  const namePattern = new RegExp(
    `^(?:insert|replace)\\s+(?:ignore\\s+)?into\\s+(${IDENTIFIER_SOURCE}(?:\\s*\\.\\s*${IDENTIFIER_SOURCE})?)`,
    'i'
  );
  const match = statement.match(namePattern);
  if (!match) return null;

  let remainder = statement.slice(match[0].length).trimStart();
  let columns: string[] = [];
  if (remainder.startsWith('(')) {
    const close = findClosingParenthesis(remainder, 0);
    if (close < 0) return null;
    columns = splitTopLevel(remainder.slice(1, close)).map(cleanIdentifier);
    remainder = remainder.slice(close + 1).trimStart();
  }

  const valuesMatch = remainder.match(/^values\s*([\s\S]*)$/i);
  if (!valuesMatch) return null;
  const rows = extractTuples(valuesMatch[1]).map((tuple) => splitTopLevel(tuple).map(parseLiteral));
  return { tableName: cleanTableName(match[1]), columns, rows };
}

function inferredColumn(name: string): DatabaseColumn {
  return { name, type: '', nullable: true, primaryKey: false, definition: name };
}

/**
 * Read the parts of a SQL dump needed for browsing: table definitions and rows.
 * Other dump statements (SET, LOCK, ALTER, and similar) are intentionally ignored.
 */
export function parseDatabase(sql: string): ParsedDatabase {
  const tables: DatabaseTable[] = [];
  const byName = new Map<string, DatabaseTable>();

  for (const statement of splitSqlStatements(sql)) {
    const created = parseCreateTable(statement);
    if (created) {
      const existing = byName.get(created.name);
      if (existing) {
        // Some archives put data.sql before schema.sql. Keep rows already read,
        // then align them with the richer CREATE TABLE definition.
        const hasGenericColumns = existing.columns.every(
          (column, index) => column.name === `column_${index + 1}`
        );
        created.rows = existing.rows.map((row) =>
          created.columns.map((column, index) => {
            if (hasGenericColumns) return index < row.length ? row[index] : null;
            const oldIndex = existing.columns.findIndex((item) => item.name === column.name);
            return oldIndex >= 0 && oldIndex < row.length ? row[oldIndex] : null;
          })
        );
        const index = tables.indexOf(existing);
        tables[index] = created;
        byName.set(created.name, created);
      } else {
        tables.push(created);
        byName.set(created.name, created);
      }
      continue;
    }

    const inserted = parseInsert(statement);
    if (!inserted || inserted.rows.length === 0) continue;
    let table = byName.get(inserted.tableName);
    const width = Math.max(...inserted.rows.map((row) => row.length), inserted.columns.length);

    if (!table) {
      const headers = inserted.columns.length
        ? inserted.columns
        : Array.from({ length: width }, (_, index) => `column_${index + 1}`);
      table = { name: inserted.tableName, columns: headers.map(inferredColumn), rows: [] };
      tables.push(table);
      byName.set(table.name, table);
    }

    for (const name of inserted.columns) {
      if (!table.columns.some((column) => column.name === name)) table.columns.push(inferredColumn(name));
    }
    if (!inserted.columns.length) {
      while (table.columns.length < width) table.columns.push(inferredColumn(`column_${table.columns.length + 1}`));
    }

    for (const values of inserted.rows) {
      table.rows.push(
        table.columns.map((column, index) => {
          const sourceIndex = inserted.columns.length
            ? inserted.columns.indexOf(column.name)
            : index;
          return sourceIndex >= 0 && sourceIndex < values.length ? values[sourceIndex] : null;
        })
      );
    }
  }

  if (!tables.length) {
    throw new Error('No CREATE TABLE or INSERT statements found. Upload a MySQL-style SQL dump.');
  }
  return { tables, totalRows: tables.reduce((sum, table) => sum + table.rows.length, 0) };
}

/** Extract and parse every .sql file inside a ZIP archive. */
export async function parseDatabaseArchive(buffer: ArrayBuffer): Promise<ParsedDatabase> {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir && entry.name.toLowerCase().endsWith('.sql'))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!entries.length) throw new Error('This ZIP does not contain a .sql file.');
  const dumps = await Promise.all(entries.map((entry) => entry.async('string')));
  return parseDatabase(dumps.join(';\n'));
}

/** Use the same filename validation for file selection and drag-and-drop. */
export function isDatabaseFile(name: string): boolean {
  return /\.(?:sql|sql\.gz|zip)$/i.test(name);
}

/** Decompress gzip locally before passing the dump to the existing SQL reader. */
async function readGzipDump(file: File): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot open .sql.gz files. Extract the .sql file first or use a newer browser.');
  }
  try {
    const buffer = await file.arrayBuffer();
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  } catch {
    throw new Error('Could not decompress this .sql.gz file. It may be damaged or not a valid gzip archive.');
  }
}

/** Read a SQL dump, gzip-compressed SQL dump, or ZIP containing SQL dumps. */
export async function readDatabaseFile(file: File): Promise<ParsedDatabase> {
  if (file.name.toLowerCase().endsWith('.sql.gz')) return parseDatabase(await readGzipDump(file));
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'sql') return parseDatabase(await file.text());
  if (extension === 'zip') return parseDatabaseArchive(await file.arrayBuffer());
  throw new Error('Unsupported file. Choose a .sql, .sql.gz, or .zip containing SQL dumps.');
}
