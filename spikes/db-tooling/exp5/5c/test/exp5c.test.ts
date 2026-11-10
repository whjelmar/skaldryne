// Experiment 5c: drop-before-create index migrations under graphile-migrate 1.4.1.
// Scenarios K1, S2, K2 are 5a's (copied, generalised to a multi-file form); R3 is round 3's killed-index test; CLEAN is a fresh apply.
// K1T measures how long the lock stays held after a hard kill, without a blocker (large table).
// Overlap is made deterministic with a blocker session plus polling pg_stat_activity / pg_locks, as in 5a. Databases: lock5c_*.
import { afterAll, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  HERE, advisoryHolders, applied, backendAlive, blockEntity, dropDb, exitedWithin, fileNames, formById, freshAtM3, idxCount,
  idxState, oneLine, openLog, root, scratch, seedBig, startGm, waitFor, waitingBackend, writeCfg, type Form, type Gm,
} from "./helpers.ts";

const FORM_IDS = (process.env.FORMS ?? "F2a,F2c").split(",");
const RUNS = 5;
const log = await openLog("exp5c.log");
const rows: { form: string; scenario: string; run: number; pass: boolean; outcome: string }[] = [];
const record = (form: string, scenario: string, run: number, outcome: string, pass: boolean) => {
  rows.push({ form, scenario, run, pass, outcome });
  log(`[${form} ${scenario} #${run}] pass=${pass} ${outcome}`);
};
afterAll(async () => {
  await writeFile(join(HERE, "results.json"), JSON.stringify(rows, null, 2));
});

const REFUSE = /Failed to get exclusive lock/;
const CICLIKE = "%CREATE INDEX CONCURRENTLY%";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const recordedOnce = (rows_: string[], f: Form) => fileNames(f).every((n) => rows_.filter((x) => x === n).length === 1);
const recStr = (rows_: string[], f: Form) => fileNames(f).map((n) => `${n}x${rows_.filter((x) => x === n).length}`).join(",");

for (const fid of FORM_IDS) {
  const F = formById(fid);
  const dbn = (s: string, i: number) => `lock5c_${s}_${fid.toLowerCase()}_${i}`;

  describe(`${fid} (${F.desc})`, () => {
    it("CLEAN: fresh database, migrated once", async () => {
      const db = dbn("clean", 1);
      const { folder } = await scratch(`clean_${fid}`, F.files);
      const cfg = await freshAtM3(db, folder);
      try {
        const r = await startGm(cfg, folder).done;
        const idx = await idxState(db);
        const rows_ = await applied(db);
        const again = await startGm(cfg, folder).done;
        const outcome = `code=${r.code} index=${JSON.stringify(idx)} count=${await idxCount(db)} recorded ${recStr(rows_, F)}; rerun code=${again.code} "${oneLine(again.out).slice(-50)}"`;
        const pass = r.code === 0 && idx?.valid === true && (await idxCount(db)) === 1 && recordedOnce(rows_, F) && again.code === 0;
        record(fid, "CLEAN", 1, outcome, pass);
        expect(pass, outcome).toBe(true);
      } finally {
        await dropDb(db);
      }
    });

    it("R3: round 3 killed-index test (terminate the build backend; the hook repairs it on the next run)", async () => {
      const db = dbn("r3", 1);
      const { folder } = await scratch(`r3_${fid}`, F.files);
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
        const idx = await idxState(db);
        const rows_ = await applied(db);
        const again = await startGm(cfg, folder).done;
        const idx2 = await idxState(db);
        const outcome =
          `A code=${killed.code}; index after kill=${JSON.stringify(mid)}; rerun code=${rerun.code} index=${JSON.stringify(idx)} count=${await idxCount(db)} recorded ${recStr(rows_, F)}; ` +
          `third run code=${again.code} index=${JSON.stringify(idx2)}`;
        const pass = killed.code !== 0 && mid?.valid === false && rerun.code === 0 && idx?.valid === true && (await idxCount(db)) === 1 && recordedOnce(rows_, F) && again.code === 0 && idx2?.oid === idx.oid;
        record(fid, "R3", 1, outcome, pass);
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
          const db = dbn("s2", i);
          const { folder } = await scratch(`s2_${fid}_${i}`, F.files);
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
            const after = await idxState(db);
            const rows_ = await applied(db);
            const rerun = await startGm(cfg, folder).done;
            if (rb === null) await b.done;
            const dropped = !during || during.oid !== before.oid;
            const outcome =
              `A pid=${pid} holds advisory=${holders.map((h) => `${h.pid}:${h.granted}`).join(",")}; ` +
              (rb === null ? "B still running after 20s (overlap); " : `B exited code=${rb.code} msg="${oneLine(rb.out).slice(-60)}"; `) +
              `index during B: ${JSON.stringify(during)} (oid before=${before.oid}) dropped=${dropped}; A code=${ra.code}; final index=${JSON.stringify(after)} count=${await idxCount(db)}; recorded ${recStr(rows_, F)}; rerun code=${rerun.code}`;
            const pass = rb !== null && !dropped && ra.code === 0 && REFUSE.test(rb.out) && recordedOnce(rows_, F) && after?.valid === true && after.oid === before.oid && rerun.code === 0;
            record(fid, "S2", i, outcome, pass);
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
          const db = dbn("k2", i);
          const { folder } = await scratch(`k2_${fid}_${i}`, F.files);
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
            const after = await idxState(db);
            const rows_ = await applied(db);
            const again = await startGm(cfg, folder).done;
            const outcome =
              `A exit code=${ra.code}; advisory held after A died=${holders.length > 0}; index after kill=${JSON.stringify(mid)}; B code=${rb.code} "${oneLine(rb.out).slice(-60)}"; ` +
              `index after B=${JSON.stringify(after)} count=${await idxCount(db)}; recorded ${recStr(rows_, F)}; third run code=${again.code}`;
            const pass = holders.length === 0 && rb.code === 0 && after?.valid === true && (await idxCount(db)) === 1 && recordedOnce(rows_, F) && again.code === 0;
            record(fid, "K2", i, outcome, pass);
            expect(pass, outcome).toBe(true);
          } finally {
            await blocker.release().catch(() => {});
            a?.child.kill();
            await dropDb(db);
          }
        });
      }
    });

    describe("K1: lock holder's Node process hard-killed mid-CIC; next migrate after the orphan ends must succeed", () => {
      for (let i = 1; i <= RUNS; i++) {
        it(`run ${i}`, async () => {
          const db = dbn("k1", i);
          const { folder } = await scratch(`k1_${fid}_${i}`, F.files);
          const cfg = await freshAtM3(db, folder);
          const blocker = await blockEntity(db);
          let a: Gm | undefined;
          try {
            a = startGm(cfg, folder);
            const pid = await waitingBackend(db, CICLIKE);
            await waitFor("invalid index", async () => ((await idxState(db))?.valid === false ? true : null));
            const holdersBefore = await advisoryHolders(db);
            const oidBefore = (await idxState(db))!.oid;
            a.child.kill("SIGKILL");
            await a.done;
            const tKill = Date.now();
            await sleep(2000);
            const orphanAlive = await backendAlive(pid);
            const holdersAfterKill = await advisoryHolders(db);
            const b = startGm(cfg, folder);
            const rb = await exitedWithin(b, 20_000);
            const bRefused = rb !== null && REFUSE.test(rb.out);
            const idxDuringB = await idxState(db);
            const tRelease = Date.now();
            await blocker.release();
            if (rb === null) await b.done;
            await waitFor("advisory lock free", async () => ((await advisoryHolders(db)).length === 0 ? true : null), 60_000);
            const tFree = Date.now();
            const afterOrphan = await idxState(db);
            const appliedAfterOrphan = await applied(db);
            const c = await startGm(cfg, folder).done;
            const final = await idxState(db);
            const rowsFinal = await applied(db);
            const cnt = await idxCount(db);
            const outcome =
              `orphan pid=${pid} (advisory ${holdersBefore.map((h) => h.pid).join(",")}) alive 2s after SIGKILL=${orphanAlive}, advisory still held=${holdersAfterKill.length > 0}; ` +
              `B refused=${bRefused}, index during B same oid=${idxDuringB?.oid === oidBefore}; lock held ${tRelease - tKill} ms from kill to blocker release (test-controlled) + ${tFree - tRelease} ms to free; ` +
              `after orphan: index=${JSON.stringify(afterOrphan)} recorded ${recStr(appliedAfterOrphan, F)}; next migrate code=${c.code} already-exists-error=${/already exists/.test(c.out)} (pg code 42P07=${/42P07/.test(c.out)}) index=${JSON.stringify(final)} count=${cnt} recorded ${recStr(rowsFinal, F)}`;
            const pass = c.code === 0 && final?.valid === true && cnt === 1 && recordedOnce(rowsFinal, F);
            record(fid, "K1", i, outcome, pass);
            // K1 is allowed to fail: the verdict is read from the table, but the lock facts must hold for the report to be valid.
            expect(bRefused, outcome).toBe(true);
          } finally {
            await blocker.release().catch(() => {});
            a?.child.kill();
            await dropDb(db);
          }
        });
      }
    });

    describe("K1T: how long the lock stays held after a hard kill (no blocker, large table)", () => {
      for (let i = 1; i <= 3; i++) {
        it(`run ${i}`, async () => {
          const db = dbn("k1t", i);
          const { folder } = await scratch(`k1t_${fid}_${i}`, F.files);
          const cfg = await freshAtM3(db, folder);
          await seedBig(db, Number(process.env.ROWS ?? 1_500_000));
          let a: Gm | undefined;
          try {
            const tStart = Date.now();
            a = startGm(cfg, folder);
            await waitFor("invalid index", async () => ((await idxState(db))?.valid === false ? true : null), 60_000);
            const tInvalid = Date.now();
            a.child.kill("SIGKILL");
            await a.done;
            const tKill = Date.now();
            const heldAtKill = (await advisoryHolders(db)).length > 0;
            const b = startGm(cfg, folder);
            const rb = await exitedWithin(b, 20_000);
            const tB = Date.now();
            const bRefused = rb !== null && REFUSE.test(rb.out);
            const stillHeldAtB = (await advisoryHolders(db)).length > 0;
            await waitFor("advisory lock free", async () => ((await advisoryHolders(db)).length === 0 ? true : null), 120_000);
            const tFree = Date.now();
            const afterOrphan = await idxState(db);
            const c = await startGm(cfg, folder).done;
            const rowsFinal = await applied(db);
            const outcome =
              `rows=${process.env.ROWS ?? 1_500_000}; invalid index visible ${tInvalid - tStart} ms after start; lock held at kill=${heldAtKill}; ` +
              `lock freed ${tFree - tKill} ms after the kill (${tFree - tInvalid} ms after the invalid index appeared); B started ${tB - tKill} ms after kill: refused=${bRefused} lock still held when B ended=${stillHeldAtB}; ` +
              `index after orphan=${JSON.stringify(afterOrphan)}; next migrate code=${c.code} recorded ${recStr(rowsFinal, F)}`;
            record(fid, "K1T", i, outcome, heldAtKill && bRefused && stillHeldAtB);
            expect(heldAtKill && bRefused, outcome).toBe(true);
          } finally {
            a?.child.kill();
            await dropDb(db);
          }
        });
      }
    });
  });
}
