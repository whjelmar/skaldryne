import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { calculateHash } from "graphile-migrate/dist/hash.js";
import { createDb, withTenant } from "../src/db/index.ts";
import type { DB as DBm1 } from "../src/db/types-m1.ts";
import { MAIN_DB } from "../src/config.ts";
import { importBatch, type ImportItem } from "../src/import.ts";
import { appliedMigrations, ARM_DIR, bootstrapDatabase, migrateDatabase, MIGRATIONS_DIR, prefixFolder } from "../src/migrate.ts";
import { psql, schemaDump, seedTenant } from "./helpers.ts";

const T6 = "kysely_t6";
const db = createDb();
const m1 = createDb<DBm1>({ database: T6 });
// Per-task databases are left in place (each run recreates them). Dropping them here with FORCE
// kills graphile-migrate's still-pooled connections, and its pool error handler calls process.exit(1).
afterAll(async () => {
  await db.destroy();
  await m1.destroy();
});

const M1_FILE = "000001-m1-reference-schema.sql";
const M2_FILE = "000002-m2-expand-display_name.sql";

/** A committed-migrations folder holding M1 and a deliberately broken M2, hashed exactly as `commit` would. */
async function brokenM2Folder(): Promise<string> {
  const folder = join(ARM_DIR, ".tmp", "t6-broken");
  await rm(folder, { recursive: true, force: true });
  await mkdir(join(folder, "committed"), { recursive: true });
  await copyFile(join(MIGRATIONS_DIR, "committed", M1_FILE), join(folder, "committed", M1_FILE));
  const real = await readFile(join(MIGRATIONS_DIR, "committed", M2_FILE), "utf8");
  const previous = /^--! Previous: (\S+)$/m.exec(real)![1]!;
  const realBody = real.slice(real.indexOf("\n\n") + 2);
  // Fails only on existing data (an entity whose name is ''), after the column, backfill, function
  // and trigger have already run. `commit` validates on an empty shadow database, so it would accept this.
  const body = `${realBody.trim()}\n\nALTER TABLE entity ADD CONSTRAINT entity_display_name_not_blank CHECK (display_name <> '');\n`;
  const text = `--! Previous: ${previous}\n--! Hash: ${calculateHash(body, previous)}\n--! Message: M2 expand display_name (broken)\n\n${body}`;
  await writeFile(join(folder, "committed", M2_FILE), text);
  return folder;
}

function entityShape(database: string): string {
  return psql(database, "skal_migrator", `
    select coalesce(string_agg(attname, ',' order by attnum), '') from pg_attribute
     where attrelid = 'entity'::regclass and attnum > 0 and not attisdropped;
    select count(*) from pg_proc where proname = 'entity_name_sync';
    select count(*) from pg_trigger where tgname = 'entity_name_sync';`, ["-At"]).trim();
}

describe("T6", () => {
  it("T6a applying migrations to an up-to-date database changes nothing", async () => {
    const before = { dump: schemaDump(MAIN_DB), applied: await appliedMigrations(MAIN_DB) };
    await migrateDatabase(MAIN_DB);
    await migrateDatabase(MAIN_DB);
    expect(schemaDump(MAIN_DB)).toEqual(before.dump);
    expect(await appliedMigrations(MAIN_DB)).toEqual(before.applied);
  });

  it("T6b a migration that fails partway leaves the database unchanged; the fixed one then completes", async () => {
    await bootstrapDatabase(T6);
    await migrateDatabase(T6, await prefixFolder("t6-m1", 1));
    const tenantId = randomUUID();
    const campaignId = randomUUID();
    await withTenant(m1, tenantId, async (tx) => {
      await tx.insertInto("tenant").values({ id: tenantId, name: "t6" }).execute();
      await tx.insertInto("campaign").values({ tenant_id: tenantId, id: campaignId, name: "c" }).execute();
      await tx.insertInto("entity").values({ tenant_id: tenantId, campaign_id: campaignId, kind: "npc", name: "" }).execute();
      await tx.insertInto("entity").values({ tenant_id: tenantId, campaign_id: campaignId, kind: "npc", name: "Ada" }).execute();
    });
    const shapeAtM1 = entityShape(T6);
    const dumpAtM1 = schemaDump(T6);

    await expect(migrateDatabase(T6, await brokenM2Folder())).rejects.toThrow(/entity_display_name_not_blank/);

    // Nothing from the broken M2 survived: same columns, no function, no trigger, still one migration row.
    expect(entityShape(T6)).toBe(shapeAtM1);
    expect(shapeAtM1).toBe("tenant_id,id,campaign_id,kind,name,custom\n0\n0");
    expect(schemaDump(T6)).toEqual(dumpAtM1);
    expect((await appliedMigrations(T6)).map((m) => m.filename)).toEqual(["000001.sql"]); // recorded without the message slug

    // Fix (the real M2) and run again: it completes, and on to M3.
    await migrateDatabase(T6);
    expect((await appliedMigrations(T6)).map((m) => m.filename)).toHaveLength(3);
    const names = psql(T6, "skal_migrator", "select string_agg(display_name, ',' order by display_name) from entity;", ["-At"]).trim();
    expect(names).toBe(",Ada");
  });

  it("T6c importing the same 50 entities with claims twice adds nothing the second time", async () => {
    const s = await seedTenant(db, "import");
    const items: ImportItem[] = Array.from({ length: 50 }, (_, i) => ({
      sourceKey: `npc-${i}`,
      kind: "npc",
      displayName: `Imported ${i}`,
      claims: [
        { predicate: "title", object: `Title ${i}` },
        { predicate: "level", object: i % 10 },
      ],
    }));
    const counts = () =>
      withTenant(db, s.tenantId, async (tx) => {
        const n = async (t: "entity" | "import_record" | "claim_version" | "claim_current") =>
          Number((await tx.selectFrom(t).select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirstOrThrow()).n);
        return { entity: await n("entity"), import_record: await n("import_record"), claim_version: await n("claim_version"), claim_current: await n("claim_current") };
      });

    const before = await counts();
    const first = await importBatch(db, s.tenantId, s.campaignId, "test-source", items);
    expect(first).toEqual({ skipped: 0, created: 50, updated: 0, claimVersions: 100 });
    const afterFirst = await counts();
    expect(afterFirst).toEqual({
      entity: before.entity + 50,
      import_record: before.import_record + 50,
      claim_version: before.claim_version + 100,
      claim_current: before.claim_current + 100,
    });

    const second = await importBatch(db, s.tenantId, s.campaignId, "test-source", items);
    expect(second).toEqual({ skipped: 50, created: 0, updated: 0, claimVersions: 0 });
    expect(await counts()).toEqual(afterFirst);

    // Control: change one item and only its changed claim gets a new version.
    const changed = items.map((it, i) => (i === 7 ? { ...it, claims: [it.claims[0]!, { predicate: "level", object: 99 }] } : it));
    const third = await importBatch(db, s.tenantId, s.campaignId, "test-source", changed);
    expect(third).toEqual({ skipped: 49, created: 0, updated: 1, claimVersions: 1 });
    expect(await counts()).toEqual({ ...afterFirst, claim_version: afterFirst.claim_version + 1 });
  });
});
