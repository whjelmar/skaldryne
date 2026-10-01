import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/db.ts";
import { app, seedTenant, type Seed } from "./helpers.ts";

// Pool of exactly one connection: every transaction below borrows the same session in turn, so a
// tenant setting that outlived its transaction would be seen by the next borrower.
const { db, pool, close } = app(undefined, 1);
let A: Seed;
let B: Seed;

beforeAll(async () => {
  A = await seedTenant(db, "T2-A");
  B = await seedTenant(db, "T2-B");
});
afterAll(close);

type View = { who: string; tenants: string[]; entities: string[]; claims: string[]; setting: string | null };

/** One transaction's view of the data. tenantId undefined means no tenant context is set. */
function look(who: string, tenantId: string | undefined): Promise<View> {
  const body = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
    const [row] = await tx.query(
      db.raw.sql`SELECT current_setting('app.tenant_id', true) AS setting`.returnsRow({ setting: { codecId: "pg/text@1", nullable: true } }).build(),
    );
    return {
      who,
      tenants: (await tx.orm.public.Tenant.all()).map((t) => t.id),
      entities: (await tx.orm.public.Entity.all()).map((e) => e.tenantId),
      claims: (await tx.orm.public.ClaimCurrent.all()).map((c) => c.tenantId),
      setting: (row?.setting as string | null | undefined) ?? null,
    };
  };
  return tenantId ? withTenant(db, tenantId, body) : db.transaction(body);
}

describe("T2 per-transaction tenant context on a pool of one", () => {
  it("the pool really has one connection", () => {
    expect(pool.options.max).toBe(1);
  });

  it("interleaved A, B and no-tenant transactions each see only their own rows", async () => {
    const order = ["A", "B", "none", "A", "none", "B", "B", "A", "none", "A", "B", "none"];
    const views = await Promise.all(
      order.map((who, i) => look(`${who}#${i}`, who === "A" ? A.tenantId : who === "B" ? B.tenantId : undefined)),
    );
    for (const v of views) {
      const expected = v.who.startsWith("A") ? A.tenantId : v.who.startsWith("B") ? B.tenantId : undefined;
      if (expected) {
        expect(v.tenants, v.who).toEqual([expected]);
        expect(new Set(v.entities), v.who).toEqual(new Set([expected]));
        expect(new Set(v.claims), v.who).toEqual(new Set([expected]));
        expect(v.setting, v.who).toBe(expected);
      } else {
        // No tenant context: nothing is visible, and no earlier borrower's setting leaked in.
        expect(v.tenants, v.who).toEqual([]);
        expect(v.entities, v.who).toEqual([]);
        expect(v.claims, v.who).toEqual([]);
        expect(v.setting ?? "", v.who).toBe("");
      }
    }
  });

  it("a plain query (no transaction) after a tenant transaction sees nothing", async () => {
    await withTenant(db, A.tenantId, async (tx) => tx.orm.public.Tenant.all());
    expect(await db.orm.public.Tenant.all()).toEqual([]);
    expect(await db.orm.public.ClaimCurrent.all()).toEqual([]);
  });
});
