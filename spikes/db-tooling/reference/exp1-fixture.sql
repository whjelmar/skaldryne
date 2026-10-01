-- Deterministic fixture for experiment 1. Loaded by skal_migrator (table owner, so RLS does not
-- apply) into a database at M1–M4. Every arm's tests use exactly this data.
--
-- IDs: tenant A = …0a, tenant B = …0b. Entities 0000000a-0001-…-00N are e1..e9 in tenant A.
BEGIN;

INSERT INTO tenant (id, name) VALUES
  ('00000000-0000-7000-8000-00000000000a', 'Tenant A'),
  ('00000000-0000-7000-8000-00000000000b', 'Tenant B');

INSERT INTO campaign (tenant_id, id, name) VALUES
  ('00000000-0000-7000-8000-00000000000a', '0000000a-0000-7000-8000-000000000001', 'Ashen Eye (English)'),
  ('00000000-0000-7000-8000-00000000000a', '0000000a-0000-7000-8000-000000000002', 'Waldkult (German)'),
  ('00000000-0000-7000-8000-00000000000b', '0000000b-0000-7000-8000-000000000001', 'Other tenant');

INSERT INTO entity (tenant_id, id, campaign_id, kind, display_name) VALUES
  ('00000000-0000-7000-8000-00000000000a', '0000000a-0001-7000-8000-000000000001', '0000000a-0000-7000-8000-000000000001', 'npc', 'Archivist Mira'),
  ('00000000-0000-7000-8000-00000000000a', '0000000a-0001-7000-8000-000000000002', '0000000a-0000-7000-8000-000000000001', 'npc', 'Brother Calder'),
  ('00000000-0000-7000-8000-00000000000a', '0000000a-0001-7000-8000-000000000003', '0000000a-0000-7000-8000-000000000001', 'faction', 'Cult of the Ashen Eye'),
  ('00000000-0000-7000-8000-00000000000a', '0000000a-0001-7000-8000-000000000004', '0000000a-0000-7000-8000-000000000001', 'npc', 'Duke Orsolo'),
  ('00000000-0000-7000-8000-00000000000a', '0000000a-0001-7000-8000-000000000005', '0000000a-0000-7000-8000-000000000001', 'npc', 'Envoy Tamsin'),
  ('00000000-0000-7000-8000-00000000000a', '0000000a-0001-7000-8000-000000000006', '0000000a-0000-7000-8000-000000000001', 'npc', 'Ferryman Gaunt'),
  ('00000000-0000-7000-8000-00000000000a', '0000000a-0001-7000-8000-000000000007', '0000000a-0000-7000-8000-000000000001', 'npc', 'Grey Abbess'),
  ('00000000-0000-7000-8000-00000000000a', '0000000a-0001-7000-8000-000000000008', '0000000a-0000-7000-8000-000000000001', 'npc', 'Hollow Knight'),
  ('00000000-0000-7000-8000-00000000000a', '0000000a-0001-7000-8000-000000000009', '0000000a-0000-7000-8000-000000000001', 'npc', 'Iron Warden'),
  ('00000000-0000-7000-8000-00000000000b', '0000000b-0001-7000-8000-000000000001', '0000000b-0000-7000-8000-000000000001', 'npc', 'Intruder');

-- Relationship claims: subject -> {"entity": object}. Claim IDs 0000000a-0004-…-0NN.
-- Edges into the cult (e3): e2, e4, and tenant B's Intruder (invisible to A).
-- e1->e2, e6->e2, e5->e4, e7->e6, e9->e7, e3->e1 (cycle), e5->e5 (self loop).
-- e8->e7 existed in version 1 but version 2 replaced it with a plain value, so it is not current.
-- e3 also has a non-relationship claim.
INSERT INTO claim_version (tenant_id, claim_id, version, campaign_id, subject_id, predicate, object)
SELECT '00000000-0000-7000-8000-00000000000a'::uuid, ('0000000a-0004-7000-8000-0000000000' || c.n)::uuid, c.v,
       '0000000a-0000-7000-8000-000000000001'::uuid, ('0000000a-0001-7000-8000-00000000000' || c.s)::uuid,
       c.p, c.o::jsonb
FROM (VALUES
  ('01', 1, '2', 'serves',  '{"entity": "0000000a-0001-7000-8000-000000000003"}'),
  ('02', 1, '4', 'funds',   '{"entity": "0000000a-0001-7000-8000-000000000003"}'),
  ('03', 1, '1', 'knows',   '{"entity": "0000000a-0001-7000-8000-000000000002"}'),
  ('04', 1, '6', 'ferries', '{"entity": "0000000a-0001-7000-8000-000000000002"}'),
  ('05', 1, '5', 'reports', '{"entity": "0000000a-0001-7000-8000-000000000004"}'),
  ('06', 1, '7', 'knows',   '{"entity": "0000000a-0001-7000-8000-000000000006"}'),
  ('07', 1, '9', 'guards',  '{"entity": "0000000a-0001-7000-8000-000000000007"}'),
  ('08', 1, '3', 'hunts',   '{"entity": "0000000a-0001-7000-8000-000000000001"}'),
  ('09', 1, '5', 'doubts',  '{"entity": "0000000a-0001-7000-8000-000000000005"}'),
  ('10', 1, '8', 'knows',   '{"entity": "0000000a-0001-7000-8000-000000000007"}'),
  ('10', 2, '8', 'knows',   '{"value": "estranged"}'),
  ('11', 1, '3', 'motto',   '{"value": "The eye never closes"}')
) AS c (n, v, s, p, o);

INSERT INTO claim_version (tenant_id, claim_id, version, campaign_id, subject_id, predicate, object) VALUES
  ('00000000-0000-7000-8000-00000000000b', '0000000b-0004-7000-8000-000000000001', 1,
   '0000000b-0000-7000-8000-000000000001', '0000000b-0001-7000-8000-000000000001', 'infiltrates',
   '{"entity": "0000000a-0001-7000-8000-000000000003"}');

-- Transcript segments. Segment IDs 0000000a-0002-…-0NN; ordinal n drives the embedding.
INSERT INTO transcript_segment (tenant_id, id, campaign_id, session_no, start_ms, end_ms, speaker, text, word_timings, ts_config)
SELECT '00000000-0000-7000-8000-00000000000a'::uuid, ('0000000a-0002-7000-8000-0000000000' || lpad(t.n::text, 2, '0'))::uuid,
       '0000000a-0000-7000-8000-000000000001'::uuid, CASE WHEN t.n <= 6 THEN 1 ELSE 2 END,
       ((t.n - 1) % 6) * 10000, ((t.n - 1) % 6) * 10000 + 9000, 'GM', t.txt, '\x00'::bytea, 'english'::regconfig
FROM (VALUES
  (1,  'The cult leader spoke from the ashen altar while the crowd chanted.'),
  (2,  'Mira found a letter from the cult hidden in the archive.'),
  (3,  'Brother Calder denied any link to the leader of the Ashen Eye.'),
  (4,  'We rested at the inn and argued about the ferry toll.'),
  (5,  'Leaders of the guilds met to discuss the missing grain.'),
  (6,  'The ferryman refused to cross after dark.'),
  (7,  'A cult symbol was carved into the hull of the ferry.'),
  (8,  'The envoy of the Duke arrived with sealed orders.'),
  (9,  'Nobody mentioned the cult again until the final session.'),
  (10, 'The Grey Abbess blessed the party before the journey.'),
  (11, 'Cultists followed their leader into the catacombs beneath the abbey.'),
  (12, 'Rain fell all night and the party slept poorly.')
) AS t (n, txt);

INSERT INTO transcript_segment (tenant_id, id, campaign_id, session_no, start_ms, end_ms, speaker, text, word_timings, ts_config)
SELECT '00000000-0000-7000-8000-00000000000a'::uuid, ('0000000a-0002-7000-8000-0000000001' || lpad(t.n::text, 2, '0'))::uuid,
       '0000000a-0000-7000-8000-000000000002'::uuid, 1, (t.n - 1) * 10000, (t.n - 1) * 10000 + 9000, 'SL', t.txt,
       '\x00'::bytea, 'german'::regconfig
FROM (VALUES
  (1, 'Der Kult versammelte sich im Wald.'),
  (2, 'Die Anführerin des Kultes sprach leise.'),
  (3, 'Wir kauften Brot auf dem Markt.')
) AS t (n, txt);

INSERT INTO transcript_segment (tenant_id, id, campaign_id, session_no, start_ms, end_ms, speaker, text, word_timings, ts_config) VALUES
  ('00000000-0000-7000-8000-00000000000b', '0000000b-0002-7000-8000-000000000001', '0000000b-0000-7000-8000-000000000001',
   1, 0, 9000, 'GM', 'The cult leader of tenant B must never be visible to tenant A.', '\x00'::bytea, 'english');

-- Embeddings: element i (0-based) is sin(n * 0.37 + i * 0.05), where n is 1..12 for the English
-- segments, 21..23 for the German ones, and 4.5 for tenant B's. The query vector in EXPERIMENTS.md
-- also uses n = 4.5, so tenant B's segment would rank first if RLS leaked.
INSERT INTO segment_embedding (tenant_id, segment_id, embedding)
SELECT s.tenant_id, s.id,
       (SELECT array_agg(sin(x.n * 0.37 + i * 0.05) ORDER BY i) FROM generate_series(0, 767) AS i)::halfvec(768)
FROM transcript_segment s
CROSS JOIN LATERAL (
  SELECT CASE
           WHEN s.tenant_id = '00000000-0000-7000-8000-00000000000b' THEN 4.5
           ELSE right(s.id::text, 3)::int % 100 + CASE WHEN right(s.id::text, 3)::int >= 100 THEN 20 ELSE 0 END
         END::float8 AS n
) AS x;

-- Jobs. Tenant A: six ready, one not yet due, one done (job 6 is on its third attempt once claimed).
-- Tenant B: two ready, which tenant A must never claim.
INSERT INTO job (tenant_id, id, kind, payload, state, run_after, attempts)
SELECT '00000000-0000-7000-8000-00000000000a'::uuid, ('0000000a-0003-7000-8000-00000000000' || j.n)::uuid, j.kind,
       jsonb_build_object('n', j.n), j.state, j.run_after::timestamptz, j.attempts
FROM (VALUES
  (1, 'transcribe', 'queued', '2026-01-01 00:01:00+00', 0),
  (2, 'transcribe', 'queued', '2026-01-01 00:02:00+00', 0),
  (3, 'extract',    'queued', '2026-01-01 00:03:00+00', 0),
  (4, 'extract',    'queued', '2026-01-01 00:04:00+00', 0),
  (5, 'embed',      'queued', '2026-01-01 00:05:00+00', 0),
  (6, 'embed',      'queued', '2026-01-01 00:06:00+00', 2),
  (7, 'embed',      'queued', '2999-01-01 00:00:00+00', 0),
  (8, 'embed',      'done',   '2026-01-01 00:00:00+00', 1)
) AS j (n, kind, state, run_after, attempts);

INSERT INTO job (tenant_id, id, kind, state, run_after) VALUES
  ('00000000-0000-7000-8000-00000000000b', '0000000b-0003-7000-8000-000000000001', 'transcribe', 'queued', '2025-12-31 00:00:00+00'),
  ('00000000-0000-7000-8000-00000000000b', '0000000b-0003-7000-8000-000000000002', 'transcribe', 'queued', '2025-12-31 00:00:00+00');

COMMIT;
