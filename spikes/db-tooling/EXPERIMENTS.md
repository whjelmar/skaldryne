# Follow-up experiments for record 0017

The first round of this spike was tilted toward one arm in three ways:
- the brief favoured tools that keep the schema in code;
- the hardest queries were never written;
- no stable release line was tested.

These experiments address all three. This file pre-registers the fixtures, the expected results and the scoring. It is committed before any experiment code. Changing it afterwards needs a new commit that says why. The bias audit in `VERIFICATION.md` checks `git log` on this file.

Record 0017 stays Open whatever these experiments show.

## Environment

- **Postgres:** 18 with pgvector and pgTAP, container `db-tooling-db-1` on localhost:55432. Roles are as in [README.md](README.md).
- **Node.js 25.3.0, pnpm.** This deviates from decision 0004, which names the Active LTS line (24). It was chosen to match the first round, so the two rounds stay comparable. Nothing here depends on the Node major.
- **Local disk:** run everything from a local clone, not the network share. Use `pnpm --store-dir %USERPROFILE%\dev\.pnpm-store`.
- **Databases:** each arm uses its own prefix (below), and Experiment 1 gets one copy of the template per arm.

## Experiment 1: the hard queries

### What every arm queries

[reference/build-exp1.sh](reference/build-exp1.sh) builds the template database `exp1_main` from canonical SQL:
- the committed M1–M3 SQL files;
- [reference/exp1-m4.sql](reference/exp1-m4.sql) (M4);
- [reference/exp1-fixture.sql](reference/exp1-fixture.sql) (the fixture).

The script then copies the template once per arm: `exp1_kysely`, `exp1_drizzle`, `exp1_prisma7` and `exp1_prisma8`.

No tool's migrations touch these databases, because Experiment 1 tests only the query layer. The plan said to build the template through one arm's runner. Plain `psql` is used instead, so that no tool is involved.

M4 adds:
- `transcript_segment.ts_config regconfig`, plus a generated `tsv` with a GIN index;
- `segment_embedding (halfvec(768), HNSW)`;
- an expression index on `claim_current ((object->>'entity'))`;
- a `job` table with RLS.

A relationship is a claim whose `object` is `{"entity": "<uuid>"}`.

The fixture is deterministic. In tenant A:
- **e1–e9:** entities `0000000a-0001-7000-8000-00000000000N`;
- **A1:** the English campaign `0000000a-0000-7000-8000-000000000001`;
- **A2:** the German campaign `…0002`;
- **segments:** `0000000a-0002-7000-8000-0000000000NN` for English, `…00000001NN` for German;
- **jobs:** `0000000a-0003-7000-8000-00000000000N`.

Tenant B holds the decoys:
- an edge into e3;
- a "cult leader" segment whose embedding equals the query vector;
- two ready jobs due before tenant A's.

If RLS leaks, these show up first.

### Rules for every arm

- **Blind authoring.** One agent per tool. It gets this file, the `reference/` directory and its own arm, never another arm's Experiment 1 code.
- **Use the tool's own API.** Express each query through the tool's own query API as far as it reasonably goes. Fall back to raw SQL only for the parts the API cannot express, and record each fallback with the reason. Every arm gets this same instruction.
- **Connections.** Connect as `skal_app` and set the tenant with the arm's `withTenant` (`set_config('app.tenant_id', $1, true)` inside a transaction).
- **Arms and versions:**

  | Arm | Directory | Tool | Types from |
  | --- | --- | --- | --- |
  | Kysely | `arm-kysely-stable/` | kysely 0.29.6 | kysely-codegen against `exp1_kysely` |
  | Drizzle | `arm-drizzle-stable/` | drizzle-orm 0.45.x | its schema declarations (add the M4 tables; do not run generate against `exp1_*`) |
  | Prisma 7 (reference) | `arm-prisma7/` (new) | prisma 7.10.0 | `prisma db pull` against `exp1_prisma7`; TypedSQL allowed |
  | Prisma 8 RC (reference) | `arm-prisma/` | prisma 8.0.0-rc.x | `prisma db pull` against `exp1_prisma8`; TypedSQL allowed |

  Note on Prisma: on npm, `prisma@latest` currently resolves to 8.0.0-rc.19, and 7.10.0 is tagged `prev`. Install exact versions.
- **Test file.** Each arm writes `test/exp1.test.ts`, and `pnpm test` runs it. A `beforeAll` recreates the arm's copy from `exp1_main`, connecting as `postgres` to run `CREATE DATABASE exp1_<arm> TEMPLATE exp1_main OWNER skal_migrator`.
- **Function shapes.** Names may follow the arm's style. The parameters and result fields are fixed:
  - `graphHops(startId)` returns `{ entityId, displayName, depth, path }[]`
  - `searchSegments(campaignId, config, query)` returns `{ id, sessionNo, startMs, rank, headline }[]`
  - `hybridSearch(campaignId, config, query, queryVector)` returns `{ id, ftsRank, vecRank, score }[]`, where `ftsRank` and `vecRank` may be null
  - `claimJobs(worker, n)`, `completeJob(id, worker)` and `retryJob(id, worker)`
- **SQL log.** Log the SQL each function sends to `exp1-sql.log`, so the verifier can compare its shape with [reference/exp1-queries.sql](reference/exp1-queries.sql).

Constants used below:
- tenant A is `00000000-0000-7000-8000-00000000000a`;
- the start entity is e3 (`0000000a-0001-7000-8000-000000000003`);
- the query vector is element `i` = `Math.sin(4.5 * 0.37 + i * 0.05)` for i = 0..767.

### Q1: graph hops

Find every entity that reaches the start entity within 1–3 hops, following edges backwards (subject → `{"entity": target}`). For each one, return the shortest depth and its path. Cycles must not loop. Order by depth, then display name.

Expected, with start e3 under tenant A. Paths are entity ordinals, starting at e3:

| displayName | depth | path |
| --- | --- | --- |
| Brother Calder | 1 | e3, e2 |
| Duke Orsolo | 1 | e3, e4 |
| Archivist Mira | 2 | e3, e2, e1 |
| Envoy Tamsin | 2 | e3, e4, e5 |
| Ferryman Gaunt | 2 | e3, e2, e6 |
| Grey Abbess | 3 | e3, e2, e6, e7 |

These must not appear:
- e9: four hops away;
- e8: its edge was superseded by version 2;
- tenant B's Intruder;
- e3 itself.

The test fails on any extra row or wrong order.

### Q2: full-text search

Search one campaign with `websearch_to_tsquery(config, query)`, filtered with `tsv @@ q`. Return `ts_rank_cd(tsv, q)` rounded to 4 dp, and `ts_headline(config, text, q)` with default options. Order by rank descending, then session number, then start time. Limit 10.

Expected for A1, `english`, `cult or leader`. Ids are segment ordinals:

| id | sessionNo | startMs | rank | headline |
| --- | --- | --- | --- | --- |
| 01 | 1 | 0 | 0.2000 | `The <b>cult</b> <b>leader</b> spoke from the ashen altar while the crowd chanted.` |
| 02 | 1 | 10000 | 0.1000 | `Mira found a letter from the <b>cult</b> hidden in the archive.` |
| 03 | 1 | 20000 | 0.1000 | `Brother Calder denied any link to the <b>leader</b> of the Ashen Eye.` |
| 05 | 1 | 40000 | 0.1000 | `<b>Leaders</b> of the guilds met to discuss the missing grain.` |
| 07 | 2 | 0 | 0.1000 | `A <b>cult</b> symbol was carved into the hull of the ferry.` |
| 09 | 2 | 20000 | 0.1000 | `Nobody mentioned the <b>cult</b> again until the final session.` |
| 11 | 2 | 40000 | 0.1000 | `Cultists followed their <b>leader</b> into the catacombs beneath the abbey.` |

Expected for A2, `german`, `Kult`:

| id | sessionNo | startMs | rank | headline |
| --- | --- | --- | --- | --- |
| 101 | 1 | 0 | 0.1000 | `Der <b>Kult</b> versammelte sich im Wald.` |
| 102 | 1 | 10000 | 0.1000 | `Die Anführerin des <b>Kultes</b> sprach leise.` |

The config arrives as a parameter, not a literal.

### Q3: hybrid search by reciprocal rank fusion

Two ranked lists, each capped at 10, over campaign A1:
- **full text:** `ts_rank_cd` descending, ties broken by id;
- **vector:** cosine distance `<=>` to the query vector as `halfvec(768)`, ascending, ties broken by segment id. Distance is computed in the database.

Ranks come from `row_number()`. Merge the lists with a FULL OUTER JOIN on id, and score each row as `1/(60 + ftsRank) + 1/(60 + vecRank)`, where a missing side contributes 0. Round the score to 6 dp. Order by score descending, then id. Limit 10.

Expected for A1, `english`, `cult or leader`, with the query vector above:

| id | ftsRank | vecRank | score |
| --- | --- | --- | --- |
| 05 | 4 | 2 | 0.031754 |
| 03 | 3 | 3 | 0.031746 |
| 02 | 2 | 5 | 0.031514 |
| 01 | 1 | 7 | 0.031319 |
| 07 | 5 | 6 | 0.030536 |
| 09 | 6 | 9 | 0.029644 |
| 04 | – | 1 | 0.016393 |
| 06 | – | 4 | 0.015625 |
| 11 | 7 | – | 0.014925 |
| 08 | – | 8 | 0.014706 |

Vector ranks 1 and 2 (segments 04 and 05) are close. The database's halfvec rounding decides them, so they are deterministic when the distance is computed in the database. If an arm sees them swapped, the verifier compares the raw distances before calling it a failure.

### RLS check (part of Q1–Q3)

Run Q1, Q2 and Q3 with no tenant set (a transaction with `app.tenant_id` = ''). Each must return zero rows. A count of `claim_current` under the same conditions is 0.

### Q4: SKIP LOCKED job queue

| Operation | SQL shape | Effect |
| --- | --- | --- |
| Claim | `UPDATE job … WHERE (tenant_id, id) IN (SELECT … WHERE state = 'queued' AND run_after <= now() ORDER BY run_after, id LIMIT n FOR UPDATE SKIP LOCKED) RETURNING id, kind, payload, attempts` | Sets `state = 'running'`, `locked_by = worker`, `locked_at = now()`, `attempts + 1`. |
| Complete | `WHERE id AND locked_by = worker` | Sets `state = 'done'` and clears the locks. |
| Retry | `WHERE id AND locked_by = worker` | Sets `state = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END` and `run_after = now() + 30 s × attempts`, clears the locks, and returns `id, state, attempts`. |

Expected sequence on a fresh copy, using two separate pooled connections:

1. W1 opens a tenant-A transaction and claims n = 3. It gets jobs 01, 02 and 03, each with attempts 1. W1 does **not** commit yet.
2. Concurrently, W2 opens a tenant-A transaction and claims n = 3. It gets jobs 04, 05 and 06 without waiting. Job 06 now has attempts 3. W3 claims n = 3 in a third transaction and gets nothing.
3. W1 and W2 commit.
4. Then:
   - W1 completes 01, which becomes `done`;
   - W1 retries 02, which becomes `queued` with attempts 1 and `run_after` ≥ now() + 25 s;
   - W2 retries 06, which becomes `failed` with attempts 3;
   - W2 tries to complete 03, which is held by W1, and changes 0 rows.
5. Job 07 (due in 2999) and job 08 (done) are unchanged. Tenant B's two jobs are still `queued` with attempts 0. Verify this as `skal_migrator`.

Step 2 must show that the claims don't block. Either W2's claim finishes while W1's transaction is still open, or the test fails on a timeout of 5 s.

### Scoring, per query, per arm

| Measure | Definition |
| --- | --- |
| **Pass** | The rows equal the expected rows exactly: ids, order, depth, path, rank to 4 dp, headline string and score to 6 dp. Rounding may happen in SQL or in TypeScript. For Q4, every step of the sequence holds. Anything else is a fail, with the difference recorded. |
| **Raw SQL share** | Non-whitespace characters inside raw-SQL escapes, divided by non-whitespace characters of the whole query expression. The expression runs from the first builder or raw call to the execute call, excluding comments. Raw escapes are `sql\`…\``, `sql.raw`, `$queryRaw`/`$executeRaw`, and TypedSQL `.sql` files (counted in full). **Mostly raw** means a share above 50%. The author reports the share, and the verifier recomputes it. |
| **Result typing** | **yes:** the tool derives the row type from its schema or from the database, with every field a concrete type and no row type written by the author. **partial:** the author supplies an unchecked row type (a generic on a raw call, or a cast), or some fields are `any`/`unknown`. **no:** the rows are `any`/`unknown`/untyped. |
| **Lines of code** | Non-blank, non-comment lines in the function or functions implementing the query. This excludes `withTenant`, generated types and the test. |
| **EXPLAIN** | Record `EXPLAIN (COSTS OFF)` for each query with `enable_seqscan = off`. **This is evidence, not part of the score.** On a 16-row fixture the planner chooses among indexes without regard to how the SQL was produced. The reference SQL itself does not reach HNSW or GIN on this fixture (checked before any arm was written): Q1 uses `claim_current_object_entity_idx` and Q4 uses `job_ready_idx`. The verifier instead checks that each arm's logged SQL keeps the reference's index-relevant shape: `tsv @@ q`, `<=>` against a `halfvec(768)` value, `object ->> 'entity'` with `object ? 'entity'`, and `state = 'queued'`. |
| **What fought back** | Free text, with evidence. |

Each arm writes `EXP1.md` with:
- the exact versions;
- a table of query × {pass, raw share, typing, lines};
- every raw fallback with its reason;
- the EXPLAIN output;
- what fought back.

## Experiment 2: Kysely on a stable migration runner

`arm-kysely-stable/` is a copy of `arm-kysely` with **graphile-migrate 1.4.1** (the stable line) and kysely 0.29.6. Its databases use the prefix `kysely14_`.

| Test | Pass criterion |
| --- | --- |
| T1–T8 | Rerun unchanged. Compare the scores with `arm-kysely/RESULTS.md`, and explain any difference. |
| T9 (CONCURRENTLY) | Migration `000004` is marked `--! no-transaction` and runs `CREATE INDEX CONCURRENTLY`. It applies, and `pg_index.indisvalid` is true. Because Postgres rejects CONCURRENTLY inside a transaction block, a successful apply is the evidence that no transaction was open. Record the runner's output. |
| T10a (killed transactional file) | A migration does DDL and then `pg_sleep(30)`. A second connection kills it with `pg_terminate_backend`. Afterwards the schema is unchanged and the migration is not recorded as applied. A rerun with the sleep removed completes. |
| T10b (killed no-transaction file) | The T9 file is killed the same way during the build. Record whether an INVALID index is left and what a rerun does. **Pass:** the rerun ends with a valid index, either through the runner or through an idempotent file such as `DROP INDEX CONCURRENTLY IF EXISTS` before the create. The runner must never report success while the index is INVALID. |
| T7 tamper check | Edit an applied committed file and rerun. Record whether 1.4.1 detects it, in the same way as the first round. This is reported, not scored as a must-have. |

**Must-haves:** T6, T7, T9 and T10. If 1.4.1 fails one, stop and report. The fallback would be a runner of our own of at most 150 lines, and it is built only after the maintainer confirms.

## Experiment 3: Drizzle on its stable line

`arm-drizzle-stable/` is a copy of `arm-drizzle` with **drizzle-orm 0.45.x** and **drizzle-kit 0.31.x**. Its databases use the prefix `drizzle045_`. Use `generate` and `check` only; never use `push`.

| Test | Pass criterion |
| --- | --- |
| Schema features | Each item is scored pass, partial or fail: `pgPolicy` generates `CREATE POLICY` with `USING`/`WITH CHECK`; `halfvec(768)` generates; the HNSW index generates with `halfvec_cosine_ops` and `m`/`ef_construction`. List everything that needs raw SQL in 0.45 but did not in the 1.0 RC. |
| T1–T8 | Rerun. Compare with `arm-drizzle/RESULTS.md`, and explain any difference. |
| T4 (focus) | After M1–M3, `generate` proposes no change. Record the exact filter or config needed, and whether it still tries to drop partitions, triggers, functions or policies. |
| T6 (focus) | A migration that fails halfway leaves the database unchanged. Record how drizzle-kit 0.31 groups pending migrations into transactions, and what that means for a batch where only the second file fails. |

Record exact versions and every difference from the 1.0 RC results.

## Verification and bias audit

- **Verifier.** A separate agent, not one of the authors, reruns every arm's `pnpm test` from a clean database on local disk. It checks each result against this file, recomputes the raw SQL shares and appends its findings to `VERIFICATION.md`.
- **Critic.** Another agent checks for bias:
  - Did any arm get easier fixtures, looser criteria or extra help?
  - Did this file change after results came in?

  It appends to `VERIFICATION.md` too.
