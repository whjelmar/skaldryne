CREATE TABLE "campaign" (
	"tenant_id" uuid,
	"id" uuid DEFAULT uuidv7(),
	"name" text NOT NULL,
	CONSTRAINT "campaign_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "campaign" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "claim_current" (
	"tenant_id" uuid,
	"claim_id" uuid,
	"version" integer NOT NULL,
	"campaign_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"predicate" text NOT NULL,
	"object" jsonb NOT NULL,
	CONSTRAINT "claim_current_pkey" PRIMARY KEY("tenant_id","claim_id")
);
--> statement-breakpoint
ALTER TABLE "claim_current" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "claim_embedding" (
	"tenant_id" uuid,
	"claim_id" uuid,
	"embedding" halfvec(768) NOT NULL,
	CONSTRAINT "claim_embedding_pkey" PRIMARY KEY("tenant_id","claim_id")
);
--> statement-breakpoint
ALTER TABLE "claim_embedding" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "claim_version" (
	"tenant_id" uuid,
	"claim_id" uuid,
	"version" integer,
	"campaign_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"predicate" text NOT NULL,
	"object" jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_version_pkey" PRIMARY KEY("tenant_id","claim_id","version"),
	CONSTRAINT "claim_version_version_check" CHECK (version > 0)
) PARTITION BY HASH ("tenant_id"); -- HAND-EDITED: drizzle-kit has no partitioning syntax; partitions are in m1_partitions_triggers_grants
--> statement-breakpoint
ALTER TABLE "claim_version" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "entity" (
	"tenant_id" uuid,
	"id" uuid DEFAULT uuidv7(),
	"campaign_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"custom" jsonb DEFAULT '{}' NOT NULL,
	CONSTRAINT "entity_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "entity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "field_definition" (
	"tenant_id" uuid,
	"id" uuid DEFAULT uuidv7(),
	"campaign_id" uuid,
	"key" text NOT NULL,
	"value_type" text NOT NULL,
	CONSTRAINT "field_definition_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "field_definition_tenant_id_campaign_id_key_key" UNIQUE NULLS NOT DISTINCT("tenant_id","campaign_id","key"),
	CONSTRAINT "field_definition_value_type_check" CHECK (value_type IN ('text', 'number', 'boolean', 'date'))
);
--> statement-breakpoint
ALTER TABLE "field_definition" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_record" (
	"tenant_id" uuid,
	"source" text,
	"source_key" text,
	"entity_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_record_pkey" PRIMARY KEY("tenant_id","source","source_key")
);
--> statement-breakpoint
ALTER TABLE "import_record" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "transcript_segment" (
	"tenant_id" uuid,
	"id" uuid DEFAULT uuidv7(),
	"campaign_id" uuid NOT NULL,
	"session_no" integer NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"speaker" text,
	"text" text NOT NULL,
	"word_timings" bytea NOT NULL,
	CONSTRAINT "transcript_segment_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "transcript_segment_check" CHECK (end_ms >= start_ms)
);
--> statement-breakpoint
ALTER TABLE "transcript_segment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "claim_current_subject_idx" ON "claim_current" ("tenant_id","subject_id");--> statement-breakpoint
CREATE INDEX "claim_embedding_hnsw" ON "claim_embedding" USING hnsw ("embedding" halfvec_cosine_ops) WITH (m=16, ef_construction=64);--> statement-breakpoint
CREATE INDEX "entity_campaign_idx" ON "entity" ("tenant_id","campaign_id");--> statement-breakpoint
CREATE INDEX "transcript_segment_session_idx" ON "transcript_segment" ("tenant_id","campaign_id","session_no","start_ms");--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id");--> statement-breakpoint
ALTER TABLE "claim_current" ADD CONSTRAINT "claim_current_tenant_id_campaign_id_fkey" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "campaign"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "claim_current" ADD CONSTRAINT "claim_current_tenant_id_subject_id_fkey" FOREIGN KEY ("tenant_id","subject_id") REFERENCES "entity"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "claim_embedding" ADD CONSTRAINT "claim_embedding_tenant_id_claim_id_fkey" FOREIGN KEY ("tenant_id","claim_id") REFERENCES "claim_current"("tenant_id","claim_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "claim_version" ADD CONSTRAINT "claim_version_tenant_id_campaign_id_fkey" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "campaign"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "claim_version" ADD CONSTRAINT "claim_version_tenant_id_subject_id_fkey" FOREIGN KEY ("tenant_id","subject_id") REFERENCES "entity"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "entity" ADD CONSTRAINT "entity_tenant_id_campaign_id_fkey" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "campaign"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "field_definition" ADD CONSTRAINT "field_definition_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id");--> statement-breakpoint
ALTER TABLE "field_definition" ADD CONSTRAINT "field_definition_tenant_id_campaign_id_fkey" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "campaign"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "import_record" ADD CONSTRAINT "import_record_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id");--> statement-breakpoint
ALTER TABLE "import_record" ADD CONSTRAINT "import_record_tenant_id_entity_id_fkey" FOREIGN KEY ("tenant_id","entity_id") REFERENCES "entity"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "transcript_segment" ADD CONSTRAINT "transcript_segment_tenant_id_campaign_id_fkey" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "campaign"("tenant_id","id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "campaign" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "claim_current" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "claim_embedding" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "claim_version" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "entity" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "field_definition" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "import_record" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant" AS PERMISSIVE FOR ALL TO public USING (id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "transcript_segment" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);