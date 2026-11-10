// Experiment 4a rerun (round 3, equal brief): T9, T10a, T10b, T11, T7 for drizzle-orm 0.45.4 migrate() and
// drizzle-kit 0.31.11 migrate. Databases are prefixed drizzle045r_. This file records outcomes; verdicts are in RESULTS.md.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { describe, test } from 'vitest';
import { url } from '../src/db.ts';

const ARM = resolve(import.meta.dirname, '..');
const TMP = join(ARM, '.r3tmp');
const LOG = join(ARM, 'out', 'exp4a-rerun.txt');
const P = 'drizzle045r_';
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(join(ARM, 'out'), { recursive: true });
writeFileSync(LOG, '');
const log = (s: string) => appendFileSync(LOG, s + '\n');

async function q<T = any>(db: string, sql: string, role: 'postgres' | 'migrator' = 'migrator'): Promise<T[]> {
  const c = new pg.Client({ connectionString: url(db, role) });
  await c.connect();
  try {
    return (await c.query(sql)).rows as T[];
  } finally {
    await c.end();
  }
}
async function mk(name: string, ext: string[] = []): Promise<string> {
  const db = P + name;
  await q('postgres', `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`, 'postgres');
  await q('postgres', `CREATE DATABASE ${db} OWNER skal_migrator`, 'postgres');
  for (const e of ext) await q(db, `CREATE EXTENSION ${e}`, 'postgres');
  return db;
}

interface Entry { tag: string; sql: string; when?: number; breakpoints?: boolean }
let seq = 0;
/** Write a migrations folder (NNNN_tag.sql + meta/_journal.json). */
function folder(name: string, entries: Entry[]): string {
  const dir = join(TMP, `${name}-${seq++}`);
  mkdirSync(join(dir, 'meta'), { recursive: true });
  const base = 1_800_000_000_000;
  const j = {
    version: '7', dialect: 'postgresql',
    entries: entries.map((e, i) => ({ idx: i, version: '7', when: e.when ?? base + i * 1000, tag: e.tag, breakpoints: e.breakpoints ?? true })),
  };
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(j, null, 2));
  for (const e of entries) writeFileSync(join(dir, `${e.tag}.sql`), e.sql);
  return dir;
}

interface Run { ok: boolean; err?: string; notices?: string }
const errText = (e: any): string => `${e?.cause?.message ?? e?.message ?? e}`.split('\n')[0];

async function runMigrate(db: string, dir: string): Promise<Run> {
  const pool = new pg.Pool({ connectionString: url(db, 'migrator'), max: 1 });
  const notices: string[] = [];
  pool.on('error', () => {});
  // Kill tests terminate the backend on purpose; swallow the per-client error so Vitest
  // doesn't report it as unhandled (the uncaught pg error itself is a recorded finding).
  pool.on('connect', (c) => {
    c.on('error', () => {});
    c.on('notice', (n) => notices.push(String(n.message ?? '')));
  });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: dir, migrationsSchema: 'drizzle', migrationsTable: '__drizzle_migrations' });
    return { ok: true, notices: notices.join(' | ') };
  } catch (e) {
    return { ok: false, err: errText(e), notices: notices.join(' | ') };
  } finally {
    await pool.end().catch(() => {});
  }
}

function kitConfig(db: string, out: string, extra = ''): string {
  const p = join(TMP, `kit-${seq++}.config.mjs`);
  writeFileSync(p, `export default { dialect: 'postgresql', out: ${JSON.stringify(out)}, ${extra} dbCredentials: { url: ${JSON.stringify(url(db, 'migrator'))} } };\n`);
  return p;
}
function kit(args: string[], cwd = ARM): Promise<{ code: number; output: string }> {
  return new Promise((res) => {
    const c = spawn(process.execPath, [join(ARM, 'node_modules/drizzle-kit/bin.cjs'), ...args], { cwd, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));
    c.on('close', (code) => res({ code: code ?? 1, output: out }));
  });
}
async function runKit(db: string, dir: string): Promise<{ code: number; output: string }> {
  const r = await kit(['migrate', '--config', kitConfig(db, dir)]);
  r.output = r.output
    .replace(/\x1b\[2K\x1b\[1G/g, '\n')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^\[.\] applying migrations\.\.\.$/.test(l.trim()) && !l.startsWith('Reading config') && !l.startsWith('Using '))
    .join(' / ')
    .slice(-500);
  return r;
}

/** After `ms` of polling, terminate the backend whose active query matches `pattern`. */
function killer(db: string, pattern: string): Promise<number> & { stop: () => void } {
  let stopped = false;
  const p = (async () => {
    for (let i = 0; i < 300 && !stopped; i++) {
      const r = await q(db, `select pg_terminate_backend(pid) t, pid from pg_stat_activity where datname='${db}' and state='active' and pid<>pg_backend_pid() and query ilike '%${pattern}%'`);
      if (r.length) return r.length;
      await new Promise((r) => setTimeout(r, 100));
    }
    return 0;
  })() as Promise<number> & { stop: () => void };
  p.stop = () => { stopped = true; };
  return p;
}

const SETUP = `CREATE TABLE t (id int PRIMARY KEY, a int);
--> statement-breakpoint
CREATE FUNCTION slow(i int) RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN PERFORM pg_sleep(0.01); RETURN i; END $$;
--> statement-breakpoint
INSERT INTO t SELECT g, g FROM generate_series(1,2000) g;`;

const idx = (db: string) => q<{ indisvalid: boolean }>(db, `select i.indisvalid from pg_index i join pg_class c on c.oid=i.indexrelid where c.relname='t_idx'`);
const rows = (db: string) => q<{ id: number; created_at: string }>(db, `select id, created_at::text from drizzle.__drizzle_migrations order by id`).catch(() => []);
const txState = (db: string) => `index=${JSON.stringify([]) /* placeholder */}`;

// Patterns: body of migration 0001, parameterised by the index expression `X`.
interface Pattern { id: string; doc: string; body: (x: string) => string; breakpoints?: boolean; note: string }
const CREATE = (x: string) => `CREATE INDEX CONCURRENTLY t_idx ON t (${x})`;
const PATTERNS: Pattern[] = [
  { id: 'P1 plain file', doc: 'documented (ordinary file)', body: (x) => `${CREATE(x)};`, note: 'one CREATE INDEX CONCURRENTLY statement' },
  { id: 'P2 breakpoint split', doc: 'documented (breakpoints)', body: (x) => `SELECT 1;\n--> statement-breakpoint\n${CREATE(x)};`, note: 'statement-breakpoint isolates the statement into its own query' },
  { id: 'P3 journal breakpoints:false', doc: 'documented (config)', breakpoints: false, body: (x) => `${CREATE(x)};`, note: 'journal entry breakpoints=false; whole file sent as one string' },
  { id: 'P4 IF NOT EXISTS', doc: 'documented SQL', body: (x) => `CREATE INDEX CONCURRENTLY IF NOT EXISTS t_idx ON t (${x});`, note: 'idempotent single statement' },
  { id: 'P5 DROP IF EXISTS + CREATE (two breakpoints)', doc: 'documented SQL', body: (x) => `DROP INDEX CONCURRENTLY IF EXISTS t_idx;\n--> statement-breakpoint\n${CREATE(x)};`, note: 'the idempotent file pattern' },
  { id: 'P6 DO block EXECUTE', doc: 'documented SQL', body: (x) => `DO $$ BEGIN EXECUTE 'DROP INDEX IF EXISTS t_idx'; EXECUTE '${CREATE(x)}'; END $$;`, note: 'dynamic SQL inside a function-like block' },
  { id: 'P7 COMMIT first', doc: 'NOT documented (hack: ends the migrator tx from inside the file)', body: (x) => `COMMIT;\n--> statement-breakpoint\nDROP INDEX CONCURRENTLY IF EXISTS t_idx;\n--> statement-breakpoint\n${CREATE(x)};`, note: 'COMMIT then idempotent drop/create' },
  { id: 'P8 COMMIT first, BEGIN last', doc: 'NOT documented (hack)', body: (x) => `COMMIT;\n--> statement-breakpoint\nDROP INDEX CONCURRENTLY IF EXISTS t_idx;\n--> statement-breakpoint\n${CREATE(x)};\n--> statement-breakpoint\nBEGIN;`, note: 'as P7, then reopen a transaction so the migrator COMMIT is clean' },
  { id: 'P7b COMMIT first, IF NOT EXISTS only (no drop)', doc: 'NOT documented (hack)', body: (x) => `COMMIT;\n--> statement-breakpoint\nCREATE INDEX CONCURRENTLY IF NOT EXISTS t_idx ON t (${x});`, note: 'non-self-healing idempotency' },
  { id: 'P7c COMMIT first, plain CREATE (no drop)', doc: 'NOT documented (hack)', body: (x) => `COMMIT;\n--> statement-breakpoint\nCREATE INDEX CONCURRENTLY t_idx ON t (${x});`, note: 'no idempotency' },
  { id: 'P9 COMMIT in one string (breakpoints:false)', doc: 'NOT documented (hack)', breakpoints: false, body: (x) => `COMMIT;\nDROP INDEX CONCURRENTLY IF EXISTS t_idx;\n${CREATE(x)};`, note: 'multi-statement simple query' },
  { id: 'P10 dblink_exec', doc: 'NOT documented (hack; needs dblink extension and a connection string in the file)', body: (x) => `SELECT dblink_exec('${'postgres://skal_migrator:migrator@localhost:5432/__DB__'}', 'DROP INDEX CONCURRENTLY IF EXISTS t_idx');\n--> statement-breakpoint\nSELECT dblink_exec('${'postgres://skal_migrator:migrator@localhost:5432/__DB__'}', '${CREATE(x)}');`, note: 'build on a second connection outside the migrator transaction' },
];

describe('T9 + T10b patterns', () => {
  for (const pat of PATTERNS) {
    test(pat.id, async () => {
      const ext = pat.id.startsWith('P10') ? ['dblink'] : [];
      // ---- T9: fast index, through migrate() and through the CLI
      const out: Record<string, unknown> = { pattern: pat.id, doc: pat.doc, note: pat.note };
      for (const runner of ['migrate()', 'kit migrate'] as const) {
        const db = await mk(`t9_${seq}`, ext);
        const fix = (s: string) => s.replaceAll('__DB__', db);
        const setup = folder('setup', [{ tag: '0000_setup', sql: SETUP }]);
        const r0 = await runMigrate(db, setup);
        const f = folder('t9', [
          { tag: '0000_setup', sql: SETUP },
          { tag: '0001_idx', sql: fix(pat.body('a')), breakpoints: pat.breakpoints },
        ]);
        const r = runner === 'migrate()' ? await runMigrate(db, f) : await runKit(db, f);
        const ok = 'ok' in r ? (r as Run).ok : (r as any).code === 0;
        out[`T9 ${runner}`] = {
          setupOk: r0.ok, runnerSaysSuccess: ok, detail: 'ok' in r ? (r as Run).err ?? (r as Run).notices : (r as any).output.slice(0, 400),
          indexRows: await idx(db), migrationRows: (await rows(db)).length,
        };
        await q('postgres', `DROP DATABASE ${db} WITH (FORCE)`, 'postgres');
      }
      log(JSON.stringify(out, null, 1));
    });
  }
});

describe('T10b kill during CONCURRENTLY build', () => {
  // Only patterns that can run CONCURRENTLY at all are interesting; run all for the record, with migrate().
  for (const pat of PATTERNS) {
    test(pat.id, async () => {
      const ext = pat.id.startsWith('P10') ? ['dblink'] : [];
      const out: Record<string, unknown> = { pattern: pat.id };
      for (const runner of ['migrate()', 'kit migrate'] as const) {
        const db = await mk(`t10b_${seq}`, ext);
        const fix = (s: string) => s.replaceAll('__DB__', db);
        await runMigrate(db, folder('setup', [{ tag: '0000_setup', sql: SETUP }]));
        const f = folder('t10b', [
          { tag: '0000_setup', sql: SETUP },
          { tag: '0001_idx', sql: fix(pat.body('slow(a)')), breakpoints: pat.breakpoints },
        ]);
        const kp = killer(db, 'CREATE INDEX CONCURRENTLY%t_idx');
        const r1 = runner === 'migrate()' ? await runMigrate(db, f) : await runKit(db, f);
        kp.stop();
        const killed = await kp;
        const ok1 = 'ok' in r1 ? (r1 as Run).ok : (r1 as any).code === 0;
        const after = { runnerSaysSuccess: ok1, killedBackends: killed, err: 'ok' in r1 ? (r1 as Run).err : (r1 as any).output.slice(-300), index: await idx(db), migrationRows: (await rows(db)).length };
        // The DBA-visible window: if a build was killed the INVALID index stays. Rerun the SAME file (kill again is not needed;
        // the slow function makes rerun take ~20s, acceptable).
        const r2 = runner === 'migrate()' ? await runMigrate(db, f) : await runKit(db, f);
        const ok2 = 'ok' in r2 ? (r2 as Run).ok : (r2 as any).code === 0;
        const rerun = { runnerSaysSuccess: ok2, err: 'ok' in r2 ? (r2 as Run).err : (r2 as any).output.slice(-300), index: await idx(db), migrationRows: (await rows(db)).length };
        out[runner] = { afterKill: after, afterRerun: rerun };
        await q('postgres', `DROP DATABASE ${db} WITH (FORCE)`, 'postgres');
      }
      log(JSON.stringify(out, null, 1));
    });
  }
});

describe('T10a killed transactional file', () => {
  for (const runner of ['migrate()', 'kit migrate'] as const) {
    test(runner, async () => {
      const db = await mk(`t10a_${runner === 'migrate()' ? 'm' : 'k'}`);
      const run = (d: string) => (runner === 'migrate()' ? runMigrate(db, d) : runKit(db, d));
      const okOf = (r: any) => ('ok' in r ? r.ok : r.code === 0);
      const f0 = folder('a0', [{ tag: '0000_setup', sql: SETUP }]);
      const r0 = await run(f0);
      const bad = (sleep: string) => folder('a1', [
        { tag: '0000_setup', sql: SETUP },
        { tag: '0001_ddl_sleep', sql: `ALTER TABLE t ADD COLUMN b int;\n--> statement-breakpoint\n${sleep}` },
      ]);
      const killedDir = bad('SELECT pg_sleep(30);');
      const kp = killer(db, 'pg_sleep(30)');
      const r1 = await run(killedDir);
      kp.stop();
      const killed = await kp;
      const cols = async () => (await q(db, `select attname from pg_attribute where attrelid='t'::regclass and attnum>0 and not attisdropped order by attnum`)).map((r) => r.attname);
      const afterKill = { setupOk: okOf(r0), killed, runnerSaysSuccess: okOf(r1), cols: await cols(), migrationRows: (await rows(db)).length };
      const r2 = await run(bad('SELECT 1;'));
      const afterRerun = { runnerSaysSuccess: okOf(r2), cols: await cols(), migrationRows: (await rows(db)).length };
      // Batch: fresh DB, 0000 and 0001 in one call, 0001 killed -> does 0000 survive?
      const db2 = await mk(`t10a_batch_${runner === 'migrate()' ? 'm' : 'k'}`);
      const run2 = (d: string) => (runner === 'migrate()' ? runMigrate(db2, d) : runKit(db2, d));
      const kp2 = killer(db2, 'pg_sleep(30)');
      const rb = await run2(killedDir);
      kp2.stop();
      await kp2;
      const batch = { runnerSaysSuccess: okOf(rb), tExists: (await q(db2, `select to_regclass('t')::text r`))[0].r, migrationRows: (await rows(db2)).length };
      log(JSON.stringify({ T10a: runner, afterKill, afterRerun, freshBatchKilledSecondFile: batch }, null, 1));
    });
  }
});

describe('T7 tamper', () => {
  for (const runner of ['migrate()', 'kit migrate'] as const) {
    test(runner, async () => {
      const db = await mk(`t7_${runner === 'migrate()' ? 'm' : 'k'}`);
      const run = (d: string) => (runner === 'migrate()' ? runMigrate(db, d) : runKit(db, d));
      const okOf = (r: any) => ('ok' in r ? r.ok : r.code === 0);
      const f = folder('t7', [{ tag: '0000_setup', sql: SETUP }, { tag: '0001_col', sql: 'ALTER TABLE t ADD COLUMN b int;' }]);
      await run(f);
      const before = await q(db, `select id, hash from drizzle.__drizzle_migrations order by id`);
      writeFileSync(join(f, '0001_col.sql'), 'ALTER TABLE t ADD COLUMN b int;\n--> statement-breakpoint\nALTER TABLE t ADD COLUMN evil int;');
      const r = await run(f);
      const cols = (await q(db, `select attname from pg_attribute where attrelid='t'::regclass and attnum>0 and not attisdropped`)).map((x) => x.attname);
      const after = await q(db, `select id, hash from drizzle.__drizzle_migrations order by id`);
      log(JSON.stringify({ T7: runner, rerunSaysSuccess: okOf(r), output: 'ok' in r ? (r as Run).err : (r as any).output.slice(-200), cols, hashesUnchanged: JSON.stringify(before) === JSON.stringify(after) }, null, 1));
    });
  }
});

// ---------------------------------------------------------------- T11
const SCHEMA = (extra: string[]) => `import { pgTable, integer } from 'drizzle-orm/pg-core';
export const base = pgTable('base_tbl', { id: integer('id').primaryKey() });
${extra.map((t) => `export const ${t} = pgTable('${t}', { id: integer('id').primaryKey() });`).join('\n')}
`;
function proj(name: string): string {
  const d = join(TMP, `p-${name}-${seq++}`);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'drizzle.config.mjs'), `export default { dialect: 'postgresql', schema: './schema.ts', out: './drizzle' };\n`);
  return d;
}
async function gen(dir: string, tables: string[], name?: string): Promise<string> {
  writeFileSync(join(dir, 'schema.ts'), SCHEMA(tables));
  const r = await kit(['generate', '--config', join(dir, 'drizzle.config.mjs'), ...(name ? ['--name', name] : [])], dir);
  return r.output.replace(/\x1b\[[0-9;]*m/g, '').trim();
}
const jr = (dir: string) => JSON.parse(readFileSync(join(dir, 'drizzle', 'meta', '_journal.json'), 'utf8'));
const files = (dir: string) => readdirSync(join(dir, 'drizzle')).concat(readdirSync(join(dir, 'drizzle', 'meta')).map((f) => 'meta/' + f)).sort();
const tablesOf = async (db: string) => (await q(db, `select table_name from information_schema.tables where table_schema='public' order by 1`)).map((r) => r.table_name).join(',');

describe('T11 late merge', () => {
  test('two branches, merges and regenerate', async () => {
    const R: Record<string, unknown> = {};
    const base = proj('base');
    R.baseGenerate = await gen(base, [], 'base');
    const Y = proj('Y');
    cpSync(join(base, 'drizzle'), join(Y, 'drizzle'), { recursive: true });
    R.yGenerate = await gen(Y, ['y_tbl']);          // authored first
    await new Promise((r) => setTimeout(r, 1500));
    const X = proj('X');
    cpSync(join(base, 'drizzle'), join(X, 'drizzle'), { recursive: true });
    R.xGenerate = await gen(X, ['x_tbl']);          // authored second
    R.yFiles = files(Y); R.xFiles = files(X);
    R.yJournalNew = jr(Y).entries.slice(1); R.xJournalNew = jr(X).entries.slice(1);

    // textual git merge of the journal (current = X as main, other = Y)
    const jb = join(base, 'drizzle/meta/_journal.json');
    const m = spawnSync('git', ['merge-file', '-p', '-L', 'main(X)', '-L', 'base', '-L', 'Y', join(X, 'drizzle/meta/_journal.json'), jb, join(Y, 'drizzle/meta/_journal.json')], { encoding: 'utf8' });
    R.gitJournalMerge = { exitCode: m.status, hasConflictMarkers: m.stdout.includes('<<<<<<<'), text: m.stdout };
    // snapshot add/add: same file name 0001_snapshot.json on both branches
    const sx = readFileSync(join(X, 'drizzle/meta/0001_snapshot.json'), 'utf8');
    const sy = readFileSync(join(Y, 'drizzle/meta/0001_snapshot.json'), 'utf8');
    R.snapshotSameNameDifferentContent = sx !== sy;
    const sxo = JSON.parse(sx), syo = JSON.parse(sy);
    R.snapshotIds = { X: { id: sxo.id, prevId: sxo.prevId }, Y: { id: syo.id, prevId: syo.prevId } };

    const mkMerged = (order: 'YX' | 'XY', snap: 'X' | 'Y', name: string) => {
      const d = proj(name);
      cpSync(join(X, 'drizzle'), join(d, 'drizzle'), { recursive: true });
      for (const f of readdirSync(join(Y, 'drizzle'))) if (f.endsWith('.sql') && !readdirSync(join(d, 'drizzle')).includes(f)) cpSync(join(Y, 'drizzle', f), join(d, 'drizzle', f));
      const ex = jr(X).entries[1], ey = jr(Y).entries[1];
      const j = jr(X);
      j.entries = [jr(base).entries[0], ...(order === 'YX' ? [ey, ex] : [ex, ey])];
      writeFileSync(join(d, 'drizzle/meta/_journal.json'), JSON.stringify(j, null, 2));
      writeFileSync(join(d, 'drizzle/meta/0001_snapshot.json'), snap === 'X' ? sx : sy);
      return d;
    };
    const xOnly = (n: string) => join(X, 'drizzle');
    const yOnly = join(Y, 'drizzle');
    const tag = (d: string, who: 'x' | 'y') => jr(d === X ? X : d).entries[1].tag;

    // A1: DB has X applied, merged journal [base, Y, X]
    for (const order of ['YX', 'XY'] as const) {
      const d = mkMerged(order, 'X', `merged${order}`);
      const db = await mk(`t11_a_${order.toLowerCase()}`);
      const rX = await runMigrate(db, join(X, 'drizzle'));
      const beforeRows = await rows(db);
      const r = await runMigrate(db, join(d, 'drizzle'));
      const afterRows = await rows(db);
      R[`A_${order}_migrate`] = { xAppliedFirst: rX.ok, rerunOk: r.ok, err: r.err, tables: await tablesOf(db), rowsBefore: beforeRows.length, rowsAfter: afterRows.length, journalOrder: jr(d).entries.map((e: any) => `${e.idx}:${e.tag}@${e.when}`) };
      const k = await runKit(db, join(d, 'drizzle'));
      R[`A_${order}_kitmigrate`] = { code: k.code, output: k.output.slice(-300), tables: await tablesOf(db) };
      // fresh DB
      const dbf = await mk(`t11_afresh_${order.toLowerCase()}`);
      const rf = await runMigrate(dbf, join(d, 'drizzle'));
      R[`A_${order}_freshDb`] = { ok: rf.ok, err: rf.err, tables: await tablesOf(dbf), appliedOrder: await rows(dbf) };
      // check
      const c = await kit(['check', '--config', join(d, 'drizzle.config.mjs')], d);
      R[`A_${order}_check`] = { code: c.code, output: c.output.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(-300) };
    }
    // A control: Y applied first on a dev DB, then merged [base, Y, X]; X is later -> applies?
    {
      const d = mkMerged('YX', 'X', 'merged-ctl');
      const db = await mk('t11_ctl');
      await runMigrate(db, join(Y, 'drizzle'));
      const r = await runMigrate(db, join(d, 'drizzle'));
      R.control_YappliedThenMerged = { ok: r.ok, err: r.err, tables: await tablesOf(db) };
    }
    // check on branch-local folders
    // B: regenerate after rebase onto X: take X's drizzle dir, regenerate with schema base+x+y
    {
      const Rb = proj('rebased');
      cpSync(join(X, 'drizzle'), join(Rb, 'drizzle'), { recursive: true });
      await new Promise((r) => setTimeout(r, 1200));
      R.regenerate = await gen(Rb, ['x_tbl', 'y_tbl']);
      R.regenFiles = files(Rb);
      const db = await mk('t11_regen');
      await runMigrate(db, join(X, 'drizzle'));
      const r = await runMigrate(db, join(Rb, 'drizzle'));
      R.B_regen_on_prodlike = { ok: r.ok, err: r.err, tables: await tablesOf(db), journal: jr(Rb).entries.map((e: any) => `${e.idx}:${e.tag}@${e.when}`) };
      // dev DB that already ran old Y (and old Y not X) then moves to regenerated chain
      const dbd = await mk('t11_regen_dev');
      await runMigrate(dbd, join(Y, 'drizzle'));
      const r2 = await runMigrate(dbd, join(Rb, 'drizzle'));
      R.B_regen_on_devdb_with_old_Y = { ok: r2.ok, err: r2.err, tables: await tablesOf(dbd) };
    }
    // C: journal lists an entry whose .sql is missing
    {
      const d = mkMerged('YX', 'X', 'merged-missing');
      rmSync(join(d, 'drizzle', jr(Y).entries[1].tag + '.sql'));
      const db = await mk('t11_missing');
      await runMigrate(db, join(X, 'drizzle'));
      const r = await runMigrate(db, join(d, 'drizzle'));
      R.C_missingSqlFile = { ok: r.ok, err: r.err };
    }
    // D: same numeric prefix and an explicit earlier-sorting name (--name aaa vs zzz), Y first
    {
      const b2 = proj('base2'); await gen(b2, [], 'base');
      const Y2 = proj('Y2'); cpSync(join(b2, 'drizzle'), join(Y2, 'drizzle'), { recursive: true }); await gen(Y2, ['y_tbl'], 'aaa_y');
      await new Promise((r) => setTimeout(r, 1200));
      const X2 = proj('X2'); cpSync(join(b2, 'drizzle'), join(X2, 'drizzle'), { recursive: true }); await gen(X2, ['x_tbl'], 'zzz_x');
      const d = proj('merged2'); cpSync(join(X2, 'drizzle'), join(d, 'drizzle'), { recursive: true });
      cpSync(join(Y2, 'drizzle/0001_aaa_y.sql'), join(d, 'drizzle/0001_aaa_y.sql'));
      const j = jr(X2); j.entries = [jr(b2).entries[0], jr(Y2).entries[1], jr(X2).entries[1]];
      writeFileSync(join(d, 'drizzle/meta/_journal.json'), JSON.stringify(j, null, 2));
      const db = await mk('t11_named');
      await runMigrate(db, join(X2, 'drizzle'));
      const r = await runMigrate(db, join(d, 'drizzle'));
      R.D_namedAaaYThenZzzX = { ok: r.ok, err: r.err, tables: await tablesOf(db), filesSort: readdirSync(join(d, 'drizzle')).filter((f) => f.endsWith('.sql')) };
    }
    log('T11 ' + JSON.stringify(R, null, 1));
  }, 600_000);
});

describe('kit raw error capture', () => {
  test('P1 through CLI, raw', async () => {
    const db = await mk('rawerr');
    await runMigrate(db, folder('setup', [{ tag: '0000_setup', sql: SETUP }]));
    const f = folder('raw', [{ tag: '0000_setup', sql: SETUP }, { tag: '0001_idx', sql: 'CREATE INDEX CONCURRENTLY t_idx ON t (a);' }]);
    const r = await kit(['migrate', '--config', kitConfig(db, f)]);
    log('KITRAW ' + JSON.stringify({ code: r.code, output: r.output.replace(/[[0-9;]*[A-Za-z]/g, '') }));
  });
});
