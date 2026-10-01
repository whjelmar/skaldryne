import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import { withTenant } from "../src/db.ts";
import { app } from "./helpers.ts";

// FALLBACK (raw SQL): halfvec is not a contract type (the pgvector pack ships only `vector`), so the
// embedding column is outside the contract and both the inserts and the search use the raw lane.
const { db, close } = app();
const DIM = 768;
const tenantId = randomUUID();
const campaigns = [randomUUID(), randomUUID()];
const claims: { claimId: string; campaignId: string; i: number }[] = [];

/** Deterministic, distinct 768-dim vectors; vector i and i+1 are close, distant ones are not. */
const vec = (i: number) => Array.from({ length: DIM }, (_, j) => Math.sin(i * 0.1 + j * 0.37)).map((x) => x.toFixed(4));
const literal = (i: number) => `[${vec(i).join(",")}]`;

beforeAll(async () => {
  await withTenant(db, tenantId, async (tx) => {
    await tx.orm.public.Tenant.create({ id: tenantId, name: "T3" });
    for (const campaignId of campaigns) {
      await tx.orm.public.Campaign.create({ tenantId, id: campaignId, name: "T3 campaign" });
    }
    for (let i = 0; i < 24; i++) {
      const campaignId = campaigns[i % 2]!;
      const entityId = randomUUID();
      const claimId = randomUUID();
      await tx.orm.public.Entity.create({ tenantId, id: entityId, campaignId, kind: "npc", displayName: `npc ${i}` });
      await tx.orm.public.ClaimVersion.create({
        tenantId, claimId, version: 1, campaignId, subjectId: entityId, predicate: "title", object: { i },
      });
      await tx.query(
        db.raw.sql`INSERT INTO claim_embedding (tenant_id, claim_id, embedding) VALUES (${tenantId}::uuid, ${claimId}::uuid, ${literal(i)}::halfvec)`
          .affectedCount()
          .build(),
      );
      claims.push({ claimId, campaignId, i });
    }
  });
});
afterAll(close);

const search = (campaignId: string, queryIndex: number) =>
  db.raw.sql`
    SELECT c.claim_id, c.predicate, c.object, e.embedding <=> ${literal(queryIndex)}::halfvec AS distance
    FROM claim_embedding e
    JOIN claim_current c ON c.tenant_id = e.tenant_id AND c.claim_id = e.claim_id
    WHERE c.campaign_id = ${campaignId}::uuid
    ORDER BY e.embedding <=> ${literal(queryIndex)}::halfvec
    LIMIT 5`.returnsRow({
    claim_id: "pg/uuid@1",
    predicate: "pg/text@1",
    object: "pg/jsonb@1",
    distance: "pg/float8@1",
  });

describe("T3 halfvec similarity search", () => {
  it("top-5 cosine, filtered by campaign and joined to claim_current", async () => {
    const target = claims.find((c) => c.campaignId === campaigns[0] && c.i === 10)!;
    const rows = await withTenant(db, tenantId, (tx) => tx.query(search(campaigns[0]!, 10).build()));
    expect(rows).toHaveLength(5);
    expect(rows[0]!.claim_id).toBe(target.claimId);
    expect(rows[0]!.distance).toBeCloseTo(0, 3);
    const inCampaign = new Set(claims.filter((c) => c.campaignId === campaigns[0]).map((c) => c.claimId));
    for (const r of rows) expect(inCampaign.has(r.claim_id as string)).toBe(true);
    const d = rows.map((r) => r.distance as number);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    // Runtime value types, recorded in RESULTS.md.
    console.log("T3 runtime types:", Object.fromEntries(Object.entries(rows[0]!).map(([k, v]) => [k, typeof v])), rows[0]);
  });

  it("the static row type", async () => {
    const rows = await withTenant(db, tenantId, (tx) => tx.query(search(campaigns[0]!, 10).build()));
    type Row = (typeof rows)[number];
    // Recorded as found: see RESULTS.md T3 note.
    expectTypeOf<Row>().toHaveProperty("claim_id");
    expectTypeOf<Row>().toHaveProperty("distance");
  });

  it("EXPLAIN shows the HNSW index can serve the query", async () => {
    const plan = await withTenant(db, tenantId, async (tx) => {
      // 24 rows would never pick the HNSW index on cost alone. With seq scans off the planner still
      // prefers a bitmap scan on claim_current plus a sort, so sorts and bitmap scans are disabled too:
      // the only remaining way to produce the ORDER BY is the HNSW index. This shows it is usable.
      for (const setting of ["enable_seqscan", "enable_bitmapscan", "enable_sort"]) {
        await tx.query(db.raw.sql`SELECT set_config(${setting}, 'off', true) AS v`.returnsRow({ v: "pg/text@1" }).build());
      }
      const inner = search(campaigns[0]!, 10);
      return tx.query(db.raw.sql`EXPLAIN ${inner}`.returnsRow({ "QUERY PLAN": "pg/text@1" }).build());
    });
    const text = plan.map((r) => r["QUERY PLAN"]).join("\n");
    console.log("T3 EXPLAIN:\n" + text);
    expect(text).toMatch(/Index Scan using claim_embedding_hnsw/);
  });
});
