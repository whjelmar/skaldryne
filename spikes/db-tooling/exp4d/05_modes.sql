-- Core modes. Run after 01-04. psql -d vecscale -f 03_bench_lib.sql -f 05_modes.sql
\pset pager off
LOAD 'vector';
SHOW hnsw.ef_search; SHOW hnsw.iterative_scan; SHOW hnsw.max_scan_tuples; SHOW hnsw.scan_mem_multiplier;
SHOW shared_buffers; SHOW work_mem; SHOW effective_cache_size;
\set ann 'SELECT coalesce(array_agg(id), ''{}'') FROM (SELECT id FROM items WHERE campaign_id = $2 ORDER BY embedding <=> $1 LIMIT 10) s'
\set exa 'SELECT coalesce(array_agg(id), ''{}'') FROM (SELECT id FROM items WHERE campaign_id = $2 ORDER BY (embedding <=> $1) + 0 LIMIT 10) s'

-- (iii) exact: "+ 0" on the distance expression stops the planner using the HNSW index; it picks the btree on campaign_id by itself.
SET hnsw.iterative_scan = off;
SELECT run_mode('exact', :'exa');

-- (i) HNSW + WHERE campaign_id, iterative scan off
SET hnsw.iterative_scan = off;
SET hnsw.ef_search = 40;  SELECT run_mode('i_ef40',  :'ann');
SET hnsw.ef_search = 100; SELECT run_mode('i_ef100', :'ann');
SET hnsw.ef_search = 200; SELECT run_mode('i_ef200', :'ann');

-- (ii) relaxed_order iterative scan (max_scan_tuples default 20000)
SET hnsw.iterative_scan = relaxed_order;
SET hnsw.ef_search = 40;  SELECT run_mode('ii_relaxed_ef40',  :'ann');
SET hnsw.ef_search = 100; SELECT run_mode('ii_relaxed_ef100', :'ann');
SET hnsw.ef_search = 200; SELECT run_mode('ii_relaxed_ef200', :'ann');
-- extra: strict_order iterative scan
SET hnsw.iterative_scan = strict_order;
SET hnsw.ef_search = 40;  SELECT run_mode('x_strict_ef40',  :'ann');
SET hnsw.ef_search = 200; SELECT run_mode('x_strict_ef200', :'ann');

SELECT (summarize(l)).* FROM unnest(ARRAY['exact','i_ef40','i_ef100','i_ef200','ii_relaxed_ef40','ii_relaxed_ef100','ii_relaxed_ef200','x_strict_ef40','x_strict_ef200']) l;
