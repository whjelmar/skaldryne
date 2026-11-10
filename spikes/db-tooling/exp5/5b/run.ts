// Runs C1-C4 (plus C2b, the push-to-scratch variant of C2) against the control and every drift variant.
// Usage: node run.ts [--only ctl,d1m] [--priv]   (--priv: control only, repeated with CHECK_ROLE=skal_app)
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VARIANTS, buildVariant, dbName, CASES } from "./lib/drift.ts";
import { createDatabase, dropDatabase, migrateDatabase, ROOT } from "./lib/databases.ts";
import { withClient, CHECK_ROLE } from "./lib/env.ts";
import { c1 } from "./candidates/c1.ts";
import { c2, c2b } from "./candidates/c2.ts";
import { c3 } from "./candidates/c3.ts";
import { c4 } from "./candidates/c4.ts";
import type { Ctx, Outcome } from "./candidates/types.ts";

const CANDIDATES: Record<string, (ctx: Ctx) => Promise<Outcome>> = { c1, c2, c2b, c3, c4 };
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const priv = args.includes("--priv");
const variants = priv ? VARIANTS.filter((v) => v.id === "ctl") : VARIANTS.filter((v) => !only || only.includes(v.id));

async function dropAllScratch() {
  const names = await withClient("postgres", "postgres", async (c) =>
    (await c.query<{ datname: string }>("SELECT datname FROM pg_database WHERE datname LIKE 'schema5\_%'")).rows.map((r) => r.datname));
  for (const n of names) await dropDatabase(n);
  return names;
}

const results: any = { checkRole: CHECK_ROLE, variants: {} };
for (const v of variants) {
  const dir = await buildVariant(v);
  const db = dbName(v);
  let t = Date.now();
  await createDatabase(db);
  const createMs = Date.now() - t;
  t = Date.now();
  await migrateDatabase(db, join(dir, "migrations"));
  const migrateMs = Date.now() - t;
  const entry: any = { createMs, migrateMs, candidates: {} };
  for (const [name, fn] of Object.entries(CANDIDATES)) {
    const t0 = Date.now();
    let out: Outcome;
    try { out = await fn({ variantId: v.id, dir, db }); } catch (e) { out = { findings: [], error: `threw: ${String(e).slice(0, 300)}` }; }
    entry.candidates[name] = { ms: Date.now() - t0, error: out.error, findings: out.findings, facts: out.facts };
    console.log(v.id.padEnd(5), name.padEnd(4), String(Date.now() - t0).padStart(6), "ms", out.error ? "ERROR " + out.error.slice(0, 80) : `${out.findings.length} findings`);
  }
  results.variants[v.id] = entry;
  await dropDatabase(db);
}

// delta detection against the control's own findings
const ctl = results.variants.ctl;
if (ctl) {
  for (const [id, e] of Object.entries<any>(results.variants)) {
    for (const [name, r] of Object.entries<any>(e.candidates)) {
      const base = new Set<string>(ctl.candidates[name].findings);
      r.newFindings = r.findings.filter((f: string) => !base.has(f));
      r.goneFindings = [...base].filter((f) => !r.findings.includes(f));
      r.fires = r.findings.length > 0;
      r.detected = !r.error && (r.newFindings.length > 0 || r.goneFindings.length > 0);
    }
  }
}
await mkdir(join(ROOT, "results"), { recursive: true });
const file = priv ? `results-${CHECK_ROLE}.json` : only ? `results-partial.json` : "results.json";
await writeFile(join(ROOT, "results", file), JSON.stringify(results, null, 2));
const dropped = await dropAllScratch();
console.log("wrote", file, "| dropped leftover:", dropped.join(",") || "none");
