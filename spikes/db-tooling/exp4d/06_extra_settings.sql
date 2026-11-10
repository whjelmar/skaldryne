-- Extra settings on the same table/index (labelled x_). Run after 05.
\pset pager off
LOAD 'vector';
\set ann 'SELECT coalesce(array_agg(id), ''{}'') FROM (SELECT id FROM items WHERE campaign_id = $2 ORDER BY embedding <=> $1 LIMIT 10) s'
-- sanity: unfiltered recall of the index itself (no campaign filter), ef_search 40/200, vs exact scan of the whole table, 20 queries
SET hnsw.iterative_scan = off;
SET hnsw.ef_search = 200;
WITH r AS (
  SELECT q.qid,
    (SELECT array_agg(id) FROM (SELECT id FROM items ORDER BY embedding <=> q.embedding LIMIT 10) s) AS ann,
    (SELECT array_agg(id) FROM (SELECT id FROM items ORDER BY (embedding <=> q.embedding) + 0 LIMIT 10) s) AS ex
  FROM queries q WHERE qid <= 20)
SELECT round(avg((SELECT count(*) FROM unnest(ann) a WHERE a = ANY(ex))::numeric/10),3) AS unfiltered_recall10_ef200_20q FROM r;
SET hnsw.ef_search = 1000;
SET hnsw.iterative_scan = off;
SELECT run_mode('x_plain_ef1000', :'ann');
SET hnsw.iterative_scan = relaxed_order;
SET hnsw.ef_search = 1000; SET hnsw.max_scan_tuples = 20000;   SELECT run_mode('x_relaxed_ef1000_mst20k', :'ann');
SET hnsw.ef_search = 200;  SET hnsw.max_scan_tuples = 100000;  SELECT run_mode('x_relaxed_ef200_mst100k', :'ann');
SET hnsw.ef_search = 1000; SET hnsw.max_scan_tuples = 100000;  SELECT run_mode('x_relaxed_ef1000_mst100k', :'ann');
SET hnsw.ef_search = 1000; SET hnsw.max_scan_tuples = 1000000; SET hnsw.scan_mem_multiplier = 4; SELECT run_mode('x_relaxed_ef1000_mst1M_mem4', :'ann');
RESET hnsw.max_scan_tuples; RESET hnsw.scan_mem_multiplier;
SELECT (summarize(l)).* FROM unnest(ARRAY['x_plain_ef1000','x_relaxed_ef1000_mst20k','x_relaxed_ef200_mst100k','x_relaxed_ef1000_mst100k','x_relaxed_ef1000_mst1M_mem4']) l;
