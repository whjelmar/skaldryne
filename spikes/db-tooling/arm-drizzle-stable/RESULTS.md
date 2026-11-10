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

## Experiment 4a (round 3)

Versions: drizzle-orm 0.45.4 (`migrate()` from `drizzle-orm/node-postgres/migrator`), drizzle-kit 0.31.11 (`migrate` only, never `push`), pg 8.23.1, vitest 5.1.0, Node 25.3.0, Postgres 18 on localhost:55432. Tests: `test/exp4a.test.ts` (14 tests, all pass; databases `drizzle045_exp4a_*`; log in `out/exp4a.txt`). Run with `node node_modules/vitest/vitest.mjs run test/exp4a.test.ts` or `pnpm test`. Each test builds a temporary migrations folder (journal plus SQL files) and calls `migrate()` on one `pg.Client`, or the `drizzle-kit migrate` CLI via `DATABASE_URL` and `MIGRATIONS_OUT`.

| Test | Result | Evidence |
|---|---|---|
| T9 CONCURRENTLY | **fail** | No supported way to run a file outside a transaction. `migrate()` fails with SQLSTATE 25001 `CREATE INDEX CONCURRENTLY cannot run inside a transaction block`. The `drizzle-kit migrate` CLI exits 1 and prints only `applying migrations...` (no error text). Nothing is applied: the base file rolled back too. |
| T10a killed transactional file | **pass** | ALTER ADD COLUMN, then `pg_sleep(30)`; backend killed with `pg_terminate_backend`. `migrate()` rejects with `Failed query: rollback` / cause `Connection terminated unexpectedly`. Columns and `drizzle.__drizzle_migrations` rows are unchanged. Rerun with the sleep removed adds the column and records 2 rows. |
| T10b killed no-transaction file | **fail as specified (not applicable without a supported mechanism)**; see the workaround table below | Only reachable through the unsupported `COMMIT`/`BEGIN` trick. |
| T11 late merge | **fail** (confirms round 2) | Y (`when`=1500, tag `0001_y`) merged after X (`when`=2000) was applied. `migrate()` returns with no error. `branch_y` is never created. `drizzle-kit migrate` prints `migrations applied successfully!` and exits 0. Table rows: `created_at` 1000, 2000 only. |
| T7 tamper | reported: not detected | Edited an applied file. `migrate()` and the CLI exit 0 with no warning. Stored hash and rows are unchanged. The edit never runs. |

### T9: every mechanism looked at

- Source (`drizzle-orm/pg-core/dialect.js` `migrate()`): the loop over all pending files is always wrapped in one `session.transaction(...)`. The config accepts only `migrationsFolder`, `migrationsTable`, `migrationsSchema`. The journal's per-entry `breakpoints` flag is read by `readMigrationFiles` as `bps` and never used when executing. There is no per-file flag, no `no-transaction` marker, and no config switch (asserted by a test that greps these sources).
- Plain file: fails (above). File with the statement after `--> statement-breakpoint`: same error, because every statement runs on the same open transaction.
- `drizzle-kit migrate` CLI: same failure, with no database error in its output.
- Workaround, not a documented option: a file of the form `COMMIT;` / `--> statement-breakpoint` / `CREATE INDEX CONCURRENTLY ...;` / `--> statement-breakpoint` / `BEGIN;`. It ends the runner's transaction, runs the statement on the same connection, and opens a new transaction so the runner's own `insert` and `commit` still work. Result via `migrate()` and via the CLI: applies, `pg_index.indisvalid = true`, 2 rows recorded. The `COMMIT` also commits any earlier pending files in the same run (their bookkeeping rows are written file by file, so this stays consistent).

### T10b: patterns tried (all use the COMMIT/BEGIN workaround; a blocker transaction holding an `INSERT` on the table keeps the build in its wait phase, then the CIC backend is killed)

| Pattern | After kill | Rerun |
|---|---|---|
| 1. `DROP INDEX CONCURRENTLY IF EXISTS items_v_idx;` then `CREATE INDEX CONCURRENTLY items_v_idx ...` | `indisvalid=false`, `indisready=false`; 1 row recorded (base only) | succeeds; `indisvalid=true`; 2 rows |
| 2. `CREATE INDEX CONCURRENTLY IF NOT EXISTS items_v_idx ...` | same INVALID index; 1 row | runner **reports success** and records the migration; index stays `indisvalid=false` (Postgres only emits a notice that the relation exists) |
| 3. plain `CREATE INDEX CONCURRENTLY items_v_idx ...` | same INVALID index; 1 row | fails with 42P07 `relation "items_v_idx" already exists`; index stays INVALID; not recorded |

The runner never checks `indisvalid`. Whether it reports success while INVALID depends entirely on how the file is written (pattern 2 does). No pattern is a runner feature; each is SQL written inside the workaround.

### Surprising or notable

- A killed backend makes `pg` emit `error` on the checked-out client. With a `pg.Pool` as `migrate()` is normally given (`src/migrations.ts`), this is an uncaught exception that makes vitest fail. The test therefore uses one `pg.Client` with an `error` listener. This matters for any production runner that wraps `migrate()`.
- The reported error for a kill is `Failed query: rollback` (the rollback attempt on the dead connection), not the cause.
- T11 behavior is the same on the CLI as in `migrate()`: success message, exit 0, migration skipped.
- A failed CIC leaves nothing in the bookkeeping table (the workaround committed earlier statements, but the failing file was not recorded), so reruns do retry the file.

## Experiment 4a rerun with equal brief (round 3)

Independent rerun of the round-3 4a tests with a fixed, equal brief. Test file: `test/exp4a-rerun.test.ts` (30 tests, all pass; raw logs `out/exp4a-rerun.txt`, `out/exp4a-rerun-vitest.txt`). Databases use the prefix `drizzle045r_`. Run with `node node_modules/vitest/vitest.mjs run test/exp4a-rerun.test.ts`.

Versions: drizzle-orm 0.45.4 (`migrate()` from `drizzle-orm/node-postgres/migrator`, on a `pg.Pool` of size 1), drizzle-kit 0.31.11 (`migrate`, `generate`, `check`; `push` never run), pg 8.23.1, vitest 5.1.0, Node 25.3.0, Postgres 18 on localhost:55432.

Method notes and disclosures:
- Permissions denied reading `node_modules`, so no runner source was read. Behaviour below is empirical, plus the drizzle docs pages, which do not mention transactions or CONCURRENTLY.
- The earlier agent's `test/exp4a.test.ts` was not read. The earlier "Experiment 4a (round 3)" section of this file was read after my tests had run but before I wrote this section (a sequencing slip against the brief). The tests were not changed afterwards.
- Kills use `pg_terminate_backend`. Index builds are slowed with an IMMUTABLE plpgsql function that calls `pg_sleep(0.01)` over 2000 rows (about 20 s per build), so the killer reliably catches the build.
- vitest reports about 6 unhandled errors (`Connection terminated unexpectedly`) from killed pg connections in the COMMIT-workaround runs, even with a pool `error` listener. The tests themselves pass.

### Result table

| Test | Result | Evidence |
|---|---|---|
| T9 CONCURRENTLY via the runner's own mechanism | **fail** | Every supported form fails (P1 to P6 below). `migrate()`: SQLSTATE 25001 `CREATE INDEX CONCURRENTLY cannot run inside a transaction block`, the whole batch rolls back. `drizzle-kit migrate`: exit 1, output ends at the spinner, no error text. Works only with the undocumented COMMIT-first file (P7, P8, P7b, P7c): `indisvalid=true`, 2 rows recorded, via `migrate()` and the CLI. |
| T10a killed transactional file | **pass** | `ALTER ADD COLUMN` then `pg_sleep`, backend killed. Columns and `__drizzle_migrations` rows unchanged (1 row). Rerun adds the column, 2 rows. Same via CLI. Fresh DB with 2 pending files, kill in the 2nd: table from the 1st file absent, 0 rows (the batch is atomic). |
| T10b killed no-transaction file | **fail as specified**; pass only inside the undocumented hack | No supported pattern can run the statement, so there is nothing to kill (killed backends = 0). With the COMMIT hack: P7 and P8 end with a valid index on rerun, no manual SQL. P7b reports success on rerun while the index is INVALID (the runner never checks `indisvalid`). P7c fails on rerun with `relation "t_idx" already exists` (index stays INVALID, not recorded). |
| T11 late merge | **fail: silent skip** | Every ordering of a Y migration whose `when` is older than the applied X is skipped with no error and no warning from `migrate()` or the CLI (`migrations applied successfully!`, exit 0). Details below. |
| T7 tamper (reported only) | **not detected** | Edited an applied file. `migrate()` and the CLI exit 0. The stored hash is unchanged and the edit never runs. |

### T9 and T10b: every pattern tried

"Doc" is whether the pattern is ordinary SQL or a documented journal field, versus a hack that depends on how the runner issues statements.

| Pattern | Doc | T9 `migrate()` / CLI | T10b after kill, then rerun |
|---|---|---|---|
| P1 plain `CREATE INDEX CONCURRENTLY` | ordinary file | 25001 / exit 1, no text | nothing ran; rerun fails the same |
| P2 statement alone after `--> statement-breakpoint` | documented | 25001 / exit 1 | same |
| P3 journal entry `breakpoints:false` (whole file as one string) | documented config | 25001 / exit 1 | same |
| P4 `CREATE INDEX CONCURRENTLY IF NOT EXISTS` | ordinary SQL | 25001 / exit 1 | same |
| P5 `DROP INDEX CONCURRENTLY IF EXISTS` + `CREATE ...` (two breakpoints) | ordinary SQL | 25001 on the DROP / exit 1 | same |
| P6 `DO` block with `EXECUTE 'CREATE INDEX CONCURRENTLY ...'` | ordinary SQL | 25001 / exit 1 | same |
| P7 `COMMIT;` first, then `DROP ... IF EXISTS` and `CREATE ... CONCURRENTLY` | **not documented** | applies, valid / applies | INVALID after kill; rerun valid, 2 rows. **Pass** |
| P8 as P7 plus a trailing `BEGIN;` | **not documented** | applies, valid, no "no transaction" notice | same as P7. **Pass** |
| P7b `COMMIT;` then `CREATE ... IF NOT EXISTS` only | **not documented** | applies, valid | INVALID after kill; rerun **reports success**, index still INVALID |
| P7c `COMMIT;` then plain `CREATE` | **not documented** | applies, valid | INVALID after kill; rerun fails 42P07, still INVALID |
| P9 `COMMIT;` and the statements in one string (`breakpoints:false`) | **not documented** | 25001 on `DROP INDEX CONCURRENTLY` / exit 1 | nothing ran |
| P10 `dblink_exec` to a second connection | **not documented** | not viable here: `password or GSSAPI delegated credentials required`. Recorded as fail, not pursued. | not run |

After a killed backend, `drizzle-kit migrate` crashes with an uncaught Node stack trace (exit 1), not a drizzle error message.

### T11: every merge scenario

X is the production branch (already applied, `when` 1794282360098). Y is the other branch (`when` 1794282357803, older). Both came from real `drizzle-kit generate` runs from the same base (`0000_base`): X is `0001_broad_carlie_cooper.sql`, Y is `0001_new_hydra.sql`. The two `0001_snapshot.json` files share a name and differ in content (X `id` e8f61f24, Y `id` 39eb9e55, same `prevId`).

| Scenario | What happens |
|---|---|
| Git merge of `meta/_journal.json` (`git merge-file`) | Text conflict on the entry's `when` and `tag` lines (exit 1, conflict markers). Snapshot `0001_snapshot.json` is also a same-name, different-content collision. |
| A_YX: journal resolved as base, Y, X (X already applied) | `migrate()` returns normally, `y_tbl` never created, rows stay at 2. CLI exit 0, "migrations applied successfully!". `drizzle-kit check`: "Everything's fine", no warning. **Silently skips.** |
| A_XY: journal resolved as base, X, Y | Same: `y_tbl` never created, no error, CLI exit 0. `check` prints "its timestamp is not greater ... the migrator will skip this entry" but still exits 0. **Silent skip at run time; a static warning exists.** |
| Fresh DB with the merged journal (either order) | Applies all three in journal order. |
| Control: Y applied first, then X merged | Applies. |
| B: regenerate after rebase (`generate` produced `0002_colossal_gertrude_yorkes.sql`) on a production-like DB (X applied) | Applies, `y_tbl` created. |
| B: same regenerated folder on a dev DB that already ran the old Y | Fails: `relation "y_tbl" already exists` (clear error, no skip). |
| C: journal lists Y but its SQL file is missing | Refuses with a clear error: `No file .../0001_new_hydra.sql found in ... drizzle folder`. |
| D: named files, Y `0001_aaa_y.sql` sorts before X `0001_zzz_x.sql` | File names do not matter; pending detection uses `when` only. Y skipped. |

### Differences from the earlier 4a section

- T9: same verdict. This run adds P2 to P6 and P8 to P10, showing `breakpoints:false` and a single-string COMMIT do not help.
- T10b: findings agree (drop-and-create recovers; IF NOT EXISTS alone reports success on an INVALID index; plain create fails 42P07). This run adds P8 and the documented/undocumented classification.
- T10a: same verdict; adds the fresh-DB two-file batch.
- T11: same verdict (silent skip), extended to real `generate` output, git text merge of the journal, both journal orders, the `check` warning for X-then-Y only, regenerate-after-rebase, missing file and named files. The earlier section tested one synthetic case.
- T7: same verdict.
