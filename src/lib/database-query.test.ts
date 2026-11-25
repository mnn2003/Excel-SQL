import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseDatabase, type ParsedDatabase } from './database-parser';
import {
  buildGlobalSearchQuery,
  createDatabaseQueryEngine,
  getStatementType,
  prepareQueryBatch,
  type DatabaseQueryEngine,
} from './database-query';

const source: ParsedDatabase = parseDatabase(`
  CREATE TABLE customers (id int NOT NULL, name varchar(80), city varchar(80), PRIMARY KEY (id));
  INSERT INTO customers VALUES (1, 'Aman', 'Delhi'), (2, 'Priya', 'Mumbai'), (3, 'Rohit', 'Delhi');
  CREATE TABLE orders (id int NOT NULL, customer_id int, total numeric, PRIMARY KEY (id));
  INSERT INTO orders VALUES (10, 1, 250), (11, 1, 450), (12, 2, 300);
`);

describe('DatabaseQueryEngine', () => {
  let engine: DatabaseQueryEngine;

  beforeAll(async () => {
    engine = await createDatabaseQueryEngine(
      source,
      `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`
    );
  });

  afterAll(() => engine?.close());

  it('runs joins and multiple SELECT statements with concrete row values', () => {
    const execution = engine.run(`
      SELECT c.name, SUM(o.total) AS spent
      FROM customers AS c JOIN orders AS o ON o.customer_id = c.id
      WHERE c.city = 'Delhi'
      GROUP BY c.id, c.name;
      SELECT COUNT(*) AS customer_count FROM customers;
    `);

    expect(execution.changed).toBe(false);
    expect(execution.results).toHaveLength(2);
    expect(execution.results[0].columns).toEqual(['name', 'spent']);
    expect(execution.results[0].rows).toEqual([['Aman', 700]]);
    expect(execution.results[1].rows).toEqual([[3]]);
  });

  it('applies INSERT, UPDATE, and DELETE to the browser snapshot', () => {
    const execution = engine.run(`
      INSERT INTO customers VALUES (4, 'Neha', 'Chennai');
      UPDATE customers SET city = 'New Delhi' WHERE id = 1;
      DELETE FROM orders WHERE id = 12;
    `);

    expect(execution.changed).toBe(true);
    expect(execution.results.map((result) => result.rowsAffected)).toEqual([1, 1, 1]);
    const snapshot = engine.snapshot();
    expect(snapshot.tables[0].rows).toContainEqual([4, 'Neha', 'Chennai']);
    expect(snapshot.tables[0].rows[0]).toEqual([1, 'Aman', 'New Delhi']);
    expect(snapshot.tables[1].rows).toEqual([[10, 1, 250], [11, 1, 450]]);
  });

  it('rolls back earlier statements when a later statement fails', () => {
    expect(() => engine.run("DELETE FROM customers WHERE id = 2; SELECT * FROM missing_table;"))
      .toThrow('Statement 2');
    expect(engine.snapshot().tables[0].rows).toContainEqual([2, 'Priya', 'Mumbai']);
  });

  it('recognizes the main statement after a WITH clause', () => {
    expect(getStatementType('WITH selected AS (SELECT * FROM customers) SELECT * FROM selected')).toBe('SELECT');
    expect(getStatementType('WITH selected AS (SELECT 1 AS id) DELETE FROM customers WHERE id IN (SELECT id FROM selected)')).toBe('DELETE');
  });

  it('rejects manual transaction commands', () => {
    expect(() => prepareQueryBatch('BEGIN; DELETE FROM customers; COMMIT;'))
      .toThrow('Transaction commands are managed automatically');
  });
});

describe('buildGlobalSearchQuery', () => {
  it('searches every table and column and escapes quotes in the term', () => {
    const query = buildGlobalSearchQuery(source, "Aman's");
    expect(query).toContain("LIKE '%Aman''s%'");
    expect(query.match(/AS table_name/g)).toHaveLength(6);
    expect(query).toContain("FROM \"customers\"");
    expect(query).toContain("FROM \"orders\"");
  });
});
