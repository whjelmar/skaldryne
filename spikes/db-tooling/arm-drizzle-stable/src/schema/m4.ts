// M4 (Experiment 1 only): the tables and columns the four hard queries need, declared for the query layer.
// This file is deliberately NOT the drizzle-kit schema (drizzle.config.ts points at m1/m2/m3), so `generate`
// is not asked to plan M4 and T4 stays about M1-M3. The database for Experiment 1 is built by reference/exp1-m4.sql.
import { sql } from 'drizzle-orm';
import { customType, foreignKey, index, integer, jsonb, pgPolicy, halfvec, pgTable, primaryKey, text, uuid, timestamp } from 'drizzle-orm/pg-core';

import { claimCurrent, entity } from './m3.ts';

export { claimCurrent, entity };

const regconfig = customType<{ data: string; driverData: string }>({ dataType: () => 'regconfig' });
const tsvector = customType<{ data: string; driverData: string }>({ dataType: () => 'tsvector' });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

const currentTenant = sql`nullif(current_setting('app.tenant_id', true), '')::uuid`;
const isolation = () =>
  pgPolicy('tenant_isolation', {
    as: 'permissive',
    for: 'all',
    to: 'public',
    using: sql`tenant_id = ${currentTenant}`,
    withCheck: sql`tenant_id = ${currentTenant}`,
  });

// transcript_segment as of M4: the M3 columns plus ts_config and the generated tsv.
export const transcriptSegment = pgTable(
  'transcript_segment',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').default(sql`uuidv7()`).notNull(),
    campaignId: uuid('campaign_id').notNull(),
    sessionNo: integer('session_no').notNull(),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    speaker: text('speaker'),
    text: text('text').notNull(),
    wordTimings: bytea('word_timings').notNull(),
    tsConfig: regconfig('ts_config').notNull().default('english'),
    tsv: tsvector('tsv').generatedAlwaysAs(sql`to_tsvector(ts_config, text)`),
  },
  (t) => [
    primaryKey({ name: 'transcript_segment_pkey', columns: [t.tenantId, t.id] }),
    index('transcript_segment_tsv_idx').using('gin', t.tsv),
    isolation(),
  ],
);

export const segmentEmbedding = pgTable(
  'segment_embedding',
  {
    tenantId: uuid('tenant_id').notNull(),
    segmentId: uuid('segment_id').notNull(),
    embedding: halfvec('embedding', { dimensions: 768 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.segmentId] }),
    foreignKey({ columns: [t.tenantId, t.segmentId], foreignColumns: [transcriptSegment.tenantId, transcriptSegment.id] }).onDelete('cascade'),
    index('segment_embedding_hnsw').using('hnsw', t.embedding.op('halfvec_cosine_ops')).with({ m: 16, ef_construction: 64 }),
    isolation(),
  ],
);

export const job = pgTable(
  'job',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').default(sql`uuidv7()`).notNull(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<unknown>().default(sql`'{}'::jsonb`).notNull(),
    state: text('state', { enum: ['queued', 'running', 'done', 'failed'] }).default('queued').notNull(),
    runAfter: timestamp('run_after', { withTimezone: true }).defaultNow().notNull(),
    attempts: integer('attempts').default(0).notNull(),
    lockedBy: text('locked_by'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    index('job_ready_idx').on(t.state, t.runAfter).where(sql`state = 'queued'`),
    isolation(),
  ],
);
