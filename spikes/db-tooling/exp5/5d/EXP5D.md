# Experiment 5d: `IF NOT EXISTS` in non-blocking index files, with the hook (graphile-migrate 1.4.1)

Run on 2026-11-10 against `db-tooling-db-1` (localhost:55432), databases `lock5d_*` only (all dropped; 0 remain). Node v25.3.0, pnpm 12.8.1, Vitest 4.1.11 run directly with node. Method, pass criteria and output rules are those of EXPERIMENTS.md section 5d (commit 5e3ae9f), unchanged. Nothing in 5a, 5b, 5c or the arm folders was edited. Not committed.

Files: `test/helpers.ts`, `test/exp5d.test.ts`, `reports/exp5d.log` (one line per run), `reports/vitest-run.txt`, `reports/c3-ctl.json`, `reports/c3-name.json` (NAME), `results.json`. Run from `exp5/5d/` with `node node_modules/vitest/vitest.mjs run`. The full run was done once: 28 of 28 tests executed and passed (27 scenario runs that assert a pass criterion, plus NAME, which asserts only its set-up). No retries, no discarded runs.

## 1. Verdict

**Pass on every criterion. With `CREATE INDEX CONCURRENTLY IF NOT EXISTS` in one `--! no-transaction` file and the unchanged hook, K1 now succeeds on rerun (5/5), and K1-early (5/5), K1-fail (5/5), S2 (5/5), K2 (5/5), R3 and CLEAN give the outcomes of 5a, 5c and round 3.**

NAME (reported): with a valid index of the same name and a different definition, `migrate` exits 0, records the migration, and leaves the other definition in place. The index the migration describes is never built. Both 5b checks flag it, by their delta rule (section 5). This is the case the 0017 rule was written for, and the hook does not cover it.

## 2. Method as run

- Harness copied from `exp5/5c/test/` (`helpers.ts`, `exp5c.test.ts`, `package.json`, `vitest.config.ts`, lockfile). Changes, all in the copy:
  - database prefix `lock5c_` to `lock5d_`;
  - `CIC` is `CREATE INDEX CONCURRENTLY IF NOT EXISTS entity_kind_conc_idx ON entity (tenant_id, kind);`, and the migration is one file, `000004.sql` = `--! no-transaction` + that statement. The form tables, `seedBig` and the K1T scenario of 5c were dropped;
  - added helpers `idxDef`, `recordedCount`, `EXPECTED_DEF` (`CREATE INDEX entity_kind_conc_idx ON public.entity USING btree (tenant_id, kind)`);
  - K1 and S2 assert their pass criteria (5c's K1 only asserted that the second run was refused). Every scenario `expect`s its full pass condition, so Vitest's result equals the verdict.
- Chain: M1-M3 from `arm-kysely-stable/migrations/committed/`, then the one index file. The `beforeAllMigrations` hook is the P7 text, verbatim, configured in every config (`before-all.sql`, unchanged from 5c). The CLI is the arm's graphile-migrate 1.4.1, executed and not read.
- **Determinism.** Every overlap uses a blocker session that holds `ROW EXCLUSIVE` on `entity`, so the build waits until the test releases it. The test polls `pg_stat_activity` (`wait_event_type = 'Lock'`) and `pg_locks` for the state it needs, and no outcome depends on timing. The one fixed wait is 1 s after SIGKILL before sampling that the orphan is still alive (it cannot end: the blocker is held). No large table or `pg_sleep` was needed, so none was used; the build ends only when the test releases the blocker.
- Scenarios (all in `test/exp5d.test.ts`):
  - **CLEAN** (x1): fresh database at M3, one `migrate`, then a rerun that must say `Already up to date`.
  - **R3** (x1): terminate the build backend while it waits behind the blocker, release, rerun (hook repairs, rebuild), third run (no-op, same OID).
  - **S2** (x5): A mid-build, B started with the hook configured.
  - **K2** (x5): the lock holder's database session is terminated while A is alive.
  - **K1** (x5): A's Node process is hard-killed (SIGKILL) while its backend waits behind the blocker with the invalid index in place; the blocker is released; the test waits until the advisory lock is free (the orphan's build has ended); then `migrate`.
  - **K1-early** (x5): as K1, but `migrate` B is started while the orphan still holds the lock (blocker still held). B must be refused and must not drop the index. Then the blocker is released, the orphan finishes, and a later `migrate` must pass as in K1.
  - **K1-fail** (x5): as K1, but the orphaned backend is terminated with `pg_terminate_backend` while the blocker is still held, so the build cannot have ended. This leaves an invalid index and frees the lock. Then the blocker is released and `migrate` runs.
  - **NAME** (x1, reported): see section 5.
- "Valid index with the migration's definition" means: `indisvalid`, exactly one `pg_class` entry of that name with `relkind='i'`, and `pg_get_indexdef` equal to `EXPECTED_DEF`. "Recorded once" means `000004.sql` appears exactly once in `graphile_migrate.migrations`.
- The source of graphile-migrate was not read. The lock facts in the brief (non-blocking session-level `pg_try_advisory_lock`; a refused run never reaches the hook; the orphan keeps the lock until its build ends) were validated by the runs: every K1 and K1-early run asserted that the advisory lock was held by the orphan's pid after the kill, and every refusal printed `Failed to get exclusive lock`.

## 3. Per-scenario run table

All outcomes are from `reports/exp5d.log`. "x" in a pass column means every sub-condition of the test held.

| Scenario | Runs | Passed | Observed outcome |
|---|---|---|---|
| CLEAN | 1 | 1/1 | Exit 0; one valid index with the migration's definition; `000004.sql` recorded once; rerun `Already up to date`. |
| R3 | 1 | 1/1 | A exit 1; invalid index left (OID n); rerun exit 0 with the hook dropping it and the file rebuilding it (OID n+1, valid, one index); recorded once; third run exit 0, same OID. |
| S2 | 5 | 5/5 | B exit 1 `Failed to get exclusive lock`; the invalid index kept its OID and state during B (not dropped); A exit 0, index valid, same OID; recorded once; rerun exit 0. |
| K2 | 5 | 5/5 | No advisory lock left after the session kill; invalid index left; B exit 0 (hook dropped it, file rebuilt it, valid, one index); recorded once; third run exit 0. |
| **K1** | 5 | **5/5** | After SIGKILL the orphan backend was alive 1 s later and held the advisory lock (5/5). After release, the orphan built the index (valid) and the lock was freed 18 to 84 ms later; `000004.sql` was not recorded. The next `migrate` exited 0, **kept the orphan's index (same OID)**, recorded `000004.sql` once, one valid index with the migration's definition. Rerun exit 0. |
| **K1-early** | 5 | **5/5** | B started while the orphan held the lock and the invalid index existed: B exit 1 `Failed to get exclusive lock` (5/5). Index OID and invalid state unchanged during B; the orphan was still alive and still held the lock after B; nothing recorded. After the orphan ended, the later `migrate` exited 0 and ended as in K1 (same OID as the orphan's, recorded once); rerun exit 0. |
| **K1-fail** | 5 | **5/5** | Orphan terminated before its build ended: invalid index left (OID n), lock freed, nothing recorded. The next `migrate` exited 0: the hook dropped the invalid index, the file built a new valid one (OID n+1), recorded once, one index with the migration's definition. No run reported success while the index was invalid (0 of 5). Rerun exit 0, same OID. |
| NAME | 1 | reported | Section 5. |

## 4. Verdict against each pass criterion

| Criterion (EXPERIMENTS.md 5d) | Result |
|---|---|
| K1: all 5 runs, the next `migrate` succeeds, leaves exactly one valid index with the migration's definition, records the migration once | **PASS 5/5** |
| K1-early: all 5 runs, the second run is refused as in 5a and does not drop the index being built; a later run then passes as in K1 | **PASS 5/5** (refused 5/5, index kept 5/5, later run as K1 5/5) |
| K1-fail: all 5 runs, the next `migrate` drops the invalid index through the hook, builds a valid one, records once; no run reports success while the index is invalid | **PASS 5/5** |
| S2, K2, R3 and CLEAN give the same outcomes as in 5a, 5c and round 3 | **PASS** (S2 5/5, K2 5/5, R3 1/1, CLEAN 1/1) |

What this shows: the `IF NOT EXISTS` skip does the right thing when the orphan built a valid index (K1), and the hook removes the case that would otherwise be reported as success without an index (K1-fail, R3, K2). The refusal behaviour of 5a is unchanged (S2, K1-early). The first run of every K1-class scenario that is refused never reaches the hook, so it cannot drop an index under construction.

## 5. NAME (reported, not a criterion)

A valid index `entity_kind_conc_idx ON entity (tenant_id)` was created by hand at M3, then the file (`... IF NOT EXISTS entity_kind_conc_idx ON entity (tenant_id, kind)`) was run by `migrate`.

- **`migrate`:** exit 0, "1 committed migrations executed", `000004.sql` recorded once. The index is still valid and still `USING btree (tenant_id)`: the definition is unchanged and is not the migration's. Rerun exit 0. Nothing in the output says the index was skipped. So the run reports success without building the index the file describes.
- **5b C2 and C3 wiring.**
  - **C3** was run unchanged from `exp5/5b` (`tests/c3.test.ts`, env `SCHEMA_DIR=5b/base/schema`, `DATABASE_URL` = the lock5d database; its prefix guard is in `lib/env.ts`, which the test file does not use). It ran against the cleanly migrated control and against the NAME database.
  - **C2 was not wired in as written.** C2 builds a second database from the Drizzle schema through `lib/databases.ts`, whose `schema5_` prefix guard would need editing, and 5b's Drizzle schema does not declare `entity_kind_conc_idx` at all (it is this experiment's test index). The direct catalog comparison was used instead: 5b's fixed catalog query (`lib/catalog.ts`, imported unchanged) on the NAME database against the same query on a control database that `migrate` built cleanly, which is the intended end state.
- **Catalog comparison (C2-equivalent):** 2 differing lines, `< index entity CREATE INDEX entity_kind_conc_idx ON entity USING btree (tenant_id)` and `> index entity CREATE INDEX entity_kind_conc_idx ON entity USING btree (tenant_id, kind)`. **Flags it.**
- **C3:** both runs have one failing test of 64 ("entity has matching indexes"), because the schema does not declare this index. On the control the finding is `database only: [entity_kind_conc_idx: btree (tenant_id,kind) with()]`; on NAME it is `... btree (tenant_id) with()`. By 5b's rule ("detected" = findings differ from the control's) **C3 flags it**. The test already fails on the control, so a bare pass/fail reading of C3 would not show it.
- So in a setup where the check compares against an intended end state that includes the index, both checks catch the different-definition case. The `migrate` itself does not.

## 6. Does the 0017 rule change?

For the reader to decide; no record was edited. Facts only:
- With the hook, the invalid-index half of the rule's reason no longer holds in any scenario tested here (K1-fail, K2, R3).
- The different-definition half still holds: `migrate` succeeds and records the file while the wrong index remains. It is detectable by a catalog comparison against an intended state (section 5), not by `migrate`.
- Without `IF NOT EXISTS`, K1 fails (5a, 5c). With it, K1 passes and the NAME case is a silent success. The two cannot both be avoided by `IF NOT EXISTS` alone.

## 7. Limits

- 5 runs per K1/K1-early/K1-fail/S2/K2 cell, 1 run for CLEAN, R3 and NAME, as pre-registered. One full execution; no run was repeated or dropped.
- Overlap is forced with a blocker, so the orphan is killed or refused while waiting behind a lock with the invalid index in place. It was not killed mid-way through scanning a large table. The brief suggested large tables and `pg_sleep`; they were not needed for determinism and were not used. The orphan's remaining build after release took 18 to 84 ms on the empty tables here, so this experiment says nothing about how long the lock lasts on a large table (5c's K1T: about 2 s at 1.5M rows).
- K1-fail terminates the orphan while the blocker is held, which is a deterministic stand-in for "terminated before its build ends". It does not test an operator or the OOM killer acting at an arbitrary moment.
- NAME is one case: a valid index on a subset of the columns. Other different definitions (unique, partial, other access method, invalid and different) were not run. C3 and the catalog comparison were run on one pair of databases each; the C2 comparison used a migrated control rather than a Drizzle-built database, for the reason in section 5.
- Running 5b's `tests/c3.test.ts` from its folder may have written Vitest's cache under `exp5/5b/node_modules` (ignored by git); no tracked file in 5b changed (`git status` shows only `exp5/5d/` as untracked).
- pgbouncer, a real second container and a different Postgres version were not tested.
