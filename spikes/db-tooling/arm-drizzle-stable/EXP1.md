# Arm B (stable): Drizzle ORM 0.45.4, Experiment 1

Code: `src/exp1.ts`. Tests: `test/exp1.test.ts`. SQL log: `exp1-sql.log` (every statement from drizzle's `logger.logQuery`). EXPLAIN: `out/exp1-explain.txt` (`COSTS OFF`, `enable_seqscan = off`). Q4 timing: `out/exp1-q4-timing.txt`.

Final `pnpm test` summary (full suite from clean databases; the Experiment 1 file ran in it):

```
 Test Files  9 passed (9)
      Tests  36 passed (36)
   Duration  10.27s (tests 70%, import 29%, transform 1%)
```

## 1. Versions

drizzle-orm 0.45.4, drizzle-kit 0.31.11, pg 8.23.1, TypeScript 7.0.x, vitest 5.1.0, Node 25.3.0, Postgres 18 with pgvector. The app connects as `skal_app` (RLS applies). `exp1_drizzle` is created from the `exp1_main` template in `beforeAll`; `exp1_main` is untouched.

## 2. Results

Raw share = non-whitespace characters inside `sql\`...\`` (including its `${}` interpolations) divided by the non-whitespace characters of the whole expression between the `@expr` markers. Lines = non-blank, non-comment lines in the same region. Counting script ran over `src/exp1.ts`.

| Query | Pass | Raw share | Typing | Lines |
|---|---|---|---|---|
| Q1 graph hops (6 rows, exact order and paths) | pass | 73.4% | full (`entityId: string`, `depth: number`, `path: string[]`, `displayName`) | 30 |
| Q2 FTS search | pass | 80.6% | full (rank `number`, headline `string`) | 17 |
| Q3 hybrid search (RRF) | pass | 88.9% | **partial**: rank columns typed `number`, but are `null` at runtime | 32 |
| Q4 claim | pass | 67.2% | full | 14 |
| Q4 complete | pass | 0.0% | full | 7 |
| Q4 retry | pass | 78.5% | full | 12 |
| RLS check (wrong tenant, empty tenant, null tenant; `claim_current` count 0) | pass | n/a | n/a | n/a |

Q4 concurrency (W1/W2/W3 with `FOR UPDATE SKIP LOCKED`): pass. W2 returned 10 ms after W1 claimed with W1's transaction still open; W3 returned 12 ms with W1 and W2 open. Nobody waited, no job was claimed twice, and the final job states matched the expected rows. Expected row values were not changed anywhere.

Shares are high because most of the interesting expressions are Postgres-specific (recursive CTE, `ts_rank_cd`, `websearch_to_tsquery`, `<=>`, `row_number() over`, `make_interval`, `case`). The builder carries the skeleton (from, joins, where, order, limit, `FOR UPDATE SKIP LOCKED`, `update ... returning`), and the typed result.

## 3. Raw fallbacks and why

| Query | Fallback | Reason |
|---|---|---|
| Q1 | `WITH RECURSIVE` body as `sql` inside `$with(...).as(sql...)` | `$with` emits plain `with`; there is no recursive form, and a CTE cannot reference itself in the builder. The raw body is nested in a typed CTE with explicit field types, so the rest of the query is builder. |
| Q1 | `array[...]`, `path \|\| id`, `<> all (path)`, `object ? 'entity'`, `->>` | No operators for arrays or jsonb in the builder. |
| Q2 | `ts_rank_cd(tsv, websearch_to_tsquery(config::regconfig, query))`, rounded | No full-text functions. Also `tsv @@ q` in `where` and `ts_headline`. |
| Q3 | `row_number() over (order by ...)` per CTE | No window-function API. |
| Q3 | `embedding <=> vector::halfvec(768)` | `cosineDistance()` exists, but takes a typed vector and was not used with the explicit `halfvec` cast and parameter as a JSON string. Raw is simpler and exact. |
| Q3 | `coalesce(id)`, RRF score `1/(60+rank)` | Arithmetic and `coalesce` have no builder form. |
| Q4 claim | `(tenant_id, id) in ${subquery}` | The builder has `inArray` for one column only; row-value IN needs `sql`. The subquery itself is a builder (`.for('update', { skipLocked: true })` works). |
| Q4 retry | `case when attempts >= 3 ...`, `make_interval(secs => 30 * attempts)` | No CASE expression or interval functions. |
| Q4 complete | none | Plain update with `returning`. |

## 4. What fought back

1. **No recursive CTE.** See above. Workable, but the CTE is only half typed: fields are declared by hand with `sql<T>\`name\`.as('name')`.
2. **Column builders as the `$with` selection overflow the stack** (`orderSelectedFields` recursion). The fix was to use aliased `sql` fields.
3. **Aliased `sql` fields from CTEs render as bare identifiers** in the outer query (no CTE prefix), so two CTEs with a same-named alias collide (Postgres `42702 ambiguous column`). Q3 needed distinct names (`fts_rank` / `vec_rank`, `vec_id`).
4. **Typing after `fullJoin` (Q3).** Drizzle does not mark aliased `sql` fields as nullable on the outer side of a full join; `sql<number | null>` did not change the inferred result either (the result stayed `number`). The data has nulls (for example `[4, null, 1, 0.016393]`), and the type says `number`. The test asserts the actual inferred type and records the mismatch. Scored "partial". A consumer would have to cast by hand.
5. **Row-value `IN`** needs raw SQL (see Q4 claim).
6. **Functions take `tx` through a factory** (`exp1(tx, tenantId)`), because drizzle queries are bound to a transaction and RLS needs `set_config` in one. This is a deviation from a fixed-parameter shape. Tenant isolation is by RLS plus an explicit `tenantId` predicate on the Q1/Q2/Q3 reads; Q4 relies on RLS alone for the tenant filter (the plan shows `tenant_id = current_setting(...)` injected by the policy).
7. **`mapWith(Number)`** is needed on `round(...)::numeric` and `row_number()` results, because pg returns `numeric` and `bigint` as strings.

## 5. EXPLAIN notes (`enable_seqscan = off`)

- Q1: recursive union drives from `claim_current_object_entity_idx`; entity read by `entity_campaign_idx`.
- Q2: `transcript_segment_session_idx` with the `tsv @@` as a filter. The generated tsv column's GIN index is not used by this plan on a small table.
- Q3: **the HNSW index is not used.** The vector side is a nested loop over `transcript_segment` joined to `segment_embedding_pkey`, with an exact sort by the distance, because the query joins and filters before ordering. The index would be used only for a pure `order by embedding <=> q limit k`.
- Q4: `job_ready_idx` Index Scan, `LockRows`, `Hash Semi Join` into the update.

## 6. Deviations

- Functions are created through the `exp1(tx, tenantId)` factory, not as free functions with fixed parameters.
- The raw-share measure counts `${...}` interpolations inside `sql` templates as raw, per the stated definition (non-whitespace characters inside the template).
- No expected values or criteria were changed. The one typing expectation in the Q3 test was corrected to the type drizzle actually infers, with the mismatch recorded above.
