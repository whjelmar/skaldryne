-- Exp 4d data generation. Run with psql against database vecscale. Deterministic: one session, setseed(0.4242).
-- Parameters: noise sigma = 2.5 per dimension (centres ~ N(0,1) per dimension)
\set sigma 1.5
\set dims 768
\set ncamp 10
\set ncent 200
\set per_cent_ent 25      -- 5,000 entities / 200 centres
\set per_cent_pas 250     -- 50,000 passages / 200 centres
CREATE EXTENSION IF NOT EXISTS vector;
DROP TABLE IF EXISTS items, queries, centres CASCADE;
SELECT setseed(0.4242);

-- gaussian vector helper: Box-Muller, n dims, scale s
CREATE OR REPLACE FUNCTION gvec(n int, s float8) RETURNS real[] LANGUAGE plpgsql VOLATILE AS $$
DECLARE r real[] := array_fill(0::real, ARRAY[n]); u1 float8; u2 float8; m float8; i int;
BEGIN
  FOR i IN 1..n/2 LOOP
    u1 := 1.0 - random(); u2 := random(); m := s*sqrt(-2.0*ln(u1));
    r[2*i-1] := m*cos(2*pi()*u2); r[2*i] := m*sin(2*pi()*u2);
  END LOOP;
  RETURN r;
END $$;

-- 200 centres per campaign, unit-variance Gaussian per dim
CREATE TABLE centres (campaign_id int, cid int, vec real[], PRIMARY KEY (campaign_id, cid));
INSERT INTO centres SELECT c, k, gvec(:dims, 1.0) FROM generate_series(1,:ncamp) c, generate_series(1,:ncent) k ORDER BY c, k;

-- items: per campaign 200 centres x (25 entity + 250 passage) = 55,000 rows
CREATE TABLE items (
  id bigint GENERATED ALWAYS AS IDENTITY,
  campaign_id int NOT NULL,
  cid int NOT NULL,
  kind text NOT NULL,
  embedding halfvec(768) NOT NULL
);
DO $$
DECLARE c int;
BEGIN
  FOR c IN 1..10 LOOP
    INSERT INTO items (campaign_id, cid, kind, embedding)
    SELECT c, ce.cid, CASE WHEN n <= 25 THEN 'entity' ELSE 'passage' END,
           (SELECT array_agg((ce.vec[i] + noise[i])::real ORDER BY i) FROM generate_series(1,768) i)::halfvec(768)
    FROM centres ce, generate_series(1,275) n, LATERAL (SELECT gvec(768, 2.5 + n*0) AS noise) g
    WHERE ce.campaign_id = c
    ORDER BY ce.cid, n;
    RAISE NOTICE 'campaign % done at %', c, clock_timestamp();
  END LOOP;
END $$;

