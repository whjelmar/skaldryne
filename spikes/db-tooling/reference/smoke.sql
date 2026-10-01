-- Run as skal_app against a database built from schema.sql. Each SELECT prints one check.
BEGIN;
SELECT set_config('app.tenant_id', '0190f000-0000-7000-8000-00000000000a', true) IS NOT NULL AS ctx;
INSERT INTO tenant (id, name) VALUES ('0190f000-0000-7000-8000-00000000000a', 'A');
INSERT INTO campaign (tenant_id, id, name)
  VALUES ('0190f000-0000-7000-8000-00000000000a', '0190f000-0000-7000-8000-0000000000c1', 'c');
INSERT INTO entity (tenant_id, id, campaign_id, kind, name)
  VALUES ('0190f000-0000-7000-8000-00000000000a', '0190f000-0000-7000-8000-0000000000e1',
          '0190f000-0000-7000-8000-0000000000c1', 'npc', 'Mira');
INSERT INTO claim_version (tenant_id, claim_id, version, campaign_id, subject_id, predicate, object) VALUES
  ('0190f000-0000-7000-8000-00000000000a', '0190f000-0000-7000-8000-0000000000f1', 1,
   '0190f000-0000-7000-8000-0000000000c1', '0190f000-0000-7000-8000-0000000000e1', 'title', '"smith"'),
  ('0190f000-0000-7000-8000-00000000000a', '0190f000-0000-7000-8000-0000000000f1', 2,
   '0190f000-0000-7000-8000-0000000000c1', '0190f000-0000-7000-8000-0000000000e1', 'title', '"mayor"');
SELECT 'current object = ' || object::text AS check FROM claim_current;
INSERT INTO claim_embedding
  VALUES ('0190f000-0000-7000-8000-00000000000a', '0190f000-0000-7000-8000-0000000000f1',
          array_fill(0.1::real, ARRAY[768])::halfvec);
SELECT 'embeddings = ' || count(*) AS check FROM claim_embedding;
COMMIT;

BEGIN;
SELECT set_config('app.tenant_id', '0190f000-0000-7000-8000-00000000000b', true) IS NOT NULL AS ctx;
SELECT 'tenant B sees campaigns = ' || count(*) AS check FROM campaign;
COMMIT;

SELECT 'no context sees entities = ' || count(*) AS check FROM entity;

-- Must fail with permission denied: partitions are reachable only through the parent.
SELECT count(*) FROM claim_version_p0;
