// Planted drift D1-D10. Each case is applied to ONE side only (the migrations or the Drizzle schema), alone,
// to a fresh copy of the unchanged pair under work/<variant>/. The arms are never edited.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { copyDir, ROOT } from "./databases.ts";

export interface SchemaFiles { define: string; m3: string }
export interface DriftCase {
  id: string; // d1, d3a, ...
  label: string;
  required: boolean; // D1-D8 are pass criteria; D9, D10 are reported only
  migrationSql: string; // appended as a new committed migration (migration side)
  schemaEdit: (files: SchemaFiles) => void; // applied to the schema copy (schema side)
}

/** Edit inside the `const <table> = pgTable(` block of define.ts; the pattern must exist exactly once there. */
function inBlock(src: string, table: string, from: string, to: string): string {
  const start = src.indexOf(`const ${table} = pgTable(`);
  if (start < 0) throw new Error(`block ${table} not found`);
  const next = src.indexOf("\n  const ", start + 10);
  const end = next < 0 ? src.indexOf("\n  return {", start) : next;
  const block = src.slice(start, end);
  const at = block.indexOf(from);
  if (at < 0 || block.indexOf(from, at + 1) >= 0) throw new Error(`pattern not unique in ${table}: ${from}`);
  return src.slice(0, start) + block.replace(from, () => to) + src.slice(end);
}

export const CASES: DriftCase[] = [
  {
    id: "d1", label: "column renamed (campaign.name -> title)", required: true,
    migrationSql: "ALTER TABLE campaign RENAME COLUMN name TO title;",
    schemaEdit: (f) => { f.define = inBlock(f.define, "campaign", "text('name')", "text('title')"); },
  },
  {
    id: "d2", label: "nullability (campaign.name nullable)", required: true,
    migrationSql: "ALTER TABLE campaign ALTER COLUMN name DROP NOT NULL;",
    schemaEdit: (f) => { f.define = inBlock(f.define, "campaign", "text('name').notNull()", "text('name')"); },
  },
  {
    id: "d3a", label: "type text vs varchar(100) (entity.kind)", required: true,
    migrationSql: "ALTER TABLE entity ALTER COLUMN kind TYPE varchar(100);",
    schemaEdit: (f) => {
      f.define = inBlock(f.define, "entity", "text('kind')", "varchar('kind', { length: 100 })");
      f.define = f.define.replace("  uuid,\n", "  uuid,\n  varchar,\n");
    },
  },
  {
    id: "d3b", label: "type halfvec(768) vs halfvec(384)", required: true,
    migrationSql: "ALTER TABLE claim_embedding ALTER COLUMN embedding TYPE halfvec(384);",
    schemaEdit: (f) => { f.define = inBlock(f.define, "claimEmbedding", "dimensions: 768", "dimensions: 384"); },
  },
  {
    id: "d4", label: "default (entity.custom '{}' vs '[]')", required: true,
    migrationSql: "ALTER TABLE entity ALTER COLUMN custom SET DEFAULT '[]'::jsonb;",
    schemaEdit: (f) => { f.define = inBlock(f.define, "entity", "'{}'::jsonb", "'[]'::jsonb"); },
  },
  {
    id: "d5", label: "index on one side only (transcript_segment.speaker)", required: true,
    migrationSql: "CREATE INDEX transcript_segment_speaker_idx ON transcript_segment (tenant_id, speaker);",
    schemaEdit: (f) => {
      f.define = inBlock(f.define, "transcriptSegment", "      tenantIsolation(", "      index('transcript_segment_speaker_idx').on(t.tenantId, t.speaker),\n      tenantIsolation(");
    },
  },
  {
    id: "d6", label: "foreign key on one side only (entity.tenant_id -> tenant)", required: true,
    migrationSql: "ALTER TABLE entity ADD CONSTRAINT entity_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant (id);",
    schemaEdit: (f) => {
      f.define = inBlock(f.define, "entity", "      index('entity_campaign_idx')", "      foreignKey({ name: 'entity_tenant_id_fkey', columns: [t.tenantId], foreignColumns: [tenant.id] }),\n      index('entity_campaign_idx')");
    },
  },
  {
    id: "d7", label: "check constraint on one side only (campaign.name)", required: true,
    migrationSql: "ALTER TABLE campaign ADD CONSTRAINT campaign_name_check CHECK (length(name) > 0);",
    schemaEdit: (f) => {
      f.define = inBlock(f.define, "campaign", "      tenantIsolation(", "      check('campaign_name_check', sql`length(name) > 0`),\n      tenantIsolation(");
    },
  },
  {
    id: "d8", label: "whole table on one side only (audit_log)", required: true,
    migrationSql: "CREATE TABLE audit_log (tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT uuidv7(), note text, PRIMARY KEY (tenant_id, id));",
    schemaEdit: (f) => {
      f.m3 = f.m3.replace("import { text } from 'drizzle-orm/pg-core';", "import { text, pgTable, uuid, primaryKey } from 'drizzle-orm/pg-core';\nimport { sql } from 'drizzle-orm';");
      f.m3 += "\nexport const auditLog = pgTable('audit_log', {\n  tenantId: uuid('tenant_id').notNull(),\n  id: uuid('id').default(sql`uuidv7()`).notNull(),\n  note: text('note'),\n}, (t) => [primaryKey({ name: 'audit_log_pkey', columns: [t.tenantId, t.id] })]);\n";
    },
  },
  {
    id: "d9", label: "RLS policy differs (campaign: tenant match vs true)", required: false,
    migrationSql: "DROP POLICY tenant_isolation ON campaign;\nCREATE POLICY tenant_isolation ON campaign USING (true) WITH CHECK (true);",
    schemaEdit: (f) => { f.define = inBlock(f.define, "campaign", "tenantIsolation(sql`tenant_id = ${currentTenant}`)", "tenantIsolation(sql`true`)"); },
  },
  {
    id: "d10", label: "column added to partition parent only (claim_version.note)", required: false,
    migrationSql: "ALTER TABLE claim_version ADD COLUMN note text;",
    schemaEdit: (f) => { f.define = inBlock(f.define, "claimVersion", "predicate: text('predicate').notNull(),", "predicate: text('predicate').notNull(),\n      note: text('note'),"); },
  },
];

export interface Variant { id: string; caseId: string | null; side: "m" | "s" | null }
export const VARIANTS: Variant[] = [
  { id: "ctl", caseId: null, side: null },
  ...CASES.flatMap((c): Variant[] => [
    { id: `${c.id}m`, caseId: c.id, side: "m" },
    { id: `${c.id}s`, caseId: c.id, side: "s" },
  ]),
];

export const workDir = (v: Variant) => join(ROOT, "work", v.id);
export const dbName = (v: Variant) => `schema5_${v.id}`;

const DRIZZLE_CONFIG = `import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'postgresql',
  schema: './schema/m3.ts',
  out: process.env.OUT ?? './out',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  schemaFilter: ['public'],
  tablesFilter: ['!claim_version_p*'], // as in arm-drizzle-stable/drizzle.config.ts: partitions are not declarable
});
`;

/** Hash = sha1(previous hash + "\n" + trimmed body + "\n"); found by checking it against the arm's committed files. */
async function addMigration(dir: string, id: string, sql: string): Promise<void> {
  const committed = join(dir, "migrations", "committed");
  const files = (await readdir(committed)).filter((f) => f.endsWith(".sql")).sort();
  const last = await readFile(join(committed, files.at(-1)!), "utf8");
  const previous = /^--! Hash: (\S+)/m.exec(last)![1];
  const body = sql.trim() + "\n";
  const hash = "sha1:" + createHash("sha1").update(previous + "\n" + body).digest("hex");
  const text = `--! Previous: ${previous}\n--! Hash: ${hash}\n--! Message: planted drift ${id}\n\n${body}`;
  await writeFile(join(committed, `000004-drift-${id}.sql`), text);
}

/** Copy the unchanged pair into work/<variant>/ and plant the variant's drift on its one side. */
export async function buildVariant(v: Variant): Promise<string> {
  const dir = workDir(v);
  const base = join(ROOT, "base");
  await copyDir(join(base, "migrations"), join(dir, "migrations"));
  await copyDir(join(base, "schema"), join(dir, "schema"));
  await writeFile(join(dir, "drizzle.config.ts"), DRIZZLE_CONFIG);
  if (v.caseId) {
    const c = CASES.find((x) => x.id === v.caseId)!;
    if (v.side === "m") {
      await addMigration(dir, c.id, c.migrationSql);
    } else {
      const f: SchemaFiles = {
        define: await readFile(join(dir, "schema", "define.ts"), "utf8"),
        m3: await readFile(join(dir, "schema", "m3.ts"), "utf8"),
      };
      c.schemaEdit(f);
      await writeFile(join(dir, "schema", "define.ts"), f.define);
      await writeFile(join(dir, "schema", "m3.ts"), f.m3);
    }
  }
  return dir;
}
