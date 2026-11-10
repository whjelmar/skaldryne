-- EXPLAIN (ANALYZE, BUFFERS) per mode for query qid=1 (campaign 1), after the benchmark has warmed caches. Literal vector via psql variable.
\pset pager off
LOAD 'vector';
SELECT embedding::text AS qv, campaign_id AS qc FROM queries WHERE qid = 1 \gset
SELECT pg_size_pretty(sum(pg_relation_size(i.indexrelid))) AS partitioned_hnsw_total FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid WHERE c.relname LIKE 'items\_part\_%' AND i.indexrelid::regclass::text LIKE '%hnsw%';
SELECT pg_size_pretty(sum(pg_relation_size(indexrelid))) AS partial_hnsw_total FROM pg_index WHERE indrelid='items_pi'::regclass AND indexrelid::regclass::text LIKE 'items_pi_hnsw%';
\echo '=== exact (iii)'
SET hnsw.iterative_scan = off;
EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM items WHERE campaign_id = :qc ORDER BY (embedding <=> :'qv'::halfvec(768)) + 0 LIMIT 10;
\echo '=== (i) default ef_search=40, iterative off'
SET hnsw.ef_search = 40;
EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM items WHERE campaign_id = :qc ORDER BY embedding <=> :'qv'::halfvec(768) LIMIT 10;
\echo '=== (i) ef_search=200'
SET hnsw.ef_search = 200;
EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM items WHERE campaign_id = :qc ORDER BY embedding <=> :'qv'::halfvec(768) LIMIT 10;
\echo '=== (ii) relaxed_order ef_search=40'
SET hnsw.iterative_scan = relaxed_order; SET hnsw.ef_search = 40;
EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM items WHERE campaign_id = :qc ORDER BY embedding <=> :'qv'::halfvec(768) LIMIT 10;
\echo '=== (ii) relaxed_order ef_search=200'
SET hnsw.ef_search = 200;
EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM items WHERE campaign_id = :qc ORDER BY embedding <=> :'qv'::halfvec(768) LIMIT 10;
\echo '=== extra: partitioned, ef_search=1000, iterative off'
SET hnsw.iterative_scan = off; SET hnsw.ef_search = 1000;
EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM items_part WHERE campaign_id = :qc ORDER BY embedding <=> :'qv'::halfvec(768) LIMIT 10;
\echo '=== extra: partial index, ef_search=1000, iterative off'
EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM items_pi WHERE campaign_id = :qc ORDER BY embedding <=> :'qv'::halfvec(768) LIMIT 10;
