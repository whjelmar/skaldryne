import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/db.ts";
import { app, pgError, seedTenant, type Seed } from "./helpers.ts";

const { db, close } = app();
let A: Seed;
let B: Seed;

beforeAll(async () => {
  A = await seedTenant(db, "T1-A");
  B = await seedTenant(db, "T1-B");
});
afterAll(close);

describe("T1 tenant isolation", () => {
  it("reads of tenant B's rows from tenant A's context return nothing", async () => {
    await withTenant(db, A.tenantId, async (tx) => {
      expect(await tx.orm.public.Tenant.where({ id: B.tenantId }).all()).toEqual([]);
      expect(await tx.orm.public.Campaign.where({ tenantId: B.tenantId }).all()).toEqual([]);
      expect(await tx.orm.public.Entity.where({ tenantId: B.tenantId }).all()).toEqual([]);
      expect(await tx.orm.public.ClaimVersion.where({ tenantId: B.tenantId }).all()).toEqual([]);
      expect(await tx.orm.public.ClaimCurrent.where({ tenantId: B.tenantId }).all()).toEqual([]);
      // Unfiltered reads see only A.
      const tenants = await tx.orm.public.Tenant.all();
      expect(tenants.map((t) => t.id)).toEqual([A.tenantId]);
    });
  });

  it("updates and deletes of tenant B's rows from tenant A's context affect nothing", async () => {
    await withTenant(db, A.tenantId, async (tx) => {
      const updated = await tx.orm.public.Entity.where({ tenantId: B.tenantId, id: B.entityId }).updateAll({ kind: "hijacked" });
      expect(updated).toEqual([]);
      const deleted = await tx.orm.public.ClaimCurrent.where({ tenantId: B.tenantId }).deleteAll();
      expect(deleted).toEqual([]);
      const renamed = await tx.orm.public.Campaign.where({ tenantId: B.tenantId }).updateAll({ name: "x" });
      expect(renamed).toEqual([]);
    });
    await withTenant(db, B.tenantId, async (tx) => {
      const e = await tx.orm.public.Entity.where({ id: B.entityId }).first();
      expect(e?.kind).toBe("npc");
      expect(await tx.orm.public.ClaimCurrent.where({ claimId: B.claimId }).all()).toHaveLength(1);
    });
  });

  it("an insert with tenant B's tenant_id is rejected by the policy's WITH CHECK", async () => {
    const err = await pgError(
      withTenant(db, A.tenantId, (tx) =>
        tx.orm.public.Campaign.create({ tenantId: B.tenantId, id: randomUUID(), name: "smuggled" }),
      ),
    );
    expect(err.chain).toMatch(/row-level security policy/);
    expect(err.code).toBe("42501");
  });

  it("a row in A referencing B's campaign is rejected by the composite foreign key", async () => {
    const err = await pgError(
      withTenant(db, A.tenantId, (tx) =>
        tx.orm.public.Entity.create({
          tenantId: A.tenantId, id: randomUUID(), campaignId: B.campaignId, kind: "npc", displayName: "cross",
        }),
      ),
    );
    expect(err.chain).toMatch(/entity_tenant_id_campaign_id_fkey/);
    expect(err.code).toBe("23503");
  });

  it("skal_app cannot read a claim_version partition directly", async () => {
    const err = await pgError(
      withTenant(db, A.tenantId, (tx) =>
        tx.query(db.raw.sql`SELECT count(*)::int AS n FROM claim_version_p0`.returnsRow({ n: "pg/int4@1" }).build()),
      ),
    );
    expect(err.chain).toMatch(/permission denied for table claim_version_p0/);
    expect(err.code).toBe("42501");
  });
});
