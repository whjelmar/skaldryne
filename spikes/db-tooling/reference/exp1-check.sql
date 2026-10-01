-- psql driver that printed the expected results in EXPERIMENTS.md. Run as skal_app on a fresh exp1_* copy:
--   psql -U skal_app -h localhost -d exp1_<arm> -X -q -f exp1-check.sql
\set tenant 00000000-0000-7000-8000-00000000000a
\set campaign 0000000a-0000-7000-8000-000000000001
\set start 0000000a-0001-7000-8000-000000000003
\set config english
\set query 'cult or leader'
SELECT '[' || string_agg(sin(4.5 * 0.37 + i * 0.05)::text, ',' ORDER BY i) || ']' AS qv FROM generate_series(0, 767) i \gset
SELECT set_config('app.tenant_id', :'tenant', false);
\pset footer off
-- Q1 graph hops: who reaches the start entity within 3 hops, and through whom.
-- Follows edges backwards (subject -> {"entity": start}), skips cycles, keeps the shortest path.
WITH RECURSIVE walk (entity_id, depth, path) AS (
  SELECT c.subject_id, 1, ARRAY[(c.object ->> 'entity')::uuid, c.subject_id]
  FROM claim_current c
  WHERE c.tenant_id = :'tenant' AND c.object ? 'entity' AND c.object ->> 'entity' = :'start'
    AND c.subject_id <> :'start'
  UNION ALL
  SELECT c.subject_id, w.depth + 1, w.path || c.subject_id
  FROM walk w
  JOIN claim_current c
    ON c.tenant_id = :'tenant' AND c.object ? 'entity' AND c.object ->> 'entity' = w.entity_id::text
  WHERE w.depth < 3 AND c.subject_id <> ALL (w.path)
)
SELECT entity_id, display_name, depth, path
FROM (
  SELECT DISTINCT ON (w.entity_id) w.entity_id, e.display_name, w.depth, w.path
  FROM walk w
  JOIN entity e ON e.tenant_id = :'tenant' AND e.id = w.entity_id
  ORDER BY w.entity_id, w.depth
) AS shortest
ORDER BY depth, display_name;

-- Q2 full-text search in one campaign, with the campaign's text search config as a parameter.
SELECT s.id, s.session_no, s.start_ms,
       round(ts_rank_cd(s.tsv, q)::numeric, 4) AS rank,
       ts_headline(:'config'::regconfig, s.text, q) AS headline
FROM transcript_segment s, websearch_to_tsquery(:'config'::regconfig, :'query') AS q
WHERE s.tenant_id = :'tenant' AND s.campaign_id = :'campaign' AND s.tsv @@ q
ORDER BY rank DESC, s.session_no, s.start_ms
LIMIT 10;

-- Q3 hybrid search: reciprocal rank fusion (k = 60) of the top 10 from each list.
WITH fts AS (
  SELECT s.id, row_number() OVER (ORDER BY ts_rank_cd(s.tsv, q) DESC, s.id) AS r
  FROM transcript_segment s, websearch_to_tsquery(:'config'::regconfig, :'query') AS q
  WHERE s.tenant_id = :'tenant' AND s.campaign_id = :'campaign' AND s.tsv @@ q
  ORDER BY r LIMIT 10
), vec AS (
  SELECT e.segment_id AS id, row_number() OVER (ORDER BY e.embedding <=> :'qv'::halfvec(768), e.segment_id) AS r
  FROM segment_embedding e
  JOIN transcript_segment s ON s.tenant_id = e.tenant_id AND s.id = e.segment_id
  WHERE s.tenant_id = :'tenant' AND s.campaign_id = :'campaign'
  ORDER BY r LIMIT 10
)
SELECT coalesce(f.id, v.id) AS id, f.r AS fts_rank, v.r AS vec_rank,
       round(coalesce(1.0 / (60 + f.r), 0) + coalesce(1.0 / (60 + v.r), 0), 6) AS score
FROM fts f FULL OUTER JOIN vec v ON f.id = v.id
ORDER BY score DESC, id
LIMIT 10;

\echo GERMAN
\set campaign 0000000a-0000-7000-8000-000000000002
\set config german
\set query 'Kult'
SELECT s.id, s.session_no, s.start_ms, round(ts_rank_cd(s.tsv, q)::numeric, 4) AS rank, ts_headline(:'config'::regconfig, s.text, q) AS headline
FROM transcript_segment s, websearch_to_tsquery(:'config'::regconfig, :'query') AS q
WHERE s.tenant_id = :'tenant' AND s.campaign_id = :'campaign' AND s.tsv @@ q ORDER BY rank DESC, s.session_no, s.start_ms LIMIT 10;
\echo NO_TENANT
SELECT set_config('app.tenant_id', '', false);
SELECT count(*) FROM claim_current;
