\pset pager off
LOAD 'vector';
SET hnsw.iterative_scan = off;
\set part 'SELECT coalesce(array_agg(id), ''{}'') FROM (SELECT id FROM items_part WHERE campaign_id = $2 ORDER BY embedding <=> $1 LIMIT 10) s'
\set pi   'SELECT coalesce(array_agg(id), ''{}'') FROM (SELECT id FROM items_pi WHERE campaign_id = $2 ORDER BY embedding <=> $1 LIMIT 10) s'
SET hnsw.ef_search = 40;  SELECT run_mode('x_partitioned_ef40', :'part');  SELECT run_mode('x_partial_ef40', :'pi');
SET hnsw.ef_search = 100; SELECT run_mode('x_partitioned_ef100', :'part'); SELECT run_mode('x_partial_ef100', :'pi');
SET hnsw.ef_search = 200; SELECT run_mode('x_partitioned_ef200', :'part'); SELECT run_mode('x_partial_ef200', :'pi');
SET hnsw.ef_search = 400; SELECT run_mode('x_partitioned_ef400', :'part'); SELECT run_mode('x_partial_ef400', :'pi');
SET hnsw.ef_search = 1000; SELECT run_mode('x_partitioned_ef1000', :'part'); SELECT run_mode('x_partial_ef1000', :'pi');
SELECT (summarize(l)).* FROM unnest(ARRAY['x_partitioned_ef40','x_partitioned_ef100','x_partitioned_ef200','x_partitioned_ef400','x_partitioned_ef1000','x_partial_ef40','x_partial_ef100','x_partial_ef200','x_partial_ef400','x_partial_ef1000']) l;
-- finer ef steps for the partitioned design
SET hnsw.ef_search = 600; SELECT run_mode('x_partitioned_ef600', :'part');
SET hnsw.ef_search = 800; SELECT run_mode('x_partitioned_ef800', :'part');
SELECT (summarize(l)).* FROM unnest(ARRAY['x_partitioned_ef600','x_partitioned_ef800']) l;
