// Experiment 2 additions for graphile-migrate 1.4.1: T9 (CONCURRENTLY via --! no-transaction),
// T10a (killed transactional file), T10b (killed no-transaction file).
// Everything goes through the graphile-migrate CLI (see gm-cli.ts).
import { describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { url } from "../src/config.ts";
import { bootstrapDatabase } from "../src/migrate.ts";
import {
  appliedFiles, committedFiles, indexState, makeNote, root, runGm, scratchFolder, startGm, waitFor, writeCommitted, writeConfig,
} from "./gm-cli.ts";
import { schemaDump } from "./helpers.ts";

const note = makeNote("exp2-t9-t10-output.log");
const IDX = "entity_kind_conc_idx";
const CIC = `CREATE INDEX CONCURRENTLY ${IDX} ON entity (tenant_id, kind);`;
const NOTX = "--! no-transaction\n";

async function freshAtM3(db: string, name: string) {
  await bootstrapDatabase(db);
  const folder = await scratchFolder(name);
  const cfg = await writeConfig(folder, db);
  const r = await runGm(cfg, ["migrate"]);
  expect(r.code, r.out).toBe(0);
  expect(await appliedFiles(db)).toEqual(["000001.sql", "000002.sql", "000003.sql"]);
  return { folder, cfg };
}

/** Kill the backend of `db` whose current query matches `like` and passes `ready`. */
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

describe("T9 / T10 (graphile-migrate 1.4.1)", () => {
  it("T9 CONCURRENTLY: a --! no-transaction migration committed by `commit` applies and leaves a valid index", async () => {
    const db = "kysely14_t9";
    const { folder, cfg } = await freshAtM3(db, "t9");

    // Control: the same statement without the header is refused by `commit` (it runs inside a transaction).
    await writeFile(join(folder, "current.sql"), `${CIC}\n`);
    const control = await runGm(cfg, ["commit", "-m", "control"]);
    note("[T9 control: CIC without header, commit]\n" + control.out);
    expect(control.code).not.toBe(0);
    expect(control.out).toMatch(/cannot run inside a transaction block/i);
    expect(await committedFiles(folder)).toHaveLength(3);

    // The real thing.
    await writeFile(join(folder, "current.sql"), `${NOTX}${CIC}\n`);
    const commit = await runGm(cfg, ["commit", "-m", "m4 concurrent index"]);
    note("[T9 commit]\n" + commit.out);
    expect(commit.code, commit.out).toBe(0);
    const files = await committedFiles(folder);
    expect(files).toHaveLength(4);
    const m4 = await readFile(join(folder, "committed", files[3]!), "utf8");
    note("[T9 committed file]\n" + m4);
    expect(m4).toContain("--! no-transaction");

    const migrate = await runGm(cfg, ["migrate"]);
    note("[T9 migrate]\n" + migrate.out);
    expect(migrate.code, migrate.out).toBe(0);
    expect(await appliedFiles(db)).toEqual(["000001.sql", "000002.sql", "000003.sql", "000004.sql"]);
    expect(await indexState(db, IDX)).toEqual({ valid: true, ready: true });

    const again = await runGm(cfg, ["migrate"]);
    expect(again.code).toBe(0);
    expect(again.out).toContain("Already up to date");
  });

  it("T10a killed transactional file: DDL then pg_sleep(30), terminated; schema unchanged, not recorded; rerun without the sleep completes", async () => {
    const db = "kysely14_t10a";
    const { folder, cfg } = await freshAtM3(db, "t10a");
    const before = schemaDump(db);

    await writeCommitted(folder, "000004", "t10a-ddl-then-sleep", "ALTER TABLE entity ADD COLUMN t10a_marker int;\nSELECT pg_sleep(30);\n");
    const run = startGm(cfg, ["migrate"]);
    // wait until the DDL has run (the backend is inside pg_sleep), then kill it
    await killBackend(db, "%t10a_marker%", "wait_event = 'PgSleep'");
    const res = await run.done;
    note("[T10a killed migrate]\ncode=" + res.code + "\n" + res.out);
    expect(res.code).not.toBe(0);

    expect(await appliedFiles(db)).toEqual(["000001.sql", "000002.sql", "000003.sql"]);
    expect(schemaDump(db)).toBe(before);
    const col = await root(async (c) => (await c.query("select 1 from information_schema.columns where table_name='entity' and column_name='t10a_marker'")).rowCount, db);
    expect(col).toBe(0);

    await writeCommitted(folder, "000004", "t10a-ddl-then-sleep", "ALTER TABLE entity ADD COLUMN t10a_marker int;\n");
    const rerun = await runGm(cfg, ["migrate"]);
    note("[T10a rerun]\n" + rerun.out);
    expect(rerun.code, rerun.out).toBe(0);
    expect(await appliedFiles(db)).toHaveLength(4);
    const col2 = await root(async (c) => (await c.query("select 1 from information_schema.columns where table_name='entity' and column_name='t10a_marker'")).rowCount, db);
    expect(col2).toBe(1);
  });

  // T10b: the T9 file, killed during the build. A second session holds ROW EXCLUSIVE on entity, so
  // CREATE INDEX CONCURRENTLY has created the catalog entry (invalid) and is waiting for writers.
  async function killDuringBuild(db: string, name: string, body: string) {
    const { folder, cfg } = await freshAtM3(db, name);
    await writeCommitted(folder, "000004", "m4-concurrent-index", body);
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
    return { folder, cfg, killed };
  }

  it("T10b killed no-transaction file (T9 file as committed): record the INVALID index and what a rerun does", async () => {
    const db = "kysely14_t10b";
    const { cfg, killed } = await killDuringBuild(db, "t10b", `${NOTX}${CIC}\n`);
    note("[T10b killed migrate]\ncode=" + killed.code + "\n" + killed.out);
    expect(killed.code).not.toBe(0);
    const afterKill = await indexState(db, IDX);
    note("[T10b after kill] index=" + JSON.stringify(afterKill) + " applied=" + JSON.stringify(await appliedFiles(db)));
    expect(afterKill).toEqual({ valid: false, ready: false });
    expect(await appliedFiles(db)).toHaveLength(3);

    const rerun = await runGm(cfg, ["migrate"]);
    note("[T10b rerun, unchanged file]\ncode=" + rerun.code + "\n" + rerun.out);
    const end = await indexState(db, IDX);
    note("[T10b after rerun] index=" + JSON.stringify(end) + " applied=" + JSON.stringify(await appliedFiles(db)));
    // The pass criterion: the rerun ends with a valid index, and the runner never reports success while it is INVALID.
    const reportedSuccess = rerun.code === 0;
    expect(reportedSuccess && !end?.valid, "runner reported success while the index is INVALID").toBe(false);
    expect(end?.valid, "rerun ended with a valid index").toBe(true);
  });

  it("FINDING T10b variant D: an idempotent one-file form (DROP INDEX CONCURRENTLY IF EXISTS, then CREATE) cannot be applied at all", async () => {
    const db = "kysely14_t10bd";
    const body = `${NOTX}DROP INDEX CONCURRENTLY IF EXISTS ${IDX};\n${CIC}\n`;
    const { folder, cfg } = await freshAtM3(db, "t10bd");
    await writeCommitted(folder, "000004", "m4-concurrent-index", body);
    const r = await runGm(cfg, ["migrate"]);
    note("[T10b-D plain apply of the two-statement file]\ncode=" + r.code + "\n" + r.out);
    note("[T10b-D index] " + JSON.stringify(await indexState(db, IDX)) + " applied=" + JSON.stringify(await appliedFiles(db)));
    // The whole file is sent as one multi-statement query, so Postgres treats it as a transaction block.
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/cannot run inside a transaction block/i);
    expect(await indexState(db, IDX)).toBeNull();
  });

  it("FINDING T10b manual recovery: after the kill, dropping the INVALID index by hand lets the unchanged file complete", async () => {
    const db = "kysely14_t10bm";
    const { cfg, killed } = await killDuringBuild(db, "t10bm", `${NOTX}${CIC}\n`);
    expect(killed.code).not.toBe(0);
    expect((await indexState(db, IDX))?.valid).toBe(false);
    await root((c) => c.query(`drop index concurrently ${IDX}`), db);
    const rerun = await runGm(cfg, ["migrate"]);
    note("[T10b manual recovery rerun]\ncode=" + rerun.code + "\n" + rerun.out);
    expect(rerun.code, rerun.out).toBe(0);
    expect(await indexState(db, IDX)).toEqual({ valid: true, ready: true });
  });

  it("FINDING T10b variant N: file = CREATE INDEX CONCURRENTLY IF NOT EXISTS (does a rerun report success on an INVALID index?)", async () => {
    const db = "kysely14_t10bn";
    const { cfg, killed } = await killDuringBuild(db, "t10bn", `${NOTX}CREATE INDEX CONCURRENTLY IF NOT EXISTS ${IDX} ON entity (tenant_id, kind);\n`);
    expect(killed.code).not.toBe(0);
    const afterKill = await indexState(db, IDX);
    const rerun = await runGm(cfg, ["migrate"]);
    const end = await indexState(db, IDX);
    note("[T10b-N] afterKill=" + JSON.stringify(afterKill) + " rerun code=" + rerun.code + " end=" + JSON.stringify(end) + "\n" + rerun.out);
    expect(afterKill?.valid).toBe(false);
    // Recorded, not asserted either way: report what happened.
    expect({ rerunCode: rerun.code, valid: end?.valid }).toBeDefined();
  });
});
