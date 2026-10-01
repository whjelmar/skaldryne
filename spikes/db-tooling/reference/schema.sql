-- Reference schema for the database tooling spike.
-- A stand-in, not the Skaldryne record model: it holds the Postgres features the real schema
-- will need, using the hardest variant of each open storage lever. Every arm must end up with an
-- equivalent database, expressed through its tool as far as the tool allows.
-- Applied by skal_migrator. Postgres 18 (uuidv7() is built in).

-- Extensions are created by a superuser bootstrap step before migrations run (pgvector is not a
-- trusted extension). Migrations only assert they exist.
CREATE EXTENSION IF NOT EXISTS vector;

-- Tenant registry (NFR-16).
CREATE TABLE tenant (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Tenant-first composite keys: every child key carries tenant_id, so a reference across
-- tenants cannot be written (MODEL-32).
CREATE TABLE campaign (
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  id        uuid NOT NULL DEFAULT uuidv7(),
  name      text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

-- Custom fields per tenant (campaign_id NULL) or per campaign (MODEL-33).
CREATE TABLE field_definition (
  tenant_id   uuid NOT NULL REFERENCES tenant (id),
  id          uuid NOT NULL DEFAULT uuidv7(),
  campaign_id uuid,
  key         text NOT NULL,
  value_type  text NOT NULL CHECK (value_type IN ('text', 'number', 'boolean', 'date')),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES campaign (tenant_id, id),
  UNIQUE NULLS NOT DISTINCT (tenant_id, campaign_id, key)
);

-- Ordinary relational table: the ORM's easy case, as a baseline.
CREATE TABLE entity (
  tenant_id   uuid NOT NULL,
  id          uuid NOT NULL DEFAULT uuidv7(),
  campaign_id uuid NOT NULL,
  kind        text NOT NULL,
  name        text NOT NULL,
  custom      jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES campaign (tenant_id, id)
);
CREATE INDEX entity_campaign_idx ON entity (tenant_id, campaign_id);

-- Append-only claim history, hash-partitioned by tenant (lever 5).
CREATE TABLE claim_version (
  tenant_id   uuid NOT NULL,
  claim_id    uuid NOT NULL,
  version     integer NOT NULL CHECK (version > 0),
  campaign_id uuid NOT NULL,
  subject_id  uuid NOT NULL,
  predicate   text NOT NULL,
  object      jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, claim_id, version),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES campaign (tenant_id, id),
  FOREIGN KEY (tenant_id, subject_id) REFERENCES entity (tenant_id, id)
) PARTITION BY HASH (tenant_id);
CREATE TABLE claim_version_p0 PARTITION OF claim_version FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE claim_version_p1 PARTITION OF claim_version FOR VALUES WITH (MODULUS 4, REMAINDER 1);
CREATE TABLE claim_version_p2 PARTITION OF claim_version FOR VALUES WITH (MODULUS 4, REMAINDER 2);
CREATE TABLE claim_version_p3 PARTITION OF claim_version FOR VALUES WITH (MODULUS 4, REMAINDER 3);

CREATE FUNCTION claim_version_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'claim_version is append-only (% rejected)', TG_OP;
END $$;
CREATE TRIGGER claim_version_append_only
  BEFORE UPDATE OR DELETE ON claim_version
  FOR EACH ROW EXECUTE FUNCTION claim_version_append_only();

-- Current state, maintained by trigger from claim_version (lever 2, hardest variant).
CREATE TABLE claim_current (
  tenant_id   uuid NOT NULL,
  claim_id    uuid NOT NULL,
  version     integer NOT NULL,
  campaign_id uuid NOT NULL,
  subject_id  uuid NOT NULL,
  predicate   text NOT NULL,
  object      jsonb NOT NULL,
  PRIMARY KEY (tenant_id, claim_id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES campaign (tenant_id, id),
  FOREIGN KEY (tenant_id, subject_id) REFERENCES entity (tenant_id, id)
);
CREATE INDEX claim_current_subject_idx ON claim_current (tenant_id, subject_id);

CREATE FUNCTION claim_current_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO claim_current AS c (tenant_id, claim_id, version, campaign_id, subject_id, predicate, object)
  VALUES (NEW.tenant_id, NEW.claim_id, NEW.version, NEW.campaign_id, NEW.subject_id, NEW.predicate, NEW.object)
  ON CONFLICT (tenant_id, claim_id) DO UPDATE
    SET version = EXCLUDED.version, campaign_id = EXCLUDED.campaign_id, subject_id = EXCLUDED.subject_id,
        predicate = EXCLUDED.predicate, object = EXCLUDED.object
    WHERE c.version < EXCLUDED.version;
  RETURN NULL;
END $$;
CREATE TRIGGER claim_current_sync
  AFTER INSERT ON claim_version
  FOR EACH ROW EXECUTE FUNCTION claim_current_sync();

-- Half-precision embeddings of current claims only, HNSW index (lever 4).
CREATE TABLE claim_embedding (
  tenant_id uuid NOT NULL,
  claim_id  uuid NOT NULL,
  embedding halfvec(768) NOT NULL,
  PRIMARY KEY (tenant_id, claim_id),
  FOREIGN KEY (tenant_id, claim_id) REFERENCES claim_current (tenant_id, claim_id) ON DELETE CASCADE
);
CREATE INDEX claim_embedding_hnsw ON claim_embedding
  USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);

-- Transcript segments with packed word timings (lever 3).
CREATE TABLE transcript_segment (
  tenant_id    uuid NOT NULL,
  id           uuid NOT NULL DEFAULT uuidv7(),
  campaign_id  uuid NOT NULL,
  session_no   integer NOT NULL,
  start_ms     integer NOT NULL,
  end_ms       integer NOT NULL CHECK (end_ms >= start_ms),
  speaker      text,
  text         text NOT NULL,
  word_timings bytea NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES campaign (tenant_id, id)
);
CREATE INDEX transcript_segment_session_idx ON transcript_segment (tenant_id, campaign_id, session_no, start_ms);

-- Imports that are safe to repeat (NFR-25).
CREATE TABLE import_record (
  tenant_id    uuid NOT NULL REFERENCES tenant (id),
  source       text NOT NULL,
  source_key   text NOT NULL,
  entity_id    uuid NOT NULL,
  content_hash text NOT NULL,
  imported_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, source, source_key),
  FOREIGN KEY (tenant_id, entity_id) REFERENCES entity (tenant_id, id)
);

-- Row-level security. The application role sets app.tenant_id per transaction with
-- set_config('app.tenant_id', $1, true); with no setting, nothing is visible.
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant
  USING (id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE campaign ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON campaign
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE field_definition ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON field_definition
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE entity ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON entity
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE claim_version ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON claim_version
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE claim_current ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON claim_current
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE claim_embedding ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON claim_embedding
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE transcript_segment ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transcript_segment
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE import_record ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON import_record
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO skal_app;
