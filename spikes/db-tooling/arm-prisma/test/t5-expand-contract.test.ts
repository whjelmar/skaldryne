import { randomUUID } from "node:crypto";
import postgres from "@prisma/orm-postgres/runtime";
import pgvector from "@prisma/orm-extension-pgvector/runtime";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import { appUrl, migratorUrl, recreateDatabase } from "../scripts/bootstrap.ts";
import { prisma } from "../scripts/prisma-cli.ts";
import "../src/db.ts"; // the Temporal polyfill and the jsonb parser workaround
// Each era of application code is built against the contract snapshot of its migration. The
// snapshots are what `migration plan` writes; they carry both the JSON contract and its types.
import type { Contract as M1 } from "../migrations/snapshots/b4c11737c4774575acc639908163c539bdba2997572ffa13f28883608db2f512/contract.d.ts";
import m1Json from "../migrations/snapshots/b4c11737c4774575acc639908163c539bdba2997572ffa13f28883608db2f512/contract.json" with { type: "json" };
import type { Contract as M2 } from "../migrations/snapshots/d2b00090b4fc868ad2942ade701084f42423ca169b03c25e745d202ade41d8ab/contract.d.ts";
import m2Json from "../migrations/snapshots/d2b00090b4fc868ad2942ade701084f42423ca169b03c25e745d202ade41d8ab/contract.json" with { type: "json" };
import type { Contract as M3 } from "../prisma/contract.d.ts";
import m3Json from "../prisma/contract.json" with { type: "json" };
import { pgError, psql } from "./helpers.ts";

const T5_DB = "prisma_t5";
const tenantId = randomUUID();
const campaignId = randomUUID();

/** A pool of 2 per era, so the first-use marker check has a connection of its own. */
const pools = [1, 2, 3].map(() => new pg.Pool({ connectionString: appUrl(T5_DB), max: 2 }));
const v1 = postgres<M1>({ contractJson: m1Json as never, pg: pools[0]!, extensions: [pgvector] });
const v2 = postgres<M2>({ contractJson: m2Json as never, pg: pools[1]!, extensions: [pgvector] });
const v3 = postgres<M3>({ contractJson: m3Json as never, pg: pools[2]!, extensions: [pgvector] });
afterAll(async () => {
  for (const db of [v1, v2, v3]) await db.close();
  for (const p of pools) await p.end();
});

type EraDb = typeof v1 | typeof v2 | typeof v3;
type TxOf<D extends EraDb> = Parameters<Parameters<D["transaction"]>[0]>[0];
/** Same shape as src/db.ts withTenant, for any era's client. */
async function inTenant<D extends EraDb, T>(db: D, fn: (tx: TxOf<D>) => PromiseLike<T>): Promise<T> {
  const run = db.transaction as (cb: (tx: TxOf<D>) => Promise<T>) => Promise<T>;
  return run.call(db, async (tx) => {
    await tx.query(db.raw.sql`SELECT set_config('app.tenant_id', ${tenantId}, true) AS t`.returnsRow({ t: "pg/text@1" }).build());
    return fn(tx);
  });
}

const columns = (id: string) =>
  psql(T5_DB, "postgres", `SELECT coalesce(name, '<null>') || '|' || coalesce(display_name, '<null>') FROM entity WHERE id = '${id}'`, ["-At"]).trim();

beforeAll(async () => {
  await recreateDatabase(T5_DB);
  const r = prisma(["db", "migrate", "--db", migratorUrl(T5_DB), "--to", "m2"]);
  if (r.exitCode !== 0) throw new Error(`T5 setup to m2: ${JSON.stringify(r.envelope)}`);
  await inTenant(v2, async (tx) => {
    await tx.orm.public.Tenant.create({ id: tenantId, name: "T5" });
    await tx.orm.public.Campaign.create({ tenantId, id: campaignId, name: "T5 campaign" });
  });
});

describe("T5 expand/contract: between M2 and M3", () => {
  const fromV1 = randomUUID();
  const fromV2 = randomUUID();

  it("M1-era code writes name; the trigger fills display_name", async () => {
    await inTenant(v1, (tx) =>
      tx.orm.public.Entity.create({ tenantId, id: fromV1, campaignId, kind: "npc", name: "written by v1" }));
    expect(columns(fromV1)).toBe("written by v1|written by v1");
  });

  it("M2-era code writes displayName; the trigger fills name", async () => {
    await inTenant(v2, (tx) =>
      tx.orm.public.Entity.create({ tenantId, id: fromV2, campaignId, kind: "npc", displayName: "written by v2" }));
    expect(columns(fromV2)).toBe("written by v2|written by v2");
  });

  it("each era reads the other's writes through its own field", async () => {
    const seenByV1 = await inTenant(v1, (tx) => tx.orm.public.Entity.where({ tenantId, id: fromV2 }).first());
    const seenByV2 = await inTenant(v2, (tx) => tx.orm.public.Entity.where({ tenantId, id: fromV1 }).first());
    expect(seenByV1?.name).toBe("written by v2");
    expect(seenByV2?.displayName).toBe("written by v1");
  });

  it("updates from either era keep the two columns in sync", async () => {
    await inTenant(v1, (tx) => tx.orm.public.Entity.where({ tenantId, id: fromV2 }).updateAll({ name: "renamed by v1" }));
    expect(columns(fromV2)).toBe("renamed by v1|renamed by v1");
    await inTenant(v2, (tx) => tx.orm.public.Entity.where({ tenantId, id: fromV1 }).updateAll({ displayName: "renamed by v2" }));
    expect(columns(fromV1)).toBe("renamed by v2|renamed by v2");
  });

  it("the generated types differ per era", () => {
    type Row1 = Awaited<ReturnType<typeof v1.orm.public.Entity.first>>;
    type Row2 = Awaited<ReturnType<typeof v2.orm.public.Entity.first>>;
    type Row3 = Awaited<ReturnType<typeof v3.orm.public.Entity.first>>;
    expectTypeOf<NonNullable<Row1>>().toHaveProperty("name");
    expectTypeOf<NonNullable<Row2>>().toHaveProperty("displayName");
    expectTypeOf<NonNullable<Row2>>().toHaveProperty("name");
    expectTypeOf<NonNullable<Row3>>().toHaveProperty("displayName");
  });
});

describe("T5 after M3", () => {
  beforeAll(() => {
    const r = prisma(["db", "migrate", "--db", migratorUrl(T5_DB)]);
    if (r.exitCode !== 0) throw new Error(`T5 migrate to m3: ${JSON.stringify(r.envelope)}`);
  });

  it("M3-era code reads and writes", async () => {
    const id = randomUUID();
    await inTenant(v3, (tx) => tx.orm.public.Entity.create({ tenantId, id, campaignId, kind: "npc", displayName: "written by v3" }));
    const all = await inTenant(v3, (tx) => tx.orm.public.Entity.all());
    expect(all.map((e) => e.displayName).sort()).toEqual(["renamed by v1", "renamed by v2", "written by v3"]);
  });

  it("M1-era code now fails on the dropped column, not on a contract check", async () => {
    const err = await pgError(inTenant(v1, (tx) => tx.orm.public.Entity.all()));
    console.log("T5 M1-era client after M3:", err.code, err.chain.slice(0, 300));
    expect(err.code).toBe("42703");
  });

  it("M2-era code also fails on the dropped column", async () => {
    const err = await pgError(inTenant(v2, (tx) => tx.orm.public.Entity.all()));
    console.log("T5 M2-era client after M3:", err.code, err.chain.slice(0, 300));
    expect(err.code).toBe("42703");
  });
});
