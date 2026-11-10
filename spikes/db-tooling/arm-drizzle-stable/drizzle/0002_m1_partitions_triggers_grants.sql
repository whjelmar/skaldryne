-- Custom migration (drizzle-kit generate --custom): what the Drizzle schema cannot express.
-- Partitions of claim_version (the parent is created PARTITION BY HASH in m1_schema, hand-edited).
CREATE TABLE claim_version_p0 PARTITION OF claim_version FOR VALUES WITH (MODULUS 4, REMAINDER 0);
--> statement-breakpoint
CREATE TABLE claim_version_p1 PARTITION OF claim_version FOR VALUES WITH (MODULUS 4, REMAINDER 1);
--> statement-breakpoint
CREATE TABLE claim_version_p2 PARTITION OF claim_version FOR VALUES WITH (MODULUS 4, REMAINDER 2);
--> statement-breakpoint
CREATE TABLE claim_version_p3 PARTITION OF claim_version FOR VALUES WITH (MODULUS 4, REMAINDER 3);
--> statement-breakpoint

-- Trigger functions and triggers.
CREATE FUNCTION claim_version_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'claim_version is append-only (% rejected)', TG_OP;
END $$;
--> statement-breakpoint
CREATE TRIGGER claim_version_append_only
  BEFORE UPDATE OR DELETE ON claim_version
  FOR EACH ROW EXECUTE FUNCTION claim_version_append_only();
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TRIGGER claim_current_sync
  AFTER INSERT ON claim_version
  FOR EACH ROW EXECUTE FUNCTION claim_current_sync();
--> statement-breakpoint

-- Grants. Drizzle has no grant syntax.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO skal_app;
--> statement-breakpoint
-- RLS on the partitioned parent does not cover direct access to its partitions, which have no policy.
-- Drizzle has no grant/revoke syntax, and partitions are not in the schema at all.
REVOKE ALL ON claim_version_p0, claim_version_p1, claim_version_p2, claim_version_p3 FROM skal_app;
