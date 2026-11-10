# Experiment 5a: one `migrate` at a time (graphile-migrate 1.4.1)

Run on 2026-11-10 against `db-tooling-db-1` (localhost:55432), databases `lock5_*` only (all dropped; none remain). Node v25.3.0, pnpm 12.8.1, Vitest 4.1.11 run directly with node. Nothing in the arm directories was edited. Not committed.

Files: `test/exp5a.test.ts`, `test/helpers.ts`, `reports/exp5a.log` (one line per run), `results.json`. Run with `node node_modules/vitest/vitest.mjs run` from `exp5/5a/`. Result: 25 tests, all 25 executed; 20 met their criteria, 5 (K1) did not (see below).

## 1. Source findings

**Source caveat.** Reading `arm-kysely-stable/node_modules` was denied by the permission settings, so the installed `dist/` was not read. The citations below are from the public GitHub repository at tag v1.4.1, `src/` (TypeScript), fetched through WebFetch. WebFetch returns a model-produced rendering of each file, so the line numbers are the fetcher's and are approximate. The verdict rests on the runs in section 3, not on these citations.

| Finding | GitHub v1.4.1 `src/` location |
|---|---|
| `migrate` wraps its whole body (read last migration, `beforeAllMigrations` hook, migrations loop, `afterAllMigrations`) in `withAdvisoryLock(pgClient, ...)` | `commands/migrate.ts` ~35-76; hook at ~43-49 |
| Lock key constant `ADVISORY_LOCK_MIGRATE = "4727445306447283"` | `pgReal.ts` ~140-141 |
| `withAdvisoryLock` calls `pg_try_advisory_lock` (session level, non-blocking). If it is not granted it throws `Failed to get exclusive lock`. The `finally` block calls `pg_advisory_unlock`. | `pgReal.ts` ~142-164 |
| Each migration also takes the same lock (re-entrant on the same session) and then runs `begin` / migration / `insert into graphile_migrate.migrations` / `commit` (no `begin` for `--! no-transaction`). `hash` is the primary key of that table, so a second insert of the same migration would error. | `migration.ts` ~401-445 (`runStringMigration`), ~190 (table DDL) |
| No `LOCK TABLE` on graphile_migrate's own tables was reported. | n/a |

Consequences stated by the source: the lock is acquired before the hook, so a refused run never executes its hook. The lock lives on the same session that runs the migration SQL, so it lasts as long as that Postgres backend exists.

Observed at run time (CLI stderr): the refusal prints `Error: Failed to get exclusive lock` plus a stack trace, exit code 1. It does not mention another `migrate` run.

## 2. Method

- Chain: M1-M3 copied from `arm-kysely-stable/migrations/committed/`, plus an M4 per scenario (hashes computed with the arm's `hash.js`, as round 3 did). The `beforeAllMigrations` hook is the P7 text from `arm-kysely-stable/test/exp4a.test.ts` lines 160-170, verbatim, configured in every config.
- Overlap is forced, not timed: a blocker session holds `ROW EXCLUSIVE` on `entity`, so the winner's `ALTER TABLE` (S1) or `CREATE INDEX CONCURRENTLY` (S2, S3, K) waits on a lock. The test polls `pg_stat_activity` (`wait_event_type = 'Lock'`) and `pg_locks`, and only then starts or observes the second run.
- M4: S1 = `ALTER TABLE entity ADD COLUMN s1_col text;` (transactional). S2, S3, K1, K2 = `--! no-transaction` + `CREATE INDEX CONCURRENTLY entity_kind_conc_idx ON entity (tenant_id, kind);`.
- **S3 stand-in:** a second container was not used. B is a second OS process with its own connection, its own copy of the migrations folder and config, and its own working directory. It differs from S2 only in those three respects.
- K1 / K2 are the "run killed while holding the lock" cases, run on 1.4.1 alone. K1 hard-kills the Node process (SIGKILL) of the lock holder; K2 terminates its database session with `pg_terminate_backend` (as round 3's P7 did).

## 3. Results, 1.4.1 alone

Each cell is 5 runs; the outcome was identical in all five unless noted.

| Scenario | Runs | Outcome |
|---|---|---|
| S1: two `migrate`s start together, one pending transactional migration | 5 | One run held the advisory lock (`pg_locks`, granted) and applied M4; the other exited in under 15 s with code 1 and `Failed to get exclusive lock`. Which process won varied (final codes 0/1 in 3 runs, 1/0 in 2). M4 recorded once, `s1_col` exists once, a later `migrate` prints `Already up to date`, exit 0. No double apply. |
| S2: A mid-CIC, B starts with the P7 hook configured | 5 | B exited code 1, `Failed to get exclusive lock`. While B ran and after, the invalid index kept the same OID and state (`indisvalid=false`); it was not dropped. After the blocker was released, A finished with code 0, index valid, same OID; M4 recorded once; rerun exit 0. |
| S3: as S2, B is a second OS process (own folder, config, cwd) | 5 | Same as S2 in all five runs. |
| K2: lock holder's DB session terminated mid-CIC | 5 | A exited 1. No advisory lock remained. Invalid index was left behind (OID n). B then ran: the hook dropped the invalid index, the migration rebuilt it (new OID n+1, valid), M4 recorded once, a third run was a no-op. Exit 0. |
| K1: lock holder's Node process hard-killed mid-CIC | 5 | After the kill the orphaned backend (the lock-holding session, still waiting on the blocker) was still alive after 10 s and the advisory lock was still held. A new B, run while the blocker was still held, was refused (`Failed to get exclusive lock`). After the blocker was released the orphan finished its CIC and the lock was freed. But M4 was then not recorded and the index was VALID, so the next `migrate` failed (exit 1, Postgres "relation ... already exists" from `index_create`). |

## 4. Wrapper

Not built. The brief asks for it only if 1.4.1 has no lock, and it has one. For the K1 behaviour, a wrapper holding `pg_advisory_lock` on its own dedicated session would not help: the lock would be released as soon as the wrapper died, while the orphaned `CREATE INDEX CONCURRENTLY` backend is still running. That would permit the overlap this experiment is about. This is reasoning, not a tested result. If a wrapper is still wanted, say so and I will build and run it.

## 5. Criteria

| Criterion | Verdict |
|---|---|
| In every run, no migration is applied twice | PASS (S1, S2, S3, K1, K2: M4 recorded at most once; the primary key on `hash` would also reject a second insert) |
| No index under construction is dropped | PASS (S2, S3: 10/10 runs, same OID, still invalid during B, valid afterwards). In K1 the second run was refused before its hook ran. |
| The second run waits then finds nothing pending, or refuses with a clear message | PASS on refusal (S1, S2, S3): it refuses with exit 1 and `Failed to get exclusive lock`. The message is terse and carries a stack trace; it does not say that another migrate is running. Whether that counts as "clear" is for the reader. |
| A killed run does not leave the lock held | PASS for a session-level kill (K2, 5/5). FAIL as written for a killed client process (K1, 0/5 passed): the lock stayed held for as long as the orphaned backend kept executing its statement, and was freed when that statement ended. |

## 6. Observations outside the criteria

- K1 shows the lock follows the Postgres backend, not the client process. With a long-running statement, a killed client leaves the lock held until the statement finishes. In these runs that was also what stopped a second run's hook from touching the in-flight index.
- When the orphan finishes after its client died, the migration is unrecorded but its effect (a valid index) exists. A plain `CREATE INDEX CONCURRENTLY` migration then fails on rerun. This is independent of locking; `IF NOT EXISTS` in the migration would avoid it.
- Not tested: pgbouncer in transaction mode (session advisory locks are not reliable there), a real second container, and the hook text racing a run that started before the lock existed.
