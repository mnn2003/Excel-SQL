import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { gzipSync } from 'node:zlib';
import { isDatabaseFile, parseDatabase, parseDatabaseArchive, readDatabaseFile } from './database-parser';

describe('parseDatabase', () => {
  it('reads multiple table definitions and INSERT rows without column lists', () => {
    const database = parseDatabase(`
      CREATE TABLE \`vendors\` (
        \`id\` int NOT NULL,
        \`name\` varchar(255) NOT NULL,
        \`notes\` text,
        PRIMARY KEY (\`id\`)
      );
      INSERT INTO \`vendors\` VALUES
        ('1','Dell Technologies','Authorized supplier'),
        ('2','HP India',NULL);
      CREATE TABLE \`empty_logs\` (\`id\` int);
    `);

    expect(database.tables.map((table) => table.name)).toEqual(['vendors', 'empty_logs']);
    expect(database.totalRows).toBe(2);
    expect(database.tables[0].columns[0]).toMatchObject({ name: 'id', type: 'int', nullable: false, primaryKey: true });
    expect(database.tables[0].rows).toEqual([
      ['1', 'Dell Technologies', 'Authorized supplier'],
      ['2', 'HP India', null],
    ]);
  });

  it('keeps semicolons and escaped quotes inside values intact', () => {
    const database = parseDatabase(
      "INSERT INTO notes (id, body) VALUES (1, 'First; second'), (2, 'it\\'s fine'), (3, 'SQL ''quote''');"
    );

    expect(database.tables[0].rows).toEqual([
      [1, 'First; second'],
      [2, "it's fine"],
      [3, "SQL 'quote'"],
    ]);
  });

  it('maps explicit INSERT columns to their CREATE TABLE positions', () => {
    const database = parseDatabase(`
      CREATE TABLE users (id int, name varchar(50), email varchar(100));
      INSERT INTO users (email, id) VALUES ('a@example.com', 7);
    `);

    expect(database.tables[0].rows).toEqual([[7, null, 'a@example.com']]);
  });

  it('adds schema details when a separate data file appears before CREATE TABLE', () => {
    const database = parseDatabase(`
      INSERT INTO users VALUES (7, 'Aman', 'aman@example.com');
      CREATE TABLE users (id int NOT NULL, name varchar(50), email varchar(100), PRIMARY KEY (id));
    `);

    expect(database.tables[0].columns.map((column) => column.name)).toEqual(['id', 'name', 'email']);
    expect(database.tables[0].columns[0].primaryKey).toBe(true);
    expect(database.tables[0].rows).toEqual([[7, 'Aman', 'aman@example.com']]);
  });
});

describe('gzip database uploads', () => {
  // jsdom's Blob lacks streams; use Node's browser-compatible implementation.
  beforeEach(() => vi.stubGlobal('Blob', NodeBlob));
  afterEach(() => vi.unstubAllGlobals());

  it('accepts .sql.gz names but rejects unrelated gzip files', () => {
    expect(isDatabaseFile('backup.sql.gz')).toBe(true);
    expect(isDatabaseFile('BACKUP.SQL.GZ')).toBe(true);
    expect(isDatabaseFile('photo.gz')).toBe(false);
    expect(isDatabaseFile('backup.sql.gz.exe')).toBe(false);
  });

  it('decompresses .sql.gz and preserves multiple tables and values', async () => {
    const sql = "CREATE TABLE users (id int, name text); INSERT INTO users VALUES (1, 'Aman'), (2, NULL); CREATE TABLE orders (id int, user_id int); INSERT INTO orders VALUES (7, 1);";
    const file = new NodeFile([gzipSync(sql)], 'backup.SQL.GZ') as unknown as File;
    const database = await readDatabaseFile(file);
    expect(database.tables.map((table) => table.name)).toEqual(['users', 'orders']);
    expect(database.tables[0].rows).toEqual([[1, 'Aman'], [2, null]]);
    expect(database.tables[1].rows).toEqual([[7, 1]]);
    expect(database.totalRows).toBe(3);
  });

  it('rejects damaged gzip files with a decompression error', async () => {
    const file = new NodeFile(['not gzip'], 'backup.sql.gz') as unknown as File;
    await expect(readDatabaseFile(file)).rejects.toThrow('Could not decompress');
  });
});

describe('parseDatabaseArchive', () => {
  it('combines SQL dumps in a ZIP and ignores non-SQL entries', async () => {
    const zip = new JSZip();
    zip.file('01-users.sql', 'CREATE TABLE users (id int); INSERT INTO users VALUES (1);');
    zip.file('02-orders.sql', 'CREATE TABLE orders (id int); INSERT INTO orders VALUES (2);');
    zip.file('README.txt', 'not a database statement');
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });

    const database = await parseDatabaseArchive(buffer);

    expect(database.tables.map((table) => table.name)).toEqual(['users', 'orders']);
    expect(database.totalRows).toBe(2);
  });
});
