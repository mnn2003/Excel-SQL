/** Result of parsing SQL INSERT statements */
export interface ParsedSql {
  tableName: string;
  headers: string[];
  rows: (string | number | null)[][];
}

/** Split a VALUES tuple body on top-level commas, respecting quotes/parens */
function splitValues(body: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (c === "'") {
        if (body[i + 1] === "'") { cur += "''"; i++; continue; }
        inStr = false;
      }
      cur += c;
      continue;
    }
    if (c === "'") { inStr = true; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() !== '') out.push(cur.trim());
  return out;
}

/** Extract top-level (...) groups from a VALUES clause */
function extractTuples(clause: string): string[] {
  const tuples: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  for (let i = 0; i < clause.length; i++) {
    const c = clause[i];
    if (inStr) {
      if (c === "'") {
        if (clause[i + 1] === "'") { i++; continue; }
        inStr = false;
      }
      continue;
    }
    if (c === "'") { inStr = true; continue; }
    if (c === '(') { if (depth === 0) start = i + 1; depth++; }
    else if (c === ')') { depth--; if (depth === 0 && start >= 0) tuples.push(clause.slice(start, i)); }
  }
  return tuples;
}

/** Convert a raw SQL literal into a JS value */
function parseLiteral(token: string): string | number | null {
  const t = token.trim();
  if (/^null$/i.test(t)) return null;
  if (/^'([\s\S]*)'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^(true|false)$/i.test(t)) return t.toLowerCase();
  return t;
}

/**
 * Parse one or more INSERT INTO ... VALUES ... statements into tabular data.
 * Throws a friendly error when nothing usable is found.
 */
export function parseSqlInserts(sql: string): ParsedSql {
  // Column list is optional; statement may end with ";" or at end of input.
  const re =
    /insert\s+(?:ignore\s+)?into\s+([`"[\]\w.]+)\s*(\(([^)]*)\)\s*)?values\s*([\s\S]*?)(?:;|$)/gi;
  let match: RegExpExecArray | null;
  let tableName = '';
  let headers: string[] = [];
  const rows: (string | number | null)[][] = [];

  while ((match = re.exec(sql)) !== null) {
    const name = match[1].replace(/[`"[\]]/g, '');
    const cols = match[3]
      ? match[3].split(',').map((c) => c.trim().replace(/[`"[\]]/g, ''))
      : [];
    if (!tableName) { tableName = name; headers = cols; }
    for (const tuple of extractTuples(match[4])) {
      const values = splitValues(tuple).map(parseLiteral);
      // Without a column list, derive generic headers from the widest row.
      if (headers.length < values.length) {
        for (let i = headers.length; i < values.length; i++) headers.push(`column_${i + 1}`);
      }
      rows.push(headers.map((_, i) => (i < values.length ? values[i] : null)));
    }
  }

  if (!tableName || rows.length === 0) {
    throw new Error('No INSERT statements found. Paste statements like: INSERT INTO table VALUES (...);');
  }
  // Pad any rows created before headers grew
  const normalized = rows.map((r) =>
    r.length === headers.length ? r : headers.map((_, i) => (i < r.length ? r[i] : null))
  );
  return { tableName, headers, rows: normalized };
}
