-- pgTAP: row-level security is enabled, with the tenant_isolation policy, on every tenant table.
-- "Tenant table" = every ordinary or partitioned table in public with a tenant_id column, plus tenant.
-- Partitions: RLS applies only through the partitioned parent, so a partition queried directly has
-- no policy. M1 (like reference/schema.sql) revokes skal_app on every partition; checked below.
BEGIN;
SET LOCAL search_path = public, tap;

CREATE TEMP TABLE tenant_tables AS
SELECT c.relname::text AS t
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace
   AND c.relkind IN ('r', 'p')
   AND NOT c.relispartition
   AND (c.relname = 'tenant'
        OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped));

CREATE TEMP TABLE partitions AS
SELECT c.relname::text AS t
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relispartition AND c.relkind = 'r';

SELECT plan(1 + 3 * (SELECT count(*)::int FROM tenant_tables) + (SELECT count(*)::int FROM partitions));

SELECT set_eq(
  'SELECT t FROM tenant_tables',
  ARRAY['tenant', 'campaign', 'field_definition', 'entity', 'claim_version', 'claim_current',
        'claim_embedding', 'transcript_segment', 'import_record'],
  'the expected nine tenant tables exist');

SELECT ok(c.relrowsecurity, format('RLS enabled on %I', t))
  FROM tenant_tables JOIN pg_class c ON c.relname = t AND c.relnamespace = 'public'::regnamespace
 ORDER BY t;

SELECT policies_are('public', t, ARRAY['tenant_isolation'], format('%I has exactly the tenant_isolation policy', t))
  FROM tenant_tables ORDER BY t;

SELECT ok(
         p.cmd = 'ALL'
         AND p.qual LIKE '%current_setting(''app.tenant_id''::text, true)%'
         AND p.with_check LIKE '%current_setting(''app.tenant_id''::text, true)%',
         format('%I policy covers all commands and keys on app.tenant_id', t))
  FROM tenant_tables
  LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = t AND p.policyname = 'tenant_isolation'
 ORDER BY t;

SELECT table_privs_are('public', t, 'skal_app', ARRAY[]::text[], format('skal_app has no privileges on partition %I', t))
  FROM partitions ORDER BY t;

SELECT * FROM finish(true);
ROLLBACK;
