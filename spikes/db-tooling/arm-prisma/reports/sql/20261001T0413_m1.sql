-- Extracted from migrations/app/20261001T0413_m1/ops.json by scripts/extract-sql.ts

-- schema.public: Create schema "public"
CREATE SCHEMA IF NOT EXISTS "public";

-- table.campaign: create table "campaign"
CREATE TABLE "public"."campaign" (
  "tenant_id" uuid NOT NULL,
  "id" uuid DEFAULT (uuidv7()) NOT NULL,
  "name" text NOT NULL,
  CONSTRAINT "campaign_pkey" PRIMARY KEY ("tenant_id", "id")
);

-- table.claim_current: create table "claim_current"
CREATE TABLE "public"."claim_current" (
  "tenant_id" uuid NOT NULL,
  "claim_id" uuid NOT NULL,
  "version" int4 NOT NULL,
  "campaign_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "predicate" text NOT NULL,
  "object" jsonb NOT NULL,
  CONSTRAINT "claim_current_pkey" PRIMARY KEY ("tenant_id", "claim_id")
);

-- table.claim_embedding: create table "claim_embedding"
CREATE TABLE "public"."claim_embedding" (
  "tenant_id" uuid NOT NULL,
  "claim_id" uuid NOT NULL,
  CONSTRAINT "claim_embedding_pkey" PRIMARY KEY ("tenant_id", "claim_id")
);

-- table.entity: create table "entity"
CREATE TABLE "public"."entity" (
  "tenant_id" uuid NOT NULL,
  "id" uuid DEFAULT (uuidv7()) NOT NULL,
  "campaign_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT "entity_pkey" PRIMARY KEY ("tenant_id", "id")
);

-- table.field_definition: create table "field_definition"
CREATE TABLE "public"."field_definition" (
  "tenant_id" uuid NOT NULL,
  "id" uuid DEFAULT (uuidv7()) NOT NULL,
  "campaign_id" uuid,
  "key" text NOT NULL,
  "value_type" text NOT NULL,
  CONSTRAINT "field_definition_pkey" PRIMARY KEY ("tenant_id", "id"),
  CONSTRAINT "field_definition_value_type_check" CHECK ((value_type = ANY (ARRAY['text'::text, 'number'::text, 'boolean'::text, 'date'::text])))
);

-- table.import_record: create table "import_record"
CREATE TABLE "public"."import_record" (
  "tenant_id" uuid NOT NULL,
  "source" text NOT NULL,
  "source_key" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "content_hash" text NOT NULL,
  "imported_at" timestamptz DEFAULT (now()) NOT NULL,
  CONSTRAINT "import_record_pkey" PRIMARY KEY ("tenant_id", "source", "source_key")
);

-- table.tenant: create table "tenant"
CREATE TABLE "public"."tenant" (
  "id" uuid DEFAULT (uuidv7()) NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamptz DEFAULT (now()) NOT NULL,
  CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- table.transcript_segment: create table "transcript_segment"
CREATE TABLE "public"."transcript_segment" (
  "tenant_id" uuid NOT NULL,
  "id" uuid DEFAULT (uuidv7()) NOT NULL,
  "campaign_id" uuid NOT NULL,
  "session_no" int4 NOT NULL,
  "start_ms" int4 NOT NULL,
  "end_ms" int4 NOT NULL,
  "speaker" text,
  "text" text NOT NULL,
  "word_timings" bytea NOT NULL,
  CONSTRAINT "transcript_segment_pkey" PRIMARY KEY ("tenant_id", "id"),
  CONSTRAINT "transcript_segment_check" CHECK ((end_ms >= start_ms))
);

-- unique.field_definition.field_definition_tenant_id_campaign_id_key_key: Add unique constraint (NULLS NOT DISTINCT) on "field_definition" (tenant_id, campaign_id, key) (1/1)
ALTER TABLE public.field_definition ADD CONSTRAINT field_definition_tenant_id_campaign_id_key_key UNIQUE NULLS NOT DISTINCT (tenant_id, campaign_id, key);

-- index.claim_current.claim_current_subject_idx: create index "claim_current_subject_idx"
CREATE INDEX "claim_current_subject_idx" ON "public"."claim_current" ("tenant_id", "subject_id");

-- index.entity.entity_campaign_idx: create index "entity_campaign_idx"
CREATE INDEX "entity_campaign_idx" ON "public"."entity" ("tenant_id", "campaign_id");

-- index.transcript_segment.transcript_segment_session_idx: create index "transcript_segment_session_idx"
CREATE INDEX "transcript_segment_session_idx" ON "public"."transcript_segment" ("tenant_id", "campaign_id", "session_no", "start_ms");

-- foreignKey.campaign.campaign_tenant_id_fkey: add FK "campaign_tenant_id_fkey"
ALTER TABLE "public"."campaign"
ADD CONSTRAINT "campaign_tenant_id_fkey"
FOREIGN KEY ("tenant_id")
REFERENCES "public"."tenant" ("id");

-- foreignKey.claim_current.claim_current_tenant_id_campaign_id_fkey: add FK "claim_current_tenant_id_campaign_id_fkey"
ALTER TABLE "public"."claim_current"
ADD CONSTRAINT "claim_current_tenant_id_campaign_id_fkey"
FOREIGN KEY ("tenant_id", "campaign_id")
REFERENCES "public"."campaign" ("tenant_id", "id");

-- foreignKey.claim_current.claim_current_tenant_id_subject_id_fkey: add FK "claim_current_tenant_id_subject_id_fkey"
ALTER TABLE "public"."claim_current"
ADD CONSTRAINT "claim_current_tenant_id_subject_id_fkey"
FOREIGN KEY ("tenant_id", "subject_id")
REFERENCES "public"."entity" ("tenant_id", "id");

-- foreignKey.claim_embedding.claim_embedding_tenant_id_claim_id_fkey: add FK "claim_embedding_tenant_id_claim_id_fkey"
ALTER TABLE "public"."claim_embedding"
ADD CONSTRAINT "claim_embedding_tenant_id_claim_id_fkey"
FOREIGN KEY ("tenant_id", "claim_id")
REFERENCES "public"."claim_current" ("tenant_id", "claim_id")
ON DELETE CASCADE;

-- foreignKey.entity.entity_tenant_id_campaign_id_fkey: add FK "entity_tenant_id_campaign_id_fkey"
ALTER TABLE "public"."entity"
ADD CONSTRAINT "entity_tenant_id_campaign_id_fkey"
FOREIGN KEY ("tenant_id", "campaign_id")
REFERENCES "public"."campaign" ("tenant_id", "id");

-- foreignKey.field_definition.field_definition_tenant_id_campaign_id_fkey: add FK "field_definition_tenant_id_campaign_id_fkey"
ALTER TABLE "public"."field_definition"
ADD CONSTRAINT "field_definition_tenant_id_campaign_id_fkey"
FOREIGN KEY ("tenant_id", "campaign_id")
REFERENCES "public"."campaign" ("tenant_id", "id");

-- foreignKey.field_definition.field_definition_tenant_id_fkey: add FK "field_definition_tenant_id_fkey"
ALTER TABLE "public"."field_definition"
ADD CONSTRAINT "field_definition_tenant_id_fkey"
FOREIGN KEY ("tenant_id")
REFERENCES "public"."tenant" ("id");

-- foreignKey.import_record.import_record_tenant_id_entity_id_fkey: add FK "import_record_tenant_id_entity_id_fkey"
ALTER TABLE "public"."import_record"
ADD CONSTRAINT "import_record_tenant_id_entity_id_fkey"
FOREIGN KEY ("tenant_id", "entity_id")
REFERENCES "public"."entity" ("tenant_id", "id");

-- foreignKey.import_record.import_record_tenant_id_fkey: add FK "import_record_tenant_id_fkey"
ALTER TABLE "public"."import_record"
ADD CONSTRAINT "import_record_tenant_id_fkey"
FOREIGN KEY ("tenant_id")
REFERENCES "public"."tenant" ("id");

-- foreignKey.transcript_segment.transcript_segment_tenant_id_campaign_id_fkey: add FK "transcript_segment_tenant_id_campaign_id_fkey"
ALTER TABLE "public"."transcript_segment"
ADD CONSTRAINT "transcript_segment_tenant_id_campaign_id_fkey"
FOREIGN KEY ("tenant_id", "campaign_id")
REFERENCES "public"."campaign" ("tenant_id", "id");

-- rowLevelSecurity.public.campaign: enable row-level security on "campaign"
ALTER TABLE "public"."campaign" ENABLE ROW LEVEL SECURITY;

-- rowLevelSecurity.public.claim_current: enable row-level security on "claim_current"
ALTER TABLE "public"."claim_current" ENABLE ROW LEVEL SECURITY;

-- rowLevelSecurity.public.claim_embedding: enable row-level security on "claim_embedding"
ALTER TABLE "public"."claim_embedding" ENABLE ROW LEVEL SECURITY;

-- rowLevelSecurity.public.entity: enable row-level security on "entity"
ALTER TABLE "public"."entity" ENABLE ROW LEVEL SECURITY;

-- rowLevelSecurity.public.field_definition: enable row-level security on "field_definition"
ALTER TABLE "public"."field_definition" ENABLE ROW LEVEL SECURITY;

-- rowLevelSecurity.public.import_record: enable row-level security on "import_record"
ALTER TABLE "public"."import_record" ENABLE ROW LEVEL SECURITY;

-- rowLevelSecurity.public.tenant: enable row-level security on "tenant"
ALTER TABLE "public"."tenant" ENABLE ROW LEVEL SECURITY;

-- rowLevelSecurity.public.transcript_segment: enable row-level security on "transcript_segment"
ALTER TABLE "public"."transcript_segment" ENABLE ROW LEVEL SECURITY;

-- rlsPolicy.public.campaign.tenant_isolation: create RLS policy "tenant_isolation"
CREATE POLICY "tenant_isolation" ON "public"."campaign" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));

-- rlsPolicy.public.claim_current.tenant_isolation: create RLS policy "tenant_isolation"
CREATE POLICY "tenant_isolation" ON "public"."claim_current" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));

-- rlsPolicy.public.claim_embedding.tenant_isolation: create RLS policy "tenant_isolation"
CREATE POLICY "tenant_isolation" ON "public"."claim_embedding" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));

-- rlsPolicy.public.entity.tenant_isolation: create RLS policy "tenant_isolation"
CREATE POLICY "tenant_isolation" ON "public"."entity" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));

-- rlsPolicy.public.field_definition.tenant_isolation: create RLS policy "tenant_isolation"
CREATE POLICY "tenant_isolation" ON "public"."field_definition" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));

-- rlsPolicy.public.import_record.tenant_isolation: create RLS policy "tenant_isolation"
CREATE POLICY "tenant_isolation" ON "public"."import_record" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));

-- rlsPolicy.public.tenant.tenant_isolation: create RLS policy "tenant_isolation"
CREATE POLICY "tenant_isolation" ON "public"."tenant" AS PERMISSIVE FOR ALL TO public USING ((id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));

-- rlsPolicy.public.transcript_segment.tenant_isolation: create RLS policy "tenant_isolation"
CREATE POLICY "tenant_isolation" ON "public"."transcript_segment" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));

-- raw.claim_version.table: Create hash-partitioned table "claim_version" and its four partitions (1/5)
CREATE TABLE public.claim_version (
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
) PARTITION BY HASH (tenant_id);

-- raw.claim_version.table: Create hash-partitioned table "claim_version" and its four partitions (2/5)
CREATE TABLE public.claim_version_p0 PARTITION OF public.claim_version FOR VALUES WITH (MODULUS 4, REMAINDER 0);

-- raw.claim_version.table: Create hash-partitioned table "claim_version" and its four partitions (3/5)
CREATE TABLE public.claim_version_p1 PARTITION OF public.claim_version FOR VALUES WITH (MODULUS 4, REMAINDER 1);

-- raw.claim_version.table: Create hash-partitioned table "claim_version" and its four partitions (4/5)
CREATE TABLE public.claim_version_p2 PARTITION OF public.claim_version FOR VALUES WITH (MODULUS 4, REMAINDER 2);

-- raw.claim_version.table: Create hash-partitioned table "claim_version" and its four partitions (5/5)
CREATE TABLE public.claim_version_p3 PARTITION OF public.claim_version FOR VALUES WITH (MODULUS 4, REMAINDER 3);

-- raw.claim_version.rls: Enable row-level security and policy "tenant_isolation" on "claim_version" (1/2)
ALTER TABLE public.claim_version ENABLE ROW LEVEL SECURITY;

-- raw.claim_version.rls: Enable row-level security and policy "tenant_isolation" on "claim_version" (2/2)
CREATE POLICY tenant_isolation ON public.claim_version AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));

-- raw.claim_version.append_only: Create append-only trigger on "claim_version" (1/2)
CREATE FUNCTION public.claim_version_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'claim_version is append-only (% rejected)', TG_OP;
END $fn$;

-- raw.claim_version.append_only: Create append-only trigger on "claim_version" (2/2)
CREATE TRIGGER claim_version_append_only BEFORE UPDATE OR DELETE ON public.claim_version
  FOR EACH ROW EXECUTE FUNCTION public.claim_version_append_only();

-- raw.claim_current.sync: Create trigger maintaining "claim_current" from "claim_version" (1/2)
CREATE FUNCTION public.claim_current_sync() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO claim_current AS c (tenant_id, claim_id, version, campaign_id, subject_id, predicate, object)
  VALUES (NEW.tenant_id, NEW.claim_id, NEW.version, NEW.campaign_id, NEW.subject_id, NEW.predicate, NEW.object)
  ON CONFLICT (tenant_id, claim_id) DO UPDATE
    SET version = EXCLUDED.version, campaign_id = EXCLUDED.campaign_id, subject_id = EXCLUDED.subject_id,
        predicate = EXCLUDED.predicate, object = EXCLUDED.object
    WHERE c.version < EXCLUDED.version;
  RETURN NULL;
END $fn$;

-- raw.claim_current.sync: Create trigger maintaining "claim_current" from "claim_version" (2/2)
CREATE TRIGGER claim_current_sync AFTER INSERT ON public.claim_version
  FOR EACH ROW EXECUTE FUNCTION public.claim_current_sync();

-- raw.claim_embedding.embedding: Add halfvec(768) column "embedding" and HNSW index to "claim_embedding" (1/2)
ALTER TABLE public.claim_embedding ADD COLUMN embedding halfvec(768) NOT NULL;

-- raw.claim_embedding.embedding: Add halfvec(768) column "embedding" and HNSW index to "claim_embedding" (2/2)
CREATE INDEX claim_embedding_hnsw ON public.claim_embedding USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);

-- raw.grants.skal_app: Grant DML to skal_app and revoke it on the claim_version partitions (1/2)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO skal_app;

-- raw.grants.skal_app: Grant DML to skal_app and revoke it on the claim_version partitions (2/2)
REVOKE ALL ON public.claim_version_p0, public.claim_version_p1, public.claim_version_p2, public.claim_version_p3 FROM skal_app;
