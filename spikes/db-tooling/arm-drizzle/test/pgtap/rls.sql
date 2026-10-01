-- T8b: RLS is enabled, with the expected tenant_isolation policy, on every tenant table.
-- Run inside the container: docker exec -i db-tooling-db-1 psql -U skal_migrator -d drizzle_app < test/pgtap/rls.sql
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
SET search_path = public, tap;
BEGIN;
SELECT plan(9 * 6 + 1);

CREATE TEMP TABLE tenant_tables (name text, match text);
INSERT INTO tenant_tables VALUES
  ('tenant', 'id'),
  ('campaign', 'tenant_id'),
  ('field_definition', 'tenant_id'),
  ('entity', 'tenant_id'),
  ('claim_version', 'tenant_id'),
  ('claim_current', 'tenant_id'),
  ('claim_embedding', 'tenant_id'),
  ('transcript_segment', 'tenant_id'),
  ('import_record', 'tenant_id');

-- Every table in public with a tenant_id column (other than partitions) is in the list above.
SELECT set_eq(
  $$SELECT c.relname::text FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND a.attname = 'tenant_id'
    UNION SELECT 'tenant'$$,
  $$SELECT name FROM tenant_tables$$,
  'every tenant table is covered'
);

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || name)::regclass), name || ': RLS enabled')
  FROM tenant_tables ORDER BY name;
SELECT policies_are('public', name, ARRAY['tenant_isolation'], name || ': only tenant_isolation')
  FROM tenant_tables ORDER BY name;
SELECT policy_cmd_is('public', name, 'tenant_isolation', 'all', name || ': policy applies to ALL')
  FROM tenant_tables ORDER BY name;
-- policy_roles_are() does not recognise PUBLIC (stored as role oid 0), so compare the catalog directly.
SELECT is(
  (SELECT polroles FROM pg_policy WHERE polrelid = ('public.' || name)::regclass AND polname = 'tenant_isolation'),
  ARRAY[0]::oid[],
  name || ': policy is for PUBLIC'
) FROM tenant_tables ORDER BY name;
SELECT is(
  (SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polrelid = ('public.' || name)::regclass),
  format('(%s = (NULLIF(current_setting(''app.tenant_id''::text, true), ''''::text))::uuid)', match),
  name || ': USING matches the session tenant'
) FROM tenant_tables ORDER BY name;
SELECT is(
  (SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy WHERE polrelid = ('public.' || name)::regclass),
  format('(%s = (NULLIF(current_setting(''app.tenant_id''::text, true), ''''::text))::uuid)', match),
  name || ': WITH CHECK matches the session tenant'
) FROM tenant_tables ORDER BY name;

SELECT * FROM finish();
ROLLBACK;
