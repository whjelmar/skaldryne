// Experiment 5d helpers (copied from exp5/5c/test/helpers.ts; changes listed in EXP5D.md section 2). Drives the graphile-migrate 1.4.1 CLI of arm-kysely-stable (executed, not edited).
// Databases: lock5d_* only.
import { spawn, type ChildProcess } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { appendFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

export const HERE = resolve(import.meta.dirname, "..");
export const ARM = resolve(HERE, "..", "..", "arm-kysely-stable");
const CLI = join(ARM, "node_modules", "graphile-migrate", "dist", "cli.js");
const PORT = 55432;

export type Role = "postgres" | "skal_migrator";
const PW: Record<Role, string> = { postgres: "postgres", skal_migrator: "migrator" };

export function url(role: Role, db: string): string {
  if (!db.startsWith("lock5d_") && db !== "postgres") throw new Error(`refusing database outside lock5d_ prefix: ${db}`);
  return `postgres://${role}:${PW[role]}@localhost:${PORT}/${db}`;
}

export async function root<T>(fn: (c: pg.Client) => Promise<T>, db = "postgres"): Promise<T> {
  const c = new pg.Client({ connectionString: url("postgres", db) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export async function dropDb(db: string): Promise<void> {
  url("postgres", db);
  await root((c) => c.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`));
}

export async function waitFor<T>(what: string, probe: () => Promise<T | undefined | false | null>, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

export interface Gm {
  child: ChildProcess;
  done: Promise<{ code: number | null; out: string }>;
  finished: () => boolean;
}

export function startGm(cfg: string, cwd: string, args = ["migrate"]): Gm {
  const child = spawn(process.execPath, [CLI, ...args, "--config", cfg], { cwd });
  let out = "";
  let fin = false;
  child.stdout!.on("data", (d) => (out += d));
  child.stderr!.on("data", (d) => (out += d));
  const done = new Promise<{ code: number | null; out: string }>((res) =>
    child.on("close", (code) => {
      fin = true;
      res({ code, out });
    }),
  );
  return { child, done, finished: () => fin };
}

export const runGm = (cfg: string, cwd: string) => startGm(cfg, cwd).done;

/** Wait for `g` to exit, or give up after `ms`. Returns the result or null when still running. */
export async function exitedWithin(g: Gm, ms: number) {
  return Promise.race([g.done, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

// The P7 hook, copied verbatim from arm-kysely-stable/test/exp4a.test.ts (round 3).
export const P7_HOOK = `DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT indexrelid::regclass AS idx FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT i.indisvalid AND n.nspname = 'public' LOOP
    EXECUTE 'DROP INDEX ' || r.idx;
  END LOOP;
END $$;
`;

export const IDX = "entity_kind_conc_idx";
export const CIC = `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${IDX} ON entity (tenant_id, kind);`;
export const S1_ALTER = "ALTER TABLE entity ADD COLUMN s1_col text;";

async function calcHash(body: string, prev: string): Promise<string> {
  const m = await import(pathToFileURL(join(ARM, "node_modules", "graphile-migrate", "dist", "hash.js")).href);
  return m.calculateHash(body, prev);
}

/** A scratch migrations folder holding M1..M3 copied from the arm, M4 = `m4Body`, and the P7 hook. */
export async function scratch(name: string, m4: string | string[]): Promise<{ folder: string; cfg: string }> {
  // 5c change: m4 may be several bodies; they become 000004, 000005, ... chained by hash. A single string is the 5a behaviour.
  const bodies = Array.isArray(m4) ? m4 : [m4];
  const folder = join(HERE, ".tmp", name);
  await rm(folder, { recursive: true, force: true });
  await mkdir(join(folder, "committed"), { recursive: true });
  const src = join(ARM, "migrations", "committed");
  let last = "";
  for (const f of (await readdir(src)).filter((f) => f.endsWith(".sql")).sort()) {
    await copyFile(join(src, f), join(folder, "committed", f));
    last = (/^--! Hash: (\S+)$/m.exec(await readFile(join(src, f), "utf8")))![1]!;
  }
  for (let n = 0; n < bodies.length; n++) {
    const hash = await calcHash(bodies[n]!, last);
    const num = String(4 + n).padStart(6, "0");
    await writeFile(join(folder, "committed", `${num}-m${4 + n}.sql`), `--! Previous: ${last}\n--! Hash: ${hash}\n--! Message: m${4 + n}\n\n${bodies[n]}`);
    last = hash;
  }
  await writeFile(join(folder, "current.sql"), "");
  await writeFile(join(folder, "before-all.sql"), P7_HOOK);
  return { folder, cfg: join(folder, "gmrc.json") };
}

export async function writeCfg(folder: string, db: string, withHook = true): Promise<string> {
  const cfg = {
    connectionString: url("skal_migrator", db),
    shadowConnectionString: url("skal_migrator", "postgres"), // unused by `migrate`
    rootConnectionString: url("postgres", "postgres"),
    migrationsFolder: folder,
    ...(withHook ? { beforeAllMigrations: [{ _: "sql", file: "before-all.sql" }] } : {}),
  };
  const path = join(folder, "gmrc.json");
  await writeFile(path, JSON.stringify(cfg, null, 2));
  return path;
}

/** Create the database, bootstrap extensions as postgres, and apply M1..M3 only (M4 moved aside during the apply). */
export async function freshAtM3(db: string, folder: string): Promise<string> {
  url("postgres", db);
  await root(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await c.query(`CREATE DATABASE "${db}" OWNER skal_migrator`);
  });
  const ext = await readFile(join(ARM, "db", "bootstrap-extensions.sql"), "utf8");
  await root((c) => c.query(ext), db);
  // 5c change: every file after M3 is moved aside (5a moved only 000004-m4.sql).
  const later = (await readdir(join(folder, "committed"))).filter((f) => !/^00000[123]-/.test(f));
  const keep = new Map<string, string>();
  for (const f of later) {
    keep.set(f, await readFile(join(folder, "committed", f), "utf8"));
    await rm(join(folder, "committed", f));
  }
  const cfg = await writeCfg(folder, db);
  const r = await runGm(cfg, folder);
  for (const [f, text] of keep) await writeFile(join(folder, "committed", f), text);
  if (r.code !== 0) throw new Error(`M1..M3 apply failed: ${r.out}`);
  return cfg;
}

export async function applied(db: string): Promise<string[]> {
  return root(async (c) => (await c.query("select filename from graphile_migrate.migrations order by filename")).rows.map((r) => r.filename), db);
}

export async function colCount(db: string, col: string): Promise<number> {
  return root(async (c) => (await c.query("select 1 from information_schema.columns where table_name='entity' and column_name=$1", [col])).rowCount ?? 0, db);
}

export interface IdxState { oid: number; valid: boolean; ready: boolean }
export async function idxState(db: string): Promise<IdxState | null> {
  return root(async (c) => {
    const { rows } = await c.query(
      "select indexrelid::oid::int as oid, indisvalid, indisready from pg_index where indexrelid = to_regclass($1)",
      [IDX],
    );
    return rows[0] ? { oid: rows[0].oid, valid: rows[0].indisvalid, ready: rows[0].indisready } : null;
  }, db);
}

/** Granted advisory locks in `db`: [{pid, objid}] */
export async function advisoryHolders(db: string): Promise<{ pid: number; granted: boolean }[]> {
  return root(
    async (c) =>
      (await c.query("select pid, granted from pg_locks where locktype='advisory' and database=(select oid from pg_database where datname=$1)", [db])).rows,
  );
}

/** pid of a backend in `db` whose current statement matches `like` and is waiting on a lock. */
export function waitingBackend(db: string, like: string): Promise<number> {
  return waitFor(`backend waiting on ${like}`, () =>
    root(async (c) => {
      const { rows } = await c.query(
        "select pid from pg_stat_activity where datname=$1 and state='active' and wait_event_type='Lock' and query like $2 and pid <> pg_backend_pid()",
        [db, like],
      );
      return rows[0]?.pid as number | undefined;
    }),
  );
}

export async function backendAlive(pid: number): Promise<boolean> {
  return root(async (c) => ((await c.query("select 1 from pg_stat_activity where pid=$1", [pid])).rowCount ?? 0) > 0);
}

/** A session that holds ROW EXCLUSIVE on entity, so ALTER TABLE / CREATE INDEX CONCURRENTLY wait. */
export async function blockEntity(db: string) {
  const c = new pg.Client({ connectionString: url("skal_migrator", db) });
  await c.connect();
  await c.query("begin");
  await c.query("lock table entity in row exclusive mode");
  return {
    release: async () => {
      await c.query("rollback");
      await c.end();
    },
  };
}

const LOG = join(HERE, "reports");
export async function openLog(file: string): Promise<(t: string) => void> {
  await mkdir(LOG, { recursive: true });
  const p = join(LOG, file);
  writeFileSync(p, "");
  return (t) => appendFileSync(p, t.replace(/\r/g, "") + "\n");
}

export const oneLine = (s: string) => s.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean).join(" | ");

// ---- added for 5d ----
export const NOTX = "--! no-transaction\n";
/** The one migration file under test (000004.sql). */
export const FILE_BODY = `${NOTX}${CIC}\n`;
export const FILE_NAME = "000004.sql";
/** What the migration's index must look like in the catalog. */
export const EXPECTED_DEF = `CREATE INDEX ${IDX} ON public.entity USING btree (tenant_id, kind)`;

export async function idxDef(db: string): Promise<string | null> {
  return root(async (c) => (await c.query("select pg_get_indexdef(to_regclass($1)) as d", [IDX])).rows[0].d as string | null, db);
}

/** Number of indexes called IDX (must be at most 1: names are unique per schema). */
export async function idxCount(db: string): Promise<number> {
  return root(async (c) => (await c.query("select count(*)::int n from pg_class where relname=$1 and relkind='i'", [IDX])).rows[0].n, db);
}

/** Number of times the migration file is recorded. */
export const recordedCount = (rows: string[]) => rows.filter((x) => x === FILE_NAME).length;
