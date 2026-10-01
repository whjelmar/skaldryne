import { afterAll, describe, expect, expectTypeOf, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { status, commit } from "graphile-migrate";
import { codegen } from "../scripts/codegen.ts";
import { createDb, withTenant } from "../src/db/index.ts";
import { MAIN_DB } from "../src/config.ts";
import { ARM_DIR, bootstrapDatabase, migrateDatabase, settingsFor } from "../src/migrate.ts";
import { psql, schemaDump, seedTenant } from "./helpers.ts";

const db = createDb();
const FRESH = "kysely_t4_fresh";
// Per-task databases are left in place (each run recreates them). Dropping them here with FORCE
// kills graphile-migrate's still-pooled connections, and its pool error handler calls process.exit(1).
afterAll(() => db.destroy());

describe("T4", () => {
  it("T4 the tool proposes no changes after M1..M3; triggers, partitions, policies and HNSW survive", async () => {
    // 1. graphile-migrate has no schema model and no diff. What it can say: nothing pending.
    const st = await status(settingsFor(MAIN_DB));
    expect(st.remainingMigrations).toEqual([]);
    expect(st.hasCurrentMigration).toBe(false);
    // Asking it to "generate" a migration means committing current.sql; with nothing in it, it refuses.
    await expect(commit(settingsFor(MAIN_DB))).rejects.toThrow(/empty|blank|no.*changes|Cannot commit/i);

    // 2. Drift check it does not do for us: a database built incrementally (kysely_main) must match
    //    one built from scratch from the committed files, in a full schema-only pg_dump.
    await bootstrapDatabase(FRESH);
    await migrateDatabase(FRESH);
    const a = schemaDump(MAIN_DB);
    const b = schemaDump(FRESH);
    expect(a).toEqual(b);

    // 3. The objects a schema-diffing tool might mangle are all present.
    const objects = psql(MAIN_DB, "skal_migrator", `
      select string_agg(x, ',' order by x) from (
        select 'trigger:' || tgname from pg_trigger where not tgisinternal and tgparentid = 0
        union all select 'partition:' || relname from pg_class where relispartition and relkind = 'r'
        union all select 'policy:' || tablename from pg_policies where policyname = 'tenant_isolation'
        union all select 'index:' || indexname from pg_indexes where indexname = 'claim_embedding_hnsw'
        union all select 'function:' || proname from pg_proc where pronamespace = 'public'::regnamespace and prokind = 'f'
          and proname in ('claim_version_append_only', 'claim_current_sync')
      ) s(x);`, ["-At"]).trim();
    expect(objects.split(",")).toEqual([
      "function:claim_current_sync", "function:claim_version_append_only",
      "index:claim_embedding_hnsw",
      "partition:claim_version_p0", "partition:claim_version_p1", "partition:claim_version_p2", "partition:claim_version_p3",
      "policy:campaign", "policy:claim_current", "policy:claim_embedding", "policy:claim_version", "policy:entity",
      "policy:field_definition", "policy:import_record", "policy:tenant", "policy:transcript_segment",
      "trigger:claim_current_sync", "trigger:claim_version_append_only",
    ]);

    // 4. The other generated artefact in this arm is the Kysely type file: regenerating from the
    //    live database must reproduce the committed src/db/types.ts byte for byte (--verify).
    expect(() => codegen(MAIN_DB, "src/db/types.ts", "verify")).not.toThrow();
    const printed = codegen(MAIN_DB, "src/db/types.ts", "print");
    const committed = await readFile(join(ARM_DIR, "src/db/types.ts"), "utf8");
    expect(printed.replace(/\r\n/g, "\n").trim()).toContain(committed.replace(/\r\n/g, "\n").trim());
  });

  it("T4 claim_version inserts through Kysely still maintain claim_current, and claim_current is typed", async () => {
    const s = await seedTenant(db, "drift"); // inserts versions 1 and 2 through the query builder
    await withTenant(db, s.tenantId, async (tx) => {
      await tx
        .insertInto("claim_version")
        .values({ tenant_id: s.tenantId, claim_id: s.claimId, version: 3, campaign_id: s.campaignId, subject_id: s.entityId, predicate: "title", object: JSON.stringify("v3") })
        .execute();
      const cur = await tx.selectFrom("claim_current").selectAll().where("claim_id", "=", s.claimId).executeTakeFirstOrThrow();
      expect(cur.version).toBe(3);
      expect(cur.object).toBe("v3");
      expectTypeOf(cur.version).toEqualTypeOf<number>();
      expectTypeOf(cur.predicate).toEqualTypeOf<string>();
      // Append-only trigger still fires through the tool.
      await expect(
        tx.updateTable("claim_version").set({ predicate: "x" }).where("claim_id", "=", s.claimId).execute(),
      ).rejects.toThrow(/append-only/);
    });
  });
});
