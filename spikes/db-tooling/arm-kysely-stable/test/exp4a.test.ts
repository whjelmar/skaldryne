// Experiment 4a (round 3), graphile-migrate 1.4.1: T10b idempotent patterns, T11 late merge.
// T9, T10a, T10b (plain) and T7 are rerun by t9-t10-no-transaction.test.ts and t7b-tamper.test.ts.
// Every scenario drives the graphile-migrate CLI (see gm-cli.ts). Databases: kysely14_4a_*.
import { describe, expect, it } from "vitest";
import { rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { url, SHADOW_DB } from "../src/config.ts";
import { bootstrapDatabase } from "../src/migrate.ts";
import {
  appliedFiles, committedFiles, indexState, makeNote, root, runGm, scratchFolder, startGm, waitFor, writeCommitted, writeConfig,
} from "./gm-cli.ts";

const note = makeNote("exp4a.log");
const IDX = "entity_kind_conc_idx";
const CIC = `CREATE INDEX CONCURRENTLY ${IDX} ON entity (tenant_id, kind);`;
const NOTX = "--! no-transaction\n";

async function freshAtM3(db: string, name: string, extraCfg: Record<string, unknown> = {}, extraFiles: Record<string, string> = {}) {
  await bootstrapDatabase(db);
  const folder = await scratchFolder(name);
  for (const [f, text] of Object.entries(extraFiles)) await writeFile(join(folder, f), text);
  const cfg = await writeConfig(folder, db);
  if (Object.keys(extraCfg).length) {
    const c = JSON.parse(await readFile(cfg, "utf8"));
    await writeFile(cfg, JSON.stringify({ ...c, ...extraCfg }, null, 2));
  }
  const r = await runGm(cfg, ["migrate"]);
  expect(r.code, r.out).toBe(0);
  return { folder, cfg };
}

async function killBackend(db: string, like: string, ready: string): Promise<void> {
  const pid = await waitFor(`backend running ${like}`, () =>
    root(async (c) => {
      const { rows } = await c.query<{ pid: number }>(
        `select pid from pg_stat_activity where datname = $1 and state = 'active' and query like $2 and ${ready}`,
        [db, like],
      );
      return rows[0]?.pid;
    }),
  );
  await root((c) => c.query("select pg_terminate_backend($1)", [pid]));
}

/**
 * Run `migrate` while a second session holds ROW EXCLUSIVE on entity, so CREATE INDEX CONCURRENTLY has
 * created its (invalid) catalog entry and waits for writers; kill that backend.
 */
async function killDuringBuild(db: string, cfg: string) {
  const blocker = new pg.Client({ connectionString: url("skal_migrator", db) });
  await blocker.connect();
  await blocker.query("begin");
  await blocker.query("lock table entity in row exclusive mode");
  const run = startGm(cfg, ["migrate"]);
  try {
    await killBackend(db, "%CREATE INDEX CONCURRENTLY%", "wait_event_type = 'Lock'");
  } finally {
    await blocker.query("rollback");
    await blocker.end();
  }
  const killed = await run.done;
  expect(killed.code, killed.out).not.toBe(0);
  return killed;
}

async function colExists(db: string, col: string): Promise<boolean> {
  return (await root((c) => c.query("select 1 from information_schema.columns where table_name='entity' and column_name=$1", [col]), db)).rowCount === 1;
}

describe("T10b patterns (graphile-migrate 1.4.1)", () => {
  /** Common tail: rerun, record, return outcome. */
  async function rerunAndRecord(label: string, db: string, cfg: string) {
    const rerun = await runGm(cfg, ["migrate"]);
    const idx = await indexState(db, IDX);
    const applied = await appliedFiles(db);
    note(`[${label}] rerun code=${rerun.code} index=${JSON.stringify(idx)} applied=${JSON.stringify(applied)}\n${rerun.out}`);
    return { rerun, idx, applied };
  }

  it("P1 plain single-statement file: rerun fails (42P07), index stays INVALID", async () => {
    const db = "kysely14_4a_p1";
    const { folder, cfg } = await freshAtM3(db, "4a-p1");
    await writeCommitted(folder, "000004", "m4", `${NOTX}${CIC}\n`);
    await killDuringBuild(db, cfg);
    expect(await indexState(db, IDX)).toEqual({ valid: false, ready: false });
    const o = await rerunAndRecord("P1", db, cfg);
    expect(o.rerun.code).not.toBe(0);
    expect(o.rerun.out).toMatch(/already exists|42P07/);
    expect(o.idx?.valid).toBe(false);
  });

  it("P2 CREATE INDEX CONCURRENTLY IF NOT EXISTS: rerun exits 0 while the index is INVALID", async () => {
    const db = "kysely14_4a_p2";
    const { folder, cfg } = await freshAtM3(db, "4a-p2");
    await writeCommitted(folder, "000004", "m4", `${NOTX}CREATE INDEX CONCURRENTLY IF NOT EXISTS ${IDX} ON entity (tenant_id, kind);\n`);
    await killDuringBuild(db, cfg);
    const o = await rerunAndRecord("P2", db, cfg);
    expect(o.rerun.code).toBe(0);
    expect(o.idx?.valid).toBe(false);
    expect(o.applied).toContain("000004.sql");
  });

  it("P3 one no-transaction file, DROP INDEX CONCURRENTLY IF EXISTS then CREATE: cannot be applied (25001)", async () => {
    const db = "kysely14_4a_p3";
    const { folder, cfg } = await freshAtM3(db, "4a-p3");
    await writeCommitted(folder, "000004", "m4", `${NOTX}DROP INDEX CONCURRENTLY IF EXISTS ${IDX};\n${CIC}\n`);
    const r = await runGm(cfg, ["migrate"]);
    note(`[P3] code=${r.code}\n${r.out}`);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/cannot run inside a transaction block|25001/i);
    expect(await indexState(db, IDX)).toBeNull();
  });

  it("P3b no-transaction file with two statements in the other order (CREATE; then a trivial SELECT): also refused", async () => {
    const db = "kysely14_4a_p3b";
    const { folder, cfg } = await freshAtM3(db, "4a-p3b");
    await writeCommitted(folder, "000004", "m4", `${NOTX}${CIC}\nSELECT 1;\n`);
    const r = await runGm(cfg, ["migrate"]);
    note(`[P3b] code=${r.code}\n${r.out}`);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/cannot run inside a transaction block|25001/i);
  });

  it("P4 split across two files (000004 = DROP INDEX CONCURRENTLY IF EXISTS, 000005 = CREATE), killed during 000005: rerun fails", async () => {
    const db = "kysely14_4a_p4";
    const { folder, cfg } = await freshAtM3(db, "4a-p4");
    await writeCommitted(folder, "000004", "m4a-drop", `${NOTX}DROP INDEX CONCURRENTLY IF EXISTS ${IDX};\n`);
    await writeCommitted(folder, "000005", "m4b-create", `${NOTX}${CIC}\n`);
    await killDuringBuild(db, cfg);
    expect(await appliedFiles(db)).toEqual(["000001.sql", "000002.sql", "000003.sql", "000004.sql"]);
    expect(await indexState(db, IDX)).toEqual({ valid: false, ready: false });
    const o = await rerunAndRecord("P4", db, cfg);
    expect(o.rerun.code).not.toBe(0);
    expect(o.idx?.valid).toBe(false);
  });

  it("P5 DO block running EXECUTE 'CREATE INDEX CONCURRENTLY' in a no-transaction file: refused", async () => {
    const db = "kysely14_4a_p5";
    const { folder, cfg } = await freshAtM3(db, "4a-p5");
    await writeCommitted(folder, "000004", "m4", `${NOTX}DO $$ BEGIN EXECUTE 'CREATE INDEX CONCURRENTLY ${IDX} ON entity (tenant_id, kind)'; END $$;\n`);
    const r = await runGm(cfg, ["migrate"]);
    note(`[P5] code=${r.code}\n${r.out}`);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/cannot be executed from a function|cannot run inside a transaction block/i);
    expect(await indexState(db, IDX)).toBeNull();
  });

  it("P6 transactional cleanup file (DO block drops invalid index) then no-transaction CREATE file, killed during the create: rerun fails", async () => {
    const db = "kysely14_4a_p6";
    const { folder, cfg } = await freshAtM3(db, "4a-p6");
    await writeCommitted(folder, "000004", "m4a-cleanup", `DROP INDEX IF EXISTS ${IDX};\n`);
    await writeCommitted(folder, "000005", "m4b-create", `${NOTX}${CIC}\n`);
    await killDuringBuild(db, cfg);
    const o = await rerunAndRecord("P6", db, cfg);
    expect(o.rerun.code).not.toBe(0);
    expect(o.idx?.valid).toBe(false);
  });

  it("P7 beforeAllMigrations sql action that drops INVALID indexes + plain single-statement file: rerun ends VALID", async () => {
    const db = "kysely14_4a_p7";
    const cleanup = `DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT indexrelid::regclass AS idx FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT i.indisvalid AND n.nspname = 'public' LOOP
    EXECUTE 'DROP INDEX ' || r.idx;
  END LOOP;
END $$;
`;
    const { folder, cfg } = await freshAtM3(db, "4a-p7", { beforeAllMigrations: [{ _: "sql", file: "before-all.sql" }] }, { "before-all.sql": cleanup });
    await writeCommitted(folder, "000004", "m4", `${NOTX}${CIC}\n`);
    await killDuringBuild(db, cfg);
    expect(await indexState(db, IDX)).toEqual({ valid: false, ready: false });
    const o = await rerunAndRecord("P7", db, cfg);
    expect(o.rerun.code, o.rerun.out).toBe(0);
    expect(o.idx).toEqual({ valid: true, ready: true });
    expect(o.applied).toContain("000004.sql");
    // up-to-date rerun is a no-op
    const again = await runGm(cfg, ["migrate"]);
    expect(again.code).toBe(0);
    expect(await indexState(db, IDX)).toEqual({ valid: true, ready: true });
  });

  it("P7b P7 on a clean database (first apply with the action configured): applies, valid index", async () => {
    const db = "kysely14_4a_p7b";
    const cleanup = `DO $$ BEGIN PERFORM 1; END $$;\n`;
    const { folder, cfg } = await freshAtM3(db, "4a-p7b", { beforeAllMigrations: [{ _: "sql", file: "before-all.sql" }] }, { "before-all.sql": cleanup });
    await writeCommitted(folder, "000004", "m4", `${NOTX}${CIC}\n`);
    const r = await runGm(cfg, ["migrate"]);
    note(`[P7b] code=${r.code}\n${r.out}`);
    expect(r.code, r.out).toBe(0);
    expect(await indexState(db, IDX)).toEqual({ valid: true, ready: true });
  });
});

describe("T11 late merge (graphile-migrate 1.4.1)", () => {
  const ADD_X = "ALTER TABLE entity ADD COLUMN branch_x int;\n";
  const ADD_Y = "ALTER TABLE entity ADD COLUMN branch_y int;\n";

  it("S1 both branches commit as 000004 (what `commit` does on each branch): refused with a chain error, Y not applied", async () => {
    const db = "kysely14_4a_s1";
    const { folder, cfg } = await freshAtM3(db, "4a-s1");
    await writeCommitted(folder, "000004", "x-add-branch-x", ADD_X);
    const a = await runGm(cfg, ["migrate"]);
    expect(a.code, a.out).toBe(0);
    await writeCommitted(folder, "000004", "y-add-branch-y", ADD_Y); // merge brings Y's file in
    note("[S1] files: " + (await committedFiles(folder)).join(", "));
    const r = await runGm(cfg, ["migrate"]);
    note(`[S1] code=${r.code}\n${r.out}`);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/doesn't match|expected previous hash/);
    expect(await colExists(db, "branch_y")).toBe(false);
    expect(await appliedFiles(db)).toHaveLength(4);
  });

  it("S2 X applied as 000005, Y (authored first) is 000004, both chained on M3: refused with a chain error", async () => {
    const db = "kysely14_4a_s2";
    const { folder, cfg } = await freshAtM3(db, "4a-s2");
    await writeCommitted(folder, "000005", "x-add-branch-x", ADD_X);
    const a = await runGm(cfg, ["migrate"]);
    expect(a.code, a.out).toBe(0);
    await writeCommitted(folder, "000004", "y-add-branch-y", ADD_Y);
    const r = await runGm(cfg, ["migrate"]);
    note(`[S2] code=${r.code}\n${r.out}`);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/doesn't match|expected previous hash/);
    expect(await colExists(db, "branch_y")).toBe(false);
  });

  it("S3a rebase: Y becomes 000004, X is renumbered 000005 and rehashed on Y; non-idempotent X body: errors re-running X, Y not applied", async () => {
    const db = "kysely14_4a_s3a";
    const { folder, cfg } = await freshAtM3(db, "4a-s3a");
    await writeCommitted(folder, "000004", "x-add-branch-x", ADD_X);
    const a = await runGm(cfg, ["migrate"]);
    expect(a.code, a.out).toBe(0);
    await rm(join(folder, "committed", "000004-x-add-branch-x.sql"), { force: true });
    await writeCommitted(folder, "000004", "y-add-branch-y", ADD_Y);
    await writeCommitted(folder, "000005", "x-add-branch-x", ADD_X);
    note("[S3a] files: " + (await committedFiles(folder)).join(", "));
    const r = await runGm(cfg, ["migrate"]);
    note(`[S3a] code=${r.code}\n${r.out}`);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/already exists/);
    expect(await colExists(db, "branch_y")).toBe(false);
  });

  it("S3b same rebase with an idempotent X body (ADD COLUMN IF NOT EXISTS): refused by an FK violation on previous_hash (23503), Y not applied", async () => {
    const db = "kysely14_4a_s3b";
    const X_IDEM = "ALTER TABLE entity ADD COLUMN IF NOT EXISTS branch_x int;\n";
    const { folder, cfg } = await freshAtM3(db, "4a-s3b");
    await writeCommitted(folder, "000004", "x-add-branch-x", X_IDEM);
    const a = await runGm(cfg, ["migrate"]);
    expect(a.code, a.out).toBe(0);
    await rm(join(folder, "committed", "000004-x-add-branch-x.sql"), { force: true });
    await writeCommitted(folder, "000004", "y-add-branch-y", ADD_Y);
    await writeCommitted(folder, "000005", "x-add-branch-x", X_IDEM);
    const r = await runGm(cfg, ["migrate"]);
    note(`[S3b] code=${r.code}\n${r.out}\napplied=${JSON.stringify(await appliedFiles(db))} branch_y exists=${await colExists(db, "branch_y")}`);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/migrations_previous_hash_fkey|23503/);
    expect(await colExists(db, "branch_y")).toBe(false);
  });

  it("S4 hand-resolved merge: X stays 000005 but is re-chained after Y (000004): exits 0 'Already up to date', Y silently skipped, no hash complaint", async () => {
    const db = "kysely14_4a_s4";
    const { folder, cfg } = await freshAtM3(db, "4a-s4");
    await writeCommitted(folder, "000005", "x-add-branch-x", ADD_X);
    const a = await runGm(cfg, ["migrate"]);
    expect(a.code, a.out).toBe(0);
    await writeCommitted(folder, "000004", "y-add-branch-y", ADD_Y);
    await writeCommitted(folder, "000005", "x-add-branch-x", ADD_X); // rehash X on top of Y
    const r = await runGm(cfg, ["migrate"]);
    note(`[S4] code=${r.code}\n${r.out}\napplied=${JSON.stringify(await appliedFiles(db))} branch_y exists=${await colExists(db, "branch_y")}`);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("Already up to date");
    expect(await colExists(db, "branch_y")).toBe(false);
  });

  it("S5 control: the same merged chain (M1-M3, Y=000004, X=000005) on a fresh database applies both", async () => {
    const db = "kysely14_4a_s5";
    await bootstrapDatabase(db);
    const folder = await scratchFolder("4a-s5");
    await writeCommitted(folder, "000004", "y-add-branch-y", ADD_Y);
    await writeCommitted(folder, "000005", "x-add-branch-x", ADD_X);
    const cfg = await writeConfig(folder, db);
    const r = await runGm(cfg, ["migrate"]);
    note(`[S5] code=${r.code}\n${r.out}`);
    expect(r.code, r.out).toBe(0);
    expect(await colExists(db, "branch_y")).toBe(true);
    expect(await colExists(db, "branch_x")).toBe(true);
  });
});

void SHADOW_DB;
