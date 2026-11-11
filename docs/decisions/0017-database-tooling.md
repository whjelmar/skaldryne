# 0017 — Database client and migration tooling

**Status:** Superseded by [0018](0018-database-tooling-after-follow-ups.md) · **Date:** 2026-10-01, revised 2026-11-09, decided 2026-11-10 · **Serves:** `MODEL-32`, `NFR-01`, `NFR-14`, `NFR-16`, `NFR-24`, `NFR-25`

## Context

[0005](0005-record-storage.md) puts the record, the search indexes and the job queue in PostgreSQL with pgvector, and makes schema changes plain SQL migrations. [0007](0007-visibility-enforcement.md) relies on row-level security. Each transaction sets the campaign and the audience: the GM, one person, or the table. [0010](0010-deployment.md) gives migrations their own `migrate` step, run as a migration role. Migrations must be safe to repeat, and an interrupted one must complete on the next run. Every process checks the schema version when it starts. The tenancy requirements (`MODEL-32`, `NFR-16`) and the upgrade requirements (`NFR-24`, `NFR-25`) add more: every query runs inside one tenant, and one runner must bring many databases to the same version and say which version each one is at.

The tooling has to cope with the Postgres features the record model is likely to need, whatever [0006](0006-record-model.md) finally decides: composite tenant-first keys, a partitioned append-only history table, triggers, `halfvec` embeddings with an HNSW index, and policies on every tenant table.

### The spike

Three toolsets were built against the same stand-in schema and run through the same eight tasks. The code, each arm's `RESULTS.md`, and an independent verification are on the `spike/db-tooling` branch under [`spikes/db-tooling/`](https://github.com/whjelmar/skaldryne/tree/spike/db-tooling/spikes/db-tooling). That branch is evidence only and never merges.

| Arm | Versions |
| --- | --- |
| A | Kysely 0.29.6 (stable) with types generated from the database by kysely-codegen 0.20.0; graphile-migrate 2.0.0-rc.5 (stable line 1.4.1; nothing used is new in 2.0) |
| B | Drizzle ORM and Drizzle Kit 1.0.0-rc.4 (stable lines 0.45.3 and 0.31.11) |
| C | Prisma 8.0.0-rc.19, runtime packages rc.14 (stable line 7.10.0 has none of the features used) |

The tasks were:

- **T1** tenant isolation, including attempts to read or write another tenant's rows through the normal API;
- **T2** no tenant context leaking across pooled connections;
- **T3** vector insert and similarity search;
- **T4** the tool leaving hand-written triggers, partitions and policies alone;
- **T5** a column rename done as expand and contract, with old and new code running at once;
- **T6** migrations and imports safe to repeat, including a migration that fails halfway;
- **T7** bringing two databases at different versions current with one runner;
- **T8** CI fit: a migration linter, pgTAP checks of the policies, and one `pnpm test` from a clean database.

### Round 1 results

All three suites pass from a clean local copy: 15, 27 and 33 tests. A separate verification pass reran them, read every test against its claim, checked the catalog of each arm's database, and compared each final schema with the reference. Every arm produced an equivalent schema.

| Task | A: Kysely + graphile-migrate | B: Drizzle 1.0 RC | C: Prisma 8 RC |
| --- | --- | --- | --- |
| T1 isolation | pass | pass | pass |
| T2 pooling | pass | pass | pass |
| T3 vectors | pass; results partly typed | pass; results partly typed | pass; mostly raw SQL, results partly typed |
| T4 tool leaves objects alone | partial: no schema diff at all | pass, but only with a filter that hides the partitions | partial: plan never reads the database; the live check reports false failures |
| T5 expand and contract | pass | pass | pass |
| T6 safe to repeat | pass | pass | pass |
| T7 many databases | pass | pass | pass |
| T8 CI | pass | pass | pass |

The scores are close. The differences are in what each tool does on its own, and in how much of the schema it can express:

- **A.** Every migration is hand-written SQL, which is what [0005](0005-record-storage.md) asks for. There is nothing to drift, because the tool never generates schema. Types come from the live database, so they always match what was applied. Application code needed no raw SQL. Its weaknesses are that it never re-checks the hashes of migrations already applied, and that there is no supported way to change an earlier migration once later ones exist.
- **B.** Tables, keys, indexes, `halfvec` and policies are expressed in TypeScript, and the SQL is generated as plain files. Partitions, triggers, functions and grants need hand-written migrations. The tool's schema comparison does not see triggers, functions or grants. Without a configured filter it plans to drop every partition, and it offered to drop the test schema. The migrator stores a hash but never checks it. It runs all pending migrations in one transaction, which rules out building an index without blocking writes, and it cannot stop at a chosen version.
- **C.** The strongest account of where each database stands: state is a hash of the schema contract, the same everywhere, so a fleet can be grouped and compared. Migrations carry checks before and after each step. Against that, every feature used is in a release candidate, and the spike hit runtime defects:
  - jsonb values decoded twice;
  - a pool of one connection waiting forever inside a transaction;
  - an assumed `Temporal` global;
  - no raw SQL inside a transaction, which setting the tenant needs.

  The live schema check reports the declared policies as unexpected. The plan compares contracts without reading the database. A client built against an older schema runs against a newer database without complaint until a query fails. Partitions, triggers, `halfvec`, grants and `NULLS NOT DISTINCT` all needed raw SQL. The generated SQL lives inside `ops.json` rather than as plain files. The packages are Apache-2.0.

Found in every arm:

- **Partitions sit outside row-level security.** Policies on a partitioned table apply only to queries through the parent, so the application role must have no privileges on the partitions themselves. The reference schema now revokes them, and the pgTAP checks test it. This applies whatever tool is chosen.
- **pgvector is not a trusted extension.** A superuser step must create it before migrations run. Hosted Postgres offerings and the fleet runner both need that step.
- **The HNSW index was used only once the planner was steered, at spike scale.** The campaign filter is applied after the index scan, which can drop matches. This needs checking at reference scale (`NFR-14`) whichever tool is chosen.
- **The squawk migration linter needs `--assume-in-transaction`;** without it, many of its warnings are false.
- **Environment:** the spike ran on Node.js 25, not the Active LTS line [0004](0004-language-runtime-and-repository.md) requires. `pnpm test` does not run from the network share, because of UNC paths, so local disk is needed for development and CI.


### Round 2: hard queries and stable versions

A council and the maintainer judged the first round tilted toward arm A in three ways:
- the brief favoured tools that define the schema in code;
- the hardest queries were never written;
- no stable versions were tested.

A second round was pre-registered in `EXPERIMENTS.md` before any code was written, then run on 2026-11-09. It used the stable lines only: Kysely 0.29.6 with graphile-migrate 1.4.1, and Drizzle ORM 0.45.4 with Drizzle Kit 0.31.11. The maintainer dropped Prisma from this round. An independent verifier reran both suites, and a separate auditor checked the round for bias. Both reports are in `VERIFICATION.md` on the spike branch.

**Hard queries.** Both arms returned exactly the expected rows for all four queries and the RLS check:
- a 1–3 hop graph walk over relationship claims;
- full-text search with headlines;
- text and vector rankings combined by reciprocal rank fusion;
- a job queue whose claims don't block each other.

The verifier's recount of raw SQL, as a share of each query's characters:

| Query | Kysely | Drizzle 0.45 |
| --- | --- | --- |
| Graph walk | 23% | 57% |
| Full-text search | 13% | 36% |
| Combined ranking | 15% | 37% |
| Job queue | 10% | 18% |

The Drizzle arm's own report gave 67–89%. The verifier could not reproduce those figures, and they are wrong.

The auditor found that the measure favours a query builder: it counts Drizzle's typed column references inside `sql` fragments as raw. With those excluded, the shares are 7–22% for Kysely against 8–28% for Drizzle.

What really differs:
- Drizzle 0.45 has no recursive queries, window functions or `CASE`, so those parts are raw in Drizzle.
- Neither arm typed every result from the schema alone.
- Drizzle types the two rank columns of the combined ranking as numbers, but they are null when one side is missing. The agent changed the test's type assertion to match that wrong type, so the test no longer flags it.

**Migration runners.** Neither tool meets [0010](0010-deployment.md) and `NFR-24` on its own.

| | graphile-migrate 1.4.1 | Drizzle Kit 0.31 |
| --- | --- | --- |
| Transactions | One per file. A file can opt out, which non-blocking index builds need. | All pending files in one transaction. A failure in the second file rolls back the first. Non-blocking index builds were not tested and probably cannot run. |
| Killed part-way | Transactional file: clean, and the rerun completes. Non-blocking index build: leaves an invalid index, and the rerun fails with "already exists". The `IF NOT EXISTS` form instead reports success while the index is still invalid. | Not tested. |
| Applied file edited later | Not detected (pending files are) | Not detected |
| Older file merged late | Not tested | Skipped without a word |
| Other | Windows line endings break its header parser. | Fails without printing the database error. |

The auditor also found that only the Kysely arm was given the killed-run and non-blocking index tests. A coordinator's note described the interrupted first attempt wrongly, and a later commit on the spike branch corrects it. The auditor found no sign that the earlier work leaked into this round.

Its verdict: the round was tilted toward Kysely on its headline numbers, and toward Drizzle on Drizzle's own typing self-scores. After both corrections, Kysely still leads on the hard queries, but the margin is modest.

### Round 3: the items left untested

Round 2 left five things untested. They were pre-registered as Experiment 4 (`EXPERIMENTS.md`, commit eb51330) and run on 2026-11-09. A verifier reran them and an auditor checked them for bias, as before. The auditor found the first migration briefs unequal: graphile-migrate was told to try every pattern and model a realistic merge, while Drizzle was not. Drizzle's tests were rerun with the same wording. It also found that the two arms' rename tests ran on different TypeScript versions, so the Kysely arm was rerun on the same version. Both reruns are what is reported below. Everything is on the spike branch, commit 0f632bb.

**Migration runners.** "Pass" means the runner reaches a correct state with no manual SQL and never reports success while something is wrong.

| Test | graphile-migrate 1.4.1 | Drizzle Kit 0.31.11 |
| --- | --- | --- |
| Non-blocking index build (`CONCURRENTLY`) | Pass, in a file that opts out of the transaction. | Fail. Every supported form errors and rolls the batch back. Only an undocumented file that starts with `COMMIT;` works, and it breaks the batch's atomicity. |
| Killed transactional file | Pass. | Pass. |
| Killed non-blocking index build | Pass only with a `beforeAllMigrations` hook that drops invalid indexes. The hook is global, sits outside the migration file and could drop an index another session is still building. Every pattern inside the file fails. | Fail. No supported pattern can run the build. |
| Older file merged late | Refused in three of five scenarios, with a hash-chain error that is misleading after a rebase. Applied silently on a fresh database. Skipped silently after an applied file was hand-edited to re-chain. | Fail. Skipped silently in every scenario, while the command prints "migrations applied successfully!". A git merge of its migration list also conflicts. |
| Applied file edited later | Not detected. | Not detected. |

On both runners, a non-blocking build written with `IF NOT EXISTS` reports success while the index is still invalid.

**Type safety under renames.** Each of the 25 columns used by the four hard queries was renamed in turn, and the test counted the references to it that fail to compile.

| | Kysely 0.29.6 | Drizzle 0.45.4 |
| --- | --- | --- |
| References in query code caught | 56 of 76 (74%); 49 (64%) counting only errors reported on the right line | 78 of 78 (100%) |
| Including raw SQL in the schema and migrations | 61% (53% strict) | 87% |
| References that compile and then pass wrongly | none | none |

The Kysely result is the same on TypeScript 5.9.3 and 7.0.2. Raw SQL in either arm is caught by neither compiler. The Kysely count of raw-SQL references was done by hand and is less certain than Drizzle's.

**Node.js 24 LTS.** Both suites give the same results on Node.js 24 as on 25: Kysely passes 30 of 31, failing only the known killed-index test, and Drizzle passes 36 of 36. The verifier rates this evidence weak, because the logs do not print the Node version.

**The vector index at reference scale (`NFR-14`).** The test used 550,000 `halfvec(768)` rows across 10 campaigns. An exact scan through the campaign index already meets the target: recall 1.0, 10 rows for every query, p95 of 43 ms. Filtered HNSW failed: recall was at most 0.13, and many queries returned fewer than 10 rows. Iterative scan did not fix it. One HNSW index per campaign, as partitions or partial indexes, reached a recall of 0.97–0.98 only at the maximum search width. The verifier found the generated data unrealistically uniform, so the HNSW figures are pessimistic. This test does not separate the tools. It does mean that a large campaign will need iterative scan or per-campaign indexes, whichever tool is chosen.

**Still not tested:** our own migration runner, which has not been built; Drizzle 1.0; Prisma 8 at general release; and HNSW on real embeddings.

## Decision

The maintainer decided on 2026-11-10, after round 3.

- **Queries: Drizzle ORM 0.45.** Its main advantage is that a renamed column fails to compile in every query that uses it. The hard queries keep some raw SQL in `sql` fragments, because Drizzle 0.45 has no recursive queries, window functions or `CASE`. Every such fragment is covered by a test.
- **Migrations: graphile-migrate 1.4.1,** with:
  - a `beforeAllMigrations` hook that drops invalid indexes, so a killed non-blocking index build is repaired on the next run;
  - a CI check that the hashes of applied files match the committed files;
  - a rule that non-blocking index files never use `IF NOT EXISTS`;
  - enforced line endings for migration files.
- **Drizzle Kit is not the migration runner.** Drizzle ORM runs against the schema that graphile-migrate applies.

Adopting it means:

- **Migrations are plain SQL,** as [0005](0005-record-storage.md) says. Partitions, triggers, policies, grants and the partition `REVOKE`s are written like everything else.
- **The Drizzle schema in TypeScript describes what the migrations create.** CI builds a fresh database from the migrations, compares its schema dump with the committed one, and fails if the Drizzle schema no longer matches it.
- **One transaction helper sets the audience,** `withAudience(campaign, audience, tx => …)`, as [0007](0007-visibility-enforcement.md) describes. Application code contains no raw SQL for it.
- **Three roles and a bootstrap step.** The roles are application, migration and redaction ([0010](0010-deployment.md)). pgvector needs a superuser to create it, so install creates the extension before `migrate` first runs.
- **A migration that has shipped is never edited.** Corrections are new migrations.
- **Vector search** starts with an exact scan within a campaign. Iterative scan or per-campaign indexes are added when a campaign's size needs them (`NFR-14`).

## Consequences

- The schema exists twice: as SQL migrations, and as the Drizzle schema in TypeScript. CI keeps the two in step.
- A renamed column fails to compile wherever query code uses it. Raw SQL in migrations and in `sql` fragments is not checked by the compiler, so tests cover it.
- In `sql` fragments, result types are declared by hand. Round 2 found a nullable rank typed as a number. Such declarations must allow null where the SQL can return it, and tests check this.
- The hook runs before every migration run, and it drops any invalid index, including one that another session is still building. It is safe only while no two `migrate` steps run at the same time against one database.
- An edited applied file is caught by the CI hash check, not by the runner.
- After a rebase, a migration merged late is refused with a hash-chain error that does not explain the cause. The fix is to re-chain the unapplied files, never the applied ones.
- Vector results come back as strings and similarity scores need a cast. A small typed wrapper hides this.
- Drizzle 0.45 is the stable line, and 1.0 is a release candidate. Upgrading to 1.0 needs its own check of the hard queries and policies.

## Alternatives considered

- **Kysely 0.29 for queries.** It writes the hard queries with the least raw SQL. It was not chosen because about a quarter of query references to a renamed column still compile.
- **Drizzle Kit for migrations.** It cannot run a non-blocking index build without an undocumented workaround, it skips an older file merged late while reporting success, and it never checks applied hashes.
- **Our own migration runner.** It would be about 150 lines and avoid the global hook, but every upgrade would depend on code we own. It was never built.
- **Prisma 8.** Dropped from rounds 2 and 3. Round 1 found release-candidate defects that touch tenancy and data. Worth a fresh spike at its general release.

## Follow-up

- Confirm that graphile-migrate runs one `migrate` at a time against a database. If it does not, the `migrate` step ([0010](0010-deployment.md)) takes an advisory lock first.
- Choose how CI compares the Drizzle schema with the migrated database.
- Rerun the hard queries and policy tests before adopting Drizzle 1.0.
- Test HNSW on real embeddings once a campaign's size calls for it (`NFR-14`).
