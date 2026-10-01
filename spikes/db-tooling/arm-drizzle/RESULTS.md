# Arm B results: Drizzle ORM + Drizzle Kit (1.0 RC)

All 27 tests in 8 files pass. `pnpm install && pnpm test` works from a clean state when run from a local disk. On the Z: network share, the TypeScript compiler fails, as described in [Surprises](#4-surprises-with-evidence). From the share, the same suite passes when run as `node scripts/bootstrap.ts` followed by `node node_modules/vitest/vitest.mjs run`.

## 1. Versions, and what came from the release candidate

| Package | Version |
|---|---|
| drizzle-orm | **1.0.0-rc.4** (npm dist-tag `rc`; an `rc5` tag also exists) |
| drizzle-kit | **1.0.0-rc.4** |
| pg | 8.23.0 |
| typescript | 7.0.2 |
| vitest | 5.0.2 |
| squawk-cli | 2.66.0 (via `pnpm dlx`) |
| Node.js | v25.3.0 (**not** an LTS line, which departs from the project's Active LTS rule; this is the machine's install) |
| pnpm | 12.8.1 |
| Postgres | 18 (container `db-tooling-db-1`), pgvector, pgTAP |

The current stable releases are drizzle-orm 0.45.3 and drizzle-kit 0.31.11.

Features this arm relies on that come from the release candidate:

- **`drizzle-kit push --explain --output json`**, the machine-readable dry run behind T4. Confirmed missing from stable. `pnpm dlx drizzle-kit@0.31.11 push --help` lists only `--verbose`, `--strict` and `--force`.
- **The v1 migration layout and migrator.**
  - Each migration is a folder `drizzle/<timestamp>_<name>/` holding `migration.sql` and `snapshot.json`, with no journal file.
  - The migrator picks pending migrations by folder name.
  - Stable 0.31 uses a flat directory plus `meta/_journal.json`. This is from the documentation and I did not test it here.
- **Probably the same on 0.45, but not tested:**
  - `pgPolicy` (adding a policy enables RLS on the table)
  - `halfvec`
  - `index().using('hnsw', col.op(...))`
  - `cosineDistance`
  - `$count`
  - `onConflictDoUpdate({ setWhere })`
  - `drizzle({ client })`
  - `drizzle-kit generate --custom`
  - `drizzle-kit check`

## 2. Results table

| Task | Score | Raw SQL needed | Typed results | Note |
|---|---|---|---|---|
| T1 Tenant isolation | pass | some | yes | Policies are native (`pgPolicy`), and reads, updates, deletes and inserts of B's rows all fail or affect nothing. Partition REVOKE is raw SQL, and `skal_app` gets 42501 on `claim_version_p0`–`p3`. |
| T2 Pooling | pass | some | yes | `withTenant` uses `db.transaction` plus one `tx.execute(sql\`select set_config(...)\`)`. With 30 interleaved requests on one backend PID, nothing leaked, including after a failed transaction. |
| T3 Vectors | pass | some | partial | The query is built with the query builder. `cosineDistance()` is `SQL<unknown>` until `.mapWith(Number)`. EXPLAIN needs the raw `pg` client. HNSW is chosen only when sort is discouraged (small table). |
| T4 Triggers and partitions survive | pass | some | yes | `generate`, `check` and live `push --explain` all report no changes, but only with `tablesFilter: ['!claim_version_p*']` and `schemaFilter: ['public']`. Without the filter, push drops all four partitions. Triggers, functions and grants are invisible to it. |
| T5 Expand and contract | pass | some | yes | The backfill and sync trigger are custom SQL. Each schema version is a separate TS module. Code typed against the M2 module breaks after M3 (42703), so new code must be typed against the contract shape. |
| T6 Safe to repeat | pass | some | yes | (a) No-op. (b) All pending migrations run in one transaction, so a broken one rolls back fully. (c) Upsert with `setWhere`. Finding: an edited, already-applied migration goes unnoticed. |
| T7 Fleet | pass | none | yes | `migrate()` per database. State is rows of `(id, name, hash, created_at)` in `drizzle.__drizzle_migrations`. I hash the name:hash list into a 16-hex fingerprint that can be compared across a fleet. |
| T8 CI fit | pass | none | n/a | (a) squawk runs over the `migration.sql` files, which are plain files the migrator executes verbatim. (b) pgTAP 55/55 via psql in the container. (c) `pnpm test` works from local disk; see the UNC caveat. |

Full-suite summary from `pnpm install && pnpm test`, run on a local copy of `arm-drizzle/` plus `../reference` and `../README.md`:

```
$ node scripts/bootstrap.ts && node node_modules/typescript/bin/tsc --noEmit && node node_modules/vitest/vitest.mjs run
bootstrap: recreated drizzle_app, drizzle_t5, drizzle_t6, drizzle_fleet_a, drizzle_fleet_b, drizzle_reference; drizzle_app migrated to M3 in 6515 ms

 Test Files  8 passed (8)
      Tests  27 passed (27)
   Duration  14.29s (tests 66%, import 32%, transform 2%)
```

The same suite run from the share (`Z:`), with bootstrap then vitest `--reporter verbose`, printed `Test Files 8 passed (8) / Tests 27 passed (27) / Duration 267.39s`. Each drizzle-kit call takes 30–42 s from the share, against about 1–2 s locally.

### T4 tool output (the task asked for this verbatim)

`drizzle-kit generate`, which diffs offline against the last snapshot:

```
No config path provided, using default 'drizzle.config.ts'
Reading config file '...\arm-drizzle\drizzle.config.ts'
No schema changes, nothing to migrate 😴
```

`drizzle-kit check`:

```
Everything's fine 🐶🔥
```

`drizzle-kit push --explain --output json`, which diffs live against `drizzle_app` with the config filters:

```
{"status":"no_changes","dialect":"postgresql"}
```

The same command without `tablesFilter` (`RAW_INTROSPECTION=1`). `drizzle_app` has rows in `claim_version_p2`, so push stops before planning and asks for confirmation:

```
{"status":"missing_hints","unresolved":[{"type":"confirm_data_loss","kind":"table","entity":["public","claim_version_p2"],"reason":"non_empty"}]}
```

The same command run in text mode against `drizzle_fleet_a`, which is at M3 with empty partitions, plans the drops outright:

```
--- Generated migration statements ---
DROP TABLE "claim_version_p0";
DROP TABLE "claim_version_p1";
DROP TABLE "claim_version_p2";
DROP TABLE "claim_version_p3";
```

The catalog comparison (`out/t4-catalog-diff.txt`) has no differences from `reference/schema.sql` once the expected M2/M3 entity changes are excluded:

- the `name` and `display_name` columns;
- their `*_not_null` constraints, which Postgres 18 names;
- the M2 sync trigger, which M3 drops.

The comparison covers relations, partition bounds, RLS flags, ACLs, columns, constraints, indexes (including `WITH (m='16', ef_construction='64')`), triggers, functions and policies.

## 3. Every raw-SQL fallback, and whether drizzle-kit sees it as drift

| Fallback | Where | Why | Drift? |
|---|---|---|---|
| `PARTITION BY HASH ("tenant_id")` | Hand-edited line in generated `m1_schema/migration.sql` | Drizzle has no partitioning syntax | No. The snapshot does not record partitioning, so `check`, `generate` and filtered `push` stay quiet. |
| `CREATE TABLE claim_version_p0..p3 PARTITION OF ...` | `m1_partitions_triggers_grants` (created with `generate --custom`) | Partitions cannot be declared | **Yes**: push proposes `DROP TABLE` for each one. Hidden with `tablesFilter: ['!claim_version_p*']`. |
| Trigger functions and triggers (`claim_version_append_only`, `claim_current_sync`) | Same file | Drizzle does not model triggers or functions | No, and it would not notice if they went missing. |
| `GRANT ... ON ALL TABLES IN SCHEMA public TO skal_app` | Same file | No grant syntax | No; invisible. |
| `REVOKE ALL ON claim_version_p0..p3 FROM skal_app` | Same file (added on the coordinator's request) | RLS on the parent does not cover direct partition access. Drizzle cannot express grants, and partitions are not modelled. Per-partition RLS or grants cannot be expressed natively. | No; invisible. |
| `CREATE EXTENSION vector` | `scripts/bootstrap.ts` as `postgres`. Migration `m1_assert_extensions` only asserts it exists. | pgvector is not a trusted extension, so the migrator role cannot create it | No. |
| M2 backfill `UPDATE` plus the `entity_name_sync` trigger | `m2_expand_backfill_sync` (custom) | Data migration and trigger | No. |
| `DROP TRIGGER` / `DROP FUNCTION entity_name_sync` | `m3_contract_drop_sync` (custom) | Same | No. |
| `select set_config('app.tenant_id', $1, true)` | `withTenant` via `tx.execute(sql...)` | No API for session settings | n/a |
| `excluded.content_hash` and `now()` fragments | Importer upsert (`set`, `setWhere`) | The builder has no typed handle for `excluded` | n/a |
| `EXPLAIN` and planner `SET`s | T3, through the raw `pg` client | Drizzle has no `explain()` | n/a |

Everything else is native:

- the 9 tables;
- composite primary keys and foreign keys;
- the `halfvec(768)` column;
- the HNSW index with `m`/`ef_construction`;
- the 9 `tenant_isolation` policies;
- `ENABLE ROW LEVEL SECURITY`;
- the M2 add-column and the M3 drop column and SET NOT NULL.

Drizzle generated all of these from the TS schema.

## 4. Surprises, with evidence

1. **`push` wants to drop the partitions**, and the protection is a filter you have to remember. With rows present it stops with `missing_hints`; without rows it plans `DROP TABLE "claim_version_p0"` and the other three (see above). The `tablesFilter` and `schemaFilter` in `drizzle.config.ts` are the only guard. `--tablesFilter` on the CLI only applies when no config file is used.
2. **The pgTAP schema also looked like drift.** Bootstrap installs pgTAP into schema `tap`. Push then returned `{"status":"missing_hints","unresolved":[{"type":"confirm_data_loss","kind":"schema","entity":["tap"],"reason":"non_empty"}]}`, so it would drop a schema it does not own. This is fixed with `schemaFilter: ['public']`.
3. **Triggers, functions and grants are invisible.** Push never proposes dropping them, which is good. It also never notices if they are missing. The T4 catalog comparison against `reference/schema.sql` is what proves they survive.
4. **The migrator stores a hash but never checks it.** In test `T6 (finding)`, an already-applied M1 migration is edited and `migrate()` runs again. There is no error and no warning, and the stored hash stays the old one. Drift in applied SQL has to be caught some other way (CI diffing, or my fingerprint).
5. **All pending migrations run in one transaction.** That makes T6b clean: injecting `SELECT 1/0;` gives 22012 and leaves the catalog fingerprint equal to M1, and the fixed file then applies. It also means `CREATE INDEX CONCURRENTLY` cannot appear in any migration. There is no option to apply up to a chosen migration, so the tests stage M1 and M2 by copying folders into a temp directory.
6. **Code typed against the M2 module breaks after M3.** Drizzle lists every declared column in `SELECT` and `RETURNING`, so a module that still declares `name` fails with `42703 column "name" does not exist` once it is dropped. In T5, v1 code (m1.ts) and M2-typed code fail after M3, while v2 code typed against m3.ts works. The answer to "how do the types cope" is: one TS module per schema version, and code that must survive the contract step is typed against the contract shape. m2.ts also needs `name` given a `$defaultFn(() => sql\`NULL\`)` so its inserts leave `name` to the trigger.
7. **`cosineDistance()` returns `SQL<unknown>`.** It needs `.mapWith(Number)` before the result is typed `number`. `halfvec` maps to `number[]`, and `jsonb().$type<T>()` gives `T`. The generated SQL sends the query vector twice (`<=> $1` in the select, `<=> $3` in order by).
8. **The planner prefers join-then-sort on tiny data.** By default T3 uses a bitmap scan on `claim_current`, then a sort. With `enable_seqscan=off, enable_sort=off` it uses `Index Scan using claim_embedding_hnsw ... Order By: (embedding <=> ...)`. The campaign filter applies after the HNSW scan, so filtered recall is a real-world concern. Full plans are in `out/t3-explain.txt`.
9. **pgTAP `policy_roles_are` does not recognise PUBLIC** (`polroles = {0}`), so `test/pgtap/rls.sql` compares `polroles` with `ARRAY[0]::oid[]` directly. The container has no `pg_prove`, so the file is piped through `psql`.
10. **squawk** needs `--assume-in-transaction`, because the migrator wraps everything in one transaction. Without it, squawk reported 88 issues. With it:
    - `require-lock-timeout` 6
    - `require-statement-timeout` 6
    - `prefer-bigint-over-int` 5
    - `ban-drop-column` 1
    - `adding-not-nullable-field` 1

    The full output is in `out/t8-squawk.txt`.
11. **Environment traps.** None of these come from the tool, but each cost time:
    - **Port and user.** The pwsh profile sets `PGPORT=5432`, `PGUSER=postgres` and `PGDATABASE=postgres`, which point at a different local server. pg reads these, so the first `pnpm test` failed with `password authentication failed for user "postgres"`. The code now uses `SPIKE_DB_HOST` and `SPIKE_DB_PORT` (default `localhost:55432`).
    - **The `tsc` shim.** pnpm runs scripts with pwsh on the UNC path (`\\10.42.1.10\...`). The `tsc` .ps1 shim fails with `AuthorizationManager check failed`, so scripts call `node node_modules/typescript/bin/tsc` directly.
    - **The compiler on the UNC path.** Invoked directly, it still fails from the UNC cwd with `error TS18003: No inputs were found in config file '//10.42.1.10/.../tsconfig.json'`. It passes from `Z:\`, which is why the one-command check was run from a local copy.
    - **drizzle-kit speed.** drizzle-kit takes 30–42 s per call from the share.

## 5. `withTenant`

```ts
// src/db.ts
export type Tx = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

export function withTenant<T>(db: NodePgDatabase, tenantId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    if (tenantId !== null) await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

// usage
const rows = await withTenant(db, tenantId, (tx) => tx.select().from(entity).where(eq(entity.campaignId, c)));
```

Drizzle wraps Postgres errors, so the SQLSTATE is on `err.cause.code`, not `err.code`. `test/helpers.ts` has `pgError()` for this.

## 6. Effort

**Quick:**

- The schema DSL, including composite keys, policies, halfvec and the HNSW index.
- The query builder, `withTenant`, and the upsert.
- `generate --custom` for the hand-written migrations.
- `migrate()` per database for the fleet (T7).
- Squawk, because the migrations are plain SQL files.

**Fought back:**

- Partitioning: a hand edit of generated SQL, plus a config filter to stop push dropping partitions.
- Learning that push sees the pgTAP schema.
- Staging migrations, since there is no target version.
- The M2 module needing a `$defaultFn` for the dropped-later column.
- The HNSW plan needing planner nudges.
- pgTAP's PUBLIC quirk.
- The environment issues above (the PG* variables, and pwsh/UNC for pnpm, tsc and vitest). These took the most wall-clock time.

**Roughly:** the tool work took a few hours. Environment debugging took about as much again.

## Files

- `drizzle.config.ts`: the config, including the filters.
- `src/schema/{define,m1,m2,m3}.ts`
- `src/db.ts`
- `src/importer.ts`
- `src/migrations.ts`
- `scripts/bootstrap.ts`: drops and recreates only the `drizzle_*` databases.
- `scripts/fleet.ts`
- `drizzle/*/migration.sql`
- `test/t1`–`t8.test.ts`
- `test/pgtap/rls.sql`
- `out/`: saved tool output quoted above.
