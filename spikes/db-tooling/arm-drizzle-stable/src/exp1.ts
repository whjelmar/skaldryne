// Experiment 1: the four hard queries, through Drizzle's own query API as far as it goes.
// Every function runs inside a withTenant transaction; tenant isolation is RLS, and each query also carries the
// explicit tenant_id predicate of reference/exp1-queries.sql (so the RLS check proves RLS, not the predicate).
import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { url, type Tx } from './db.ts';
import { claimCurrent, entity, job, segmentEmbedding, transcriptSegment } from './schema/m4.ts';

/** Pool + drizzle instance whose logger reports every statement and its parameters. */
export function connectExp1(database: string, onQuery: (query: string, params: unknown[]) => void) {
  const client = new pg.Pool({ connectionString: url(database, 'app'), max: 10 });
  return drizzle({ client, logger: { logQuery: onQuery } });
}

export function exp1(tx: Tx, tenantId: string) {
  // @expr Q1 begin
  async function graphHops(startId: string) {
    // The recursive CTE is the one thing the builder cannot express: $with has no RECURSIVE form and a CTE cannot
    // refer to itself. The recursion is a raw fragment, nested in a typed CTE so the rest stays in the builder.
    const walk = tx.$with('walk', { entityId: sql<string>`entity_id`.as('entity_id'), depth: sql<number>`depth`.mapWith(Number).as('depth'), path: sql<string[]>`path`.as('path') }).as(
      sql`select entity_id, depth, path from (
        with recursive r (entity_id, depth, path) as (
          select ${claimCurrent.subjectId}, 1, array[(${claimCurrent.object} ->> 'entity')::uuid, ${claimCurrent.subjectId}]
          from ${claimCurrent}
          where ${claimCurrent.tenantId} = ${tenantId} and ${claimCurrent.object} ? 'entity'
            and ${claimCurrent.object} ->> 'entity' = ${startId} and ${claimCurrent.subjectId} <> ${startId}
          union all
          select ${claimCurrent.subjectId}, r.depth + 1, r.path || ${claimCurrent.subjectId}
          from r join ${claimCurrent}
            on ${claimCurrent.tenantId} = ${tenantId} and ${claimCurrent.object} ? 'entity'
            and ${claimCurrent.object} ->> 'entity' = r.entity_id::text
          where r.depth < 3 and ${claimCurrent.subjectId} <> all (r.path)
        ) select * from r) as rec`,
    );
    const shortest = tx.$with('shortest').as(
      tx
        .with(walk)
        .selectDistinctOn([walk.entityId], { entityId: walk.entityId, displayName: entity.displayName, depth: walk.depth, path: walk.path })
        .from(walk)
        .innerJoin(entity, and(eq(entity.tenantId, tenantId), eq(entity.id, walk.entityId)))
        .orderBy(walk.entityId, walk.depth),
    );
    return tx
      .with(shortest)
      .select()
      .from(shortest)
      .orderBy(asc(shortest.depth), asc(shortest.displayName));
  }
  // @expr Q1 end

  // @expr Q2 begin
  function searchSegments(campaignId: string, config: string, query: string) {
    const s = transcriptSegment;
    const q = sql`websearch_to_tsquery(${config}::regconfig, ${query})`;
    const rank = sql<number>`round(ts_rank_cd(${s.tsv}, ${q})::numeric, 4)`.mapWith(Number);
    return tx
      .select({
        id: s.id,
        sessionNo: s.sessionNo,
        startMs: s.startMs,
        rank,
        headline: sql<string>`ts_headline(${config}::regconfig, ${s.text}, ${q})`,
      })
      .from(s)
      .where(and(eq(s.tenantId, tenantId), eq(s.campaignId, campaignId), sql`${s.tsv} @@ ${q}`))
      .orderBy(desc(rank), asc(s.sessionNo), asc(s.startMs))
      .limit(10);
  }
  // @expr Q2 end

  // @expr Q3 begin
  function hybridSearch(campaignId: string, config: string, query: string, queryVector: number[]) {
    const s = transcriptSegment;
    const e = segmentEmbedding;
    const q = sql`websearch_to_tsquery(${config}::regconfig, ${query})`;
    // Finding: ftsRank/vecRank are null at runtime after the full join, but drizzle types them as plain number (see EXP1.md).
    const fts = tx.$with('fts').as(
      tx
        .select({ id: s.id, r: sql<number>`row_number() over (order by ts_rank_cd(${s.tsv}, ${q}) desc, ${s.id})`.mapWith(Number).as('fts_rank') })
        .from(s)
        .where(and(eq(s.tenantId, tenantId), eq(s.campaignId, campaignId), sql`${s.tsv} @@ ${q}`))
        .orderBy(sql`fts_rank`)
        .limit(10),
    );
    const dist = sql`${e.embedding} <=> ${JSON.stringify(queryVector)}::halfvec(768)`;
    const vec = tx.$with('vec').as(
      tx
        .select({ id: sql<string>`${e.segmentId}`.as('vec_id'), r: sql<number>`row_number() over (order by ${dist}, ${e.segmentId})`.mapWith(Number).as('vec_rank') })
        .from(e)
        .innerJoin(s, and(eq(s.tenantId, e.tenantId), eq(s.id, e.segmentId)))
        .where(and(eq(s.tenantId, tenantId), eq(s.campaignId, campaignId)))
        .orderBy(sql`vec_rank`)
        .limit(10),
    );
    const id = sql<string>`coalesce(${fts.id}, ${vec.id})`;
    const score = sql<number>`round(coalesce(1.0 / (60 + ${fts.r}), 0) + coalesce(1.0 / (60 + ${vec.r}), 0), 6)`.mapWith(Number);
    return tx
      .with(fts, vec)
      .select({ id, ftsRank: fts.r, vecRank: vec.r, score })
      .from(fts)
      .fullJoin(vec, eq(fts.id, vec.id))
      .orderBy(desc(score), asc(id))
      .limit(10);
  }
  // @expr Q3 end

  // @expr Q4claim begin
  function claimJobs(worker: string, n: number) {
    const ready = tx
      .select({ tenantId: job.tenantId, id: job.id })
      .from(job)
      .where(and(eq(job.state, 'queued'), lte(job.runAfter, sql`now()`)))
      .orderBy(asc(job.runAfter), asc(job.id))
      .limit(n)
      .for('update', { skipLocked: true });
    return tx
      .update(job)
      .set({ state: 'running', lockedBy: worker, lockedAt: sql`now()`, attempts: sql`${job.attempts} + 1` })
      .where(sql`(${job.tenantId}, ${job.id}) in ${ready}`)
      .returning({ id: job.id, kind: job.kind, payload: job.payload, attempts: job.attempts });
  }
  // @expr Q4claim end

  // @expr Q4complete begin
  function completeJob(id: string, worker: string) {
    return tx
      .update(job)
      .set({ state: 'done', lockedBy: null, lockedAt: null })
      .where(and(eq(job.tenantId, tenantId), eq(job.id, id), eq(job.lockedBy, worker)))
      .returning({ id: job.id, state: job.state });
  }
  // @expr Q4complete end

  // @expr Q4retry begin
  function retryJob(id: string, worker: string) {
    return tx
      .update(job)
      .set({
        state: sql`case when ${job.attempts} >= 3 then 'failed' else 'queued' end`,
        runAfter: sql`now() + make_interval(secs => 30 * ${job.attempts})`,
        lockedBy: null,
        lockedAt: null,
      })
      .where(and(eq(job.tenantId, tenantId), eq(job.id, id), eq(job.lockedBy, worker)))
      .returning({ id: job.id, state: job.state, attempts: job.attempts });
  }
  // @expr Q4retry end

  return { graphHops, searchSegments, hybridSearch, claimJobs, completeJob, retryJob };
}
