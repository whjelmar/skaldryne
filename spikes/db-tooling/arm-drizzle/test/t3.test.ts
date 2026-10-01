// T3: halfvec(768) embeddings through the tool, top-5 cosine query joined with claim_current, EXPLAIN uses HNSW.
import { and, asc, cosineDistance, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, expectTypeOf, test } from 'vitest';
import { connect, url, withTenant } from '../src/db.ts';
import * as s from '../src/schema/m3.ts';
import { randomVector, saveOutput, seedTenant, uuid, type SeededTenant } from './helpers.ts';

const db = connect('drizzle_app', 'app');
let A: SeededTenant;
let otherCampaign: string;

beforeAll(async () => {
  A = await seedTenant(db, 't3-A');
  otherCampaign = uuid();
  await withTenant(db, A.tenant, async (tx) => {
    await tx.insert(s.campaign).values({ tenantId: A.tenant, id: otherCampaign, name: 'other' });
    for (let i = 0; i < 40; i++) {
      const campaignId = i % 2 === 0 ? A.campaign : otherCampaign;
      const claimId = uuid();
      await tx.insert(s.claimVersion).values({
        tenantId: A.tenant,
        claimId,
        version: 1,
        campaignId,
        subjectId: A.entity, // the entity is in A.campaign; claim campaign is independent in the schema
        predicate: `p${i}`,
        object: { i },
      });
      await tx.insert(s.claimEmbedding).values({ tenantId: A.tenant, claimId, embedding: randomVector() });
    }
  });
});
afterAll(() => db.$client.end());

function topFive(tx: Parameters<Parameters<typeof withTenant>[2]>[0], query: number[]) {
  // cosineDistance builds `embedding <=> '[...]'`; mapWith(Number) gives it a real type (it is SQL<unknown> otherwise).
  const distance = cosineDistance(s.claimEmbedding.embedding, query).mapWith(Number);
  return tx
    .select({
      claimId: s.claimCurrent.claimId,
      predicate: s.claimCurrent.predicate,
      object: s.claimCurrent.object,
      embedding: s.claimEmbedding.embedding,
      distance,
    })
    .from(s.claimEmbedding)
    .innerJoin(
      s.claimCurrent,
      and(eq(s.claimCurrent.tenantId, s.claimEmbedding.tenantId), eq(s.claimCurrent.claimId, s.claimEmbedding.claimId)),
    )
    .where(eq(s.claimCurrent.campaignId, A.campaign))
    .orderBy(asc(distance))
    .limit(5);
}

describe('T3 vectors', () => {
  test('T3 top-5 cosine similarity filtered by campaign returns typed rows', async () => {
    const query = randomVector();
    const rows = await withTenant(db, A.tenant, (tx) => topFive(tx, query));

    expect(rows).toHaveLength(5);
    const ids = await withTenant(db, A.tenant, (tx) =>
      tx.select({ id: s.claimCurrent.claimId }).from(s.claimCurrent).where(eq(s.claimCurrent.campaignId, A.campaign)),
    );
    const inCampaign = new Set(ids.map((r) => r.id));
    for (const r of rows) {
      expect(inCampaign.has(r.claimId)).toBe(true);
      expect(typeof r.distance).toBe('number');
      expect(Array.isArray(r.embedding) && r.embedding.length === 768 && typeof r.embedding[0] === 'number').toBe(true);
    }
    const distances = rows.map((r) => r.distance);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);

    // Compile-time types (enforced by `tsc --noEmit` in `pnpm test`).
    type Row = (typeof rows)[number];
    expectTypeOf<Row['distance']>().toEqualTypeOf<number>();
    expectTypeOf<Row['embedding']>().toEqualTypeOf<number[]>();
    expectTypeOf<Row['claimId']>().toEqualTypeOf<string>();
    expectTypeOf<Row['object']>().toEqualTypeOf<unknown>(); // jsonb typed as declared with $type<unknown>()
  });

  test('T3 EXPLAIN of the generated SQL shows the HNSW index can be used', async () => {
    const query = randomVector();
    // toSQL() gives the exact text and params drizzle sends; EXPLAIN itself goes through the raw driver
    // because drizzle has no explain() on query builders.
    const { sql: text, params } = await withTenant(db, A.tenant, async (tx) => topFive(tx, query).toSQL());
    const client = new pg.Client({ connectionString: url('drizzle_app', 'app') });
    await client.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.tenant_id', $1, true)`, [A.tenant]);
      const explain = async () =>
        (await client.query<{ 'QUERY PLAN': string }>(`explain ${text}`, params)).rows
          .map((r) => r['QUERY PLAN'].replace(/'\[[-0-9.,e]+\]'/g, "'[768 values]'"))
          .join('\n');
      const natural = await explain();
      // At this size the planner prefers join-then-sort. The question is whether the HNSW index is usable for this
      // query shape, so make the alternatives expensive and look again.
      await client.query('set local enable_seqscan = off');
      await client.query('set local enable_sort = off');
      const forced = await explain();
      await client.query('rollback');
      saveOutput('t3-explain.txt', `${text.slice(0, 600)}\n\n-- default planner settings\n${natural}\n\n-- enable_seqscan=off, enable_sort=off\n${forced}\n`);
      expect(forced).toMatch(/Index Scan using claim_embedding_hnsw/);
    } finally {
      await client.end();
    }
  });
});
