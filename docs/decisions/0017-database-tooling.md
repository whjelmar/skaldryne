# 0017 — Database client and migration tooling

**Status:** Open · **Date:** 2026-10-01 · **Serves:** `MODEL-32`, `NFR-01`, `NFR-14`, `NFR-16`, `NFR-24`, `NFR-25`

## Context

[0005](0005-record-storage.md) puts the record, the search indexes and the job queue in PostgreSQL with pgvector, and makes schema changes plain SQL migrations. [0007](0007-visibility-enforcement.md) relies on row-level security, with the tenant and the person set for each transaction. The tenancy requirements (`MODEL-32`, `NFR-16`) and the upgrade requirements (`NFR-24`, `NFR-25`) add more: every query runs inside one tenant, migrations are tested and safe to repeat, and one runner must bring many databases to the same version and say which version each one is at.

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

### Results

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

## Recommendation

**Recommended, not decided:**

- **Queries:** Kysely, with types generated from a database built by the migrations.
- **Migrations:** graphile-migrate, as plain SQL files. Use its stable 1.x line unless 2.0 is released first; the spike ran 2.0.0-rc.5 and did not check that 1.4.1 behaves the same, so that needs a rerun of the suite.

The points below describe what adopting it would mean:

- **Migrations are plain SQL,** as [0005](0005-record-storage.md) already says, so partitions, triggers, policies and grants are written the same way as everything else, and nothing tries to undo them.
- **CI closes the gaps the tool leaves.** One check recomputes the hash of every applied migration and compares it with the committed files, for each database the runner touches. Another builds a fresh database from the migrations and compares its schema dump with the committed one. A third regenerates the types and fails if they changed. Together these replace the drift check that the tool lacks.
- **The fleet runner** is our own small script around the tool's programmatic API. It reports each database's applied migrations and their hashes, and refuses to run where a hash disagrees.
- **Setting the tenant** for each transaction is one helper, `withTenant(tenantId, tx => …)`, built on Kysely's transaction API with no raw SQL in application code.
- **A migration that has shipped is never edited.** Corrections are new migrations.

## Consequences if adopted

- The schema is written in SQL and read in TypeScript. That means more hand-written SQL than in arm B, but no generated schema to fight, and no mismatch between what the tool thinks exists and what does.
- We own two small pieces: the hash and schema-dump checks, and the fleet runner.
- Vector results come back as strings and similarity scores need a cast. A small typed wrapper hides this.
- jsonb inserts are typed loosely by the generated types, so a wrong value type-checks and fails at runtime. Writes go through a helper.
- Both packages are maintained by small teams. Kysely is still versioned 0.x, and graphile-migrate's 2.0 line is a release candidate.

## Options considered

- **Drizzle 1.0.** A pleasant TypeScript schema, plain generated SQL, and native policy declarations. Not recommended for now. Its comparison drops partitions unless told to ignore them and cannot see triggers, functions or grants. Its migrator never checks hashes. It runs every pending migration in one transaction. The 1.0 line is still a release candidate. Worth revisiting after 1.0 if the comparison learns to leave unknown objects alone.
- **Prisma 8.** The best design for knowing where each database in a fleet stands, and idempotent migration steps. Not recommended now. It is a release candidate with runtime defects that touch tenancy and data (jsonb, connection waits, setting the tenant). Its live check gives false failures on our policies. Much of our schema still needs raw SQL. Migrations are not plain SQL files. Worth re-running the same spike against its general release.
- **Kysely with a different SQL migration runner.** Not tested. The recommendation does not depend on graphile-migrate's own features beyond ordered SQL files and recorded hashes, so a swap remains cheap.

## To decide

Which toolset: Kysely with graphile-migrate, Drizzle 1.0, Prisma 8, or another runner? And should the decision wait for the general releases of Drizzle 1.0 and Prisma 8? When a maintainer decides, this record becomes Proposed or Accepted with the chosen option, or is replaced by a record that states it.
