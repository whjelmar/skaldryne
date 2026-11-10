# Arm Kysely-stable results: Experiment 1 (Q1 to Q4, RLS check)

Queries are in `src/exp1.ts` (BEGIN/END markers per query), tests in `test/exp1.test.ts`, metrics script in `scripts/exp1-metrics.ts`. Database `exp1_kysely` is recreated from `exp1_main` (`CREATE DATABASE ... TEMPLATE`) at the start of the test file. `exp1_main` was not modified.

**Suite summary (`pnpm test`, final run, clean database):**

```
 Test Files  1 failed | 10 passed (11)
      Tests  1 failed | 30 passed (31)
```

All 7 Experiment 1 tests pass. The one failure is the Experiment 2 test T10b (see [RESULTS.md](RESULTS.md)).

## Versions

kysely 0.29.6, kysely-codegen 0.20.0, pg 8.23.1, graphile-migrate 1.4.1 (not used by Experiment 1), typescript 5.9.3, vitest 4.1.11. Node v25.3.0, PostgreSQL 18 with pgvector (container `db-tooling-db-1`). Types: `src/db/types-exp1.ts`, generated from `exp1_kysely`.

## Results

All expected values from the spec were met on the first run. No expected value or criterion was changed.

| Query | Pass | Raw SQL share | Mostly raw | Result typing | Lines of code |
| --- | --- | --- | --- | --- | --- |
| Q1 graph hops | pass | 22.7% (25.6% if `sql.lit` counted) | no | partial | 50 |
| Q2 FTS + rank + headline (A1 english, A2 german) | pass | 12.7% | no | partial | 25 |
| Q3 hybrid FTS + vector, RRF | pass | 15.1% | no | partial | 66 |
| Q4 SKIP LOCKED queue (claim, complete, retry) | pass | 9.8% (claim 8.8%, complete 0.0%, retry 16.4%) | no | yes | 48 (25 + 9 + 14) |
| RLS check (Q1 to Q3 with an empty tenant context, `claim_current` count) | pass | n/a | n/a | n/a | n/a |

Method (spec definitions): raw share is the non-whitespace characters inside `sql` tagged templates (including the `<T>` generic) divided by the non-whitespace characters of the expression from `tx` to `.execute()`, comments excluded. `sql.lit("entity")` is not in the spec's list of raw escapes, so the headline figure does not count it; Q1 is also given with it counted. The Q1 to Q3 functions include a `ctx` parameter used only by the RLS check, so they are a line or two longer than they need to be. Lines are non-blank, non-comment lines of the functions, including the signature and the `withTenant` call line itself, excluding the `withTenant` implementation and generated types. Run `node scripts/exp1-metrics.ts` to recompute.

Typing assessment, by the spec definition (unchecked author-supplied type or `any` fields = partial):

- **Q1 partial.** `depth` and `path` come from author-written generics (`sql<number>`, `sql<string[]>`) because the recursive CTE columns are typed `any`.
- **Q2 partial.** `rank` goes through `eb.cast<number>`, `headline` through `eb.fn<string>("ts_headline")`, both author-written types that the compiler does not check against the database.
- **Q3 partial.** `r` through `eb.cast<number>`, `score` through `sql<number>`. `id` is `string | null` because `coalesce` over a full join is nullable.
- **Q4 yes.** `id, kind, payload, attempts, state` all come from the generated column types. The generics on `eb.fn<Date>("now")` are on inputs and do not appear in the result rows.

## Raw SQL fallbacks and why

Each is marked `// RAW:` in the source.

| Query | Fragment | Reason |
| --- | --- | --- |
| Q1 | `sql<number>\`1\`` as `depth` | no builder for a bare typed constant select item |
| Q1 | `array[(c.object ->> 'entity')::uuid, c.subject_id]` | no `ARRAY[]` constructor |
| Q1 | `sql.lit("entity")` as the right side of `?` | a bound parameter would not match the partial index predicate, so the operand must be a literal. This is a helper, not a tagged template. |
| Q1 (x2) | `sql<string>\`c.object ->> 'entity'\`` | codegen types `jsonb` as `Json`, a union that includes primitives, so `.key("entity")` on the reference is typed `never` |
| Q1 | `sql<string>\`w.entity_id::text\`` | `uuid` to `text` cast of a CTE column typed `any` |
| Q1 | `sql<number>\`w.depth + 1\`` | arithmetic on a CTE column typed `any` |
| Q1 | `sql<string[]>\`w.path \|\| c.subject_id\`` | array concatenation |
| Q1 | `sql<boolean>\`c.subject_id <> all (w.path)\`` | `<> ALL(array)` |
| Q2, Q3 | `sql<{ q: string }>\`websearch_to_tsquery(${config}::regconfig, ${query})\`.as("q")` | a function with a parameterised `regconfig` used as a FROM source |
| Q3 | `sql\`e.embedding <=> ${qv}::halfvec(768)\`` | pgvector operator, halfvec cast |
| Q3 | `sql<number>\`round(coalesce(1.0 / (60 + f.r), 0) + coalesce(1.0 / (60 + v.r), 0), 6)::float8\`` | numeric arithmetic on nullable operands from a full join |
| Q4 claim | `sql<boolean>\`(tenant_id, id) in (${ready})\`` | Kysely types a tuple `IN` as a one-column subquery. The subquery `ready` itself is built with the builder, including `.forUpdate().skipLocked()`. |
| Q4 retry | `sql<Date>\`now() + make_interval(secs => 30 * attempts)\`` | `make_interval` takes a named argument (`secs =>`), which `eb.fn` cannot express |

Builder-expressed parts: joins including `fullJoin`, `distinctOn`, recursive CTE with `unionAll`, `row_number() over (...)`, `coalesce`, `case`, `ts_rank_cd`, `round`, `ts_headline` via `eb.fn`, `@@` via `eb(...)`, `?` via `where(col, "?", ...)`, `FOR UPDATE SKIP LOCKED`, `UPDATE ... RETURNING`.

The SQL Kysely emitted for the passing runs is in `exp1-sql.log`.

## EXPLAIN (COSTS OFF), `enable_seqscan = off`

Replayed as `skal_app` with tenant A set, using the parameters from the SQL log. Full output: `reports/exp1-explain.log`.

- **Q1:** both arms of the recursive CTE use `claim_current_object_entity_idx`. The other index conditions are applied as filters.
- **Q2:** `transcript_segment_session_idx` with `Filter: tsv @@ ...`. The GIN index is not used. This matches the spec's note that GIN/HNSW are not reached on this fixture.
- **Q3:** the FTS side uses `transcript_segment_session_idx` with a filter. The vector side uses `segment_embedding_pkey` and `transcript_segment_session_idx`, then sorts by `<=>`. The HNSW index is not used (same note).
- **Q4 claim:** `job_ready_idx` with `Index Cond: ((state = 'queued') AND (run_after <= now()))`, even though `state` is a bound parameter in the emitted SQL (`$1`). The outer update uses a bitmap scan on `job_pkey`. **Complete and retry:** `job_pkey`, with `locked_by` as a filter.

## What fought back

1. **`.key()` on `jsonb` is typed `never`.** Codegen types `jsonb` as `Json` (a union with primitives), so the JSON path helpers do not apply. Cost: two raw `->>` fragments in Q1.
2. **Recursive CTE columns are `any`.** `withRecursive("walk(entity_id, depth, path)")` gives no column types, so everything touching `w.*` needs a raw fragment or a generic. This is why Q1's typing is only partial.
3. **Row-value `IN` (subquery).** The tuple form is typed as one-column, so the Q4 claim predicate is raw. The subquery is still builder-made.
4. **`make_interval(secs => ...)`.** Named arguments cannot be expressed through `eb.fn`.
5. **`?` operator and partial index.** The operator itself works with `where(col, "?", operand)`, but the operand must be `sql.lit` or the planner cannot match the partial index predicate. Without knowing that, Q1 would silently lose its index.
6. **`<=>` and vectors.** No type for the operator; halfvec is `string` in the generated types, so the query vector is passed as a text literal `[...]` and cast in SQL.
7. **`coalesce` nullability.** `eb.fn.coalesce("f.id", "v.id")` makes `id` `string | null`, so the test needs `r.id!`. The ids are non-null in this data; the compiler cannot know.
8. **`regconfig` as a cast target** needs `sql\`regconfig\`` because it is not in Kysely's data type list.
9. **Test-harness slip, not a tool problem.** A `\b` in a regex that I generated through a shell heredoc turned into a backspace character and made the SQL logger record nothing. I fixed it and the log is complete (30 statements).
10. **Policy-level observation.** `completeJob` and `retryJob` do not filter on `tenant_id`; they depend on RLS plus `id` and `locked_by`. The plans show the tenant filter coming from RLS and `job_pkey` is used.
