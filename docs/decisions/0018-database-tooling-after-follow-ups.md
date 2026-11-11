# 0018 — Database tooling, after the 0017 follow-ups

**Status:** Accepted · **Date:** 2026-11-10 · **Supersedes:** [0017](0017-database-tooling.md) · **Serves:** `MODEL-32`, `NFR-01`, `NFR-14`, `NFR-16`, `NFR-24`, `NFR-25`

## Context

[0017](0017-database-tooling.md) chose Drizzle ORM for queries and graphile-migrate for migrations. Its context and the spike evidence behind it (rounds 1 to 3) still hold and are not repeated here. It left two follow-ups that change how the decision works in practice:

- **One `migrate` at a time.** The hook that drops invalid indexes would also drop an index another session is still building.
- **The schema check in CI.** 0017 said CI keeps the Drizzle schema in step with the migrations, but not how.

Both were tested on 2026-11-10 as Experiment 5 on the spike branch (`EXPERIMENTS.md`). Each part was pre-registered before it ran, and a separate verifier reran it (`VERIFICATION.md`).

### What the follow-ups found

**graphile-migrate 1.4.1 already locks (5a, commit e535897).** It holds a non-blocking advisory lock for the whole run. A second `migrate` started meanwhile is refused with "Failed to get exclusive lock" before its hook runs, so it cannot apply anything twice or drop an index being built. This held in all 5 runs of each of three overlap scenarios. A terminated database session releases the lock at once. The lock is a session lock, so it holds only on a direct connection or session pooling, not through a transaction-mode pooler; that case was not tested.

One case failed: a hard-killed `migrate` process. The database keeps building the index and holds the lock until the build ends. The index then finishes, but the migration is never recorded, so the next run fails with "already exists".

**Dropping the index first does not help (5c, commit 4287595).** Postgres refuses a drop and a non-blocking create in one file, because graphile-migrate sends the file as one query. A `DO` block and `dblink` fail too. As two files, the drop is recorded before the process is killed and never runs again, so the next run still fails.

**`IF NOT EXISTS` with the hook fixes it (5d, commit 9ca6ea7).** Index files use `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, and the hook still drops invalid indexes first.

| Scenario | Result |
| --- | --- |
| Killed process, next run after the abandoned build ends | The run keeps the finished index and records the migration once. 5 of 5. |
| Next run started while the abandoned build is still running | Refused, and the index being built is left alone. 5 of 5. |
| Abandoned build stopped, leaving an invalid index | The hook drops it, and the run builds a valid one. No run reported success while the index was invalid. 5 of 5. |
| Overlapping runs, terminated session, earlier killed-index repair, clean migration | Same as in 5a, 5c and round 3. |

The verifier repeated the killed-process case once on a table of 1.5 million rows, with the same result. 0017 banned `IF NOT EXISTS` because, without the hook, it reports success while an index is still invalid. The hook now removes the invalid index before the file runs.

`IF NOT EXISTS` has one blind spot. If an index with the same name but a different definition already exists, `migrate` keeps it, records the migration and gives no warning. This was tested with one case, an index on a subset of the intended columns. A catalog comparison against a cleanly migrated database flagged it.

**Two schema checks pass (5b, commit e535897).** Four ways of comparing the Drizzle schema with the migrated database were tested against an unchanged control and ten kinds of planted mismatch, each planted on one side. Eight kinds were required: renamed columns, nullability, types, defaults, indexes, foreign keys, check constraints and whole tables. Policies and partition columns were reported only.

| | Pull and diff | Build a second database and compare | Vitest test against the database | `push --strict` |
| --- | --- | --- | --- | --- |
| Catches the eight required kinds | yes | yes | yes | yes, but renames and a missing table only by stopping at a prompt |
| Policies and partition columns | partly | yes | yes | partly |
| Differences reported on the unchanged control | 15 | 0 | 0 | 20, varying between runs |
| Time | 1.7 s | 1.3 s | 1.0 s | 0.9 s |

Pull-and-diff cannot see the partitioned table, so it misses drift there. `push` exits 0 even when it stops at a prompt, and without `--strict` and a terminal it applies its changes. Building the second database with `push` instead of `drizzle-kit generate` gave 18 false alarms and created policies without their conditions. Neither passing check compares partitions, triggers or grants.

## Decision

The maintainer decided on 2026-11-10, after Experiment 5. The changes from 0017 are:

- **Non-blocking index files use `CREATE INDEX CONCURRENTLY IF NOT EXISTS`,** one index per `--! no-transaction` file. This replaces 0017's rule that they never use `IF NOT EXISTS`. The hook that drops invalid indexes stays and is what makes this safe. The rule covers ordinary tables. Indexes on a partitioned table are built differently and were not tested (see Follow-up).
- **CI runs two schema checks, and either failing fails the build:**
  - **Catalog comparison:** build one database from the migrations and one from the Drizzle schema with `drizzle-kit generate`, then compare their catalogs with one fixed query. It covers columns, types, nullability, defaults, keys, indexes, checks and policies.
  - **Vitest test:** read each Drizzle table definition and compare it with the migrated database's catalog.
- **Every index is declared in the Drizzle schema,** including indexes that only migrations create, such as non-blocking ones.

Because graphile-migrate already runs one `migrate` at a time, 0017's conditional follow-up does not apply: the `migrate` step in [0010](0010-deployment.md) takes no extra lock.

Carried over from 0017 unchanged:

- **Queries: Drizzle ORM 0.45.** A renamed column fails to compile in every query that uses it. The hard queries keep some raw SQL in `sql` fragments, because Drizzle 0.45 has no recursive queries, window functions or `CASE`. Every such fragment is covered by a test.
- **Migrations: graphile-migrate 1.4.1,** with:
  - a `beforeAllMigrations` hook that drops invalid indexes, so a killed non-blocking index build is repaired on the next run;
  - a CI check that the hashes of applied files match the committed files;
  - enforced line endings for migration files.
- **Drizzle Kit is not the migration runner.** Drizzle ORM runs against the schema that graphile-migrate applies.
- **Migrations are plain SQL,** as [0005](0005-record-storage.md) says. Partitions, triggers, policies, grants and the partition `REVOKE`s are written like everything else.
- **The Drizzle schema in TypeScript describes what the migrations create.** The two CI checks above replace 0017's comparison with a committed schema dump; no schema dump is committed.
- **One transaction helper sets the audience,** `withAudience(campaign, audience, tx => …)`, as [0007](0007-visibility-enforcement.md) describes. Application code contains no raw SQL for it.
- **Three roles and a bootstrap step.** The roles are application, migration and redaction ([0010](0010-deployment.md)). pgvector needs a superuser to create it, so install creates the extension before `migrate` first runs.
- **A migration that has shipped is never edited.** Corrections are new migrations.
- **Vector search** starts with an exact scan within a campaign. Iterative scan or per-campaign indexes are added when a campaign's size needs them (`NFR-14`).

## Consequences

- **A killed `migrate` recovers on its own.** The next run completes without manual SQL once the abandoned build has ended. A run started before then is refused and must be retried. On a large table that wait lasts as long as the rest of the build. The refusal message does not say that another run holds the lock.
- **The hook drops any invalid index, from any session.** graphile-migrate's lock only keeps `migrate` runs apart. A non-blocking index build or `REINDEX CONCURRENTLY` started by hand would be dropped by a `migrate` that runs meanwhile, so neither is run against a database while `migrate` might run.
- **The lock needs a session connection.** `migrate` connects directly or through session pooling, never through a transaction-mode pooler.
- **An index with the wrong definition passes `migrate`.** The CI checks catch one only if the migrations produce it, because CI builds fresh databases. Declaring every index in the Drizzle schema should let both checks flag it, but that exact case was not run. An index already wrong in a deployed database, for example one made by hand, is caught by neither.
- **CI needs a superuser** to install pgvector in every database it builds, as install does. Production roles do not change.
- **Two checks to maintain.** In the spike, the Vitest test needed about 130 lines of comparison code, tuned against the spike's schema. Both checks need extending when the schema uses a Postgres feature they do not yet compare.
- **Partitions, triggers and grants** are compared by neither check, and need tests of their own (see Follow-up). Policies are also covered by pgTAP.
- **The schema exists twice:** as SQL migrations, and as the Drizzle schema in TypeScript.
- **Raw SQL is not checked by the compiler.** That covers migrations and `sql` fragments, so tests cover it. In `sql` fragments, result types are declared by hand. They must allow null where the SQL can return it, and tests check this.
- **An edited applied file** is caught by the CI hash check, not by the runner.
- **A migration merged late, after a rebase,** is refused with a hash-chain error that does not explain the cause. The fix is to re-chain the unapplied files, never the applied ones.
- **Vector results come back as strings,** and similarity scores need a cast. A small typed wrapper hides this.
- **Drizzle 0.45 is the stable line, and 1.0 is a release candidate.** Upgrading to 1.0 needs its own check of the hard queries and policies.

## Alternatives considered

- **Keep 0017's rule and document the manual fix.** After a killed `migrate`, an operator would drop the finished index and rerun. Not chosen, because [0010](0010-deployment.md) requires an interrupted migration to complete when `migrate` runs again.
- **Drop the index before creating it.** It cannot work under graphile-migrate (5c).
- **A wrapper that waits for the lock and reruns.** Not tested. On its own it still hits "already exists".
- **Only one of the two schema checks.** The catalog comparison is one fixed query, with no comparison code for each kind of object. The Vitest test needs no second database but is more code and more closely tuned to the spike's schema. Running both covers the most.
- **Pull-and-diff.** It cannot see the partitioned table, so it misses drift there.
- **`push --strict`.** It exits 0 even when it stops at a prompt, its report on an unchanged schema varies between runs, and `push` without `--strict` applies changes.
- **Kysely 0.29, Drizzle Kit as the runner, our own runner, and Prisma 8:** as in 0017.

## Follow-up

- Test how indexes on a partitioned table are migrated before the first one is needed. Such an index is created on the parent alone and then attached to a non-blocking index on each partition. The parent's index stays invalid until every partition is attached, so the hook could drop it if a run is interrupted part-way.
- Add tests for partitions, triggers and grants, which neither schema check compares.
- Decide whether to run the catalog comparison against deployed databases, which would catch an index made wrong outside the migrations.
- Rerun the hard queries and policy tests before adopting Drizzle 1.0.
- Test HNSW on real embeddings once a campaign's size calls for it (`NFR-14`).
