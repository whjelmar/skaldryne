// The reference schema expressed in Drizzle. One factory, three exported versions (m1, m2, m3), because
// only `entity` changes between migrations and every other table has a foreign key into it.
// Constraint names are set explicitly to Postgres' own defaults so the result matches reference/schema.sql.
import { sql, type SQL } from 'drizzle-orm';
import {
  bytea,
  check,
  foreignKey,
  halfvec,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumnBuilder,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

const currentTenant = sql`nullif(current_setting('app.tenant_id', true), '')::uuid`;

// Every tenant table gets the same permissive policy for PUBLIC, as in the reference.
function tenantIsolation(match: SQL) {
  return pgPolicy('tenant_isolation', { as: 'permissive', for: 'all', to: 'public', using: match, withCheck: match });
}

export function defineSchema<E extends Record<string, AnyPgColumnBuilder>>(entityExtra: E) {
  const tenant = pgTable(
    'tenant',
    {
      id: uuid('id').default(sql`uuidv7()`).notNull(),
      name: text('name').notNull(),
      createdAt: timestamptz('created_at').defaultNow().notNull(),
    },
    (t) => [primaryKey({ name: 'tenant_pkey', columns: [t.id] }), tenantIsolation(sql`id = ${currentTenant}`)],
  );

  const campaign = pgTable(
    'campaign',
    {
      tenantId: uuid('tenant_id').notNull(),
      id: uuid('id').default(sql`uuidv7()`).notNull(),
      name: text('name').notNull(),
    },
    (t) => [
      primaryKey({ name: 'campaign_pkey', columns: [t.tenantId, t.id] }),
      foreignKey({ name: 'campaign_tenant_id_fkey', columns: [t.tenantId], foreignColumns: [tenant.id] }),
      tenantIsolation(sql`tenant_id = ${currentTenant}`),
    ],
  );

  const fieldDefinition = pgTable(
    'field_definition',
    {
      tenantId: uuid('tenant_id').notNull(),
      id: uuid('id').default(sql`uuidv7()`).notNull(),
      campaignId: uuid('campaign_id'),
      key: text('key').notNull(),
      valueType: text('value_type').notNull(),
    },
    (t) => [
      primaryKey({ name: 'field_definition_pkey', columns: [t.tenantId, t.id] }),
      foreignKey({ name: 'field_definition_tenant_id_fkey', columns: [t.tenantId], foreignColumns: [tenant.id] }),
      foreignKey({
        name: 'field_definition_tenant_id_campaign_id_fkey',
        columns: [t.tenantId, t.campaignId],
        foreignColumns: [campaign.tenantId, campaign.id],
      }),
      unique('field_definition_tenant_id_campaign_id_key_key').on(t.tenantId, t.campaignId, t.key).nullsNotDistinct(),
      check('field_definition_value_type_check', sql`value_type IN ('text', 'number', 'boolean', 'date')`),
      tenantIsolation(sql`tenant_id = ${currentTenant}`),
    ],
  );

  const entity = pgTable(
    'entity',
    {
      tenantId: uuid('tenant_id').notNull(),
      id: uuid('id').default(sql`uuidv7()`).notNull(),
      campaignId: uuid('campaign_id').notNull(),
      kind: text('kind').notNull(),
      ...entityExtra,
      custom: jsonb('custom').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    },
    (t) => [
      primaryKey({ name: 'entity_pkey', columns: [t.tenantId, t.id] }),
      foreignKey({
        name: 'entity_tenant_id_campaign_id_fkey',
        columns: [t.tenantId, t.campaignId],
        foreignColumns: [campaign.tenantId, campaign.id],
      }),
      index('entity_campaign_idx').on(t.tenantId, t.campaignId),
      tenantIsolation(sql`tenant_id = ${currentTenant}`),
    ],
  );

  // Hash-partitioned in the database. Drizzle has no partitioning syntax, so the generated CREATE TABLE is
  // hand-edited to add PARTITION BY HASH (tenant_id) and the partitions live in a custom migration.
  const claimVersion = pgTable(
    'claim_version',
    {
      tenantId: uuid('tenant_id').notNull(),
      claimId: uuid('claim_id').notNull(),
      version: integer('version').notNull(),
      campaignId: uuid('campaign_id').notNull(),
      subjectId: uuid('subject_id').notNull(),
      predicate: text('predicate').notNull(),
      object: jsonb('object').$type<unknown>().notNull(),
      recordedAt: timestamptz('recorded_at').defaultNow().notNull(),
    },
    (t) => [
      primaryKey({ name: 'claim_version_pkey', columns: [t.tenantId, t.claimId, t.version] }),
      foreignKey({
        name: 'claim_version_tenant_id_campaign_id_fkey',
        columns: [t.tenantId, t.campaignId],
        foreignColumns: [campaign.tenantId, campaign.id],
      }),
      foreignKey({
        name: 'claim_version_tenant_id_subject_id_fkey',
        columns: [t.tenantId, t.subjectId],
        foreignColumns: [entity.tenantId, entity.id],
      }),
      check('claim_version_version_check', sql`version > 0`),
      tenantIsolation(sql`tenant_id = ${currentTenant}`),
    ],
  );

  // Maintained by the claim_current_sync trigger (custom migration).
  const claimCurrent = pgTable(
    'claim_current',
    {
      tenantId: uuid('tenant_id').notNull(),
      claimId: uuid('claim_id').notNull(),
      version: integer('version').notNull(),
      campaignId: uuid('campaign_id').notNull(),
      subjectId: uuid('subject_id').notNull(),
      predicate: text('predicate').notNull(),
      object: jsonb('object').$type<unknown>().notNull(),
    },
    (t) => [
      primaryKey({ name: 'claim_current_pkey', columns: [t.tenantId, t.claimId] }),
      foreignKey({
        name: 'claim_current_tenant_id_campaign_id_fkey',
        columns: [t.tenantId, t.campaignId],
        foreignColumns: [campaign.tenantId, campaign.id],
      }),
      foreignKey({
        name: 'claim_current_tenant_id_subject_id_fkey',
        columns: [t.tenantId, t.subjectId],
        foreignColumns: [entity.tenantId, entity.id],
      }),
      index('claim_current_subject_idx').on(t.tenantId, t.subjectId),
      tenantIsolation(sql`tenant_id = ${currentTenant}`),
    ],
  );

  const claimEmbedding = pgTable(
    'claim_embedding',
    {
      tenantId: uuid('tenant_id').notNull(),
      claimId: uuid('claim_id').notNull(),
      embedding: halfvec('embedding', { dimensions: 768 }).notNull(),
    },
    (t) => [
      primaryKey({ name: 'claim_embedding_pkey', columns: [t.tenantId, t.claimId] }),
      foreignKey({
        name: 'claim_embedding_tenant_id_claim_id_fkey',
        columns: [t.tenantId, t.claimId],
        foreignColumns: [claimCurrent.tenantId, claimCurrent.claimId],
      }).onDelete('cascade'),
      index('claim_embedding_hnsw')
        .using('hnsw', t.embedding.op('halfvec_cosine_ops'))
        .with({ m: 16, ef_construction: 64 }),
      tenantIsolation(sql`tenant_id = ${currentTenant}`),
    ],
  );

  const transcriptSegment = pgTable(
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
    },
    (t) => [
      primaryKey({ name: 'transcript_segment_pkey', columns: [t.tenantId, t.id] }),
      foreignKey({
        name: 'transcript_segment_tenant_id_campaign_id_fkey',
        columns: [t.tenantId, t.campaignId],
        foreignColumns: [campaign.tenantId, campaign.id],
      }),
      check('transcript_segment_check', sql`end_ms >= start_ms`),
      index('transcript_segment_session_idx').on(t.tenantId, t.campaignId, t.sessionNo, t.startMs),
      tenantIsolation(sql`tenant_id = ${currentTenant}`),
    ],
  );

  const importRecord = pgTable(
    'import_record',
    {
      tenantId: uuid('tenant_id').notNull(),
      source: text('source').notNull(),
      sourceKey: text('source_key').notNull(),
      entityId: uuid('entity_id').notNull(),
      contentHash: text('content_hash').notNull(),
      importedAt: timestamptz('imported_at').defaultNow().notNull(),
    },
    (t) => [
      primaryKey({ name: 'import_record_pkey', columns: [t.tenantId, t.source, t.sourceKey] }),
      foreignKey({ name: 'import_record_tenant_id_fkey', columns: [t.tenantId], foreignColumns: [tenant.id] }),
      foreignKey({
        name: 'import_record_tenant_id_entity_id_fkey',
        columns: [t.tenantId, t.entityId],
        foreignColumns: [entity.tenantId, entity.id],
      }),
      tenantIsolation(sql`tenant_id = ${currentTenant}`),
    ],
  );

  return {
    tenant,
    campaign,
    fieldDefinition,
    entity,
    claimVersion,
    claimCurrent,
    claimEmbedding,
    transcriptSegment,
    importRecord,
  };
}
