-- 100 held-out queries: 10 per campaign, random centre (of that campaign), same noise (sigma 2.5). Own seed.
SELECT setseed(0.777);
DROP TABLE IF EXISTS queries;
CREATE TABLE queries (qid int PRIMARY KEY, campaign_id int NOT NULL, cid int NOT NULL, embedding halfvec(768) NOT NULL);
INSERT INTO queries
SELECT q, camp, pick.cid,
       (SELECT array_agg((ce.vec[i] + noise[i])::real ORDER BY i) FROM generate_series(1,768) i)::halfvec(768)
FROM (SELECT q, ((q-1) % 10) + 1 AS camp FROM generate_series(1,100) q ORDER BY q) qq
CROSS JOIN LATERAL (SELECT 1 + floor(random()*200 + qq.q*0)::int AS cid) pick
CROSS JOIN LATERAL (SELECT vec FROM centres c WHERE c.campaign_id = qq.camp AND c.cid = pick.cid) ce
CROSS JOIN LATERAL (SELECT gvec(768, 2.5 + qq.q*0) AS noise) g;
