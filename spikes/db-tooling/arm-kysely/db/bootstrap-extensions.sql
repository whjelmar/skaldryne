-- Run as the superuser (postgres) in a freshly created kysely_* database.
-- pgvector is not a trusted extension, so migrations cannot create it; they only assert it exists.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS tap;
CREATE EXTENSION IF NOT EXISTS pgtap SCHEMA tap;
-- Lets the migrator role run the pgTAP checks (T8b); pgTAP functions live in schema tap.
GRANT USAGE ON SCHEMA tap TO skal_migrator;
