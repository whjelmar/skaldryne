-- M4 for experiment 1: the objects the four hard queries need. Applied by skal_migrator after M1–M3.
-- Canonical SQL; every arm queries a database built from M1–M4, whatever its own tool would generate.

-- Full-text search with a dictionary per row (the campaign's language), generated and indexed.
ALTER TABLE transcript_segment ADD COLUMN ts_config regconfig NOT NULL DEFAULT 'english';
ALTER TABLE transcript_segment
  ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector(ts_config, text)) STORED;
CREATE INDEX transcript_segment_tsv_idx ON transcript_segment USING gin (tsv);

-- Embeddings of transcript segments, so full-text and vector search rank the same rows.
CREATE TABLE segment_embedding (
  tenant_id  uuid NOT NULL,
  segment_id uuid NOT NULL,
  embedding  halfvec(768) NOT NULL,
  PRIMARY KEY (tenant_id, segment_id),
  FOREIGN KEY (tenant_id, segment_id) REFERENCES transcript_segment (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX segment_embedding_hnsw ON segment_embedding
  USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);

-- Relationships are claims whose value is another entity: object = {"entity": "<uuid>"}.
CREATE INDEX claim_current_object_entity_idx ON claim_current (tenant_id, (object ->> 'entity'))
  WHERE object ? 'entity';

-- Durable pipeline jobs, claimed with FOR UPDATE SKIP LOCKED.
CREATE TABLE job (
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  id        uuid NOT NULL DEFAULT uuidv7(),
  kind      text NOT NULL,
  payload   jsonb NOT NULL DEFAULT '{}'::jsonb,
  state     text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'done', 'failed')),
  run_after timestamptz NOT NULL DEFAULT now(),
  attempts  integer NOT NULL DEFAULT 0,
  locked_by text,
  locked_at timestamptz,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX job_ready_idx ON job (state, run_after) WHERE state = 'queued';

ALTER TABLE segment_embedding ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON segment_embedding
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE job ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON job
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON segment_embedding, job TO skal_app;
