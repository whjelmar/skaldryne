# Arm Kysely-stable results: Experiment 2 (graphile-migrate 1.4.1)

This arm is `arm-kysely` with graphile-migrate **2.0.0-rc.5 replaced by the stable 1.4.1**. Nothing else in the toolchain changed. Experiment 1 results are in [EXP1.md](EXP1.md).

**Suite summary (`pnpm test`, final run, clean database):**

```
 Test Files  1 failed | 10 passed (11)
      Tests  1 failed | 30 passed (31)
```

The one failing test is `T10b killed no-transaction file`. It asserts the pass criterion from the spec, and it fails. I did not weaken it. Full output: `reports/final-test.log`.

## Versions

graphile-migrate **1.4.1**, kysely 0.29.6, kysely-codegen 0.20.0, pg 8.23.1, typescript 5.9.3, vitest 4.1.11, @types/node 24.19.0, @types/pg 8.23.1. Node v25.3.0, PostgreSQL 18 with pgvector and pgTAP (container `db-tooling-db-1`). Databases use the prefix `kysely14_`.

## Per-test results against arm-kysely (2.0.0-rc.5)

| Test | arm-kysely (rc.5) | This arm (1.4.1) | Difference |
| --- | --- | --- | --- |
| T1 tenant isolation | pass | pass | none |
| T2 pooling | pass | pass | none |
| T3 vectors | pass | pass | none |
| T4 triggers/partitions survive | partial | partial | none in outcome. Needed the LF fix below, or `kysely-codegen --verify` fails. |
| T5 expand/contract | pass | pass | none |
| T6 safe to repeat | pass | pass | none |
| T7 fleet | pass (FINDING: applied hashes never re-verified) | pass (same FINDING) | none. See tamper checks below. |
| T8 CI fit | pass | pass | none |
| T9 CONCURRENTLY | not run in that arm | **pass** | new test |
| T10a killed transactional file | not run | **pass** | new test |
| T10b killed no-transaction file | not run | **FAIL** | new test, see below |
| T7 tamper (a), (b), (c) | not run | (a) not detected, (b) not detected, (c) detected | new test |

T1 to T8 are the same 15 tests as in arm-kysely, 15/15 passing, with no assertion changed.

### Why the T1 to T8 numbers match despite the version change

The functions this arm uses (`migrate`, `status`, `commit`, the programmatic API, hash chain, `afterReset` with `root: true`) behave the same in 1.4.1 for these tests. The only 1.4.1-specific problem was a file-format one: 1.4.1 has a strict header parser, and Git on Windows (autocrlf) wrote CRLF line endings into the committed files, so 1.4.1 failed to parse the `--! Previous` / `--! Hash` header. The same CRLF also broke `kysely-codegen --verify` (T4). See Deviations.

## T9 (CONCURRENTLY): pass

- **Control.** `CREATE INDEX CONCURRENTLY` in `current.sql` without the header: `commit` fails in the shadow run with error 25001 "cannot run inside a transaction block". The file is not committed.
- **With `--! no-transaction`** as the first line of the body: `commit` succeeds (shadow run and main DB both apply it), the committed file keeps the header, and `pg_index.indisvalid` and `indisready` are both true. A following `migrate` prints "Already up to date" because `commit` already applied it to the main DB.
- The successful apply is the evidence that no transaction was open.

## T10a (killed transactional file): pass

`ALTER TABLE entity ADD COLUMN t10a_marker int; SELECT pg_sleep(30);` is killed with `pg_terminate_backend` while in `pg_sleep`. The CLI exits 1 (unhandled `Connection terminated unexpectedly`). The schema dump is identical to before, the migration is not in `graphile_migrate.migrations`, and the column does not exist. After rewriting the file without the sleep, the rerun applies it and the column exists.

## T10b (killed no-transaction file): FAIL (must-have)

Setup: the T9 file as committed. A second session holds `ROW EXCLUSIVE` on `entity`, so `CREATE INDEX CONCURRENTLY` has created its catalog entry and waits for writers. The backend is killed there.

| Step | Observed |
| --- | --- |
| After kill | CLI exits 1. Index `entity_kind_conc_idx` exists with `indisvalid = false`, `indisready = false`. Migration 000004 is not recorded (3 applied). |
| Rerun of the unchanged file | Exit 1, `relation "entity_kind_conc_idx" already exists` (42P07). The index is still INVALID. The migration is still not recorded. |
| Criterion: rerun ends with a valid index | **Not met.** |

The runner does not report success here, so the "never reports success while INVALID" half holds for the plain file. The "ends with a valid index" half does not. Recovery needs a human to drop the index.

Variants, recorded as FINDING tests (they pass by asserting what happened, and they do not turn the T10b criterion into a pass):

| Variant | Result |
| --- | --- |
| D: one file with `DROP INDEX CONCURRENTLY IF EXISTS` then `CREATE INDEX CONCURRENTLY` | **Cannot be applied at all.** The file is sent as one multi-statement simple query, which Postgres treats as an implicit transaction block, so the first statement fails with 25001. No index exists afterwards. In 1.4.1 a `--! no-transaction` file effectively may hold only one statement that needs to be outside a transaction. |
| Manual recovery: `DROP INDEX CONCURRENTLY` by hand, rerun the unchanged file | Passes: exit 0, valid index. |
| N: file uses `CREATE INDEX CONCURRENTLY IF NOT EXISTS` | After the kill the index is INVALID. The rerun **exits 0 and prints "1 committed migrations executed"**, but the index is **still INVALID** and the migration is recorded. This is the dangerous case: the runner reports success while the index is unusable. It violates the criterion. |

I did not write a replacement runner, as the spec says that needs maintainer approval.

## Tamper check (T7)

| Case | Result in 1.4.1 |
| --- | --- |
| (a) Hash in `graphile_migrate.migrations` altered, then `migrate` | **Not detected.** Exit 0. |
| (b) An already-applied committed file edited, then `migrate` on an up-to-date DB | **Not detected.** Exit 0. |
| (c) A pending (not yet applied) committed file edited, then `migrate` | **Detected.** Exit 1, "Hash for 000002-m2-expand-display_name.sql does not match ... has the file been tampered with?" |

So 1.4.1 detects tampering only for pending migrations, as the T7 FINDING in arm-kysely already said for 2.0.0-rc.5. Whether 2.0.0-rc.5 differs on (a) and (b) was not tested by me in this arm.

## Deviations from the spec

1. **LF line endings and `.gitattributes`.** Text files were normalised to LF and `.gitattributes` added (`* text=auto eol=lf`). Reason: CRLF broke 1.4.1's header parser and `kysely-codegen --verify`. This changes file bytes, but not any hash-chain content intended by the source arm; the hashes are computed over the body and were verified by graphile-migrate itself.
2. **Lockfile regenerated, devDependencies pinned** (`@types/node` 24.19.0, vitest 4.1.11, typescript 5.9.3, `@types/pg` 8.23.1) so the only moving part versus arm-kysely is graphile-migrate.
3. **Database prefix** `kysely14_` instead of the source arm's prefix, to avoid collisions in the shared container. `exp1_main` was not modified.
4. **T9, T10 and the tamper checks drive the graphile-migrate CLI in a child process.** Reason: when its pool loses a connection, 1.4.1 emits an unhandled error and calls `process.exit(1)`, which would kill the Vitest worker. This is also the runner's real entry point.
5. **T10 files are written with `writeCommitted`**, which uses graphile-migrate's own `calculateHash` and chains onto the previous hash. T9 uses the real `commit` command. T10a/T10b need the file present before the run starts, and `commit` would apply it first.
6. **No replacement runner** was written for the T10b failure.

## Evidence files

`reports/exp2-t9-t10-output.log`, `reports/exp2-t7-tamper.log`, `reports/final-test.log`.

## Experiment 4a (round 3)

Versions: graphile-migrate **1.4.1**, Node v25.3.0, Postgres in container `db-tooling-db-1` (localhost:55432). Databases used: `kysely14_*` only. New tests: `test/exp4a.test.ts` (15 tests, all pass; databases `kysely14_4a_*`; evidence in `reports/exp4a.log`). T9, T10a, T10b and T7 were rerun with the unchanged round 2 tests `test/t9-t10-no-transaction.test.ts` and `test/t7b-tamper.test.ts` (`pnpm exec vitest run` on those two files: 8 passed, 1 failed; the one failure is the `T10b` pass-criterion assertion, left as written). Nothing was changed in the round 2 tests.

| Test | Result | Evidence |
| --- | --- | --- |
| T9 CONCURRENTLY | **pass** | Control (CIC without header, `commit`): `CREATE INDEX CONCURRENTLY cannot run inside a transaction block`, code 25001, rolled back. With `--! no-transaction` as first line of `current.sql`: `commit` creates `000004-m4-concurrent-index.sql`, applies on shadow and main; `indisvalid=true, indisready=true`; rerun prints `Already up to date`. |
| T10a killed transactional file | **pass** | Killed in `pg_sleep(30)`; CLI exit 1 (unhandled `Connection terminated unexpectedly`); schema dump identical, not in `graphile_migrate.migrations`, column absent; rerun without sleep applies. |
| T10b killed no-transaction file | **FAIL** (see P7 caveat) | P1 to P7 below. All patterns that live in migration files fail. Only P7, a runner-level `beforeAllMigrations` hook, ends valid. |
| T11 late merge | **pass** on the realistic cases (refuses); one hand-edited path silently skips | S1 to S5 below. |
| T7 tamper (reported) | 1.4.1 does **not** detect an edited, already-applied file (`Already up to date`, exit 0) nor a changed hash in the DB table; it **does** detect an edited pending file (`Hash for ... does not match ... has the file been tampered with?`). | Same as round 2. |

Differences from round 2: none. Every result matches. (T10b's rerun error is Postgres `relation "entity_kind_conc_idx" already exists`, 42P07.)

### T10b patterns tried

Each one: kill the `CREATE INDEX CONCURRENTLY` backend while it waits on a ROW EXCLUSIVE lock held by a second session (catalog entry exists, index INVALID), then rerun `graphile-migrate migrate`.

| # | Pattern | Outcome |
| --- | --- | --- |
| P1 | One no-transaction file: `CREATE INDEX CONCURRENTLY idx ...` | Rerun exit 1, 42P07 already exists. Index stays `indisvalid=false`. Not reported as success. |
| P2 | One no-transaction file: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx ...` | Rerun **exit 0**, `000004.sql` recorded as applied, index still `indisvalid=false, indisready=false`. The runner reports success while the index is INVALID. Fails the "never report success" clause. |
| P3 | One no-transaction file with two statements: `DROP INDEX CONCURRENTLY IF EXISTS idx; CREATE INDEX CONCURRENTLY idx ...` | Cannot be applied at all: `DROP INDEX CONCURRENTLY cannot run inside a transaction block` (25001). The whole file is sent as one multi-statement query. The README says no-transaction files must contain exactly one statement. |
| P3b | Same, `CREATE INDEX CONCURRENTLY ...; SELECT 1;` | Same refusal (25001). Any second statement breaks it. |
| P4 | Two files: `000004` = no-transaction `DROP INDEX CONCURRENTLY IF EXISTS idx`, `000005` = no-transaction CREATE. Killed during 000005. | 000004 is already recorded, so it is not rerun. Rerun of 000005: 42P07. Index stays INVALID. |
| P5 | No-transaction file with `DO $$ BEGIN EXECUTE 'CREATE INDEX CONCURRENTLY ...'; END $$;` (the README invites DO-block workarounds) | `CREATE INDEX CONCURRENTLY cannot be executed from a function`. Does not work for CONCURRENTLY. |
| P6 | Two files: `000004` = transactional `DROP INDEX IF EXISTS idx`, `000005` = no-transaction CREATE. Killed during 000005. | Same as P4: cleanup file already recorded; rerun 42P07. |
| P7 | `beforeAllMigrations` sql action in `gmrc.json` (`{"_":"sql","file":"before-all.sql"}`) holding a `DO` block that drops every INVALID index in schema `public`; the migration file is the plain P1 file. | Rerun exit 0, `000004.sql` recorded, `indisvalid=true, indisready=true`; a further rerun is a no-op. On a clean database (P7b) it also applies with a valid index. No hand-run SQL. |

Notes on P7: it is configuration, not part of the migration file. The action runs only when at least one committed migration is pending (or with `--forceActions`), runs on every such `migrate` including shadow runs during `commit`, and drops any INVALID index in `public`, not just the one from the killed build. Whether it counts as "an idempotent pattern the runner supports" is for the coordinator to judge. The literal rule (some pattern ends with a valid index on rerun, no manual SQL, never success while INVALID) is met by P7 and by no file-based pattern, so I scored T10b as fail for file-based patterns and flag P7 as the possible pass. The `graphile-migrate run` command and manual `DROP INDEX` (the round 2 manual-recovery test) were not counted.

### T11 late merge

Mechanics read from the source (`dist/migration.js`, `dist/commands/commit.js`, `dist/commands/migrate.js`): `commit` names a file `<last number + 1, 6 digits>-<slug>.sql`; the recorded filename in `graphile_migrate.migrations` is the number only (`000004.sql`); each file carries `--! Previous:` (hash of the preceding file) and `--! Hash:`; the table has a foreign key `previous_hash -> hash`. On every `migrate`, all committed files are loaded, sorted by number, and each file's `Previous` must equal the hash of the file before it in that order. Then only files whose number sorts after the last applied row's number are run.

Setup in each case: database at M1 to M3, branch X's migration applied (adds `entity.branch_x`), then branch Y's file (adds `entity.branch_y`) is brought in.

| Case | Scenario | Result |
| --- | --- | --- |
| S1 | Both branches ran `commit` from M3, so both are numbered 000004 (`000004-x-...`, `000004-y-...`). | **Refuses**, exit 1, before running anything: `Previous migration with hash 'sha1:a45c...' doesn't match '000004.sql''s expected previous hash 'sha1:baa1...'`. Y not applied. The message does not mention a duplicate number. |
| S2 | X applied as 000005, Y authored first as 000004, both chained on M3. | **Refuses**, exit 1, same chain error naming `000005.sql`. Y not applied. |
| S3a | Rebase: Y = 000004 on M3, X renumbered 000005 and rehashed on Y; X's body is plain `ADD COLUMN`. | Exit 1: runs `000005-x-add-branch-x.sql` again, then `column "branch_x" of relation "entity" already exists`. X is re-run because its new number is higher than the last applied (000004). Y not applied. |
| S3b | Same as S3a with an idempotent X body (`ADD COLUMN IF NOT EXISTS`). | Exit 1: `violates foreign key constraint "migrations_previous_hash_fkey"` (23503). The X re-run is rolled back; Y not applied. Refused, but by a constraint error and not a purpose-written message. |
| S4 | Hand-resolved merge: X keeps number 000005 but its file is edited to be chained on Y (`Previous` = Y's hash, new `Hash`). | **Silent skip.** Exit 0, `Already up to date`. Y is never applied (`branch_y` absent); the applied table still holds the old X hash. File-chain validation passes, and the edited applied file is not compared to the table (same blind spot as T7). |
| S5 | Control: the same merged chain (Y=000004, X=000005) on a fresh database. | Applies M1 to M3, Y, X in order; both columns exist. |

Scoring: in the realistic flows (two branches each run `commit`, S1/S2; or a rebase that renumbers, S3a/S3b) the runner refuses, with a chain-mismatch error in S1/S2 and a database error in S3a/S3b. It silently skipped Y only in S4, which requires hand-editing an already-applied file so the chain validates. I rate T11 as pass on the realistic cases and record S4 as a silent-skip path.

### Surprises

- P2 (`IF NOT EXISTS`) reports success on an INVALID index, and an idempotent drop-then-create cannot be expressed in one file because of the one-statement rule (P3).
- The README's DO-block hint (P5) does not work for CONCURRENTLY.
- The only mechanism that survived a killed build is a runner-level `beforeAllMigrations` hook (P7), which is global rather than per-migration.
- The migrations table's FK on `previous_hash` turns some rebase mistakes into 23503 errors; it is what stops S3b.
- The recorded filename is the number only, so two branches' files with different slugs collide on the same recorded name.
