import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withTenant } from "../src/db/index.ts";
import { seedTenant, type Seed } from "./helpers.ts";

const setupDb = createDb();
// The pool under test: one connection, so every request reuses the same session.
const db = createDb({ poolSize: 1 });
let A: Seed;
let B: Seed;

beforeAll(async () => {
  A = await seedTenant(setupDb, "pool-A");
  B = await seedTenant(setupDb, "pool-B");
});
afterAll(async () => {
  await db.destroy();
  await setupDb.destroy();
});

type Who = "A" | "B" | "none";

async function request(who: Who): Promise<{ who: Who; tenants: string[]; setting: string | null }> {
  // Application code: one helper per request, the query builder inside.
  const read = async (tx: typeof db) => {
    const rows = await tx.selectFrom("entity").innerJoin("campaign", (j) =>
      j.onRef("campaign.tenant_id", "=", "entity.tenant_id").onRef("campaign.id", "=", "entity.campaign_id"),
    ).select("entity.tenant_id").execute();
    const s = await tx
      .selectNoFrom((eb) => eb.fn<string | null>("current_setting", [eb.val("app.tenant_id"), eb.lit(true)]).as("v"))
      .executeTakeFirstOrThrow();
    return { tenants: [...new Set(rows.map((r) => r.tenant_id))], setting: s.v };
  };
  if (who === "none") return { who, ...(await db.transaction().execute((tx) => read(tx))) };
  const id = who === "A" ? A.tenantId : B.tenantId;
  return { who, ...(await withTenant(db, id, (tx) => read(tx))) };
}

describe("T2", () => {
  it("T2 pooling: interleaved A / B / no-tenant requests on a pool of size 1 never see each other's rows", async () => {
    const order: Who[] = [];
    for (let i = 0; i < 20; i++) order.push(...(["A", "none", "B", "B", "none", "A"] as Who[]));
    const results = await Promise.all(order.map((w) => request(w)));

    for (const r of results) {
      if (r.who === "A") expect(r.tenants).toEqual([A.tenantId]);
      if (r.who === "B") expect(r.tenants).toEqual([B.tenantId]);
      if (r.who === "none") {
        expect(r.tenants).toEqual([]);
        // After a transaction-local set_config the custom GUC reverts to '' (not NULL) on this
        // connection; the policy's nullif(..., '') is what makes that safe.
        expect(r.setting === null || r.setting === "").toBe(true);
      }
    }
    // Also outside any explicit transaction.
    expect(await db.selectFrom("entity").select("id").execute()).toEqual([]);
  });

  it("T2 control: a session-level set_config (is_local=false) would leak through the pool", async () => {
    // Shows the test above can detect a leak: same pool, but the context is set for the session.
    await db.selectNoFrom((eb) => eb.fn("set_config", [eb.val("app.tenant_id"), eb.val(A.tenantId), eb.lit(false)]).as("x")).execute();
    const leaked = await db.selectFrom("entity").select("tenant_id").execute();
    expect(new Set(leaked.map((r) => r.tenant_id))).toEqual(new Set([A.tenantId]));
    // Clean up the session so later users of this pool start clean.
    await db.selectNoFrom((eb) => eb.fn("set_config", [eb.val("app.tenant_id"), eb.val(""), eb.lit(false)]).as("x")).execute();
    expect(await db.selectFrom("entity").select("id").execute()).toEqual([]);
  });
});
