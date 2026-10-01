import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createDb, withTenant } from "../src/db/index.ts";
import { seedTenant, type Seed } from "./helpers.ts";

const db = createDb();
let A: Seed;
let B: Seed;

beforeAll(async () => {
  A = await seedTenant(db, "A");
  B = await seedTenant(db, "B");
});
afterAll(() => db.destroy());

describe("T1", () => {
  it("T1 tenant isolation: reads, updates, deletes and inserts of B's rows from A's context fail or affect nothing", async () => {
    await withTenant(db, A.tenantId, async (tx) => {
      // Reads: only A's rows, and an explicit filter on B finds nothing.
      for (const table of ["campaign", "entity", "claim_version", "claim_current"] as const) {
        const rows = await tx.selectFrom(table).select("tenant_id").execute();
        expect(rows.length).toBeGreaterThan(0);
        expect(new Set(rows.map((r) => r.tenant_id))).toEqual(new Set([A.tenantId]));
        const bRows = await tx.selectFrom(table).selectAll().where("tenant_id", "=", B.tenantId).execute();
        expect(bRows).toEqual([]);
      }
      const tenants = await tx.selectFrom("tenant").select("id").execute();
      expect(tenants.map((t) => t.id)).toEqual([A.tenantId]);

      // Updates and deletes aimed at B affect nothing.
      const upd = await tx
        .updateTable("entity")
        .set({ display_name: "hijacked" })
        .where("tenant_id", "=", B.tenantId)
        .executeTakeFirst();
      expect(upd.numUpdatedRows).toBe(0n);
      const updCampaign = await tx.updateTable("campaign").set({ name: "hijacked" }).where("id", "=", B.campaignId).executeTakeFirst();
      expect(updCampaign.numUpdatedRows).toBe(0n);
      const delClaims = await tx.deleteFrom("claim_current").where("tenant_id", "=", B.tenantId).executeTakeFirst();
      expect(delClaims.numDeletedRows).toBe(0n);
      const delTenant = await tx.deleteFrom("tenant").where("id", "=", B.tenantId).executeTakeFirst();
      expect(delTenant.numDeletedRows).toBe(0n);
    });

    // Insert a row whose tenant_id is B, from A's context: rejected by the WITH CHECK policy.
    await expect(
      withTenant(db, A.tenantId, (tx) =>
        tx.insertInto("campaign").values({ tenant_id: B.tenantId, name: "smuggled" }).execute(),
      ),
    ).rejects.toThrow(/row-level security policy/);
    await expect(
      withTenant(db, A.tenantId, (tx) =>
        tx
          .insertInto("entity")
          .values({ tenant_id: B.tenantId, campaign_id: B.campaignId, kind: "npc", display_name: "smuggled" })
          .execute(),
      ),
    ).rejects.toThrow(/row-level security policy/);

    // A row in A referencing B's campaign: rejected by the composite foreign key.
    await expect(
      withTenant(db, A.tenantId, (tx) =>
        tx
          .insertInto("entity")
          .values({ tenant_id: A.tenantId, id: randomUUID(), campaign_id: B.campaignId, kind: "npc", display_name: "x" })
          .execute(),
      ),
    ).rejects.toThrow(/violates foreign key constraint "entity_tenant_id_campaign_id_fkey"/);

    // B is untouched.
    await withTenant(db, B.tenantId, async (tx) => {
      const e = await tx.selectFrom("entity").select(["display_name"]).where("id", "=", B.entityId).executeTakeFirstOrThrow();
      expect(e.display_name).toBe("B npc");
      const c = await tx.selectFrom("campaign").select("name").where("id", "=", B.campaignId).executeTakeFirstOrThrow();
      expect(c.name).toBe("B campaign");
      const cc = await tx.selectFrom("claim_current").select("version").where("claim_id", "=", B.claimId).executeTakeFirstOrThrow();
      expect(cc.version).toBe(2);
    });
  });

  // RLS is enabled on the partitioned parent only, and a partition queried directly does not apply
  // the parent's policy. The reference schema (and so M1) revokes skal_app's access to the
  // partitions. kysely-codegen leaves partitions out of the DB type by default, so the typed API
  // cannot name them; an untyped table name is used to try anyway.
  it("T1 claim_version partitions cannot be queried directly by skal_app (42501)", async () => {
    const untyped = db as unknown as ReturnType<typeof createDb<Record<string, { tenant_id: string }>>>;
    for (const p of ["claim_version_p0", "claim_version_p1", "claim_version_p2", "claim_version_p3"]) {
      await expect(untyped.selectFrom(p).select("tenant_id").execute()).rejects.toMatchObject({ code: "42501" });
      await expect(
        withTenant(untyped, A.tenantId, (tx) => tx.selectFrom(p).select("tenant_id").execute()),
      ).rejects.toMatchObject({ code: "42501" });
    }
    // The parent stays reachable; without a tenant context RLS hides every row.
    expect(await db.selectFrom("claim_version").select("tenant_id").execute()).toEqual([]);
  });
});
