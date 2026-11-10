import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import { randomUUID } from "node:crypto";
import pgvector from "pgvector";
import { cosineDistance } from "pgvector/kysely";
import { createDb, withTenant } from "../src/db/index.ts";
import { seedTenant, type Seed } from "./helpers.ts";

const db = createDb();
let T: Seed;
let otherCampaign: string;
const DIM = 768;

/** Deterministic pseudo-random unit-ish vector. */
function vec(seed: number): number[] {
  const out: number[] = [];
  let x = seed * 9301 + 49297;
  for (let i = 0; i < DIM; i++) {
    x = (x * 9301 + 49297) % 233280;
    out.push(x / 233280 - 0.5);
  }
  return out;
}

beforeAll(async () => {
  T = await seedTenant(db, "vec");
  otherCampaign = randomUUID();
  await withTenant(db, T.tenantId, async (tx) => {
    await tx.insertInto("campaign").values({ tenant_id: T.tenantId, id: otherCampaign, name: "other" }).execute();
    // 40 claims: even ones in T.campaignId, odd ones in otherCampaign.
    for (let i = 0; i < 40; i++) {
      const campaign = i % 2 === 0 ? T.campaignId : otherCampaign;
      const subject = randomUUID();
      const claimId = randomUUID();
      await tx.insertInto("entity").values({ tenant_id: T.tenantId, id: subject, campaign_id: campaign, kind: "npc", display_name: `e${i}` }).execute();
      await tx
        .insertInto("claim_version")
        .values({ tenant_id: T.tenantId, claim_id: claimId, version: 1, campaign_id: campaign, subject_id: subject, predicate: "p", object: JSON.stringify(i) })
        .execute();
      // halfvec goes in as pgvector's text form; the generated column type is `string` and toSql is typed `string | null`.
      await tx.insertInto("claim_embedding").values({ tenant_id: T.tenantId, claim_id: claimId, embedding: pgvector.toSql(vec(i))! }).execute();
    }
  });
});
afterAll(() => db.destroy());

function topFive(tx: typeof db, campaignId: string, query: number[]) {
  return tx
    .selectFrom("claim_embedding as e")
    .innerJoin("claim_current as c", (j) => j.onRef("c.tenant_id", "=", "e.tenant_id").onRef("c.claim_id", "=", "e.claim_id"))
    .select((eb) => [
      "c.claim_id",
      "c.object",
      // Kysely knows `<=>` as a comparison operator (typed SqlBool), so the distance needs a cast.
      eb("e.embedding", "<=>", pgvector.toSql(query)).$castTo<number>().as("distance"),
    ])
    .where("c.campaign_id", "=", campaignId)
    .orderBy((eb) => eb("e.embedding", "<=>", pgvector.toSql(query)))
    .limit(5);
}

describe("T3", () => {
  it("T3 vectors: halfvec(768) insert, top-5 cosine by campaign via claim_current, HNSW usable", async () => {
    const q = vec(4); // equal to claim #4's embedding (campaign A)
    await withTenant(db, T.tenantId, async (tx) => {
      const rows = await topFive(tx, T.campaignId, q).execute();
      expect(rows).toHaveLength(5);
      expect(rows[0]!.object).toBe(4);
      expect(rows[0]!.distance).toBeLessThan(0.001); // halfvec rounding
      for (const r of rows) expect(Number(r.object) % 2).toBe(0); // only the filtered campaign
      for (let i = 1; i < rows.length; i++) expect(rows[i]!.distance).toBeGreaterThanOrEqual(rows[i - 1]!.distance);
      expect(typeof rows[0]!.distance).toBe("number");
      expectTypeOf(rows[0]!.distance).toEqualTypeOf<number>();
      expectTypeOf(rows[0]!.claim_id).toEqualTypeOf<string>();

      // The pgvector/kysely helper builds the same SQL but is typed RawBuilder<unknown>.
      const viaHelper = await tx
        .selectFrom("claim_embedding as e")
        .select(["e.claim_id", cosineDistance("e.embedding", q).as("d")])
        .orderBy(cosineDistance("e.embedding", q))
        .limit(1)
        .executeTakeFirstOrThrow();
      expectTypeOf(viaHelper.d).toEqualTypeOf<unknown>();

      // Reading the embedding back: the generated type is `string` (pgvector text form).
      const emb = await tx.selectFrom("claim_embedding").select("embedding").limit(1).executeTakeFirstOrThrow();
      expectTypeOf(emb.embedding).toEqualTypeOf<string>();
      expect(pgvector.fromSql(emb.embedding)).toHaveLength(DIM);

      // EXPLAIN through Kysely's own .explain(). With 40 rows the planner prefers a seq scan, so
      // disable it for this transaction (set_config is local, as in withTenant) to prove the HNSW
      // index can serve this query shape (planner hints only; the query itself is unchanged).
      // With the campaign filter the planner also prefers to sort a handful of claim_current rows, so
      // enable_sort is turned off too; that leaves the ordered HNSW scan as the only way to serve ORDER BY.
      for (const guc of ["enable_seqscan", "enable_sort"]) {
        await tx.selectNoFrom((eb) => eb.fn("set_config", [eb.val(guc), eb.val("off"), eb.lit(true)]).as("x")).execute();
      }
      const plan = await topFive(tx, T.campaignId, q).explain();
      const text = plan.map((r) => r["QUERY PLAN"]).join("\n");
      expect(text).toMatch(/Index Scan using claim_embedding_hnsw on claim_embedding e/);
    });
  });
});
