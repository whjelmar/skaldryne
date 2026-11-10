// C3: compare what Drizzle's getTableConfig says with what pg_catalog says, one test per table and aspect.
// Env: SCHEMA_DIR (folder holding m3.ts), DATABASE_URL (the migrated database).
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import pg from "pg";
import { canonExpr } from "../lib/canon.ts";

const dialect = new PgDialect();
const sqlText = (x: any) => canonExpr(dialect.sqlToQuery(x).sql.replace(/"/g, "").replace(/'/g, ""));
const exprText = (s: string | null) => canonExpr((s ?? "").replace(/'/g, ""));
const typeText = (s: string) =>
  s.toLowerCase().replace(/\s+/g, "").replace("charactervarying", "varchar").replace("timestampwithtimezone", "timestamptz").replace("timestamp(3)withtimezone", "timestamptz(3)");
const rule = (c: string) => ({ a: "no action", r: "restrict", c: "cascade", n: "set null", d: "set default" })[c] ?? c;
function same(schema: string[], db: string[]) {
  const s = setOf(schema), d = setOf(db);
  const so = s.filter((x) => !d.includes(x)), dO = d.filter((x) => !s.includes(x));
  if (so.length || dO.length) throw new Error(`schema only: [${so.join(" | ")}] database only: [${dO.join(" | ")}]`);
}
const colsText = (x: string) => x.replace(/\s*,\s*/g, ",").replace(/\s+/g, " ").toLowerCase();
const setOf = (xs: string[]) => [...new Set(xs)].sort();

const schemaDir = process.env.SCHEMA_DIR!;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
let configs: Map<string, ReturnType<typeof getTableConfig>>;

const q = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows;
const REL = `SELECT c.oid, c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relispartition`;

beforeAll(async () => {
  const mod = await import(pathToFileURL(`${schemaDir}/m3.ts`).href);
  configs = new Map();
  for (const t of Object.values(mod) as any[]) {
    const cfg = getTableConfig(t);
    configs.set(cfg.name, cfg);
  }
  await client.connect();
});
afterAll(() => client.end());


// Test names have to be known when the file is collected, so the table list comes from the schema folder here.
const names: string[] = Object.values(await import(pathToFileURL(`${schemaDir}/m3.ts`).href)).map((t: any) => getTableConfig(t).name);

describe("C3 schema vs database", () => {
  it("has the same set of tables", async () => {
    const db = (await q(REL)).map((r) => r.relname);
    same([...configs.keys()], db);
  });

  const dbTables = async () => new Map((await q(REL)).map((r) => [r.relname as string, r]));

  describe.each(names)("%s", (name) => {
    const cfg = () => configs.get(name)!;
    const oidOf = async () => (await dbTables()).get(name)?.oid;

    it("has matching columns, types, nullability and defaults", async () => {
      const oid = await oidOf();
      const db = (await q(
        `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS def
         FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped`, [oid])).map(
        (r) => `${r.attname} ${typeText(r.type)} ${r.attnotnull ? "not null" : "null"} default ${r.def ? exprText(r.def) : "-"}`);
      const schema = (cfg().columns as any[]).map((c) => {
        const d = c.hasDefault ? (c.default && c.default.queryChunks ? sqlText(c.default) : canonExpr(String(JSON.stringify(c.default)).replace(/["']/g, ""))) : "-";
        return `${c.name} ${typeText(c.getSQLType())} ${c.notNull ? "not null" : "null"} default ${d}`;
      });
      same(schema, db);
    });

    it("has matching primary key", async () => {
      const oid = await oidOf();
      const db = (await q(
        `SELECT conname, (SELECT array_agg(attname::text ORDER BY attname) FROM pg_attribute WHERE attrelid = conrelid AND attnum = ANY (conkey)) AS cols
         FROM pg_constraint WHERE conrelid = $1 AND contype = 'p'`, [oid])).map((r) => `${r.conname}: ${r.cols.join(",")}`);
      const schema = (cfg().primaryKeys as any[]).map((p) => `${p.getName()}: ${p.columns.map((c: any) => c.name).sort().join(",")}`);
      same(schema, db);
    });

    it("has matching unique constraints", async () => {
      const oid = await oidOf();
      const db = (await q(
        `SELECT co.conname, (SELECT array_agg(attname::text ORDER BY attname) FROM pg_attribute WHERE attrelid = conrelid AND attnum = ANY (conkey)) AS cols,
                coalesce(i.indnullsnotdistinct, false) AS nnd
         FROM pg_constraint co JOIN pg_index i ON i.indexrelid = co.conindid WHERE co.conrelid = $1 AND co.contype = 'u'`, [oid]))
        .map((r) => `${r.conname}: ${r.cols.join(",")} nnd=${r.nnd}`);
      const schema = (cfg().uniqueConstraints as any[]).map((u) => `${u.name}: ${u.columns.map((c: any) => c.name).sort().join(",")} nnd=${!!u.nullsNotDistinct}`);
      same(schema, db);
    });

    it("has matching foreign keys", async () => {
      const oid = await oidOf();
      const db = (await q(
        `SELECT co.conname,
                (SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(co.conkey) WITH ORDINALITY k(n, ord) JOIN pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = k.n) AS cols,
                (SELECT relname FROM pg_class WHERE oid = co.confrelid) AS ft,
                (SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(co.confkey) WITH ORDINALITY k(n, ord) JOIN pg_attribute a ON a.attrelid = co.confrelid AND a.attnum = k.n) AS fcols,
                co.confdeltype, co.confupdtype
         FROM pg_constraint co WHERE co.conrelid = $1 AND co.contype = 'f' AND co.conparentid = 0`, [oid]))
        .map((r) => `${r.conname}: (${r.cols}) -> ${r.ft}(${r.fcols}) del=${rule(r.confdeltype)} upd=${rule(r.confupdtype)}`);
      const schema = (cfg().foreignKeys as any[]).map((f) => {
        const r = f.reference();
        return `${f.getName()}: (${r.columns.map((c: any) => c.name).join(",")}) -> ${getTableConfig(r.foreignTable as any).name}(${r.foreignColumns.map((c: any) => c.name).join(",")}) del=${f.onDelete ?? "no action"} upd=${f.onUpdate ?? "no action"}`;
      });
      same(schema, db);
    });

    it("has matching check constraints", async () => {
      const oid = await oidOf();
      const db = (await q(`SELECT conname, pg_get_expr(conbin, conrelid) AS e FROM pg_constraint WHERE conrelid = $1 AND contype = 'c' AND conparentid = 0`, [oid]))
        .map((r) => `${r.conname}: ${exprText(r.e)}`);
      const schema = (cfg().checks as any[]).map((k) => `${k.name}: ${sqlText(k.value)}`);
      same(schema, db);
    });

    it("has matching indexes", async () => {
      const oid = await oidOf();
      const db = (await q(
        `SELECT ic.relname, i.indisunique, am.amname, ic.reloptions,
                substring(pg_get_indexdef(i.indexrelid) from 'USING \\w+ \\(([^)]*)\\)') AS cols
         FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_am am ON am.oid = ic.relam
         WHERE i.indrelid = $1 AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid AND k.contype IN ('p','u'))`, [oid]))
        .map((r) => `${r.relname}: ${r.indisunique ? "unique " : ""}${r.amname} (${colsText(r.cols)}) with(${setOf(r.reloptions ?? []).join(",")})`);
      const schema = (cfg().indexes as any[]).map((i) => {
        const x = i.config;
        const cols = x.columns.map((c: any) => `${c.name}${c.indexConfig?.opClass ? " " + c.indexConfig.opClass : ""}${c.indexConfig?.order === "desc" ? " DESC" : ""}`).join(",");
        const w = Object.entries(x.with ?? {}).map(([k, v]) => `${k}=${v}`);
        return `${x.name}: ${x.unique ? "unique " : ""}${x.method ?? "btree"} (${colsText(cols)}) with(${setOf(w).join(",")})`;
      });
      same(schema, db);
    });

    it("has matching row level security and policies", async () => {
      const t = (await dbTables()).get(name);
      const db = (await q(`SELECT policyname, permissive, cmd, roles::text AS roles, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = $1`, [name]))
        .map((r) => `${r.policyname}: ${r.permissive.toLowerCase()} ${r.cmd.toLowerCase()} to ${r.roles.replace(/[{}]/g, "")} using ${exprText(r.qual)} check ${exprText(r.with_check)}`);
      const schema = (cfg().policies as any[]).map((p) => {
        const to = (p.to === undefined ? ["public"] : Array.isArray(p.to) ? p.to : [p.to]).map((x: any) => (typeof x === "string" ? x : x.name)).join(",");
        return `${p.name}: ${p.as ?? "permissive"} ${p.for ?? "all"} to ${to} using ${p.using ? sqlText(p.using) : ""} check ${p.withCheck ? sqlText(p.withCheck) : ""}`;
      });
      same(schema, db);
      expect(!!t?.relrowsecurity).toBe(cfg().enableRLS || cfg().policies.length > 0);
    });
  });
});
