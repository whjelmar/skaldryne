-- Data hardness: for each query, exact cosine distances in its campaign (seq scan, no index use needed).
\timing off
SELECT count(*) AS rows, count(DISTINCT campaign_id) AS campaigns FROM items;
SELECT campaign_id, count(*) FROM items GROUP BY 1 ORDER BY 1 LIMIT 3;
SELECT count(*) AS queries FROM queries;
CREATE TEMP TABLE hard AS
SELECT q.qid, q.cid,
       (array_agg(d ORDER BY d))[1] AS d1, (array_agg(d ORDER BY d))[10] AS d10, (array_agg(d ORDER BY d))[11] AS d11,
       (array_agg(cid2 ORDER BY d))[1:10] AS top_cids
FROM queries q
CROSS JOIN LATERAL (SELECT i.embedding <=> q.embedding AS d, i.cid AS cid2 FROM items i WHERE i.campaign_id = q.campaign_id) x
GROUP BY q.qid, q.cid;
SELECT round(avg(d1)::numeric,4) AS mean_d1, round(avg(d10)::numeric,4) AS mean_d10,
       round(avg(d1/d10)::numeric,4) AS mean_ratio_1st_to_10th, round(min(d1/d10)::numeric,4) AS min_ratio, round(max(d1/d10)::numeric,4) AS max_ratio,
       round(avg(d10/d11)::numeric,4) AS mean_ratio_10th_to_11th
FROM hard;
-- purity: share of exact top-10 coming from the query's own generating centre
SELECT round(avg((SELECT count(*) FROM unnest(top_cids) t WHERE t = hard.cid)::numeric/10),3) AS top10_own_centre_share FROM hard;
