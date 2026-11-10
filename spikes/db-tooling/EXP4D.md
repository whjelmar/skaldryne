# Experiment 4d: the vector index at reference scale

Spec: `EXPERIMENTS.md` → Experiment 4 → 4d (committed eb51330). Run alone on 2026-11-09/10; nothing else was using the database server. Not committed.

## Verdict

> **Correction after verification (2026-11-09).** The verifier and the bias auditor (see `VERIFICATION.md`, round 3) found the verdict below overstated. Corrected reading: mode (iii), the exact scan via the campaign btree, already **passes** at reference scale (recall 1.0, 10 rows, p95 43 ms). Modes (i) and (ii) fail on this data, and the data is not representative (near-uniform clusters, sigma 2.5; at sigma 0.5 unfiltered recall at ef 40 is 0.915), so their failure says little about real embeddings. Filtered HNSW at larger scale would need iterative scan or one index per campaign. 4d does not separate the tools under test. The original text is kept unchanged below.

**PASS, but only through index design plus a very high `ef_search`, and only just.** The pre-registered modes (i) and (ii) both **fail** on this data. A pass was found with one HNSW index per campaign, either a partitioned table or partial indexes, at `hnsw.ef_search = 1000` (the maximum): recall@10 0.980 (partitioned) and 0.974 (partial), 10 rows for every query, p95 45.3 and 46.8 ms. At `ef_search = 800` the partitioned design gets recall 0.947 and misses the 0.95 bar. The margin is thin, and on this data the winning configuration is barely faster than the exact scan (p95 43.1 ms).

The data is a hard case for HNSW (see "Data and noise choice"). Even with no campaign filter, the whole-table index reaches recall@10 of only 0.18 at `ef_search = 200`. The failures of (i) and (ii) therefore come mostly from the data being nearly structureless to a graph index, not from filtering alone. Real embeddings usually have lower intrinsic dimension, so treat these numbers as a pessimistic bound, not a forecast.

## Environment

| Item | Value |
| --- | --- |
| CPU | Intel Core Ultra 9 275HX, 24 cores / 24 logical |
| RAM | 68.1 GB host; Docker VM reports 33.3 GB (container `MemTotal` 32.5 GB) |
| Container `db-tooling-db-1` | image `skaldryne-spike-pg:18`, no memory or CPU limit (`memory.max` = max, `cpu.max` = max), `/dev/shm` 64 MB, data on a local 1 TB volume |
| PostgreSQL | 18.6 (Debian 12) |
| pgvector | **0.8.6** (`pg_extension.extversion` in `vecscale`) |
| `shared_buffers` | 128 MB (default). Heap 859 MB and index 1,074 MB do not fit, so reads come from the OS cache. |
| `work_mem`, `effective_cache_size` | defaults |
| Other load | `kokoro-speech-server` container was up and idle (GPU 0%); no other queries |

## Data and noise choice

- 10 campaigns x 200 centres x 275 points = 550,000 `halfvec(768)` rows (25 entity-like + 250 passage-like rows per centre, in the `kind` column). Table `items` (id, campaign_id, cid, kind, embedding).
- Centres: N(0,1) per dimension, independent per campaign. Points: centre + N(0, sigma^2) per dimension, Box-Muller in PL/pgSQL, stored as `halfvec`. Seeds: `setseed(0.4242)` for centres and data, `setseed(0.777)` for queries.
- **sigma = 2.5.** I first generated with sigma = 1.5 (nearest/10th-nearest ratio 0.959, own-centre share 1.0) and discarded it before running any benchmark, then raised the noise to 2.5 hoping for real cluster overlap. It did not produce overlap: at sigma = 2.5 the exact top 10 for every query still comes 100% from the query's own centre, because centres are near-orthogonal in 768 dimensions. What the noise does is lower the contrast between neighbours.
- Query vectors: 100 held-out points, 10 per campaign, a random centre of that campaign, same noise. Table `queries`.
- Hardness (exact cosine distance within the campaign, 100 queries): mean d1 = 0.7720, mean d10 = 0.8025, **mean d1/d10 = 0.962** (min 0.933, max 0.990), mean d10/d11 = 0.998. The nearest neighbour is barely closer than the 10th, so the data is not trivially separable at the neighbour level. It is cleanly separable at the cluster level (top-10 own-centre share 1.000). This is close to the worst case for graph indexes.

## Build

| Item | Value |
| --- | --- |
| Index | `USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64)` (stand-in schema settings) |
| `maintenance_work_mem` | 4 GB (raised from the 64 MB default) |
| `max_parallel_maintenance_workers` | **0 (serial build)**. First attempt with 8 workers failed with `could not resize shared memory segment ... No space left on device`: a parallel HNSW build needs a shared segment the size of `maintenance_work_mem`, and the container's `/dev/shm` is 64 MB. |
| Build time | **239.9 s** (serial) |
| HNSW size | **1,074 MB** (heap 859 MB; btree on `campaign_id` 3,752 kB) |
| Partitioned table, 10 per-partition HNSW indexes | 212.6 s, 1,074 MB total |
| 10 partial HNSW indexes (`WHERE campaign_id = k`) on a plain copy | 214.8 s, 1,074 MB total |

## Results

100 queries, one warm-up pass, then one timed pass. Latency is server-side wall time per query (`clock_timestamp()` around `EXECUTE` in a PL/pgSQL loop), so it includes planning and excludes the client round trip. Recall is against mode (iii). "short" is the number of queries returning fewer than 10 rows. Per-query rows are in the `bench` table of `vecscale`; the full summary is `exp4d/summary_all.txt`.

### Pre-registered modes

| Mode | `ef_search` | recall@10 | short | p50 ms | p95 ms |
| --- | --- | --- | --- | --- | --- |
| (iii) exact, btree on `campaign_id` | n/a | 1.000 | 0 | 37.1 | 43.1 |
| (i) HNSW + filter | 40 (default) | 0.051 | 79 | 1.6 | 3.9 |
| (i) | 100 | 0.089 | 71 | 3.1 | 7.7 |
| (i) | 200 | 0.129 | 62 | 6.0 | 10.0 |
| (ii) `relaxed_order` | 40 | 0.180 | 0 | 11.9 | 61.0 |
| (ii) | 100 | 0.204 | 0 | 16.6 | 66.2 |
| (ii) | 200 | 0.222 | 0 | 18.4 | 79.4 |

Neither (i) nor (ii) passes. (i) fails on recall and on row count (62 to 79 of 100 queries return fewer than 10 rows). (ii) fixes the row count but recall stays at 0.18 to 0.22.

### Extra modes (labelled x; settings and index design)

| Mode | `ef_search` | recall@10 | short | p50 ms | p95 ms | Pass? |
| --- | --- | --- | --- | --- | --- | --- |
| x: filter, iterative off | 1000 | 0.302 | 28 | 34.4 | 50.5 | no |
| x: `relaxed_order`, max_scan_tuples 20k | 1000 | 0.348 | 0 | 39.6 | 103.3 | no |
| x: `relaxed_order`, max_scan_tuples 100k | 200 | 0.223 | 0 | 20.5 | 94.8 | no |
| x: `relaxed_order`, max_scan_tuples 100k | 1000 | 0.348 | 0 | 42.0 | 111.9 | no |
| x: `relaxed_order`, max_scan_tuples 1M, scan_mem_multiplier 4 | 1000 | 0.349 | 0 | 39.1 | 102.1 | no |
| x: `strict_order` | 40 | 0.051 | 0 | 57.9 | 117.4 | no |
| x: `strict_order` | 200 | 0.129 | 0 | 30.7 | 124.4 | no |
| x: partitioned by campaign, HNSW per partition | 40 | 0.427 | 0 | 3.3 | 6.5 | no |
| | 100 | 0.520 | 0 | 6.3 | 10.0 | no |
| | 200 | 0.641 | 0 | 10.1 | 17.2 | no |
| | 400 | 0.805 | 0 | 15.9 | 22.0 | no |
| | 600 | 0.896 | 0 | 20.1 | 29.9 | no |
| | 800 | 0.947 | 0 | 27.3 | 39.2 | no (recall) |
| | **1000** | **0.980** | 0 | 36.0 | **45.3** | **yes** |
| x: partial HNSW per campaign | 40 | 0.428 | 0 | 3.1 | 7.5 | no |
| | 100 | 0.529 | 0 | 6.3 | 10.5 | no |
| | 200 | 0.644 | 0 | 11.0 | 17.3 | no |
| | 400 | 0.817 | 0 | 15.4 | 22.4 | no |
| | **1000** | **0.974** | 0 | 34.8 | **46.8** | **yes** |

The partitioned and partial modes at ef 40 to 1000 were run twice (first pass and second pass); recall was identical, latencies differed by a few ms. The table shows the last run.

Unfiltered sanity check (20 queries, no `WHERE`, `ef_search = 200`, whole-table HNSW against exact): recall@10 = 0.180.

## Plans (EXPLAIN (ANALYZE, BUFFERS), query 1, campaign 1; full text in `exp4d/explain.log`)

- **(iii) exact:** `Limit -> Sort (top-N heapsort) -> Index Scan using items_campaign_btree`, 55,000 rows fetched, 11,049 buffers read, 84 ms for this single cold-ish run (the 37 ms median is warm). The only nudge: the order key is written `(embedding <=> q) + 0`, which stops the planner choosing the HNSW index. It then picks the btree by itself.
- **(i) HNSW + filter:** `Index Scan using items_embedding_hnsw` with `Filter: (campaign_id = 1)`, 27 rows removed by the filter, 10 rows for this query. **No planner nudge was needed**: with the btree on `campaign_id` present, the planner chose HNSW on its own in every (i) and (ii) plan I inspected. This query happened to return 10 rows; across the 100 queries, 62 to 79 did not.
- **(ii) relaxed_order:** same plan node (the iterative scan is a GUC, not visible in the plan); it scans further into the index until LIMIT is met (3,807 buffers hit at `ef_search = 200`).
- **Partitioned / partial:** `Index Scan using items_part_1_embedding_idx` (pruned to one partition) and `items_pi_hnsw_c1` (no filter node); 28 to 30 ms for query 1 at `ef_search = 1000`.

## Limitations

- Isotropic Gaussian clusters in 768-d have near-uniform neighbour distances (d1/d10 = 0.96). HNSW recall is far worse on this than on typical text embeddings, so the failure of (i) and (ii), and the need for `ef_search = 1000`, may not carry over to real data. I did not rerun at lower noise.
- The campaign filter is perfectly correlated with cluster structure here (campaigns have independent centres, so a query's global neighbours are mostly in its own campaign). Real campaigns may be less separated.
- Server-side timing only; `shared_buffers` is 128 MB, so reads rely on the OS cache after warm-up. One timed pass per mode after one warm-up pass, as specified.
- Serial index build because `/dev/shm` is 64 MB; parallel build times were not measured.
- The 0.95 recall bar was met only at the maximum allowed `ef_search` (1000), with p95 close to the exact scan, so the margin is small in both directions.
- The pass relies on index design not named in modes (i) to (iii): one index or partition per campaign. That is a schema and query-layer requirement (the query must carry a literal or bound `campaign_id` that the planner can match to a partial index or prune to a partition).

## Reproduce

All files are under `spikes/db-tooling/exp4d/`. Create `vecscale`, then run each with `docker exec -i db-tooling-db-1 psql -U postgres -d vecscale -v ON_ERROR_STOP=1 < file`:

1. `01_generate.sql` (about 6.5 min), `01b_queries.sql`, `04_data_check.sql` (output `data_check.log`)
2. `02_index.sql` (output `index.log`)
3. `03_bench_lib.sql` and `05_modes.sql` in one session (output `modes.log`), then `06_extra_settings.sql`
4. `07_design_alternatives.sql` (output `design.log`), then `08_design_modes.sql`
5. `09_explain.sql` (output `explain.log`)

`06` and `08` use the objects from `03_bench_lib.sql`, which persist in the database. The database `vecscale` is left in place with `items`, `queries`, `centres`, `items_part` (and partitions), `items_pi`, and `bench`.
