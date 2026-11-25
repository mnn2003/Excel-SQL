import initSqlJs, {
  type Database as SqlJsDatabase,
  type SqlJsStatic,
  type SqlValue,
} from 'sql.js';
import {
  splitSqlStatements,
  type DatabaseTable,
  type DatabaseValue,
  type ParsedDatabase,
} from './database-parser';

export const MAX_QUERY_RESULT_ROWS = 10_000;
// Served as a static asset so the WASM binary stays out of the JavaScript bundle.
const SQL_WASM_URL = '/wasm/sql-wasm.wasm';

const SUPPORTED_STATEMENTS = new Set([
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'REPLACE',
  'CREATE',
  'ALTER',
  'DROP',
  'EXPLAIN',
]);
const MUTATING_STATEMENTS = new Set(['INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'CREATE', 'ALTER', 'DROP']);
const MAIN_WITH_STATEMENTS = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE']);

export interface SqlQueryResult {
  statement: string;
  type: string;
  columns: string[];
  rows: DatabaseValue[][];
  rowsAffected: number | null;
  truncated: boolean;
}

export interface SqlQueryExecution {
  results: SqlQueryResult[];
  changed: boolean;
  elapsedMs: number;
}

/** Quote an identifier so table and column names cannot change SQL meaning. */
export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Return top-level SQL words, ignoring words inside CTE parentheses and quoted values.
 * This lets WITH ... UPDATE be distinguished from WITH ... SELECT without a SQL parser dependency.
 */
function topLevelWords(statement: string): string[] {
  const words: string[] = [];
  let depth = 0;
  let quote = '';

  for (let index = 0; index < statement.length; index++) {
    const char = statement[index];
    const next = statement[index + 1];

    if (quote) {
      if (char === quote) {
        if (next === quote) index++;
        else quote = '';
      } else if (char === ']' && quote === '[') {
        quote = '';
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      quote = char;
      continue;
    }
    if (char === '(') {
      depth++;
      continue;
    }
    if (char === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && /[A-Za-z_]/.test(char)) {
      const match = statement.slice(index).match(/^[A-Za-z_]+/);
      if (match) {
        words.push(match[0].toUpperCase());
        index += match[0].length - 1;
      }
    }
  }
  return words;
}

/** Find the effective statement type, including the main statement after a WITH clause. */
export function getStatementType(statement: string): string {
  const words = topLevelWords(statement);
  if (!words.length) return '';
  if (words[0] !== 'WITH') return words[0];
  return words.slice(1).find((word) => MAIN_WITH_STATEMENTS.has(word)) ?? 'WITH';
}

/** Split and validate a batch. Transactions are supplied by the engine for atomic execution. */
export function prepareQueryBatch(sql: string): string[] {
  const statements = splitSqlStatements(sql);
  if (!statements.length) throw new Error('Enter at least one SQL statement.');

  for (const statement of statements) {
    const type = getStatementType(statement);
    if (['BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE'].includes(type)) {
      throw new Error('Transaction commands are managed automatically. Remove BEGIN, COMMIT, and ROLLBACK.');
    }
    if (!SUPPORTED_STATEMENTS.has(type)) {
      throw new Error(`Unsupported ${type || 'SQL'} statement. Use SELECT, INSERT, UPDATE, DELETE, REPLACE, CREATE, ALTER, DROP, or EXPLAIN.`);
    }
  }
  return statements;
}

/**
 * Build a UNION ALL query that searches every column of every imported table.
 * Each match identifies its source table and column without requiring compatible table schemas.
 */
export function buildGlobalSearchQuery(database: ParsedDatabase, searchTerm: string): string {
  const term = searchTerm.trim();
  if (!term) throw new Error('Enter text to search for.');
  const pattern = quoteLiteral(`%${term}%`);
  const branches = database.tables.flatMap((table) =>
    table.columns.map((column) => {
      const value = `CAST(${quoteIdentifier(column.name)} AS TEXT)`;
      return `SELECT ${quoteLiteral(table.name)} AS table_name, ${quoteLiteral(column.name)} AS column_name, ${value} AS matched_value FROM ${quoteIdentifier(table.name)} WHERE ${value} LIKE ${pattern}`;
    })
  );
  if (!branches.length) throw new Error('There are no table columns to search.');
  return `${branches.join('\nUNION ALL\n')}\nLIMIT ${MAX_QUERY_RESULT_ROWS};`;
}

function toDatabaseValue(value: SqlValue): DatabaseValue {
  if (value instanceof Uint8Array) return `[Binary data: ${value.byteLength} bytes]`;
  return value;
}

function safeColumnType(type: string): string {
  return /^[A-Za-z]+(?:\s*\(\s*\d+(?:\s*,\s*\d+)*\s*\))?$/.test(type) ? type : '';
}

let sqlModule: Promise<SqlJsStatic> | null = null;

function loadSqlModule(wasmUrl: string): Promise<SqlJsStatic> {
  if (!sqlModule) {
    sqlModule = initSqlJs({ locateFile: () => wasmUrl }).catch((error) => {
      sqlModule = null;
      throw error;
    });
  }
  return sqlModule;
}

/** A temporary SQLite database populated entirely from the uploaded dump. */
export class DatabaseQueryEngine {
  private constructor(private readonly db: SqlJsDatabase) {}

  static async fromDatabase(database: ParsedDatabase, wasmUrl = SQL_WASM_URL): Promise<DatabaseQueryEngine> {
    const SQL = await loadSqlModule(wasmUrl);
    const db = new SQL.Database();
    try {
      db.exec('BEGIN');
      for (const table of database.tables) {
        if (!table.columns.length) continue;
        const primaryKeys = table.columns.filter((column) => column.primaryKey);
        const definitions = table.columns.map((column) => {
          const type = safeColumnType(column.type);
          const parts = [quoteIdentifier(column.name)];
          if (type) parts.push(type);
          if (!column.nullable) parts.push('NOT NULL');
          if (column.primaryKey && primaryKeys.length === 1) parts.push('PRIMARY KEY');
          return parts.join(' ');
        });
        if (primaryKeys.length > 1) {
          definitions.push(`PRIMARY KEY (${primaryKeys.map((column) => quoteIdentifier(column.name)).join(', ')})`);
        }
        db.run(`CREATE TABLE ${quoteIdentifier(table.name)} (${definitions.join(', ')})`);

        const insert = db.prepare(
          `INSERT INTO ${quoteIdentifier(table.name)} (${table.columns.map((column) => quoteIdentifier(column.name)).join(', ')}) VALUES (${table.columns.map(() => '?').join(', ')})`
        );
        try {
          for (const row of table.rows) {
            insert.run(table.columns.map((_, index) => row[index] ?? null));
          }
        } finally {
          insert.free();
        }
      }
      db.exec('COMMIT');
      return new DatabaseQueryEngine(db);
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* The database is closed below. */ }
      db.close();
      throw error;
    }
  }

  /** Run a batch atomically and return one result entry per statement. */
  run(sql: string): SqlQueryExecution {
    const statements = prepareQueryBatch(sql);
    const started = Date.now();
    const results: SqlQueryResult[] = [];
    let activeStatement = 0;

    this.db.exec('BEGIN');
    try {
      for (let index = 0; index < statements.length; index++) {
        activeStatement = index + 1;
        const source = statements[index];
        const type = getStatementType(source);
        const statement = this.db.prepare(source);
        try {
          const columns = statement.getColumnNames();
          const rows: DatabaseValue[][] = [];
          let truncated = false;
          while (statement.step()) {
            if (rows.length >= MAX_QUERY_RESULT_ROWS) {
              truncated = true;
              break;
            }
            rows.push(statement.get().map(toDatabaseValue));
          }
          results.push({
            statement: source,
            type,
            columns,
            rows,
            rowsAffected: ['INSERT', 'UPDATE', 'DELETE', 'REPLACE'].includes(type) ? this.db.getRowsModified() : null,
            truncated,
          });
        } finally {
          statement.free();
        }
      }
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* Preserve the original query error. */ }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Statement ${activeStatement}: ${message}`);
    }

    return {
      results,
      changed: statements.some((statement) => MUTATING_STATEMENTS.has(getStatementType(statement))),
      elapsedMs: Math.round((Date.now() - started) * 10) / 10,
    };
  }

  /** Read the current temporary database back into the table browser's data model. */
  snapshot(): ParsedDatabase {
    const namesResult = this.db.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid"
    );
    const names = namesResult[0]?.values.map((row) => String(row[0])) ?? [];
    const tables: DatabaseTable[] = names.map((name) => {
      const info = this.db.exec(`PRAGMA table_info(${quoteIdentifier(name)})`);
      const columns = (info[0]?.values ?? []).map((row) => ({
        name: String(row[1]),
        type: String(row[2] ?? ''),
        nullable: Number(row[3]) === 0,
        primaryKey: Number(row[5]) > 0,
        definition: `${String(row[1])} ${String(row[2] ?? '')}`.trim(),
      }));
      const data = this.db.exec(`SELECT * FROM ${quoteIdentifier(name)}`);
      return {
        name,
        columns,
        rows: (data[0]?.values ?? []).map((row) => row.map(toDatabaseValue)),
      };
    });
    return { tables, totalRows: tables.reduce((sum, table) => sum + table.rows.length, 0) };
  }

  close(): void {
    this.db.close();
  }
}

export async function createDatabaseQueryEngine(
  database: ParsedDatabase,
  wasmUrl = SQL_WASM_URL
): Promise<DatabaseQueryEngine> {
  return DatabaseQueryEngine.fromDatabase(database, wasmUrl);
}
