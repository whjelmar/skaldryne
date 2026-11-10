# Arm B (stable): Drizzle ORM 0.45.4 + Drizzle Kit 0.31.11, Experiment 3

Same eight tests as `../arm-drizzle/RESULTS.md` (the 1.0 RC arm), rerun on the stable line. Databases use the `drizzle045_` prefix. Experiment 1 is in [EXP1.md](EXP1.md).

Final `pnpm test` from a freshly recreated set of databases (bootstrap drops and recreates them):

```
$ node scripts/bootstrap.ts && node node_modules/typescript/bin/tsc --noEmit && node node_modules/vitest/vitest.mjs run
 Test Files  9 passed (9)
      Tests  36 passed (36)
   Duration  10.27s (tests 70%, import 29%, transform 1%)
```

(9 files: T1 to T8 plus `exp1.test.ts`. T1 to T8 are 29 tests; Experiment 1 adds 7.)

## 1. Versions

drizzle-orm 0.45.4, drizzle-kit 0.31.11, pg 8.23.1, TypeScript 7.0.x, vitest 5.1.0, Node 25.3.0, Postgres 18 (pgvector, pgTAP). drizzle-kit commands used: `generate`, `check`, `migrate` only. `push` was never run.

## 2. Per-test comparison with the 1.0 RC arm

| Test | RC arm | Stable arm | Difference |
|---|---|---|---|
| T1 Tenant isolation | pass | pass | None. `pgPolicy` with USING and WITH CHECK generates natively. Partition REVOKE is raw in both. |
| T2 Pooling | pass | pass | None. |
| T3 Vectors | pass | pass | None in behaviour. `halfvec(768)`, the HNSW index with `halfvec_cosine_ops` and `m=16, ef_construction=64` generate natively on 0.45. |
| T4 Triggers and partitions survive | pass | pass | Method differs: the RC arm used `push --explain`, which does not exist in 0.45. Replaced by `generate` and `check` (offline) plus `generate` under `RAW_INTROSPECTION` with no database. See section 4. |
| T5 Expand and contract | pass | pass | None in behaviour. File layout differs (flat files plus a journal). |
| T6 Safe to repeat | pass | pass | Failure semantics are the same (one transaction for all pending files). New 0.45-specific findings in section 5. |
| T7 Fleet | pass | pass | State rows are `(id, hash, created_at)`, with no name column, so the migration names come from the journal. Fleet comparison uses the catalog fingerprint plus the applied rows. |
| T8 CI fit | pass | pass | squawk runs over `drizzle/NNNN_name.sql` (flat files). pgTAP 55/55. |

## 3. Schema features: native or raw in 0.45, against the RC

| Feature | 0.45 | RC | Needs raw SQL in 0.45 but not in RC? |
|---|---|---|---|
| `pgPolicy` (USING / WITH CHECK, enables RLS) | native | native | no |
| `halfvec(768)` | native | native | no |
| HNSW with `halfvec_cosine_ops`, `m`, `ef_construction` | native | native | no |
| `bytea` column | **no builder**; `customType` (still typed, still generated as `bytea`) | native | yes, a small `customType` shim in `src/schema/define.ts` |
| Generated tsvector column (`generatedAlwaysAs`) | native | native | no |
| Partitioning (`PARTITION BY`, `PARTITION OF`) | raw | raw | no |
| Triggers, functions | raw | raw | no |
| GRANT / REVOKE | raw | raw | no |
| `CREATE EXTENSION vector` | bootstrap (`postgres` role) | same | no |

Other API differences (not SQL): `AnyPgColumnBuilder` is called `PgColumnBuilderBase`; there is no `push --explain`; migrations are flat `NNNN_name.sql` files plus `meta/_journal.json`, not folders holding `migration.sql` and a snapshot per folder; the `__drizzle_migrations` table has no name column.

Net answer: the only schema feature that needs hand-written code in 0.45 and not in the RC is `bytea`, and the workaround is typed.

## 4. T4 focus: exact filter, drop behaviour

- `generate` and `check` are offline: they diff the TS schema against the last snapshot. They never connect, so they cannot propose to drop partitions, triggers, functions or policies. With the RAW_INTROSPECTION flag (which removes `tablesFilter`) and no database, `generate` still says "No schema changes, nothing to migrate" (`out/t4-generate-no-db-no-filter.txt`). `check` says "Everything's fine" (`out/t4-check.txt`).
- The filter that the RC arm needed for `push` is `tablesFilter: ['!claim_version_p*']` plus `schemaFilter: ['public']`. It is kept in `drizzle.config.ts`. In 0.45 it only affects `push`, `pull` and introspection. It has no effect on `generate` or `check`, so the offline workflow does not need it.
- Not tested, by instruction: what `push` would drop. In 0.45 there is no `--explain` to preview that without risk. The filter is therefore protective only for anyone who runs `push` or `pull`.
- Catalog comparison against `reference/schema.sql`: no differences beyond the expected M2/M3 entity changes (`out/t4-catalog-diff.txt`).

## 5. T6 focus: transaction grouping, only the 2nd file fails

- The ORM migrator (`migrate()` from `drizzle-orm/node-postgres/migrator`) runs **all pending files in one transaction**. Proved with `pg_current_xact_id()` written from the first and the last pending file: identical xid.
- With four pending files and a `SELECT 1/0` placed at the start of only the second file, the error is `22012`, and the first file's `ADD COLUMN` is rolled back too. The database fingerprint equals the one before the run, and `__drizzle_migrations` still lists only the M1 rows. After restoring the file, the rerun applies everything.
- `drizzle-kit migrate` behaves the same (non-zero exit, first file rolled back), **but prints no Postgres error text at all**: the output ends at the spinner line "applying migrations..." (`out/t6-kit-migrate-batch.txt`). The failure reason is invisible without the programmatic migrator.
- Pending detection in 0.45 is `last created_at < journal.when`. Consequences, both tested:
  - Editing an already-applied file goes unnoticed. The hash is stored but never verified.
  - A file merged late with a `when` older than the newest applied row is skipped silently. No error, no warning, the table is never created.

## 6. Every difference from the 1.0 RC (summary)

1. No `bytea` builder (`customType`).
2. `AnyPgColumnBuilder` renamed to `PgColumnBuilderBase`.
3. No `push --explain`; T4 uses `generate`, `check` and an offline `generate` instead.
4. Flat migration files plus journal, instead of folders.
5. `__drizzle_migrations` has no name column; names come from the journal.
6. Pending detection by timestamp, with a silent skip for out-of-order files; the RC picks by folder name.
7. `drizzle-kit migrate` failure prints no error text.
8. `drizzle.config.ts` gained a `MIGRATIONS_OUT` override so tests can point `migrate` at a broken copy of the directory.
