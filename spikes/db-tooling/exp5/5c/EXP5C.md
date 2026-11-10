# Experiment 5c: drop-before-create for non-blocking index files (graphile-migrate 1.4.1)

Run on 2026-11-10 against `db-tooling-db-1` (localhost:55432, PostgreSQL 18.6), databases `lock5c_*` only (all dropped; 0 remain). Node v25.3.0, pnpm 12.8.1, Vitest 4.1.11 run directly with node. Method, pass criteria and output rules are those of EXPERIMENTS.md section 5c (commit 54f841b), unchanged. Nothing in 5a, 5b or the arm folders was edited. Not committed.

Files: `test/probe.test.ts` (step 2, forms), `test/exp5c.test.ts` (step 3, battery), `test/helpers.ts`, `reports/probe.log`, `reports/exp5c.log` (one line per run), `reports/vitest-run.txt`, `probe-results.json`, `results.json`. Run from `exp5/5c/` with `node node_modules/vitest/vitest.mjs run test/probe.test.ts` and then `... test/exp5c.test.ts`. Last full run: 40 of 40 tests executed. The battery was run twice with identical outcomes in every row (first run, then again after adding the "already exists" check to the K1 log line).

## 1. Verdict

> **Correction after verification (2026-11-10).** The independent rerun (VERIFICATION.md, "Experiment 5c verification") confirms the verdict. Two corrections:
> - **Lock-hold time (§5):** the retained log shows 1,726 to 1,850 ms, not 1,739 to 1,974 ms. The verifier's rerun took 1.8 to 3.4 s, so the time depends on the machine. Either way, the lock lasts as long as the orphaned build.
> - **`dblink_exec` (§3):** the verifier tried it as a single no-transaction file. It hangs even on a clean run, because `CREATE INDEX CONCURRENTLY` waits on the calling backend's own transaction. So no drop-before-create arrangement passes K1.

**No plain-SQL form of the migration both drops and creates the index non-blockingly and passes K1.**

- **F1 (one `--! no-transaction` file with both statements): refused by Postgres**, `DROP INDEX CONCURRENTLY cannot run inside a transaction block` (SQLSTATE 25001). Two variants with `COMMIT;` between or before the statements fail the same way. A `DO` block fails with `cannot be executed from a function`.
- **F2 forms that work are the ones that put the drop and the create in two separate migration files** (F2a, F2c). They are accepted, run outside a transaction, and pass the clean run, the round 3 killed-index test, S2 and K2. **They fail K1 in 10 of 10 runs**: the drop file is already recorded when the client is killed, so the create file is the unrecorded one, and after the orphan finishes the rerun fails with "already exists". The drop is never run again because it is recorded.
- Under the rule "if no form works, stop and report": the single-file forms do not work, and the two-file forms are accepted but do not meet the K1 criterion. No wrapper or hook change was tried. Possible next steps are in section 6.

## 2. Method as run

- Harness: copied from `exp5/5a/test/` (`helpers.ts`, `exp5a.test.ts`). Changes, all in the copy:
  - database prefix `lock5_` to `lock5c_`;
  - `scratch()` accepts a list of M4+ bodies and writes `000004-m4.sql`, `000005-m5.sql`, ... chained by hash (a single string behaves as in 5a);
  - `freshAtM3()` moves every file after M3 aside while M1..M3 are applied (5a moved only `000004-m4.sql`);
  - added: `FORMS`, `idxCount`, `seedBig`.
- Chain: M1-M3 copied from `arm-kysely-stable/migrations/committed/`, then the files of the form under test. The `beforeAllMigrations` hook is the P7 text, verbatim, configured in every config. The CLI is the arm's graphile-migrate 1.4.1, executed and not read.
- Overlap is forced as in 5a: a blocker session holds `ROW EXCLUSIVE` on `entity`; the test polls `pg_stat_activity` (`wait_event_type = 'Lock'`) and `pg_locks`. No sleeps stand in for ordering, except a fixed 2 s wait in K1 before sampling whether the orphan is still alive.
- Probe (step 2): each form applied once to a fresh database at M3. "Accepted and ran outside a transaction" = exit 0, index valid, exactly one index of that name, every file of the form recorded once.
- Battery (step 3) on the forms that passed the probe, F2a and F2c: CLEAN x1, R3 x1, S2 x5, K2 x5, K1 x5, K1T x3, per form.
  - **K1, S2, K2** are 5a's scenarios. K1's pass condition is 5c's: next `migrate` after the orphan ends exits 0, exactly one valid index, every migration file recorded once. The test also asserts the second run was refused, so the lock facts are validated even when K1 fails.
  - **R3** is round 3's P7 shape: kill the build backend with `pg_terminate_backend` while it waits behind the blocker, release the blocker, rerun (hook repairs, rebuild), run a third time (no-op, same index OID).
  - **CLEAN**: fresh database, one migrate, then a rerun that must say `Already up to date`.
  - **K1T** is added to answer the lock-hold question without a blocker: 1,500,000 `entity` rows are seeded, so the index build takes about 2 s on its own. A is hard-killed as soon as the invalid index exists, and B is started right away.
- The source of graphile-migrate was not needed for the verdict. For the lock behaviour, 5a's source findings (GitHub v1.4.1 `src/`, `commands/migrate.ts`, `pgReal.ts`) apply unchanged; they were not re-fetched.

## 3. Per-form results (step 2)

| Form | File(s) | Accepted by graphile-migrate | Runs outside a transaction | Result and why |
|---|---|---|---|---|
| F1 | one `--! no-transaction`: `DROP INDEX CONCURRENTLY IF EXISTS x; CREATE INDEX CONCURRENTLY x ...;` | yes (file is read and sent) | no | Exit 1. Postgres: `DROP INDEX CONCURRENTLY cannot run inside a transaction block`, 25001, `PreventInTransactionBlock`, xact.c:3654. graphile-migrate sends the file as one query; a query with several statements runs in an implicit transaction block, so the first statement already fails. Nothing recorded, no index. Same result as round 3 P3/P3b. |
| F1b | one `--! no-transaction`: `DROP ...; COMMIT; CREATE ...;` | yes | no | Same 25001 error. The `COMMIT` does not help because the implicit block is already open when the first statement is checked. |
| F1c | one `--! no-transaction`: `COMMIT; DROP ...; COMMIT; CREATE ...;` | yes | no | Same 25001 error. |
| F2a | two `--! no-transaction` files: `000004` = `DROP INDEX CONCURRENTLY IF EXISTS x;`, `000005` = `CREATE INDEX CONCURRENTLY x ...;` | yes | yes | Exit 0, index valid, both files recorded once. Each file holds one statement, so no implicit block. |
| F2b | one `--! no-transaction`: `DO $$ BEGIN EXECUTE 'DROP INDEX CONCURRENTLY IF EXISTS x'; EXECUTE 'CREATE INDEX CONCURRENTLY x ...'; END $$;` | yes | no | Exit 1. `DROP INDEX CONCURRENTLY cannot be executed from a function`, 25001, xact.c:3674 (PL/pgSQL `EXECUTE` is not top level). Same as round 3 P5 for CREATE. |
| F2c | two files: `000004` = transactional `DROP INDEX IF EXISTS x;`, `000005` = `--! no-transaction` CREATE | yes | the create file does; the drop file is a normal transaction | Exit 0, index valid, both files recorded once. Same shape as round 3 P6. |

Not tried, because they leave "plain SQL that graphile-migrate runs": extension-based forms such as `dblink_exec` to a second connection, and `--! include`/`--! split`-style directives (an include is inlined into one query, so it behaves like F1).

## 4. Per-scenario run table

F2a and F2c gave the same outcome in every row. "x" = pass criterion met.

| Scenario | Runs per form | F2a | F2c | Outcome |
|---|---|---|---|---|
| CLEAN | 1 | pass | pass | Exit 0; one valid index; `000004.sql` and `000005.sql` each recorded once; rerun `Already up to date`. |
| R3 (round 3 killed-index test) | 1 | pass | pass | A exit 1; invalid index left (OID n); rerun exit 0 with the hook dropping it and the create file rebuilding (OID n+1, valid, one index); both files recorded once; third run exit 0, same OID. |
| S2 (A mid-CIC, B starts with hook) | 5 | 5/5 | 5/5 | B exit 1 `Failed to get exclusive lock`; the invalid index kept the same OID and state during B (not dropped); A exit 0, index valid, same OID; both files recorded once; rerun exit 0. |
| K2 (lock holder's DB session terminated) | 5 | 5/5 | 5/5 | No advisory lock left; B exit 0 (hook dropped the invalid index, create file rebuilt it, valid); one index; both files recorded once; third run exit 0. |
| **K1 (client hard-killed, orphan finishes)** | 5 | **0/5** | **0/5** | After SIGKILL the orphan backend was alive 2 s later and still held the advisory lock (10/10). B, run while the blocker was held, was refused (10/10), and the index kept its OID. After the orphan finished: the index was valid (one index), `000004.sql` recorded once, **`000005.sql` not recorded**. Next `migrate` exited 1 with Postgres `already exists` (`index_create`, 42P07 present in all 10). |
| K1T (lock-hold time, no blocker) | 3 | 3/3 | 3/3 | See section 5. |

## 5. K1 lock-hold duration and the second run

- The lock is held by the orphaned backend until its `CREATE INDEX CONCURRENTLY` statement ends. In the blocker runs it was held for the whole time the blocker held `entity` (about 2.25 s from the kill to the blocker release, a figure set by the test) plus 7-69 ms after release for the build to finish (10 runs).
- Without a blocker (K1T, 1,500,000 rows, 6 runs across both forms): the lock was freed **1,739 to 1,974 ms after the SIGKILL** (the invalid index had appeared about 0.3 s after the start of the run). That is the remaining build time, so it scales with table size; for a large production table it would be as long as the rest of the build.
- A second `migrate` started during that time was **refused** in all 16 runs that tested it (10 K1 + 6 K1T): exit 1, `Failed to get exclusive lock`, before its hook ran; the index kept the same OID. In K1T it was started 230-250 ms after the kill and the lock was still held when it ended.
- Same as 5a: the lock lives as long as the backend, not the client.

## 6. Verdict against each pass criterion

Criteria for a working form, from EXPERIMENTS.md section 5c.

| Criterion | F1, F1b, F1c, F2b | F2a / F2c |
|---|---|---|
| K1: in all 5 runs, the next `migrate` after the orphaned build ends succeeds, leaves exactly one valid index, records the migration once | not testable: the migration cannot be applied at all | **FAIL, 0/5 each.** Index valid and unique, but the create file is unrecorded and the rerun fails "already exists". |
| S2, K2, killed-index test, clean run give the same outcomes as in 5a and round 3 | not testable | PASS: S2 5/5, K2 5/5, R3 1/1, CLEAN 1/1 for each form. |
| A run refused because another holds the lock is still refused, and no index under construction is dropped | not testable | PASS: S2 10/10 and K1 10/10 refused; K1T 6/6 refused; the index OID unchanged during B. |

Overall: **no form passes**. F1 is impossible on Postgres; F2a and F2c are valid but do not fix K1.

Why the two-file forms cannot fix K1: the fix needs the drop and the create to be recorded together or not at all. graphile-migrate records one migration per file, in a separate step after the file's SQL ends, and a `--! no-transaction` file cannot hold two statements. A killed client stops before recording the create file, and the orphaned build then finishes the work behind its back. Dropping first only helps when the drop runs again, which a recorded drop file does not.

## 7. Does the 0017 "no IF NOT EXISTS" rule need rewording?

The rule stands as written for `CREATE INDEX CONCURRENTLY`; nothing here argues for `IF NOT EXISTS` on the create. It is worth a clarifying sentence: the rule is about the `CREATE`, and `DROP INDEX CONCURRENTLY IF EXISTS` is a different statement that is allowed but, as a separate preceding file (F2a), gives no protection against K1 (and F2c's plain `DROP INDEX IF EXISTS` file likewise), so the pattern is not recommended. Suggested wording for the reader to decide on: "Non-blocking index files hold one `CREATE INDEX CONCURRENTLY` without `IF NOT EXISTS`. A companion `DROP INDEX ... IF EXISTS` file does not help; a drop and a create cannot share a file." This is a suggestion; no record was edited.

## 8. Possible next steps (not tested, not done here)

Reported per the instructions as options only:
- Accept the K1 case as a documented operational failure: after a hard-killed deploy, wait for the lock to free, then fix by hand (record the migration or drop the index).
- Use `CREATE INDEX CONCURRENTLY IF NOT EXISTS` together with the existing hook (the hook drops invalid indexes, so a valid orphan result would be kept and the file would then record normally). This reverses the 0017 rule and is untested here; round 3 P2 tested `IF NOT EXISTS` without the hook only.
- A wrapper that, after a failed `migrate`, waits for the advisory lock to free and reruns. 5a argued a lock-holding wrapper does not help; a wait-and-rerun wrapper is a different thing and is untested.

## 9. Limits

- 5 runs per K1/S2/K2 cell, 1 run for R3 and CLEAN, as the pre-registration asks; no timing-based outcomes except the K1T durations, which depend on this machine (local Docker, 1.5M rows).
- The F1 variants tried are the single-file forms I could think of that stay plain SQL; the verdict that F1 is impossible rests on Postgres's behaviour for the three variants and the `DO` block, plus round 3's P3/P3b/P5.
- pgbouncer, a real second container and a different Postgres version were not tested.
