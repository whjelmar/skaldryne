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
