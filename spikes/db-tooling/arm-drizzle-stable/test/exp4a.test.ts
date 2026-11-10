// Experiment 4a (round 3): T9, T10a, T10b, T11, T7 for drizzle-orm 0.45.4 migrate() / drizzle-kit 0.31.11 migrate.
// Own databases, prefix drizzle045_exp4a_. Created at the start of each test, left in place afterwards.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, describe, expect, test } from 'vitest';
import { url } from '../src/db.ts';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzleKit, saveOutput } from './helpers.ts';

// Same call as src/migrations.ts migrateDatabase, but on one pg.Client with an error listener: a backend killed by pg_terminate_backend
// makes pg emit 'error' on the checked-out client, which would otherwise surface as an uncaught exception.
async function migrateDatabase(database: string, migrationsFolder: string): Promise<void> {
  const client = new pg.Client({ connectionString: url(database, 'migrator') });
  client.on('error', () => {});
  await client.connect();
  try {
    await migrate(drizzle({ client }), { migrationsFolder, migrationsSchema: 'drizzle', migrationsTable: '__drizzle_migrations' });
  } finally {
    await client.end().catch(() => {});
  }
}

const BP = '\n--> statement-breakpoint\n';
const log: string[] = [];
const note = (s: string) => log.push(s);
afterAll(() => saveOutput('exp4a.txt', log.join('\n') + '\n'));

interface Mig {
  tag: string;
  when: number;
  sql: string;
}

function makeFolder(migs: Mig[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'exp4a-'));
  mkdirSync(join(dir, 'meta'));
  const entries = migs.map((m, idx) => ({ idx, version: '7', when: m.when, tag: m.tag, breakpoints: true }));
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ version: '7', dialect: 'postgresql', entries }, null, 2));
  for (const m of migs) writeFileSync(join(dir, `${m.tag}.sql`), m.sql);
  return dir;
}

async function admin<T extends pg.QueryResultRow = pg.QueryResultRow>(database: string, text: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: url(database, 'postgres') });
  await c.connect();
  try {
    return (await c.query<T>(text, params)).rows;
  } finally {
    await c.end();
  }
}

async function freshDb(name: string): Promise<string> {
  const db = `drizzle045_exp4a_${name}`;
  if (!db.startsWith('drizzle045_exp4a_')) throw new Error('refusing to touch foreign database');
  await admin('postgres', `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  await admin('postgres', `CREATE DATABASE ${db} OWNER skal_migrator`);
  return db;
}

const BASE: Mig = {
  tag: '0000_base',
  when: 1_000,
  sql: `CREATE TABLE items (id int, v text);${BP}INSERT INTO items SELECT g, 'v' || g FROM generate_series(1, 1000) g;`,
};

const applied = (db: string) => admin<{ id: number; hash: string; created_at: string }>(db, `select id, hash, created_at::text from drizzle.__drizzle_migrations order by id`);
const columns = async (db: string) =>
  (await admin<{ column_name: string }>(db, `select column_name from information_schema.columns where table_name='items' order by ordinal_position`)).map((r) => r.column_name);
const indexState = (db: string) =>
  admin<{ relname: string; indisvalid: boolean; indisready: boolean }>(
    db,
    `select c.relname, i.indisvalid, i.indisready from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname like 'items_v_idx%'`,
  );

async function failure(p: Promise<unknown>): Promise<{ message: string; causeMessage: string; code?: string }> {
  try {
    await p;
  } catch (e) {
    const err = e as Error & { cause?: { message: string; code?: string } };
    return { message: err.message, causeMessage: err.cause?.message ?? '', code: err.cause?.code };
  }
  throw new Error('expected failure, got success');
}

/** Wait for a backend in `db` running a statement that matches `like`, and return its pid. */
async function waitForBackend(db: string, like: string): Promise<number> {
  for (let i = 0; i < 100; i++) {
    const rows = await admin<{ pid: number }>(
      db,
      `select pid from pg_stat_activity where datname = $1 and state = 'active' and query ilike $2 and pid <> pg_backend_pid()`,
      [db, like],
    );
    if (rows[0]) return rows[0].pid;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no backend running ${like}`);
}

const kill = (db: string, pid: number) => admin(db, `select pg_terminate_backend($1)`, [pid]);

const NO_TX_HACK = (body: string) => `COMMIT;${BP}${body}${BP}BEGIN;`;
const CIC = 'CREATE INDEX CONCURRENTLY items_v_idx ON items (v);';
const cicMig = (body: string, when = 2_000): Mig => ({ tag: '0001_index', when, sql: body });

describe('T9 CREATE INDEX CONCURRENTLY through the migrator', () => {
  test('T9 plain file: migrate() fails, Postgres rejects it inside the transaction', async () => {
    const db = await freshDb('t9_plain');
    const dir = makeFolder([BASE, cicMig(CIC)]);
    const f = await failure(migrateDatabase(db, dir));
    note(`T9 plain, migrate(): message=${JSON.stringify(f.message)} cause=${JSON.stringify(f.causeMessage)} code=${f.code}`);
    expect(f.code).toBe('25001');
    expect(f.causeMessage).toMatch(/cannot run inside a transaction block/);
    expect(await applied(db)).toHaveLength(0); // base rolled back with it (single transaction)
    expect(await indexState(db)).toEqual([]);
  });

  test('T9 plain file, only the CIC statement after a breakpoint: same failure', async () => {
    const db = await freshDb('t9_bp');
    const dir = makeFolder([BASE, cicMig(`SELECT 1;${BP}${CIC}`)]);
    const f = await failure(migrateDatabase(db, dir));
    note(`T9 breakpoint-separated, migrate(): code=${f.code} cause=${JSON.stringify(f.causeMessage)}`);
    expect(f.code).toBe('25001');
  });

  test('T9 plain file through the drizzle-kit migrate CLI: fails', async () => {
    const db = await freshDb('t9_cli');
    const dir = makeFolder([BASE, cicMig(CIC)]);
    const r = drizzleKit(['migrate'], { DATABASE_URL: url(db, 'migrator'), MIGRATIONS_OUT: dir });
    note(`T9 plain, drizzle-kit migrate: exit=${r.code} output=${JSON.stringify(r.output.trim().slice(-600))}`);
    expect(r.code).not.toBe(0);
    expect(await indexState(db)).toEqual([]);
  });

  test('T9 per-file/config switches: none exist in the 0.45.4 / 0.31.11 sources', () => {
    const root = join(import.meta.dirname, '..', 'node_modules');
    const dialect = readFileSync(join(root, 'drizzle-orm', 'pg-core', 'dialect.js'), 'utf8');
    const reader = readFileSync(join(root, 'drizzle-orm', 'migrator.js'), 'utf8');
    // migrate() always wraps the loop in session.transaction(...). `bps` (the journal's breakpoints flag) is read
    // by readMigrationFiles but never consulted when executing.
    expect(dialect).toMatch(/await session\.transaction\(async \(tx\) => \{\s*for await \(const migration of migrations\)/);
    expect(reader).toMatch(/bps: journalEntry\.breakpoints/);
    expect(dialect.match(/\.bps/g)).toBeNull();
    expect(dialect.match(/no-?transaction/gi)).toBeNull();
  });

  test('T9 workaround, not a documented option: COMMIT; ... BEGIN; breakpoint-separated statements', async () => {
    const db = await freshDb('t9_hack');
    const dir = makeFolder([BASE, cicMig(NO_TX_HACK(CIC))]);
    await migrateDatabase(db, dir);
    const idx = await indexState(db);
    note(`T9 COMMIT/BEGIN workaround, migrate(): applied rows=${(await applied(db)).length} index=${JSON.stringify(idx)}`);
    expect(idx).toEqual([{ relname: 'items_v_idx', indisvalid: true, indisready: true }]);
    expect(await applied(db)).toHaveLength(2);
  });

  test('T9 workaround through the drizzle-kit migrate CLI', async () => {
    const db = await freshDb('t9_hack_cli');
    const dir = makeFolder([BASE, cicMig(NO_TX_HACK(CIC))]);
    const r = drizzleKit(['migrate'], { DATABASE_URL: url(db, 'migrator'), MIGRATIONS_OUT: dir });
    note(`T9 COMMIT/BEGIN workaround, drizzle-kit migrate: exit=${r.code} index=${JSON.stringify(await indexState(db))}`);
    expect(r.code).toBe(0);
    expect((await indexState(db))[0]?.indisvalid).toBe(true);
  });
});

describe('T10a killed transactional migration', () => {
  test('T10a DDL then pg_sleep(30), backend terminated: nothing applied; rerun without the sleep completes', async () => {
    const db = await freshDb('t10a');
    const m = (body: string): Mig => ({ tag: '0001_alter', when: 2_000, sql: body });
    const withSleep = `ALTER TABLE items ADD COLUMN c int;${BP}SELECT pg_sleep(30);`;
    const dir = makeFolder([BASE, m(withSleep)]);
    // Apply the base alone first, so "unchanged" means unchanged from a known recorded state.
    await migrateDatabase(db, makeFolder([BASE]));
    const before = { cols: await columns(db), rows: await applied(db) };

    const run = failure(migrateDatabase(db, dir));
    const pid = await waitForBackend(db, '%pg_sleep%');
    // The ALTER has run inside the open transaction on that backend.
    await kill(db, pid);
    const f = await run;
    note(`T10a killed: message=${JSON.stringify(f.message)} cause=${JSON.stringify(f.causeMessage)} code=${f.code}`);

    expect(await columns(db)).toEqual(before.cols);
    expect(await applied(db)).toEqual(before.rows);

    writeFileSync(join(dir, '0001_alter.sql'), 'ALTER TABLE items ADD COLUMN c int;');
    await migrateDatabase(db, dir);
    expect(await columns(db)).toEqual([...before.cols, 'c']);
    expect(await applied(db)).toHaveLength(2);
    note(`T10a rerun: columns=${(await columns(db)).join(',')} applied rows=${(await applied(db)).length}`);
  });
});

describe('T10b killed no-transaction file (only reachable with the COMMIT/BEGIN workaround)', () => {
  /** Run the file, kill the CIC while a blocker transaction holds it in its wait phase, return state. */
  async function killedRun(name: string, body: string) {
    const db = await freshDb(name);
    await migrateDatabase(db, makeFolder([BASE]));
    const dir = makeFolder([BASE, cicMig(NO_TX_HACK(body))]);
    const blocker = new pg.Client({ connectionString: url(db, 'migrator') });
    await blocker.connect();
    await blocker.query('BEGIN');
    // An open writer holds RowExclusive on items; CIC commits its INVALID catalog entry, then waits for this writer.
    await blocker.query("INSERT INTO items VALUES (0, 'blocker')");
    const run = failure(migrateDatabase(db, dir));
    const pid = await waitForBackend(db, '%CREATE INDEX CONCURRENTLY%');
    await kill(db, pid);
    const f = await run;
    await blocker.query('ROLLBACK');
    await blocker.end();
    return { db, dir, f, idx: await indexState(db), rows: await applied(db) };
  }

  test('T10b pattern 1: DROP INDEX CONCURRENTLY IF EXISTS before CREATE INDEX CONCURRENTLY', async () => {
    const k = await killedRun('t10b_drop', `DROP INDEX CONCURRENTLY IF EXISTS items_v_idx;${BP}${CIC}`);
    note(`T10b p1 killed: err=${JSON.stringify(k.f.causeMessage)} index=${JSON.stringify(k.idx)} applied rows=${k.rows.length}`);
    expect(k.idx).toEqual([{ relname: 'items_v_idx', indisvalid: false, indisready: false }]);
    expect(k.rows).toHaveLength(1);
    await migrateDatabase(k.db, k.dir);
    const idx = await indexState(k.db);
    note(`T10b p1 rerun: index=${JSON.stringify(idx)} applied rows=${(await applied(k.db)).length}`);
    expect(idx).toEqual([{ relname: 'items_v_idx', indisvalid: true, indisready: true }]);
    expect(await applied(k.db)).toHaveLength(2);
  });

  test('T10b pattern 2: CREATE INDEX CONCURRENTLY IF NOT EXISTS', async () => {
    const k = await killedRun('t10b_ifne', 'CREATE INDEX CONCURRENTLY IF NOT EXISTS items_v_idx ON items (v);');
    note(`T10b p2 killed: index=${JSON.stringify(k.idx)} applied rows=${k.rows.length}`);
    expect(k.idx[0]?.indisvalid).toBe(false);
    expect(k.rows).toHaveLength(1);
    await migrateDatabase(k.db, k.dir); // runner reports success
    const idx = await indexState(k.db);
    note(`T10b p2 rerun: runner returned success; index=${JSON.stringify(idx)} applied rows=${(await applied(k.db)).length}`);
    expect(await applied(k.db)).toHaveLength(2);
    expect(idx[0]?.indisvalid).toBe(false); // success recorded with the index still INVALID
  });

  test('T10b pattern 3: plain CREATE INDEX CONCURRENTLY, no guard', async () => {
    const k = await killedRun('t10b_plain', CIC);
    note(`T10b p3 killed: index=${JSON.stringify(k.idx)} applied rows=${k.rows.length}`);
    expect(k.idx[0]?.indisvalid).toBe(false);
    const f = await failure(migrateDatabase(k.db, k.dir));
    note(`T10b p3 rerun: error code=${f.code} cause=${JSON.stringify(f.causeMessage)}; index=${JSON.stringify(await indexState(k.db))} applied rows=${(await applied(k.db)).length}`);
    expect(f.code).toBe('42P07');
    expect((await indexState(k.db))[0]?.indisvalid).toBe(false);
    expect(await applied(k.db)).toHaveLength(1);
  });

  test('T10b without the workaround: a plain file cannot start, so there is nothing to kill (not applicable)', async () => {
    const db = await freshDb('t10b_na');
    const f = await failure(migrateDatabase(db, makeFolder([BASE, cicMig(CIC)])));
    expect(f.code).toBe('25001');
    expect(await indexState(db)).toEqual([]);
  });
});

describe('T11 late merge', () => {
  // Y authored first (when=1500, tag 0001_y), X second (when=2000, tag 0002_x). X is applied; Y arrives later.
  const Y: Mig = { tag: '0001_y', when: 1_500, sql: 'CREATE TABLE branch_y (id int);' };
  const X: Mig = { tag: '0002_x', when: 2_000, sql: 'CREATE TABLE branch_x (id int);' };
  const to = (db: string, t: string) => admin<{ t: string | null }>(db, `select to_regclass('public.${t}')::text as t`).then((r) => r[0]!.t);

  test('T11 migrate(): Y is silently skipped', async () => {
    const db = await freshDb('t11');
    await migrateDatabase(db, makeFolder([BASE, X])); // branch X's journal only
    const merged = makeFolder([BASE, Y, X]); // after the merge: Y sorts before X
    await migrateDatabase(db, merged); // no throw
    const rows = await applied(db);
    note(`T11 migrate(): returned without error; branch_y=${await to(db, 'branch_y')} applied created_at=${rows.map((r) => r.created_at).join(',')}`);
    expect(await to(db, 'branch_x')).toBe('branch_x');
    expect(await to(db, 'branch_y')).toBeNull();
    expect(rows).toHaveLength(2);
  });

  test('T11 drizzle-kit migrate CLI: Y is silently skipped', async () => {
    const db = await freshDb('t11_cli');
    await migrateDatabase(db, makeFolder([BASE, X]));
    const r = drizzleKit(['migrate'], { DATABASE_URL: url(db, 'migrator'), MIGRATIONS_OUT: makeFolder([BASE, Y, X]) });
    note(`T11 drizzle-kit migrate: exit=${r.code} output=${JSON.stringify(r.output.trim().slice(-300))} branch_y=${await to(db, 'branch_y')}`);
    expect(await to(db, 'branch_y')).toBeNull();
    expect(r.output).not.toMatch(/error/i);
  });
});

describe('T7 tamper (reported, not scored)', () => {
  test('T7 editing an applied file: no error, stored hash unchanged, edit never re-run', async () => {
    const db = await freshDb('t7');
    const dir = makeFolder([BASE, { tag: '0001_t', when: 2_000, sql: 'CREATE TABLE t7 (id int);' }]);
    await migrateDatabase(db, dir);
    const before = await applied(db);
    writeFileSync(join(dir, '0001_t.sql'), 'CREATE TABLE t7 (id int);\n-- tampered');
    await migrateDatabase(db, dir);
    const after = await applied(db);
    note(`T7 tamper: no error from migrate(); stored hashes unchanged=${JSON.stringify(before) === JSON.stringify(after)}`);
    expect(after).toEqual(before);
    const r = drizzleKit(['migrate'], { DATABASE_URL: url(db, 'migrator'), MIGRATIONS_OUT: dir });
    note(`T7 tamper, drizzle-kit migrate: exit=${r.code} output=${JSON.stringify(r.output.trim().slice(-200))}`);
    expect(r.code).toBe(0);
    expect(await applied(db)).toEqual(before);
  });
});
