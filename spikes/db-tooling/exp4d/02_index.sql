-- Exp 4d index build. Stand-in schema settings: halfvec_cosine_ops, m=16, ef_construction=64.
-- maintenance_work_mem raised for the build (default 64MB); parallel workers raised from default 2.
\timing on
ANALYZE items;
CREATE INDEX items_campaign_btree ON items (campaign_id);
SET maintenance_work_mem = '4GB';
-- parallel build needs a shared-memory segment of size maintenance_work_mem; container /dev/shm is 64MB, so 8 workers + 4GB failed ("No space left on device"). Serial build used.
SET max_parallel_maintenance_workers = 0;
SHOW maintenance_work_mem;
SHOW max_parallel_maintenance_workers;
CREATE INDEX items_embedding_hnsw ON items USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);
ANALYZE items;
SELECT pg_size_pretty(pg_relation_size('items_embedding_hnsw')) AS hnsw_size,
       pg_size_pretty(pg_relation_size('items_campaign_btree')) AS btree_size,
       pg_size_pretty(pg_relation_size('items')) AS heap_size,
       pg_size_pretty(pg_table_size('items')) AS table_size_with_toast;
