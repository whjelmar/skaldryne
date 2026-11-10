// Experiment 5a: does graphile-migrate 1.4.1 stop two `migrate` runs against one database from overlapping?
// Overlap is made deterministic with a blocker session (ROW EXCLUSIVE on entity) plus polling pg_stat_activity /
// pg_locks; there are no sleeps standing in for ordering. Databases: lock5_* only. Each scenario runs 5 times.
import { afterAll, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CIC, HERE, IDX, S1_ALTER, advisoryHolders, applied, backendAlive, blockEntity, colCount, dropDb, exitedWithin, freshAtM3,
  idxState, oneLine, openLog, root, scratch, startGm, waitFor, waitingBackend, writeCfg, type Gm,
} from "./helpers.ts";

const NOTX = "--! no-transaction\n";
const RUNS = 5;
const log = await openLog("exp5a.log");
const rows: { scenario: string; run: number; outcome: string; pass: boolean }[] = [];
const record = (scenario: string, run: number, outcome: string, pass: boolean) => {
  rows.push({ scenario, run, outcome, pass });
  log(`[${scenario} #${run}] pass=${pass} ${outcome}`);
};
afterAll(async () => {
  await writeFile(join(HERE, "results.json"), JSON.stringify(rows, null, 2));
});

const REFUSE = /Failed to get exclusive lock/;

describe("S1: two migrates start together, one pending transactional migration", () => {
  for (let i = 1; i <= RUNS; i++) {
    it(`run ${i}`, async () => {
      const db = `lock5_s1_${i}`;
      const { folder } = await scratch(`s1_${i}`, S1_ALTER + "\n");
      const cfg = await freshAtM3(db, folder);
      const blocker = await blockEntity(db);
      let a: Gm | undefined, b: Gm | undefined;
      try {
        a = startGm(cfg, folder);
        b = startGm(cfg, folder);
        // exactly one of them reaches the ALTER and waits on the blocker
        const pid = await waitingBackend(db, "%s1_col%");
        const holders = await advisoryHolders(db);
        // the other must either have exited (refused) or be visibly waiting/overlapping
        const ra = await exitedWithin(a, 15_000);
        const rb = await exitedWithin(b, ra ? 1 : 15_000);
        const early = ra ?? rb;
        const overlapping = !ra && !rb;
        await blocker.release();
        const finals = await Promise.all([a.done, b.done]);
        const rows_ = await applied(db);
        const cols = await colCount(db, "s1_col");
        const again = await (startGm(cfg, folder).done);
        const m4Count = rows_.filter((f) => f === "000004.sql").length;
        const outcome =
          `waiting-backend=${pid} advisory-holders=${holders.map((h) => `${h.pid}:${h.granted}`).join(",")} ` +
          (overlapping ? "OVERLAP: both alive while one blocked; " : `loser exited early code=${early!.code} msg="${oneLine(early!.out).slice(-120)}"; `) +
          `final codes=${finals.map((f) => f.code).join("/")} M4 rows=${m4Count} s1_col columns=${cols} rerun code=${again.code} "${oneLine(again.out).slice(-60)}"`;
        const pass = !overlapping && m4Count === 1 && cols === 1 && REFUSE.test(early!.out) && again.code === 0;
        record("S1", i, outcome, pass);
        expect(m4Count).toBe(1);
        expect(cols).toBe(1);
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

/** S2 / S3: A is mid CREATE INDEX CONCURRENTLY (invalid index exists), then B starts with the P7 hook configured. */
function overlapDuringBuild(label: "S2" | "S3") {
  describe(`${label}: A mid-CIC, B starts and its beforeAllMigrations hook would run` + (label === "S3" ? " (second OS process, own folder + cwd, stands in for a second container)" : ""), () => {
    for (let i = 1; i <= RUNS; i++) {
      it(`run ${i}`, async () => {
        const db = `lock5_${label.toLowerCase()}_${i}`;
        const { folder } = await scratch(`${label}_a_${i}`, `${NOTX}${CIC}\n`);
        const cfgA = await freshAtM3(db, folder);
        let cfgB = cfgA, folderB = folder;
        if (label === "S3") {
          // Own copy of the migrations and config, own working directory: what a second container would have.
          folderB = (await scratch(`${label}_b_${i}`, `${NOTX}${CIC}\n`)).folder;
          cfgB = await writeCfg(folderB, db);
          await mkdir(join(HERE, ".tmp", `${label}_b_cwd_${i}`), { recursive: true });
        }
        const cwdB = label === "S3" ? join(HERE, ".tmp", `${label}_b_cwd_${i}`) : folder;
        const blocker = await blockEntity(db);
        let a: Gm | undefined, b: Gm | undefined;
        try {
          a = startGm(cfgA, folder);
          const pid = await waitingBackend(db, "%CREATE INDEX CONCURRENTLY%");
          const before = await waitFor("invalid index", async () => {
            const s = await idxState(db);
            return s && !s.valid ? s : null;
          });
          const holders = await advisoryHolders(db);
          b = startGm(cfgB, cwdB);
          const rb = await exitedWithin(b, 20_000);
          const during = await idxState(db);
          await blocker.release();
          const ra = await a.done;
          const after = await idxState(db);
          const rows_ = await applied(db);
          const rerun = await startGm(cfgA, folder).done;
          const overlapped = rb === null;
          if (rb === null) await b.done; // let it finish so nothing leaks
          const dropped = !during || during.oid !== before.oid;
          const outcome =
            `A pid=${pid} holds advisory=${holders.map((h) => `${h.pid}:${h.granted}`).join(",")}; ` +
            (overlapped ? "B still running after 20s (overlap); " : `B exited code=${rb!.code} msg="${oneLine(rb!.out).slice(-110)}"; `) +
            `index during B: ${JSON.stringify(during)} (oid before=${before.oid}) dropped=${dropped}; A code=${ra.code}; final index=${JSON.stringify(after)}; M4 rows=${rows_.filter((f) => f === "000004.sql").length}; rerun code=${rerun.code}`;
          const pass =
            !overlapped && !dropped && ra.code === 0 && REFUSE.test(rb!.out) && rows_.filter((f) => f === "000004.sql").length === 1 &&
            after?.valid === true && after.oid === before.oid;
          record(label, i, outcome, pass);
          expect(dropped, outcome).toBe(false);
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
}
overlapDuringBuild("S2");
overlapDuringBuild("S3");

/** K1 / K2: the run holding the lock dies while mid-CIC. */
describe("K1: lock holder's OS process is hard-killed mid-CIC", () => {
  for (let i = 1; i <= RUNS; i++) {
    it(`run ${i}`, async () => {
      const db = `lock5_k1_${i}`;
      const { folder } = await scratch(`k1_${i}`, `${NOTX}${CIC}\n`);
      const cfg = await freshAtM3(db, folder);
      const blocker = await blockEntity(db);
      let a: Gm | undefined;
      try {
        a = startGm(cfg, folder);
        const pid = await waitingBackend(db, "%CREATE INDEX CONCURRENTLY%");
        await waitFor("invalid index", async () => ((await idxState(db))?.valid === false ? true : null));
        const holdersBefore = await advisoryHolders(db);
        a.child.kill("SIGKILL");
        await a.done;
        // Does the orphaned backend (which is also the lock-holding session) go away on its own while it waits?
        let orphanGone = false;
        for (let t = 0; t < 40 && !orphanGone; t++) {
          orphanGone = !(await backendAlive(pid));
          if (!orphanGone) await new Promise((r) => setTimeout(r, 250));
        }
        const holdersAfterKill = await advisoryHolders(db);
        // B while the blocker is still held
        const b = startGm(cfg, folder);
        const rb = await exitedWithin(b, 20_000);
        const bRefused = rb !== null && REFUSE.test(rb.out);
        await blocker.release();
        const rbFinal = rb ?? (await b.done);
        // wait for lock to be free (the orphan finishes its CIC once the blocker is gone)
        const freed = await waitFor("advisory lock free", async () => ((await advisoryHolders(db)).length === 0 ? true : null), 60_000);
        const afterOrphan = await idxState(db);
        const appliedAfterOrphan = await applied(db);
        const c = await startGm(cfg, folder).done;
        const final = await idxState(db);
        const outcome =
          `lock holder pid=${pid} (advisory ${holdersBefore.map((h) => h.pid).join(",")}); after SIGKILL of the node process: orphan backend gone within 10s=${orphanGone}, advisory still held=${holdersAfterKill.length > 0}; ` +
          `B (blocker still held) ${rb === null ? "ran on" : bRefused ? "refused 'Failed to get exclusive lock'" : `code=${rb.code} "${oneLine(rb.out).slice(-100)}"`} (final code ${rbFinal.code}); lock freed after orphan finished=${freed}; ` +
          `index after orphan=${JSON.stringify(afterOrphan)}; M4 recorded=${appliedAfterOrphan.includes("000004.sql")}; later rerun code=${c.code} "${oneLine(c.out).slice(-90)}" index=${JSON.stringify(final)}`;
        record("K1", i, outcome, orphanGone && holdersAfterKill.length === 0);
      } finally {
        await blocker.release().catch(() => {});
        a?.child.kill();
        await dropDb(db);
      }
    });
  }
});

describe("K2: lock holder's database session is terminated mid-CIC (pg_terminate_backend, as round 3's P7)", () => {
  for (let i = 1; i <= RUNS; i++) {
    it(`run ${i}`, async () => {
      const db = `lock5_k2_${i}`;
      const { folder } = await scratch(`k2_${i}`, `${NOTX}${CIC}\n`);
      const cfg = await freshAtM3(db, folder);
      const blocker = await blockEntity(db);
      let a: Gm | undefined;
      try {
        a = startGm(cfg, folder);
        const pid = await waitingBackend(db, "%CREATE INDEX CONCURRENTLY%");
        await waitFor("invalid index", async () => ((await idxState(db))?.valid === false ? true : null));
        await root((c) => c.query("select pg_terminate_backend($1)", [pid]));
        const ra = await a.done;
        const holders = await advisoryHolders(db);
        const mid = await idxState(db);
        await blocker.release();
        const rb = await startGm(cfg, folder).done;
        const after = await idxState(db);
        const rows_ = await applied(db);
        const again = await startGm(cfg, folder).done;
        const outcome =
          `A exit code=${ra.code}; advisory held after A died=${holders.length > 0}; index after kill=${JSON.stringify(mid)}; B code=${rb.code} "${oneLine(rb.out).slice(-80)}"; ` +
          `index after B=${JSON.stringify(after)}; M4 rows=${rows_.filter((f) => f === "000004.sql").length}; third run code=${again.code}`;
        const pass = holders.length === 0 && rb.code === 0 && after?.valid === true && rows_.filter((f) => f === "000004.sql").length === 1;
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
