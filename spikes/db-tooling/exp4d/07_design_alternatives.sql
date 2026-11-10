-- Index-design alternatives on the same data (extra modes, labelled x_). Build settings as 02_index.sql.
\timing on
\pset pager off
LOAD 'vector';
SET maintenance_work_mem = '4GB';
SET max_parallel_maintenance_workers = 0;

-- (A) one table partitioned by campaign_id, HNSW per partition (m=16, ef_construction=64)
DROP TABLE IF EXISTS items_part;
CREATE TABLE items_part (id bigint NOT NULL, campaign_id int NOT NULL, cid int NOT NULL, kind text NOT NULL, embedding halfvec(768) NOT NULL) PARTITION BY LIST (campaign_id);
DO $$ BEGIN FOR c IN 1..10 LOOP EXECUTE format('CREATE TABLE items_part_%s PARTITION OF items_part FOR VALUES IN (%s)', c, c); END LOOP; END $$;
INSERT INTO items_part SELECT id, campaign_id, cid, kind, embedding FROM items;
ANALYZE items_part;
CREATE INDEX items_part_hnsw ON items_part USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);
SELECT pg_size_pretty(sum(pg_relation_size(c.oid))) AS part_hnsw_total_size
  FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid JOIN pg_class t ON t.oid = i.indrelid
  WHERE t.relname LIKE 'items_part\_%' AND c.relname LIKE '%hnsw%';

-- (B) plain table, one partial HNSW index per campaign (WHERE campaign_id = k), no full-table HNSW
DROP TABLE IF EXISTS items_pi;
CREATE TABLE items_pi AS SELECT * FROM items;
CREATE INDEX items_pi_campaign_btree ON items_pi (campaign_id);
ANALYZE items_pi;
DO $$ BEGIN FOR c IN 1..10 LOOP
  EXECUTE format('CREATE INDEX items_pi_hnsw_c%s ON items_pi USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64) WHERE campaign_id = %s', c, c);
END LOOP; END $$;
SELECT pg_size_pretty(sum(pg_relation_size(indexrelid))) AS partial_hnsw_total_size FROM pg_index WHERE indrelid = 'items_pi'::regclass AND indexrelid::regclass::text LIKE 'items_pi_hnsw%';
