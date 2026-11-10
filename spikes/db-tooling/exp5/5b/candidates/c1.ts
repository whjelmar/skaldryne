// C1: `drizzle-kit pull` the migrated database, `drizzle-kit generate` the committed schema, and diff the two
// snapshot JSONs after normalising representation differences between the two code paths.
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { run, url, CHECK_ROLE, DRIZZLE_KIT } from "../lib/env.ts";
import { canonExpr, uniq } from "../lib/canon.ts";
import type { Ctx, Outcome } from "./types.ts";

type J = any; // snapshot JSON, untyped on purpose

/** Turn one snapshot into comparable lines. `kind` tells which code path produced it. */
export function describe(snap: J, kind: "pull" | "gen"): string[] {
  const out: string[] = [];
  for (const t of Object.values<J>(snap.tables)) {
    const n = t.name;
    const policies = Object.values<J>(t.policies ?? {});
    out.push(`${n}`);
    // generate does not mark RLS as enabled even though it emits ENABLE ROW LEVEL SECURITY for tables with policies
    out.push(`${n}.rls = ${kind === "pull" ? t.isRLSEnabled : t.isRLSEnabled || policies.length > 0}`);
    for (const c of Object.values<J>(t.columns)) {
      out.push(`${n}.col.${c.name} = ${c.type} ${c.notNull ? "not null" : "null"} default ${c.default ?? "-"}`);
      // pull reports a single-column primary key on the column and drops its name
      if (c.primaryKey) out.push(`${n}.pk.${n}_pkey = ${c.name}`);
    }
    for (const p of Object.values<J>(t.compositePrimaryKeys ?? {})) out.push(`${n}.pk.${p.name} = ${[...p.columns].sort().join(",")}`);
    // pull returns unique and primary key columns in an order that is not the constraint order, and loses NULLS NOT DISTINCT; compare as sets
    for (const u of Object.values<J>(t.uniqueConstraints ?? {})) out.push(`${n}.uq.${u.name} = ${[...u.columns].sort().join(",")}`);
    for (const k of Object.values<J>(t.checkConstraints ?? {})) out.push(`${n}.ck.${k.name} = ${canonExpr(k.value)}`);
    for (const f of Object.values<J>(t.foreignKeys ?? {})) {
      out.push(`${n}.fk.${f.name} = (${f.columnsFrom.join(",")}) -> ${f.tableTo}(${f.columnsTo.join(",")}) del=${f.onDelete} upd=${f.onUpdate}`);
    }
    for (const i of Object.values<J>(t.indexes ?? {})) {
      // pull attaches a (sometimes wrong) default btree opclass to every column; only non-btree opclasses matter
      const cols = i.columns.map((c: J) => `${c.expression}${c.asc ? "" : " desc"}${i.method === "btree" ? "" : " " + c.opclass}`).join(",");
      const w = Object.entries(i.with ?? {}).map(([k, v]) => `${k}=${v}`).sort().join(",");
      out.push(`${n}.ix.${i.name} = ${i.isUnique ? "unique " : ""}${i.method} (${cols}) with(${w})`);
    }
    for (const p of policies) {
      out.push(`${n}.policy.${p.name} = ${p.as} ${p.for} to ${p.to.join(",")} using ${canonExpr(p.using ?? "")} check ${canonExpr(p.withCheck ?? "")}`);
    }
  }
  return out;
}

async function latestSnapshot(outDir: string): Promise<J> {
  const metaDir = join(outDir, "meta");
  const file = (await readdir(metaDir)).filter((f) => f.endsWith("_snapshot.json")).sort().at(-1)!;
  return JSON.parse(await readFile(join(metaDir, file), "utf8"));
}

export async function c1(ctx: Ctx): Promise<Outcome> {
  const pullDir = join(ctx.dir, "c1-pull");
  const genDir = join(ctx.dir, "c1-gen");
  await rm(pullDir, { recursive: true, force: true });
  await rm(genDir, { recursive: true, force: true });
  const pull = await run("node", [...DRIZZLE_KIT, "pull", "--config", "drizzle.config.ts"], {
    cwd: ctx.dir, env: { OUT: pullDir, DATABASE_URL: url(CHECK_ROLE, ctx.db) },
  });
  const gen = await run("node", [...DRIZZLE_KIT, "generate", "--config", "drizzle.config.ts"], { cwd: ctx.dir, env: { OUT: genDir } });
  if (pull.code !== 0 || gen.code !== 0) {
    return { findings: [], error: `pull exit ${pull.code}: ${pull.stderr.slice(0, 300)} | generate exit ${gen.code}: ${gen.stderr.slice(0, 300)}` };
  }
  const db = uniq(describe(await latestSnapshot(pullDir), "pull"));
  const schema = uniq(describe(await latestSnapshot(genDir), "gen"));
  const dbSet = new Set(db);
  const schemaSet = new Set(schema);
  return {
    findings: [...db.filter((l) => !schemaSet.has(l)).map((l) => `database only: ${l}`), ...schema.filter((l) => !dbSet.has(l)).map((l) => `schema only: ${l}`)],
  };
}
