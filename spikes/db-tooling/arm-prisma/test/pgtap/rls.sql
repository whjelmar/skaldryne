-- T8b: RLS is enabled on every tenant table and each carries the tenant_isolation policy.
-- Run as postgres: psql -v ON_ERROR_STOP=1 -At -f test/pgtap/rls.sql (the test functions are created
-- inside a transaction that is rolled back, so nothing is left behind).
BEGIN;
SET LOCAL search_path = public, tap;
CREATE SCHEMA rls_tests;

CREATE FUNCTION rls_tests.tenant_tables() RETURNS SETOF name LANGUAGE sql AS $$
  VALUES ('tenant'::name), ('campaign'), ('field_definition'), ('entity'), ('claim_version'),
         ('claim_current'), ('claim_embedding'), ('transcript_segment'), ('import_record')
$$;

CREATE FUNCTION rls_tests.test_01_every_table_is_a_tenant_table() RETURNS SETOF text LANGUAGE plpgsql AS $$
BEGIN
  -- Every ordinary or partitioned table in public that is not itself a partition.
  RETURN NEXT set_eq(
    $q$SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition$q$,
    $q$SELECT * FROM rls_tests.tenant_tables()$q$,
    'the tenant tables are exactly the tables in public');
END $$;

CREATE FUNCTION rls_tests.test_02_rls_enabled() RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE t name;
BEGIN
  FOR t IN SELECT * FROM rls_tests.tenant_tables() LOOP
    RETURN NEXT ok(
      (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = t),
      format('row level security is enabled on %s', t));
  END LOOP;
END $$;

CREATE FUNCTION rls_tests.test_03_policy() RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE
  t name;
  col text;
  expected text;
BEGIN
  FOR t IN SELECT * FROM rls_tests.tenant_tables() LOOP
    col := CASE WHEN t = 'tenant' THEN 'id' ELSE 'tenant_id' END;
    expected := format('(%s = (NULLIF(current_setting(''app.tenant_id''::text, true), ''''::text))::uuid)', col);
    RETURN NEXT policies_are('public', t, ARRAY['tenant_isolation'], format('%s has only tenant_isolation', t));
    RETURN NEXT policy_cmd_is('public', t, 'tenant_isolation', 'all', format('%s policy covers all commands', t));
    -- policy_roles_are() looks roles up in pg_roles, where the PUBLIC pseudo-role does not exist.
    RETURN NEXT is(
      (SELECT roles FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'tenant_isolation'),
      ARRAY['public']::name[], format('%s policy applies to every role', t));
    RETURN NEXT is(
      (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'tenant_isolation'),
      expected, format('%s USING compares %s with app.tenant_id', t, col));
    RETURN NEXT is(
      (SELECT with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'tenant_isolation'),
      expected, format('%s WITH CHECK compares %s with app.tenant_id', t, col));
  END LOOP;
END $$;

CREATE FUNCTION rls_tests.test_04_partitions_closed_to_app() RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE p name;
BEGIN
  FOR p IN SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
            WHERE i.inhparent = 'public.claim_version'::regclass ORDER BY 1 LOOP
    RETURN NEXT table_privs_are('public', p, 'skal_app', ARRAY[]::text[], format('skal_app has no privileges on %s', p));
  END LOOP;
END $$;

CREATE FUNCTION rls_tests.test_05_no_tenant_sees_nothing() RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE
  unset int;
  own int;
  partition_error text := 'none';
BEGIN
  INSERT INTO tenant (id, name) VALUES ('0199b000-0000-7000-8000-0000000000aa', 'pgTAP');
  -- skal_app has no USAGE on the tap schema, so observe as skal_app first and assert afterwards.
  SET LOCAL ROLE skal_app;
  PERFORM set_config('app.tenant_id', '', true);
  SELECT count(*) INTO unset FROM public.tenant;
  PERFORM set_config('app.tenant_id', '0199b000-0000-7000-8000-0000000000aa', true);
  SELECT count(*) INTO own FROM public.tenant;
  BEGIN
    PERFORM 1 FROM public.claim_version_p0;
  EXCEPTION WHEN insufficient_privilege THEN
    partition_error := SQLSTATE;
  END;
  RESET ROLE;
  RETURN NEXT is(unset, 0, 'skal_app with no tenant set sees no tenants');
  RETURN NEXT is(own, 1, 'skal_app with the tenant set sees exactly that tenant');
  RETURN NEXT is(partition_error, '42501', 'skal_app cannot select from a partition');
END $$;

SELECT * FROM runtests('rls_tests'::name, '^test_');
ROLLBACK;
