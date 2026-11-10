-- Custom migration (drizzle-kit generate --custom). pgvector is not a trusted extension, so the bootstrap
-- script creates it as postgres; this migration only asserts that it exists.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RAISE EXCEPTION 'extension "vector" is missing: run the bootstrap script as a superuser first';
  END IF;
END $$;
