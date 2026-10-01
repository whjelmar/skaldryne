#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/b4c11737c4774575acc639908163c539bdba2997572ffa13f28883608db2f512/contract';
import endContract from '../../snapshots/b4c11737c4774575acc639908163c539bdba2997572ffa13f28883608db2f512/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
} from '@prisma/orm-postgres/migration';
import { raw } from '../../../scripts/raw-op.ts';

const TENANT_PREDICATE = "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)";
const exists = (sql: string) => `SELECT EXISTS (${sql}) AS result`;

// FALLBACKS: objects the Prisma 8 contract cannot express. Each one is a raw SQL operation.
const rawM1Ops = [
  // Hash-partitioned table. The model is @@control(external), so Prisma emits nothing for it,
  // including its RLS and policy.
  raw(
    'raw.claim_version.table',
    'Create hash-partitioned table "claim_version" and its four partitions',
    [
      `CREATE TABLE public.claim_version (
  tenant_id   uuid NOT NULL,
  claim_id    uuid NOT NULL,
  version     integer NOT NULL CONSTRAINT claim_version_version_check CHECK (version > 0),
  campaign_id uuid NOT NULL,
  subject_id  uuid NOT NULL,
  predicate   text NOT NULL,
  object      jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claim_version_pkey PRIMARY KEY (tenant_id, claim_id, version),
  CONSTRAINT claim_version_tenant_id_campaign_id_fkey FOREIGN KEY (tenant_id, campaign_id) REFERENCES public.campaign (tenant_id, id),
  CONSTRAINT claim_version_tenant_id_subject_id_fkey FOREIGN KEY (tenant_id, subject_id) REFERENCES public.entity (tenant_id, id)
) PARTITION BY HASH (tenant_id)`,
      'CREATE TABLE public.claim_version_p0 PARTITION OF public.claim_version FOR VALUES WITH (MODULUS 4, REMAINDER 0)',
      'CREATE TABLE public.claim_version_p1 PARTITION OF public.claim_version FOR VALUES WITH (MODULUS 4, REMAINDER 1)',
      'CREATE TABLE public.claim_version_p2 PARTITION OF public.claim_version FOR VALUES WITH (MODULUS 4, REMAINDER 2)',
      'CREATE TABLE public.claim_version_p3 PARTITION OF public.claim_version FOR VALUES WITH (MODULUS 4, REMAINDER 3)',
    ],
    exists("SELECT 1 FROM pg_class WHERE relname = 'claim_version' AND relkind = 'p'"),
  ),
  raw(
    'raw.claim_version.rls',
    'Enable row-level security and policy "tenant_isolation" on "claim_version"',
    [
      'ALTER TABLE public.claim_version ENABLE ROW LEVEL SECURITY',
      `CREATE POLICY tenant_isolation ON public.claim_version AS PERMISSIVE FOR ALL TO public USING (${TENANT_PREDICATE}) WITH CHECK (${TENANT_PREDICATE})`,
    ],
    exists("SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'claim_version' AND policyname = 'tenant_isolation'"),
  ),
  raw(
    'raw.claim_version.append_only',
    'Create append-only trigger on "claim_version"',
    [
      `CREATE FUNCTION public.claim_version_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'claim_version is append-only (% rejected)', TG_OP;
END $fn$`,
      `CREATE TRIGGER claim_version_append_only BEFORE UPDATE OR DELETE ON public.claim_version
  FOR EACH ROW EXECUTE FUNCTION public.claim_version_append_only()`,
    ],
    exists("SELECT 1 FROM pg_trigger WHERE tgname = 'claim_version_append_only' AND NOT tgisinternal AND tgparentid = 0"),
  ),
  raw(
    'raw.claim_current.sync',
    'Create trigger maintaining "claim_current" from "claim_version"',
    [
      `CREATE FUNCTION public.claim_current_sync() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO claim_current AS c (tenant_id, claim_id, version, campaign_id, subject_id, predicate, object)
  VALUES (NEW.tenant_id, NEW.claim_id, NEW.version, NEW.campaign_id, NEW.subject_id, NEW.predicate, NEW.object)
  ON CONFLICT (tenant_id, claim_id) DO UPDATE
    SET version = EXCLUDED.version, campaign_id = EXCLUDED.campaign_id, subject_id = EXCLUDED.subject_id,
        predicate = EXCLUDED.predicate, object = EXCLUDED.object
    WHERE c.version < EXCLUDED.version;
  RETURN NULL;
END $fn$`,
      `CREATE TRIGGER claim_current_sync AFTER INSERT ON public.claim_version
  FOR EACH ROW EXECUTE FUNCTION public.claim_current_sync()`,
    ],
    exists("SELECT 1 FROM pg_trigger WHERE tgname = 'claim_current_sync' AND NOT tgisinternal AND tgparentid = 0"),
  ),
  // halfvec is not a contract type (the pgvector pack only has vector), so the column and its
  // HNSW index with the halfvec_cosine_ops opclass are raw. The model is @@control(tolerated).
  raw(
    'raw.claim_embedding.embedding',
    'Add halfvec(768) column "embedding" and HNSW index to "claim_embedding"',
    [
      'ALTER TABLE public.claim_embedding ADD COLUMN embedding halfvec(768) NOT NULL',
      'CREATE INDEX claim_embedding_hnsw ON public.claim_embedding USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64)',
    ],
    exists("SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'claim_embedding_hnsw'"),
  ),
  // Grants: the contract has no privilege model.
  raw(
    'raw.grants.skal_app',
    'Grant DML to skal_app and revoke it on the claim_version partitions',
    [
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO skal_app',
      // RLS on a partitioned table applies only to queries through the parent.
      'REVOKE ALL ON public.claim_version_p0, public.claim_version_p1, public.claim_version_p2, public.claim_version_p3 FROM skal_app',
    ],
    exists(
      "SELECT 1 WHERE has_table_privilege('skal_app', 'public.claim_version', 'SELECT') AND NOT has_table_privilege('skal_app', 'public.claim_version_p0', 'SELECT')",
    ),
  ),
];

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createTable({
        schema: 'public',
        table: 'campaign',
        columns: [
          col('tenant_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', {
            notNull: true,
            default: fn('uuidv7()'),
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['tenant_id', 'id'], { name: 'campaign_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'claim_current',
        columns: [
          col('tenant_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('claim_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('version', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('campaign_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('subject_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('predicate', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('object', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
        ],
        constraints: [primaryKey(['tenant_id', 'claim_id'], { name: 'claim_current_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'claim_embedding',
        columns: [
          col('tenant_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('claim_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [primaryKey(['tenant_id', 'claim_id'], { name: 'claim_embedding_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'entity',
        columns: [
          col('tenant_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', {
            notNull: true,
            default: fn('uuidv7()'),
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('campaign_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('custom', 'jsonb', {
            notNull: true,
            default: lit({}),
            codecRef: { codecId: 'pg/jsonb@1' },
          }),
        ],
        constraints: [primaryKey(['tenant_id', 'id'], { name: 'entity_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'field_definition',
        columns: [
          col('tenant_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', {
            notNull: true,
            default: fn('uuidv7()'),
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('campaign_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('value_type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['tenant_id', 'id'], { name: 'field_definition_pkey' }),
          checkExpression(
            'field_definition_value_type_check',
            "(value_type = ANY (ARRAY['text'::text, 'number'::text, 'boolean'::text, 'date'::text]))",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'import_record',
        columns: [
          col('tenant_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('source', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('source_key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('entity_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('content_hash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('imported_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
        ],
        constraints: [
          primaryKey(['tenant_id', 'source', 'source_key'], { name: 'import_record_pkey' }),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'tenant',
        columns: [
          col('id', 'uuid', {
            notNull: true,
            default: fn('uuidv7()'),
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'tenant_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'transcript_segment',
        columns: [
          col('tenant_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', {
            notNull: true,
            default: fn('uuidv7()'),
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('campaign_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('session_no', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('start_ms', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('end_ms', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('speaker', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('text', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('word_timings', 'bytea', { notNull: true, codecRef: { codecId: 'pg/bytea@1' } }),
        ],
        constraints: [
          primaryKey(['tenant_id', 'id'], { name: 'transcript_segment_pkey' }),
          checkExpression('transcript_segment_check', '(end_ms >= start_ms)'),
        ],
      }),
      // FALLBACK: the contract has no NULLS NOT DISTINCT, so the generated addUnique is replaced.
      raw(
        'unique.field_definition.field_definition_tenant_id_campaign_id_key_key',
        'Add unique constraint (NULLS NOT DISTINCT) on "field_definition" (tenant_id, campaign_id, key)',
        [
          'ALTER TABLE public.field_definition ADD CONSTRAINT field_definition_tenant_id_campaign_id_key_key UNIQUE NULLS NOT DISTINCT (tenant_id, campaign_id, key)',
        ],
        exists("SELECT 1 FROM pg_constraint WHERE conname = 'field_definition_tenant_id_campaign_id_key_key'"),
      ),
      this.createIndex({
        schema: 'public',
        table: 'claim_current',
        index: 'claim_current_subject_idx',
        columns: ['tenant_id', 'subject_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'entity',
        index: 'entity_campaign_idx',
        columns: ['tenant_id', 'campaign_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'transcript_segment',
        index: 'transcript_segment_session_idx',
        columns: ['tenant_id', 'campaign_id', 'session_no', 'start_ms'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'campaign',
        foreignKey: {
          name: 'campaign_tenant_id_fkey',
          columns: ['tenant_id'],
          references: { schema: 'public', table: 'tenant', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'claim_current',
        foreignKey: {
          name: 'claim_current_tenant_id_campaign_id_fkey',
          columns: ['tenant_id', 'campaign_id'],
          references: { schema: 'public', table: 'campaign', columns: ['tenant_id', 'id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'claim_current',
        foreignKey: {
          name: 'claim_current_tenant_id_subject_id_fkey',
          columns: ['tenant_id', 'subject_id'],
          references: { schema: 'public', table: 'entity', columns: ['tenant_id', 'id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'claim_embedding',
        foreignKey: {
          name: 'claim_embedding_tenant_id_claim_id_fkey',
          columns: ['tenant_id', 'claim_id'],
          references: {
            schema: 'public',
            table: 'claim_current',
            columns: ['tenant_id', 'claim_id'],
          },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'entity',
        foreignKey: {
          name: 'entity_tenant_id_campaign_id_fkey',
          columns: ['tenant_id', 'campaign_id'],
          references: { schema: 'public', table: 'campaign', columns: ['tenant_id', 'id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'field_definition',
        foreignKey: {
          name: 'field_definition_tenant_id_campaign_id_fkey',
          columns: ['tenant_id', 'campaign_id'],
          references: { schema: 'public', table: 'campaign', columns: ['tenant_id', 'id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'field_definition',
        foreignKey: {
          name: 'field_definition_tenant_id_fkey',
          columns: ['tenant_id'],
          references: { schema: 'public', table: 'tenant', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'import_record',
        foreignKey: {
          name: 'import_record_tenant_id_entity_id_fkey',
          columns: ['tenant_id', 'entity_id'],
          references: { schema: 'public', table: 'entity', columns: ['tenant_id', 'id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'import_record',
        foreignKey: {
          name: 'import_record_tenant_id_fkey',
          columns: ['tenant_id'],
          references: { schema: 'public', table: 'tenant', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'transcript_segment',
        foreignKey: {
          name: 'transcript_segment_tenant_id_campaign_id_fkey',
          columns: ['tenant_id', 'campaign_id'],
          references: { schema: 'public', table: 'campaign', columns: ['tenant_id', 'id'] },
        },
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'campaign' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'claim_current' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'claim_embedding' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'entity' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'field_definition' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'import_record' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'tenant' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'transcript_segment' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'campaign',
        policy: {
          naming: { kind: 'exact', name: 'tenant_isolation' },
          tableName: 'campaign',
          namespaceId: 'public',
          operation: 'all',
          roles: ['public'],
          using:
            "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
          withCheck:
            "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'claim_current',
        policy: {
          naming: { kind: 'exact', name: 'tenant_isolation' },
          tableName: 'claim_current',
          namespaceId: 'public',
          operation: 'all',
          roles: ['public'],
          using:
            "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
          withCheck:
            "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'claim_embedding',
        policy: {
          naming: { kind: 'exact', name: 'tenant_isolation' },
          tableName: 'claim_embedding',
          namespaceId: 'public',
          operation: 'all',
          roles: ['public'],
          using:
            "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
          withCheck:
            "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'entity',
        policy: {
          naming: { kind: 'exact', name: 'tenant_isolation' },
          tableName: 'entity',
          namespaceId: 'public',
          operation: 'all',
          roles: ['public'],
          using:
            "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
          withCheck:
            "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'field_definition',
        policy: {
          naming: { kind: 'exact', name: 'tenant_isolation' },
          tableName: 'field_definition',
          namespaceId: 'public',
          operation: 'all',
          roles: ['public'],
          using:
            "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
          withCheck:
            "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'import_record',
        policy: {
          naming: { kind: 'exact', name: 'tenant_isolation' },
          tableName: 'import_record',
          namespaceId: 'public',
          operation: 'all',
          roles: ['public'],
          using:
            "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
          withCheck:
            "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'tenant',
        policy: {
          naming: { kind: 'exact', name: 'tenant_isolation' },
          tableName: 'tenant',
          namespaceId: 'public',
          operation: 'all',
          roles: ['public'],
          using: "(id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
          withCheck:
            "(id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'transcript_segment',
        policy: {
          naming: { kind: 'exact', name: 'tenant_isolation' },
          tableName: 'transcript_segment',
          namespaceId: 'public',
          operation: 'all',
          roles: ['public'],
          using:
            "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
          withCheck:
            "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
          permissive: true,
        },
      }),
      ...rawM1Ops,
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
