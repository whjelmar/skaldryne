# 0017 — Database client and migration tooling

**Status:** Open · **Date:** 2026-10-01, revised 2026-11-09 · **Serves:** `MODEL-32`, `NFR-01`, `NFR-14`, `NFR-16`, `NFR-24`, `NFR-25`

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

**Not tested in either round:**
- the non-blocking index build through Drizzle's migrator;
- an older file merged late, on graphile-migrate;
- a type-safety test that renames columns and counts what fails to compile;
- the HNSW and campaign filter at reference scale (`NFR-14`);
- any run on Node.js 24 LTS.

## Recommendation

**Recommended, not decided:**

- **Queries:** Kysely, with types generated from a database built by the migrations. The lead over Drizzle 0.45 on hard queries is real but modest. It comes from recursive queries, window functions and `CASE`, which the record model and search need.
- **Migrations:** a small runner of our own over plain SQL files, rather than graphile-migrate or Drizzle Kit. The spec named this fallback in advance for a failed must-have. It has not been built or tested.

  It has four jobs:
  - apply files in name order, refusing a file that sorts before one already applied;
  - run one transaction per file, with an opt-out that afterwards checks every index is valid and fails the run if one is not;
  - check the hash of every applied file against the committed one;
  - run against a list of databases and report each one's version.

  The version it records is what processes check on start ([0010](0010-deployment.md)). The pre-registered limit is about 150 lines, and the same suite must pass on it before this record can be accepted.

  The alternative is to keep graphile-migrate 1.4.1, plus a CI hash check, a rule that non-blocking index files drop any invalid index first and check validity after, and enforced line endings. That leaves the killed-build failure to be handled by hand.

Whichever is chosen, adopting it means:

- **Migrations are plain SQL,** as [0005](0005-record-storage.md) says. Partitions, triggers, policies, grants and the partition `REVOKE`s are written like everything else.
- **One transaction helper sets the audience,** `withAudience(campaign, audience, tx => …)`, as [0007](0007-visibility-enforcement.md) describes. Application code contains no raw SQL for it.
- **Three roles and a bootstrap step.** The roles are application, migration and redaction ([0010](0010-deployment.md)). pgvector needs a superuser to create it, so install creates the extension before `migrate` first runs.
- **CI** builds a fresh database from the migrations, compares its schema dump with the committed one, and fails if regenerated types changed.
- **A migration that has shipped is never edited.** Corrections are new migrations.
- **Before acceptance,** the chosen arm's suite is rerun on Node.js 24 LTS ([0004](0004-language-runtime-and-repository.md)).

## Consequences if adopted

- The schema is written in SQL and read in TypeScript. There is no generated schema to fight, and no gap between what a tool thinks exists and what does.
- We own the migration runner, its tests and the CI checks. That is about 150 lines, but every upgrade depends on it.
- Vector results come back as strings and similarity scores need a cast. A small typed wrapper hides this.
- Generated types are loose for jsonb, so a wrong value type-checks and fails at runtime. Writes go through a helper.
- Kysely is maintained by a small team and still versioned 0.x.

## Options considered

- **Drizzle 0.45 for queries.** It covers the same hard queries correctly with somewhat more raw SQL, and it has typed column references and native policy, `halfvec` and HNSW declarations. Not recommended. It has no recursive queries, window functions or `CASE`, and it typed a nullable rank as a number. Worth revisiting at 1.0.
- **Drizzle Kit for migrations.** Not recommended. It runs all pending files in one transaction, skips an older file merged late without a word, and never checks applied hashes.
- **graphile-migrate 1.4.1.** Workable with the CI checks above. A killed non-blocking index build leaves an invalid index and needs manual recovery, and edits to applied files go unnoticed.
- **Prisma 8.** Dropped from round 2. Round 1 found release-candidate defects that touch tenancy and data. Worth a fresh spike at its general release.

## To decide

1. Kysely or Drizzle for queries?
2. Our own runner, graphile-migrate 1.4.1 with the CI checks, or something else for migrations?
3. Run the untested items above first, or decide now?

When a maintainer decides, this record becomes Proposed or Accepted with the chosen options, or is replaced by a record that states them.
