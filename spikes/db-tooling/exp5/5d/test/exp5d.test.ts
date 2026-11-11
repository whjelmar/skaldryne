// Experiment 5d: CREATE INDEX CONCURRENTLY IF NOT EXISTS in one --! no-transaction file, with the P7 beforeAllMigrations hook.
// Scenarios CLEAN, R3, S2, K2, K1 as in 5c (single-file form); K1-early and K1-fail are new; NAME is reported only.
// Every scenario asserts its pass criterion, so Vitest's pass/fail equals the verdict (NAME asserts nothing beyond its set-up).
// Overlap is deterministic: a blocker session holds ROW EXCLUSIVE on entity, so the build waits until the test releases it.
// Databases: lock5d_*.
import { afterAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import pg from "pg";
import {
  EXPECTED_DEF, FILE_BODY, HERE, IDX, advisoryHolders, applied, backendAlive, blockEntity, dropDb, exitedWithin, freshAtM3, idxCount, idxDef,
  idxState, oneLine, openLog, recordedCount, root, scratch, startGm, url, waitFor, waitingBackend, type Gm,
} from "./helpers.ts";
import { catalogSnapshot, lineDiff } from "../../5b/lib/catalog.ts";

const RUNS = 5;
const log = await openLog("exp5d.log");
const rows: { scenario: string; run: number; pass: boolean | null; outcome: string }[] = [];
const record = (scenario: string, run: number, outcome: string, pass: boolean | null) => {
  rows.push({ scenario, run, pass, outcome });
  log(`[${scenario} #${run}] pass=${pass === null ? "reported" : pass} ${outcome}`);
};
afterAll(async () => {
  await writeFile(join(HERE, "results.json"), JSON.stringify(rows, null, 2));
});

const REFUSE = /Failed to get exclusive lock/;
const CICLIKE = "%CREATE INDEX CONCURRENTLY%";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const freeLock = (db: string) => waitFor("advisory lock free", async () => ((await advisoryHolders(db)).length === 0 ? true : null), 60_000);
const tail = (s: string, n = 60) => oneLine(s).slice(-n);

/** Valid, single, with the migration's definition. */
async function goodIndex(db: string) {
  const s = await idxState(db);
  const def = await idxDef(db);
  return { s, def, ok: s?.valid === true && (await idxCount(db)) === 1 && def === EXPECTED_DEF };
}

/** Start A against a blocked entity table, wait for its build to be waiting with the invalid index in place, then SIGKILL the Node process. */
async function killedClient(db: string, cfg: string, folder: string) {
  const blocker = await blockEntity(db);
  const a = startGm(cfg, folder);
  const pid = await waitingBackend(db, CICLIKE);
  const before = await waitFor("invalid index", async () => {
    const s = await idxState(db);
    return s && !s.valid ? s : null;
  });
  const holdersBefore = await advisoryHolders(db);
  a.child.kill("SIGKILL");
  await a.done;
  await sleep(1000);
  const alive = await backendAlive(pid);
  const holders = await advisoryHolders(db);
  return { blocker, a, pid, before, alive, holders, lockIsOrphans: holdersBefore.length === 1 && holders.length === 1 && holders[0]!.pid === pid };
}

describe("5d: IF NOT EXISTS in a no-transaction index file, with the hook", () => {
  it("CLEAN: fresh database, migrated once", async () => {
    const db = "lock5d_clean_1";
    const { folder } = await scratch("clean", FILE_BODY);
    const cfg = await freshAtM3(db, folder);
    try {
      const r = await startGm(cfg, folder).done;
      const g = await goodIndex(db);
      const rec = await applied(db);
      const again = await startGm(cfg, folder).done;
      const outcome = `code=${r.code} index=${JSON.stringify(g.s)} def_ok=${g.def === EXPECTED_DEF} count=${await idxCount(db)} recorded x${recordedCount(rec)}; rerun code=${again.code} "${tail(again.out, 50)}"`;
      const pass = r.code === 0 && g.ok && recordedCount(rec) === 1 && again.code === 0 && /Already up to date/.test(again.out);
      record("CLEAN", 1, outcome, pass);
      expect(pass, outcome).toBe(true);
    } finally {
      await dropDb(db);
    }
  });

  it("R3: round 3 killed-index test (terminate the build backend; the hook repairs it on the next run)", async () => {
    const db = "lock5d_r3_1";
    const { folder } = await scratch("r3", FILE_BODY);
    const cfg = await freshAtM3(db, folder);
    const blocker = await blockEntity(db);
    let a: Gm | undefined;
    try {
      a = startGm(cfg, folder);
      const pid = await waitingBackend(db, CICLIKE);
      await waitFor("invalid index", async () => ((await idxState(db))?.valid === false ? true : null));
      await root((c) => c.query("select pg_terminate_backend($1)", [pid]));
      const killed = await a.done;
      await blocker.release();
      const mid = await idxState(db);
      const rerun = await startGm(cfg, folder).done;
      const g = await goodIndex(db);
      const rec = await applied(db);
      const again = await startGm(cfg, folder).done;
      const idx2 = await idxState(db);
      const outcome =
        `A code=${killed.code}; index after kill=${JSON.stringify(mid)}; rerun code=${rerun.code} index=${JSON.stringify(g.s)} def_ok=${g.def === EXPECTED_DEF} count=${await idxCount(db)} recorded x${recordedCount(rec)}; ` +
        `third run code=${again.code} index=${JSON.stringify(idx2)}`;
      const pass = killed.code !== 0 && mid?.valid === false && rerun.code === 0 && g.ok && g.s!.oid !== mid.oid && recordedCount(rec) === 1 && again.code === 0 && idx2?.oid === g.s!.oid;
      record("R3", 1, outcome, pass);
      expect(pass, outcome).toBe(true);
    } finally {
      await blocker.release().catch(() => {});
      a?.child.kill();
      await dropDb(db);
    }
  });

  describe("S2: A mid-CIC, B starts with the P7 hook configured", () => {
    for (let i = 1; i <= RUNS; i++) {
      it(`run ${i}`, async () => {
        const db = `lock5d_s2_${i}`;
        const { folder } = await scratch(`s2_${i}`, FILE_BODY);
        const cfg = await freshAtM3(db, folder);
        const blocker = await blockEntity(db);
        let a: Gm | undefined, b: Gm | undefined;
        try {
          a = startGm(cfg, folder);
          const pid = await waitingBackend(db, CICLIKE);
          const before = await waitFor("invalid index", async () => {
            const s = await idxState(db);
            return s && !s.valid ? s : null;
          });
          const holders = await advisoryHolders(db);
          b = startGm(cfg, folder);
          const rb = await exitedWithin(b, 20_000);
          const during = await idxState(db);
          await blocker.release();
          const ra = await a.done;
          const g = await goodIndex(db);
          const rec = await applied(db);
          const rerun = await startGm(cfg, folder).done;
          if (rb === null) await b.done;
          const dropped = !during || during.oid !== before.oid;
          const outcome =
            `A pid=${pid} holds advisory=${holders.map((h) => `${h.pid}:${h.granted}`).join(",")}; ` +
            (rb === null ? "B still running after 20s (overlap); " : `B exited code=${rb.code} msg="${tail(rb.out)}"; `) +
            `index during B: ${JSON.stringify(during)} (oid before=${before.oid}) dropped=${dropped}; A code=${ra.code}; final index=${JSON.stringify(g.s)} def_ok=${g.def === EXPECTED_DEF} count=${await idxCount(db)}; recorded x${recordedCount(rec)}; rerun code=${rerun.code}`;
          const pass = rb !== null && REFUSE.test(rb.out) && !dropped && ra.code === 0 && g.ok && g.s!.oid === before.oid && recordedCount(rec) === 1 && rerun.code === 0;
          record("S2", i, outcome, pass);
          expect(pass, outcome).toBe(true);
        } finally {
          await blocker.release().catch(() => {});
          a?.child.kill();
          b?.child.kill();
          await dropDb(db);
        }
      });
    }
  });

  describe("K2: lock holder's database session terminated mid-CIC", () => {
    for (let i = 1; i <= RUNS; i++) {
      it(`run ${i}`, async () => {
        const db = `lock5d_k2_${i}`;
        const { folder } = await scratch(`k2_${i}`, FILE_BODY);
        const cfg = await freshAtM3(db, folder);
        const blocker = await blockEntity(db);
        let a: Gm | undefined;
        try {
          a = startGm(cfg, folder);
          const pid = await waitingBackend(db, CICLIKE);
          await waitFor("invalid index", async () => ((await idxState(db))?.valid === false ? true : null));
          await root((c) => c.query("select pg_terminate_backend($1)", [pid]));
          const ra = await a.done;
          const holders = await advisoryHolders(db);
          const mid = await idxState(db);
          await blocker.release();
          const rb = await startGm(cfg, folder).done;
          const g = await goodIndex(db);
          const rec = await applied(db);
          const again = await startGm(cfg, folder).done;
          const outcome =
            `A exit code=${ra.code}; advisory held after A died=${holders.length > 0}; index after kill=${JSON.stringify(mid)}; B code=${rb.code} "${tail(rb.out)}"; ` +
            `index after B=${JSON.stringify(g.s)} def_ok=${g.def === EXPECTED_DEF} count=${await idxCount(db)}; recorded x${recordedCount(rec)}; third run code=${again.code}`;
          const pass = holders.length === 0 && mid?.valid === false && rb.code === 0 && g.ok && recordedCount(rec) === 1 && again.code === 0;
          record("K2", i, outcome, pass);
          expect(pass, outcome).toBe(true);
        } finally {
          await blocker.release().catch(() => {});
          a?.child.kill();
          await dropDb(db);
        }
      });
    }
  });

  describe("K1: client hard-killed mid-build; the next migrate starts after the orphaned build ends", () => {
    for (let i = 1; i <= RUNS; i++) {
      it(`run ${i}`, async () => {
        const db = `lock5d_k1_${i}`;
        const { folder } = await scratch(`k1_${i}`, FILE_BODY);
        const cfg = await freshAtM3(db, folder);
        let k: Awaited<ReturnType<typeof killedClient>> | undefined;
        try {
          k = await killedClient(db, cfg, folder);
          const tRelease = Date.now();
          await k.blocker.release();
          await freeLock(db);
          const tFree = Date.now();
          const afterOrphan = await idxState(db);
          const recBefore = await applied(db);
          const c = await startGm(cfg, folder).done;
          const g = await goodIndex(db);
          const rec = await applied(db);
          const d = await startGm(cfg, folder).done;
          const outcome =
            `orphan pid=${k.pid} alive 1s after SIGKILL=${k.alive}, advisory held by orphan=${k.lockIsOrphans}; lock freed ${tFree - tRelease} ms after blocker release; ` +
            `after orphan: index=${JSON.stringify(afterOrphan)} recorded x${recordedCount(recBefore)}; next migrate code=${c.code} "${tail(c.out, 50)}" index=${JSON.stringify(g.s)} same oid as orphan's=${g.s?.oid === afterOrphan?.oid} def_ok=${g.def === EXPECTED_DEF} count=${await idxCount(db)} recorded x${recordedCount(rec)}; rerun code=${d.code}`;
          const scenarioHeld = k.alive && k.lockIsOrphans && afterOrphan?.valid === true && recordedCount(recBefore) === 0;
          const pass = scenarioHeld && c.code === 0 && g.ok && recordedCount(rec) === 1 && d.code === 0;
          record("K1", i, outcome, pass);
          expect(pass, outcome).toBe(true);
        } finally {
          await k?.blocker.release().catch(() => {});
          k?.a.child.kill();
          await dropDb(db);
        }
      });
    }
  });

  describe("K1-early: as K1, but the next migrate starts while the orphan is still building", () => {
    for (let i = 1; i <= RUNS; i++) {
      it(`run ${i}`, async () => {
        const db = `lock5d_k1e_${i}`;
        const { folder } = await scratch(`k1e_${i}`, FILE_BODY);
        const cfg = await freshAtM3(db, folder);
        let k: Awaited<ReturnType<typeof killedClient>> | undefined;
        let b: Gm | undefined;
        try {
          k = await killedClient(db, cfg, folder);
          b = startGm(cfg, folder);
          const rb = await exitedWithin(b, 20_000);
          const refused = rb !== null && REFUSE.test(rb.out);
          const during = await idxState(db);
          const stillAlive = await backendAlive(k.pid);
          const stillHeld = (await advisoryHolders(db)).length > 0;
          const recDuring = await applied(db);
          await k.blocker.release();
          if (rb === null) await b.done;
          await freeLock(db);
          const afterOrphan = await idxState(db);
          const c = await startGm(cfg, folder).done;
          const g = await goodIndex(db);
          const rec = await applied(db);
          const d = await startGm(cfg, folder).done;
          const kept = during?.oid === k.before.oid && during.valid === false;
          const outcome =
            `orphan pid=${k.pid} alive=${k.alive}, lock held by orphan=${k.lockIsOrphans}; B ${rb === null ? "still running after 20s" : `code=${rb.code} "${tail(rb.out)}"`} refused=${refused}; ` +
            `index during B=${JSON.stringify(during)} (oid before=${k.before.oid}) kept=${kept}; orphan alive and lock held after B=${stillAlive && stillHeld}; recorded during x${recordedCount(recDuring)}; ` +
            `after orphan: index=${JSON.stringify(afterOrphan)}; later migrate code=${c.code} index=${JSON.stringify(g.s)} def_ok=${g.def === EXPECTED_DEF} count=${await idxCount(db)} recorded x${recordedCount(rec)}; rerun code=${d.code}`;
          const pass = k.alive && k.lockIsOrphans && refused && kept && stillAlive && stillHeld && recordedCount(recDuring) === 0 && afterOrphan?.valid === true && c.code === 0 && g.ok && recordedCount(rec) === 1 && d.code === 0;
          record("K1-early", i, outcome, pass);
          expect(pass, outcome).toBe(true);
        } finally {
          await k?.blocker.release().catch(() => {});
          k?.a.child.kill();
          b?.child.kill();
          await dropDb(db);
        }
      });
    }
  });

  describe("K1-fail: as K1, but the orphaned backend is terminated before its build ends, leaving an invalid index", () => {
    for (let i = 1; i <= RUNS; i++) {
      it(`run ${i}`, async () => {
        const db = `lock5d_k1f_${i}`;
        const { folder } = await scratch(`k1f_${i}`, FILE_BODY);
        const cfg = await freshAtM3(db, folder);
        let k: Awaited<ReturnType<typeof killedClient>> | undefined;
        try {
          k = await killedClient(db, cfg, folder);
          // the blocker is still held, so the build cannot have ended
          await root((c) => c.query("select pg_terminate_backend($1)", [k!.pid]));
          await waitFor("orphan gone", async () => ((await backendAlive(k!.pid)) ? null : true));
          await freeLock(db);
          const mid = await idxState(db);
          const recMid = await applied(db);
          await k.blocker.release();
          const c = await startGm(cfg, folder).done;
          const g = await goodIndex(db);
          const rec = await applied(db);
          const d = await startGm(cfg, folder).done;
          const finalOid = (await idxState(db))?.oid;
          const outcome =
            `orphan pid=${k.pid} alive before terminate=${k.alive}, lock held by orphan=${k.lockIsOrphans}; after terminate: index=${JSON.stringify(mid)} recorded x${recordedCount(recMid)}; ` +
            `next migrate code=${c.code} "${tail(c.out, 50)}" index=${JSON.stringify(g.s)} (oid changed=${g.s?.oid !== mid?.oid}) def_ok=${g.def === EXPECTED_DEF} count=${await idxCount(db)} recorded x${recordedCount(rec)}; ` +
            `reported success with invalid index=${c.code === 0 && g.s?.valid !== true}; rerun code=${d.code} same oid=${finalOid === g.s?.oid}`;
          const scenario = k.alive && k.lockIsOrphans && mid?.valid === false && recordedCount(recMid) === 0;
          const pass = scenario && c.code === 0 && g.ok && g.s!.oid !== mid.oid && recordedCount(rec) === 1 && !(c.code === 0 && g.s?.valid !== true) && d.code === 0 && finalOid === g.s!.oid;
          record("K1-fail", i, outcome, pass);
          expect(pass, outcome).toBe(true);
        } finally {
          await k?.blocker.release().catch(() => {});
          k?.a.child.kill();
          await dropDb(db);
        }
      });
    }
  });

  // NAME is reported, not a pass criterion. A valid index with the same name and a different definition exists before the file runs.
  it("NAME: same name, different definition, before the file runs (reported)", async () => {
    const ctl = "lock5d_name_ctl";
    const db = "lock5d_name_1";
    const SCHEMA_DIR = resolve(HERE, "..", "5b", "base", "schema");
    const B5 = resolve(HERE, "..", "5b");
    const c3 = async (target: string, tag: string) => {
      await mkdir(join(HERE, "reports"), { recursive: true });
      const report = join(HERE, "reports", `c3-${tag}.json`);
      const p = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "tests/c3.test.ts", "--reporter=json", `--outputFile=${report}`], {
        cwd: B5, env: { ...process.env, CI: "1", SCHEMA_DIR, DATABASE_URL: url("skal_migrator", target) }, stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (out += d));
      const code = await new Promise<number | null>((r) => p.on("close", r));
      let json: any;
      try {
        json = JSON.parse(await (await import("node:fs/promises")).readFile(report, "utf8"));
      } catch {
        return { code, findings: [`no report: ${tail(out, 200)}`], total: 0, failed: -1 };
      }
      const findings: string[] = [];
      for (const f of json.testResults) {
        if (f.status === "failed" && !f.assertionResults.length) findings.push(`suite error: ${String(f.message).slice(0, 200)}`);
        for (const t of f.assertionResults) if (t.status === "failed") findings.push(`${t.fullName}: ${String(t.failureMessages[0] ?? "").split("\n")[0]}`);
      }
      return { code, findings: findings.sort(), total: json.numTotalTests as number, failed: json.numFailedTests as number };
    };
    const snap = async (target: string) => {
      const c = new pg.Client({ connectionString: url("skal_migrator", target) });
      await c.connect();
      try {
        return await catalogSnapshot(c);
      } finally {
        await c.end();
      }
    };
    const { folder } = await scratch("name", FILE_BODY);
    const { folder: folderCtl } = await scratch("name_ctl", FILE_BODY);
    const cfgCtl = await freshAtM3(ctl, folderCtl);
    const cfg = await freshAtM3(db, folder);
    try {
      const rc = await startGm(cfgCtl, folderCtl).done;
      await root((c) => c.query(`CREATE INDEX ${IDX} ON entity (tenant_id)`), db);
      const preDef = await idxDef(db);
      const r = await startGm(cfg, folder).done;
      const rec = await applied(db);
      const s = await idxState(db);
      const def = await idxDef(db);
      const again = await startGm(cfg, folder).done;
      const ctlDef = await idxDef(ctl);
      // 5b C2 (catalog comparison): the 5b fixed catalog query on the NAME database against the cleanly migrated control (the intended end state).
      const cat = lineDiff(await snap(db), await snap(ctl));
      // 5b C3 (Vitest), run from exp5/5b unchanged against both databases; "detected" = findings differ from the control's (5b's rule).
      const c3ctl = await c3(ctl, "ctl");
      const c3name = await c3(db, "name");
      const newC3 = c3name.findings.filter((f) => !c3ctl.findings.includes(f));
      const outcome =
        `control migrate code=${rc.code} def=${ctlDef}; NAME: preexisting def=${preDef}; migrate code=${r.code} "${tail(r.out, 60)}" recorded x${recordedCount(rec)} index=${JSON.stringify(s)} def after=${def} (unchanged=${def === preDef}, equals migration's=${def === EXPECTED_DEF}); rerun code=${again.code}; ` +
        `C2-equivalent catalog diff vs control (${cat.length} lines): ${JSON.stringify(cat)}; ` +
        `C3 control: ${c3ctl.failed}/${c3ctl.total} failed ${JSON.stringify(c3ctl.findings)}; C3 NAME: ${c3name.failed}/${c3name.total} failed, ${newC3.length} findings not on control ${JSON.stringify(newC3)}`;
      record("NAME", 1, outcome, null);
      expect(preDef).not.toBeNull();
    } finally {
      await dropDb(db);
      await dropDb(ctl);
    }
  });
});
