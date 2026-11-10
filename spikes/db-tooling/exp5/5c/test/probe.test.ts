// Experiment 5c step 1: which forms of the index migration does graphile-migrate 1.4.1 accept and run outside a transaction?
// Each form is applied once to a fresh database (M1..M3 then the form's files). Databases: lock5c_probe_*.
import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FORMS, HERE, applied, dropDb, fileNames, freshAtM3, idxCount, idxState, oneLine, openLog, runGm, scratch } from "./helpers.ts";

const log = await openLog("probe.log");
const results: Record<string, unknown>[] = [];

describe("forms", () => {
  for (const f of FORMS) {
    it(f.id, async () => {
      const db = `lock5c_probe_${f.id.toLowerCase()}`;
      const { folder } = await scratch(`probe_${f.id}`, f.files);
      const cfg = await freshAtM3(db, folder);
      try {
        const r = await runGm(cfg, folder);
        const idx = await idxState(db);
        const rows = await applied(db);
        const rec = fileNames(f).map((n) => rows.filter((x) => x === n).length);
        const accepted = r.code === 0 && idx?.valid === true && (await idxCount(db)) === 1 && rec.every((n) => n === 1);
        const out = oneLine(r.out);
        const pgMessage = /error: ([^\n]*)/i.exec(r.out)?.[1] ?? /(DROP|CREATE) INDEX CONCURRENTLY cannot[^\n']*/.exec(r.out)?.[0] ?? null;
        const res = { form: f.id, desc: f.desc, code: r.code, index: idx, recorded: rec, accepted_and_ran_outside_tx: accepted, pg_message: pgMessage, output: out.slice(-400) };
        results.push(res);
        log(JSON.stringify(res));
        await writeFile(join(HERE, "probe-results.json"), JSON.stringify(results, null, 2));
        expect(true).toBe(true);
      } finally {
        await dropDb(db);
      }
    });
  }
});
