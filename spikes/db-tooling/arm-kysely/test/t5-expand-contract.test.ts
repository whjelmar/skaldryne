import { afterAll, describe, expect, expectTypeOf, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { createDb, withTenant, type DB } from "../src/db/index.ts";
import type { DB as DBm1 } from "../src/db/types-m1.ts";
import type { DB as DBm2 } from "../src/db/types-m2.ts";
import { appliedMigrations, bootstrapDatabase, migrateDatabase, prefixFolder } from "../src/migrate.ts";

const DBNAME = "kysely_t5";
const clients: Kysely<unknown>[] = [];
function client<S>(): Kysely<S> {
  const c = createDb<S>({ database: DBNAME });
  clients.push(c as Kysely<unknown>);
  return c;
}
// Per-task databases are left in place (each run recreates them). Dropping them here with FORCE
// kills graphile-migrate's still-pooled connections, and its pool error handler calls process.exit(1).
afterAll(async () => {
  for (const c of clients) await c.destroy();
});

describe("T5", () => {
  it("T5 expand/contract: M1-typed and M2-typed code share the database between M2 and M3; M3 code works after", async () => {
    await bootstrapDatabase(DBNAME);
    await migrateDatabase(DBNAME, await prefixFolder("t5-m2", 2)); // hold at M2
    expect((await appliedMigrations(DBNAME)).map((m) => m.filename)).toEqual([
      "000001.sql", // graphile-migrate records the number, not the full file name
      "000002.sql",
    ]);

    // Two deployments of the application, each compiled against the types generated at its own schema.
    const oldApp = client<DBm1>(); // knows `name`
    const newApp = client<DBm2>(); // knows `display_name` (and, via override, `name` as optional)
    const tenantId = randomUUID();
    const campaignId = randomUUID();
    await withTenant(newApp, tenantId, async (tx) => {
      await tx.insertInto("tenant").values({ id: tenantId, name: "t5" }).execute();
      await tx.insertInto("campaign").values({ tenant_id: tenantId, id: campaignId, name: "c" }).execute();
    });

    const oldId = randomUUID();
    const newId = randomUUID();
    // Both write at the same time.
    await Promise.all([
      withTenant(oldApp, tenantId, (tx) =>
        tx.insertInto("entity").values({ tenant_id: tenantId, id: oldId, campaign_id: campaignId, kind: "npc", name: "from old code" }).execute(),
      ),
      withTenant(newApp, tenantId, (tx) =>
        tx.insertInto("entity").values({ tenant_id: tenantId, id: newId, campaign_id: campaignId, kind: "npc", display_name: "from new code" }).execute(),
      ),
    ]);

    const readOld = (id: string) =>
      withTenant(oldApp, tenantId, (tx) => tx.selectFrom("entity").select("name").where("id", "=", id).executeTakeFirstOrThrow());
    const readNew = (id: string) =>
      withTenant(newApp, tenantId, (tx) => tx.selectFrom("entity").select(["name", "display_name"]).where("id", "=", id).executeTakeFirstOrThrow());

    // Inserts from either side show up in both columns.
    expect(await readNew(oldId)).toEqual({ name: "from old code", display_name: "from old code" });
    expect(await readOld(newId)).toEqual({ name: "from new code" });

    // Updates from either side as well.
    await withTenant(oldApp, tenantId, (tx) => tx.updateTable("entity").set({ name: "renamed by old" }).where("id", "=", newId).execute());
    expect((await readNew(newId)).display_name).toBe("renamed by old");
    await withTenant(newApp, tenantId, (tx) => tx.updateTable("entity").set({ display_name: "renamed by new" }).where("id", "=", oldId).execute());
    expect((await readOld(oldId)).name).toBe("renamed by new");

    // Contract: M3.
    await migrateDatabase(DBNAME);
    expect(await appliedMigrations(DBNAME)).toHaveLength(3);

    const m3App = client<DB>();
    const rows = await withTenant(m3App, tenantId, (tx) =>
      tx.selectFrom("entity").select(["id", "display_name"]).orderBy("display_name").execute(),
    );
    expect(rows.map((r) => r.display_name)).toEqual(["renamed by new", "renamed by old"]);
    expectTypeOf(rows[0]!.display_name).toEqualTypeOf<string>();
    await withTenant(m3App, tenantId, (tx) =>
      tx.insertInto("entity").values({ tenant_id: tenantId, campaign_id: campaignId, kind: "npc", display_name: "post-M3" }).execute(),
    );

    // M2-typed code that only touches display_name keeps working after M3 (selecting `name` would not).
    const viaM2 = await withTenant(newApp, tenantId, (tx) =>
      tx.selectFrom("entity").select("display_name").where("id", "=", oldId).executeTakeFirstOrThrow(),
    );
    expect(viaM2.display_name).toBe("renamed by new");

    // M1-typed code is now broken, as expected for a contract step; it must be retired before M3.
    await expect(readOld(oldId)).rejects.toThrow(/column "name" does not exist/);
  });
});
