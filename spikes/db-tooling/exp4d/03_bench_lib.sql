-- Benchmark harness. run_mode(label, sql): sql takes $1 = query vector, $2 = campaign_id, returns int[] of ids (top 10 in order).
CREATE TABLE IF NOT EXISTS bench (label text, qid int, ms float8, ids bigint[]);
CREATE OR REPLACE FUNCTION run_mode(p_label text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE q record; ids bigint[]; t0 timestamptz;
BEGIN
  DELETE FROM bench WHERE label = p_label;
  FOR q IN SELECT * FROM queries ORDER BY qid LOOP           -- warm-up pass, discarded
    EXECUTE p_sql INTO ids USING q.embedding, q.campaign_id;
  END LOOP;
  FOR q IN SELECT * FROM queries ORDER BY qid LOOP           -- timed pass
    t0 := clock_timestamp();
    EXECUTE p_sql INTO ids USING q.embedding, q.campaign_id;
    INSERT INTO bench VALUES (p_label, q.qid, extract(epoch FROM clock_timestamp() - t0) * 1000, ids);
  END LOOP;
END $$;
-- summary: recall@10 vs label 'exact'
CREATE OR REPLACE FUNCTION summarize(p_label text) RETURNS TABLE(label text, recall10 numeric, short_queries int, min_rows int, p50_ms numeric, p95_ms numeric, max_ms numeric) LANGUAGE sql AS $$
  SELECT p_label,
    round(avg((SELECT count(*) FROM unnest(b.ids) x WHERE x = ANY(e.ids))::numeric / 10), 4),
    count(*) FILTER (WHERE coalesce(cardinality(b.ids),0) < 10)::int,
    min(coalesce(cardinality(b.ids),0))::int,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY b.ms))::numeric, 2),
    round((percentile_cont(0.95) WITHIN GROUP (ORDER BY b.ms))::numeric, 2),
    round(max(b.ms)::numeric, 2)
  FROM bench b JOIN bench e ON e.label = 'exact' AND e.qid = b.qid WHERE b.label = p_label;
$$;
