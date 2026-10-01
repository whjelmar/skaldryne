# Database tooling spike

Throwaway comparison of database tooling for Skaldryne. This branch never merges. Its findings go into decision record 0017, which stays Open until a maintainer chooses.

## Arms

| Arm | Directory | Migrations | Queries |
| --- | --- | --- | --- |
| A | `arm-kysely/` | graphile-migrate | Kysely on `pg`, types generated from the live database |
| B | `arm-drizzle/` | Drizzle Kit | Drizzle ORM on `pg` |
| C | `arm-prisma/` | Prisma 8 migrations | Prisma 8 client |

For each tool, use the newest release line that carries its RLS and migration features, even when that line is a release candidate (Prisma 8 RC, Drizzle 1.0 RC). Where a stable line also exists, note in the results whether anything you relied on is missing from it. Record exact versions.

Each arm is its own pnpm project (Node.js, TypeScript strict, Vitest). No Bun.

## Database

`docker compose up -d --build --wait` starts Postgres 18 with pgvector and pgTAP on **localhost:55432**.

| Role | Password | Use |
| --- | --- | --- |
| `postgres` | `postgres` | Bootstrap only: create databases and extensions |
| `skal_migrator` | `migrator` | Owns the schema; runs every migration |
| `skal_app` | `app` | What the application and tests connect as; subject to RLS |

Bootstrap, done by a script in each arm, not by migrations: create the database owned by `skal_migrator`, then as `postgres` run `CREATE EXTENSION vector` and `CREATE SCHEMA tap; CREATE EXTENSION pgtap SCHEMA tap`. pgvector is not a trusted extension, so migrations cannot create it; they may only assert it exists.

Each arm uses its own databases, prefixed with the arm name (`kysely_*`, `drizzle_*`, `prisma_*`), including any shadow database its tool wants.

## Schema

[reference/schema.sql](reference/schema.sql) is the target. [reference/smoke.sql](reference/smoke.sql) shows the expected behaviour. Each arm must produce an equivalent database: same tables, columns, types, keys, partitions, triggers, indexes, policies and grants. Express as much as possible through the tool's own schema language and migration generator. Where the tool cannot express something, fall back to raw SQL inside the tool's migration mechanism, and record each fallback.

The schema is a stand-in. It does not decide the record model or the storage levers.

## Migrations

Build the schema as three migrations, so tasks 5 to 7 have something to work with:

- **M1:** everything in `reference/schema.sql`.
- **M2 (expand):** add `entity.display_name text`, backfill it from `name`, and keep the two in sync while both exist (a trigger is fine).
- **M3 (contract):** drop `entity.name`; `display_name` becomes `NOT NULL`.

## Tasks

Write each task as a Vitest test named `T1` to `T8`, connecting as `skal_app` unless the task says otherwise. Score each one **pass**, **partial**, or **fail**.

1. **Tenant isolation.** With tenant A's context, every read, update, delete and insert of tenant B's rows through the tool's normal API fails or affects nothing. Also try to insert a row whose `tenant_id` is B (rejected), and a row in A referencing B's campaign (rejected by the composite foreign key).
2. **Pooling.** Tenant context is set per transaction with `set_config('app.tenant_id', $1, true)` through the tool's own transaction API. With a pool of size 1, interleave requests for A, B, and no tenant; none sees another's rows, and a request with no tenant sees nothing. Show what application code looks like: ideally one helper, `withTenant(tenantId, tx => ...)`.
3. **Vectors.** Insert `halfvec(768)` embeddings through the tool, run a top-5 cosine similarity query filtered by campaign (joining `claim_current`), and confirm with `EXPLAIN` that the HNSW index can be used. Note whether the result types are real types or `unknown`/`any`/string.
4. **Triggers and partitions survive the tool.** After M1 to M3 are applied, ask the tool to generate a new migration or diff from its schema. It must propose no changes: it must not try to drop or recreate triggers, functions, partitions, policies or the HNSW index. Inserting claim versions through the tool must still update `claim_current`, and reading `claim_current` must be typed.
5. **Expand and contract.** Between M2 and M3, code written against the M1 schema (`name`) and code written against the M2 schema (`display_name`) both work against the same database at the same time, and writes from either show up in both columns. After M3, the newer code still works. Explain how the tool's generated types cope with two schema versions in flight.
6. **Safe to repeat.** (a) Applying migrations to an up-to-date database changes nothing. (b) Break M2 so it fails partway through, then run it: the database must be left unchanged (or clearly resumable). Fix it, run again, and it completes. (c) Import the same batch of 50 entities, with claims, twice through an upsert keyed on `import_record (tenant_id, source, source_key)` and `content_hash`. The second run adds no rows and no claim versions.
7. **A fleet of databases.** Create two databases, one at M1 and one at M2. One script, using the tool's programmatic API or CLI, brings both to M3 and then reports each database's applied state. Note how that state is identified (a version, a hash, a row list) and whether it could be compared across hundreds of databases.
8. **CI fit.** (a) Run `squawk` over the SQL the migrations actually execute, and report what it flags and whether the tool makes the SQL available as files. (b) One pgTAP test file, run with `pg_prove` or `SELECT * FROM tap.runtests()` inside the container, checks that RLS is enabled with the expected policy on every tenant table. (c) Everything runs from a clean database with one command: `pnpm test`.

## Results

Each arm writes `RESULTS.md` with:

1. Versions used, and whether any feature came from a release candidate.
2. A table: task, score, raw SQL needed (none / some / most), typed results (yes / partial / no), one-line note.
3. Every raw-SQL fallback, with the reason.
4. Anything that surprised you, good or bad, with evidence (command output, error text).
5. What the `withTenant` helper looks like, as code.
6. Rough effort: what was quick, what fought back.

Report what happened, including failures. A failing task with a clear explanation is a useful result; do not paper over it.
