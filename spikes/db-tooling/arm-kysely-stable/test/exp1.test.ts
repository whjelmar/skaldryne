// Experiment 1: the hard queries (Q1-Q4 and the RLS check) against exp1_kysely, a copy of the exp1_main template.
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import type { Kysely, LogEvent } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXP1_DB, url } from "../src/config.ts";
import { createDb, withTenant } from "../src/db/index.ts";
import type { DB } from "../src/db/types-exp1.ts";
import { claimJobs, completeJob, graphHops, hybridSearch, retryJob, searchSegments } from "../src/exp1.ts";
import { ARM_DIR } from "../src/migrate.ts";

const TENANT_A = "00000000-0000-7000-8000-00000000000a";
const TENANT_B = "00000000-0000-7000-8000-00000000000b";
const A1 = "0000000a-0000-7000-8000-000000000001";
const A2 = "0000000a-0000-7000-8000-000000000002";
const E3 = "0000000a-0001-7000-8000-000000000003";
const QV = Array.from({ length: 768 }, (_, i) => Math.sin(4.5 * 0.37 + i * 0.05));

const SQL_LOG = join(ARM_DIR, "exp1-sql.log");
const EXPLAIN_LOG = join(ARM_DIR, "reports", "exp1-explain.log");
let label = "";
const logged: { label: string; sql: string; params: unknown[] }[] = [];
function log(e: LogEvent) {
  if (e.level !== "query" || !/^(select|with|update)/i.test(e.query.sql) || e.query.sql.includes("set_config")) return;
  const params = e.query.parameters.map((p) => (typeof p === "string" && p.length > 80 ? p.slice(0, 40) + "...(" + p.length + " chars)" : p));
  appendFileSync(SQL_LOG, `-- [${label}] params: ${JSON.stringify(params)}\n${e.query.sql};\n\n`);
  logged.push({ label, sql: e.query.sql, params: e.query.parameters as unknown[] });
}

/** The trailing number of a fixture id: entity/segment/job ordinal. */
const ord = (id: string) => Number(id.slice(-12));

let db: Kysely<DB>;

async function recreateCopy(): Promise<void> {
  const root = new pg.Client({ connectionString: url("postgres", "postgres") });
  await root.connect();
  try {
    await root.query(`DROP DATABASE IF EXISTS ${EXP1_DB} WITH (FORCE)`);
    for (let attempt = 0; ; attempt++) {
      try {
        await root.query(`CREATE DATABASE ${EXP1_DB} TEMPLATE exp1_main OWNER skal_migrator`);
        return;
      } catch (e) {
        if (attempt >= 20 || !/being accessed by other users/.test(String(e))) throw e;
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      }
    }
  } finally {
    await root.end();
  }
}

beforeAll(async () => {
  await recreateCopy();
  writeFileSync(SQL_LOG, "");
  writeFileSync(EXPLAIN_LOG, "");
  db = createDb<DB>({ database: EXP1_DB, role: "skal_app", log });
});

afterAll(async () => {
  await db.destroy();
});

describe("Experiment 1 (Kysely 0.29.6)", () => {
  it("Q1 graph hops from e3 in tenant A", async () => {
    label = "Q1";
    const rows = await graphHops(db, TENANT_A, E3);
    expect(rows.map((r) => ({ name: r.displayName, depth: r.depth, path: r.path.map((p) => `e${ord(p)}`) }))).toEqual([
      { name: "Brother Calder", depth: 1, path: ["e3", "e2"] },
      { name: "Duke Orsolo", depth: 1, path: ["e3", "e4"] },
      { name: "Archivist Mira", depth: 2, path: ["e3", "e2", "e1"] },
      { name: "Envoy Tamsin", depth: 2, path: ["e3", "e4", "e5"] },
      { name: "Ferryman Gaunt", depth: 2, path: ["e3", "e2", "e6"] },
      { name: "Grey Abbess", depth: 3, path: ["e3", "e2", "e6", "e7"] },
    ]);
    expect(rows.every((r) => typeof r.depth === "number")).toBe(true);
  });

  it("Q2 full-text search: A1 english 'cult or leader'", async () => {
    label = "Q2-A1";
    const rows = await searchSegments(db, TENANT_A, A1, "english", "cult or leader");
    expect(rows.map((r) => ({ id: ord(r.id), sessionNo: r.sessionNo, startMs: r.startMs, rank: r.rank, headline: r.headline }))).toEqual([
      { id: 1, sessionNo: 1, startMs: 0, rank: 0.2, headline: "The <b>cult</b> <b>leader</b> spoke from the ashen altar while the crowd chanted." },
      { id: 2, sessionNo: 1, startMs: 10000, rank: 0.1, headline: "Mira found a letter from the <b>cult</b> hidden in the archive." },
      { id: 3, sessionNo: 1, startMs: 20000, rank: 0.1, headline: "Brother Calder denied any link to the <b>leader</b> of the Ashen Eye." },
      { id: 5, sessionNo: 1, startMs: 40000, rank: 0.1, headline: "<b>Leaders</b> of the guilds met to discuss the missing grain." },
      { id: 7, sessionNo: 2, startMs: 0, rank: 0.1, headline: "A <b>cult</b> symbol was carved into the hull of the ferry." },
      { id: 9, sessionNo: 2, startMs: 20000, rank: 0.1, headline: "Nobody mentioned the <b>cult</b> again until the final session." },
      { id: 11, sessionNo: 2, startMs: 40000, rank: 0.1, headline: "Cultists followed their <b>leader</b> into the catacombs beneath the abbey." },
    ]);
  });

  it("Q2 full-text search: A2 german 'Kult'", async () => {
    label = "Q2-A2";
    const rows = await searchSegments(db, TENANT_A, A2, "german", "Kult");
    expect(rows.map((r) => ({ id: ord(r.id), sessionNo: r.sessionNo, startMs: r.startMs, rank: r.rank, headline: r.headline }))).toEqual([
      { id: 101, sessionNo: 1, startMs: 0, rank: 0.1, headline: "Der <b>Kult</b> versammelte sich im Wald." },
      { id: 102, sessionNo: 1, startMs: 10000, rank: 0.1, headline: "Die Anführerin des <b>Kultes</b> sprach leise." },
    ]);
  });

  it("Q3 hybrid search by reciprocal rank fusion", async () => {
    label = "Q3";
    const rows = await hybridSearch(db, TENANT_A, A1, "english", "cult or leader", QV);
    expect(rows.map((r) => ({ id: ord(r.id!), ftsRank: r.ftsRank, vecRank: r.vecRank, score: r.score }))).toEqual([
      { id: 5, ftsRank: 4, vecRank: 2, score: 0.031754 },
      { id: 3, ftsRank: 3, vecRank: 3, score: 0.031746 },
      { id: 2, ftsRank: 2, vecRank: 5, score: 0.031514 },
      { id: 1, ftsRank: 1, vecRank: 7, score: 0.031319 },
      { id: 7, ftsRank: 5, vecRank: 6, score: 0.030536 },
      { id: 9, ftsRank: 6, vecRank: 9, score: 0.029644 },
      { id: 4, ftsRank: null, vecRank: 1, score: 0.016393 },
      { id: 6, ftsRank: null, vecRank: 4, score: 0.015625 },
      { id: 11, ftsRank: 7, vecRank: null, score: 0.014925 },
      { id: 8, ftsRank: null, vecRank: 8, score: 0.014706 },
    ]);
  });

  it("RLS: Q1-Q3 with no tenant set return zero rows, and claim_current counts 0", async () => {
    label = "RLS";
    expect(await graphHops(db, TENANT_A, E3, "")).toEqual([]);
    expect(await searchSegments(db, TENANT_A, A1, "english", "cult or leader", "")).toEqual([]);
    expect(await hybridSearch(db, TENANT_A, A1, "english", "cult or leader", QV, "")).toEqual([]);
    const n = await withTenant(db, "", (tx) =>
      tx.selectFrom("claim_current").select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirstOrThrow(),
    );
    expect(Number(n.n)).toBe(0);
  });

  it("Q4 SKIP LOCKED job queue: the two-connection sequence", async () => {
    label = "Q4";
    const gate = <T>() => {
      let open!: (v: T) => void;
      const p = new Promise<T>((r) => (open = r));
      return { p, open };
    };
    const release1 = gate<void>();
    const release2 = gate<void>();

    // 1. W1 claims 3 and keeps its transaction open.
    const w1claim = gate<{ id: string; attempts: number }[]>();
    const w1 = withTenant(db, TENANT_A, async (tx) => {
      w1claim.open(await claimJobs(tx, "w1", 3));
      await release1.p;
    });
    const got1 = await w1claim.p;
    expect(got1.map((j) => [ord(j.id), j.attempts]).sort()).toEqual([[1, 1], [2, 1], [3, 1]]);

    // 2. W2 claims while W1 is still open: it must not block (5 s limit).
    const w2claim = gate<{ id: string; attempts: number }[]>();
    const w2 = withTenant(db, TENANT_A, async (tx) => {
      w2claim.open(await claimJobs(tx, "w2", 3));
      await release2.p;
    });
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("W2 claim blocked for 5 s")), 5000));
    const got2 = await Promise.race([w2claim.p, timeout]);
    expect(got2.map((j) => [ord(j.id), j.attempts]).sort()).toEqual([[4, 1], [5, 1], [6, 3]]);
    const got3 = await withTenant(db, TENANT_A, (tx) => claimJobs(tx, "w3", 3));
    expect(got3).toEqual([]);

    // 3. Commit both.
    release1.open();
    release2.open();
    await Promise.all([w1, w2]);

    // 4. Complete / retry.
    const done01 = await withTenant(db, TENANT_A, (tx) => completeJob(tx, got1.find((j) => ord(j.id) === 1)!.id, "w1"));
    expect(done01.map((r) => [ord(r.id), r.state])).toEqual([[1, "done"]]);
    const retry02 = await withTenant(db, TENANT_A, (tx) => retryJob(tx, got1.find((j) => ord(j.id) === 2)!.id, "w1"));
    expect(retry02.map((r) => [ord(r.id), r.state, r.attempts])).toEqual([[2, "queued", 1]]);
    const retry06 = await withTenant(db, TENANT_A, (tx) => retryJob(tx, got2.find((j) => ord(j.id) === 6)!.id, "w2"));
    expect(retry06.map((r) => [ord(r.id), r.state, r.attempts])).toEqual([[6, "failed", 3]]);
    const wrong03 = await withTenant(db, TENANT_A, (tx) => completeJob(tx, got1.find((j) => ord(j.id) === 3)!.id, "w2"));
    expect(wrong03).toEqual([]);

    // 5. Everything else untouched; verified as skal_migrator.
    const m = new pg.Client({ connectionString: url("skal_migrator", EXP1_DB) });
    await m.connect();
    try {
      const { rows } = await m.query<{ n: number; tenant_id: string; state: string; attempts: number; ahead: boolean }>(
        "select right(id::text, 12)::int as n, tenant_id, state, attempts, run_after >= now() + interval '25 seconds' as ahead from job order by tenant_id, id",
      );
      const byN = (t: string, n: number) => rows.find((r) => r.tenant_id === t && r.n === n)!;
      expect(byN(TENANT_A, 7)).toMatchObject({ state: "queued", attempts: 0 });
      expect(byN(TENANT_A, 8)).toMatchObject({ state: "done" });
      expect(byN(TENANT_A, 2)).toMatchObject({ state: "queued", attempts: 1, ahead: true });
      expect(byN(TENANT_A, 6)).toMatchObject({ state: "failed", attempts: 3 });
      expect(rows.filter((r) => r.tenant_id === TENANT_B).map((r) => [r.state, r.attempts])).toEqual([["queued", 0], ["queued", 0]]);
    } finally {
      await m.end();
    }
  });

  it("EXPLAIN (COSTS OFF) with enable_seqscan = off, recorded for each logged query", async () => {
    // Evidence only. Replays the SQL exactly as logged, as skal_app with tenant A set.
    const c = new pg.Client({ connectionString: url("skal_app", EXP1_DB) });
    await c.connect();
    try {
      const seen = new Set<string>();
      for (const q of logged) {
        const key = q.label.replace(/-A\d$/, "") + "|" + q.sql;
        if (q.label === "RLS" || seen.has(key)) continue;
        seen.add(key);
        await c.query("begin");
        await c.query("select set_config('app.tenant_id', $1, true)", [TENANT_A]);
        await c.query("set local enable_seqscan = off");
        const { rows } = await c.query<Record<string, string>>(`explain (costs off) ${q.sql}`, q.params);
        await c.query("rollback");
        appendFileSync(EXPLAIN_LOG, `-- [${q.label}]\n${q.sql}\n\n${rows.map((r) => Object.values(r)[0]).join("\n")}\n\n`);
      }
    } finally {
      await c.end();
    }
    expect(logged.length).toBeGreaterThan(0);
  });
});
