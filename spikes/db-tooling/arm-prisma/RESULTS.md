# Arm C: Prisma 8 (release candidate)

## 1. Versions

Everything Prisma in this arm is a release candidate. There is no stable Prisma 8 yet.

| Package | Version | Licence | Note |
| --- | --- | --- | --- |
| `prisma` (CLI) | 8.0.0-rc.19 | Apache-2.0 | npm `latest` is 8.0.0-rc.19, `prev` is 7.10.0, `next` is 8.0.0-rc.10, `dev` is 8.0.0-rc.19-dev.136 |
| `@prisma/orm-postgres` | 8.0.0-rc.14 | Apache-2.0 | npm `latest` for this package is rc.14 |
| `@prisma/orm-extension-pgvector` | 8.0.0-rc.14 | Apache-2.0 | |
| `@prisma/orm-toolchain`, `@prisma/orm-framework` | 8.0.0-rc.14 | Apache-2.0 | pinned by a pnpm override, see surprise 11 |
| `@prisma/dev` (pulled in by the CLI) | | ISC | |
| pg | 8.23.0 | MIT | |
| vitest | 4.1.11 | | |
| typescript | 5.9.3 | | |
| squawk-cli | 2.66.0 | | |
| temporal-polyfill | 1.0.5 | | runtime dependency, see surprise 4 |

The toolchain was Node v25.3.0 and pnpm 12.8.1. The database was the shared `db-tooling-db-1` container (Postgres 18 with pgvector and pgTAP).

**What comes only from the RC.** All of it. The stable line is 7.10.0. Prisma 7 has none of the following:

- the contract (`contract.prisma` emitted to `contract.json` plus `contract.d.ts`);
- `@@rls` and the `policy_*` blocks;
- `@@check` and `@@control(external | tolerated)`;
- the pgvector extension pack;
- the migration graph with `ops.json` and pre/post checks;
- TypeScript migration files;
- `migration plan`;
- refs and `--advance-ref`;
- `db verify`;
- the `prisma_contract.marker` and `ledger` tables;
- the `@prisma/orm-*` runtime this arm queries through.

None of this arm would work on Prisma 7.

**Prisma 7 and 8 side by side.** I did not test this; the following is from the packages.

- The v8 runtime lives in new packages (`@prisma/orm-*`), separate from v7's `@prisma/client`, so the two runtimes can be installed together.
- Both lines publish the CLI as `prisma`, so one project needs a pnpm alias to have both CLIs.
- `@prisma/orm-postgres/config` exports `prisma7Schema(schemaPath)`, documented as reading a Prisma 7 `schema.prisma` "so Prisma 8 can adopt a database Prisma 7 still migrates". That is a deliberate migration path. I did not exercise it.

## 2. Results

| Task | Score | Raw SQL | Typed | Note |
| --- | --- | --- | --- | --- |
| T1 tenant isolation | pass | some | yes | The ORM API cannot see, update or delete tenant B's rows. A B `tenant_id` fails the `WITH CHECK`, a B campaign fails the composite FK, and direct partition reads give 42501. Raw SQL is only `set_config` in `withTenant`. |
| T2 pool of one | pass | some | yes | Interleaved A, B and no-tenant transactions on `max: 1` see only their own rows. The pool-of-one marker deadlock needs a warm-up (surprise 3). |
| T3 halfvec search | pass | most | partial | Inserts and the search are raw-lane plans, because Prisma has no `halfvec` type. Rows are typed from the codecs I declare in `returnsRow`, not from the schema. With seqscan, bitmapscan and sort off, EXPLAIN shows `Index Scan using claim_embedding_hnsw`. |
| T4 plan after M1–M3 | partial | some | yes | `migration plan` reports `noOp: true` and no operations. However, it compares contracts and never looks at the database. The live diff, `db verify`, flags all 9 `tenant_isolation` policies (which the contract declares) as extra: an RC bug. It ignores the raw triggers, functions and partitions. `--strict` also flags the HNSW index and the partitions. The trigger still updates `claim_current`, and reads are typed. |
| T5 expand/contract | pass | some | yes | Clients built from the M1, M2 and M3 contract snapshots run against one database at the same time. The trigger keeps `name` and `display_name` in sync. After M3, the M1 and M2 clients fail with 42703 rather than on a contract check (surprise 1). |
| T6 safe to repeat | pass | some | yes | (a) The re-run applies 0. (b) The broken M2 exits 2 and the database is exactly as before (one transaction), and the fixed M2 applies. (c) The second import adds nothing, and a changed record gives +1 claim version. |
| T7 fleet | pass | some | yes | `scripts/fleet.ts` calls the CLI's `db migrate` once per database (each call is a separate process; there is no fleet API), then reads `prisma_contract.marker` and `ledger` with plain `pg` queries. State is a content hash of the contract for each space, so the same contract has the same hash everywhere and hundreds of databases can be compared by grouping on it. Run against M1 and M2 databases, both reached M3; a second pass applied 0. |
| T8 CI fit | pass, but (c) is unverified as `pnpm test` | some | n/a | (a) squawk: 15 warnings, 0 errors, but the SQL exists only inside `ops.json` and I had to extract it. (b) pgTAP: 5/5 ok. (c) From a clean state, `tsc --noEmit` followed by `vitest run` passes 33/33 in 23 minutes. Global setup recreates `prisma_main` and migrates it, and each task recreates its own databases. I have not seen `pnpm test` itself succeed: on this UNC share, cmd.exe fails before tsc starts (section 7). I did not try a local-disk copy. |

## 3. Raw-SQL fallbacks

All of these are `raw.*` operations inside the migration's `migration.ts`, made with `scripts/raw-op.ts`, so they run in the migration's transaction and are recorded in the ledger. The "Drift?" column says whether Prisma reports the object.

| Where | What | Why | Drift? |
| --- | --- | --- | --- |
| M1 `raw.claim_version.table` | `claim_version` with `PARTITION BY HASH (tenant_id)` and p0–p3 | PSL has no partitioning. The model is `@@control(external)`, so Prisma emits nothing for the table. | non-strict: no. `--strict`: the partitions are reported as unclaimed. |
| M1 `raw.claim_version.rls` | RLS and the policy on `claim_version` | `@@control(external)` also suppresses `@@rls` and the policy for that model. | no |
| M1 `raw.claim_version.append_only` | the append-only trigger and its function | PSL has no triggers or functions. | no (not even with `--strict`) |
| M1 `raw.claim_current.sync` | the trigger that maintains `claim_current` | Same as above. | no |
| M1 `raw.claim_embedding.embedding` | `embedding halfvec(768)` and the HNSW `halfvec_cosine_ops` index | The pgvector pack has only `vector`. `Unsupported("halfvec(768)")` is rejected by `contract emit` (surprise 6). The model is `@@control(tolerated)`, so Prisma creates the table without that column. | `--strict` reports `claim_embedding_hnsw` as extra; the column is not reported. |
| M1 `raw.grants.skal_app` | `GRANT … TO skal_app`, then `REVOKE ALL ON claim_version_p0..p3 FROM skal_app` | PSL has no grants; per-partition privileges and RLS are not native. | no |
| M1 | `UNIQUE NULLS NOT DISTINCT` on `field_definition` | `nullsNotDistinct` is rejected: `PSL_INVALID_ATTRIBUTE_SYNTAX`. | no |
| M2 | the `entity_name_sync` function and trigger | no triggers in PSL | no |
| M3 | dropping that trigger and function | same | no |
| `src/db.ts` | `SELECT set_config('app.tenant_id', $1, true)` | The ORM has no session-variable API. The transaction context has no raw lane, so the plan is built on `db.raw` and run with `tx.query`. | n/a |
| T3 | halfvec inserts, the similarity query, and EXPLAIN | no halfvec type, no `.explain()` | n/a |

**Hand edits to generated migrations (not raw SQL, but recorded):**

- The generated `createTable` in M1 listed columns alphabetically, so I reordered them to match `schema.sql`.
- The planner placed the M3 `dataTransform` after `dropColumn`, so it would have read a column that no longer exists. I moved it before.

## 4. Surprises

1. **A client built for the wrong contract is never rejected, and the warning is thrown away.**
   - What happens: `verifyMarker` (`orm-family-sql/dist/runtime.mjs:1611`) only calls `log.warn({code: "CONTRACT.MARKER_MISMATCH"})`, or `CONTRACT.MARKER_MISSING` when there is no marker.
   - Why nobody sees it: the default log is `noopLog` (`runtime.mjs:1157`, applied at 1187, `log: log ?? noopLog`). The `postgres()` factory options expose `verifyMarker` but not `log`.
   - Effect in T5: an M1-era client against an M3 database runs until Postgres says `42703 column entity.name does not exist`.
   - Upside: this is exactly what lets expand/contract work.
   - Downside: there is no safety net and no visible signal.
2. **jsonb is decoded twice.** A jsonb string scalar fails:

   ```
   Failed to decode column claim_current.object with codec 'pg/jsonb@1': Unexpected token 'm', "mayor" is not valid JSON
   ```

   - The error is RUNTIME.DECODE_FAILED, raised at `orm-target-postgres/dist/data-types-Cl18KnNY-5I34Vd6Z.mjs:345`.
   - Cause: pg already parsed the value, and the codec calls `JSON.parse` again.
   - Workaround: a global `pg.types.setTypeParser` for JSON and JSONB returning the raw text (`src/db.ts`). It affects every pg user in the process.
3. **Deadlock on a pool of one.**
   - The default `verifyMarker: "onFirstUse"` checks the marker on a second connection.
   - If the client's first use is `db.transaction` on `max: 1`, the transaction holds the only connection and the check waits forever (the probe timed out after 5000 ms; the session sits `idle in transaction`).
   - Fix: `verifyMarker: false` or a warm-up query outside the transaction. I chose the warm-up (`src/db.ts`).
4. **No global Temporal on Node 25.** `timestamptz` decodes to `Temporal.Instant`:

   ```
   Codec 'pg/timestamptz-temporal@1' cannot decode a value because this runtime has no global Temporal implementation
   ```

   The CLI loads a polyfill for itself; application code must `import "temporal-polyfill/global"`.
5. **`db verify` reports the declared policies as extra once an extension space exists (RC bug).**
   - Non-strict: 9 failures, all `postgres-policy` `tenant_isolation`, code `CONTRACT.MARKER_REQUIRED`.
   - `--strict`: 53 failures, including the HNSW index and the p0–p3 partitions.
   - A probe database (removed) confirmed the cause: the same schema verifies clean without the pgvector space and fails on the one policy with it.
   - Triggers, functions, `NULLS NOT DISTINCT` and the external table are never reported.
6. **`contract infer` writes PSL that `contract emit` rejects.** Inferring `reference/schema.sql` produced `Unsupported("halfvec(768)")`, and emitting it fails:

   ```
   PSL_UNSUPPORTED_FIELD_TYPE … "Unsupported" is not supported in SQL PSL provider v1
   ```
7. **No halfvec in the pgvector pack.** The pack has only `vector`, so the column and the index stay raw.
8. **`dataTransform` needs storage names and the extension runtime.**
   - The builder must use `f.display_name`. Using the field name gives `Cannot construct a ParamRef for a undefined value without an explicit codec`.
   - Without the pgvector runtime it gives `RUNTIME.MISSING_EXTENSION_PACK`, even for a text column.
9. **One `db migrate` is one transaction.** It covers every migration and space, and it is what made T6b clean. The broken run reported:

   ```
   MIGRATION.RUNNER_FAILED "Operation raw.entity.display_name_sync failed during execution … function public.no_such_function() does not exist" (42883)
   nextActions: "previously applied migrations are preserved"
   ```

   The state before and after was identical: `0|NO|0|0|b4c11737…|1`. Good, but a long backfill means one long transaction.
10. **The executed SQL exists only in `ops.json`** (`execute[].sql`, plus `precheck` and `postcheck` queries). There are no `.sql` files, so `scripts/extract-sql.ts` writes them to `reports/sql/` for squawk.
    - On the positive side, each operation carries idempotence prechecks (for example "ensure column display_name is missing") and postchecks.
11. **Mixed RC builds break.**
    - CLI rc.19 pulled toolchain and framework rc.13 next to `orm-postgres` rc.14, and emitting failed: `Malformed authoring pslBlock contribution at "enum"`.
    - Fix: a pnpm override pinning both to rc.14.
12. **Paths in `prisma.config.ts` resolve relative to the config file, not the working directory.**
    - Getting this wrong gives `CLI.FILE_NOT_FOUND`.
    - A migration's `migration.ts` must be run with `--config`, otherwise `CONFIG.FILE_NOT_FOUND`.
13. **`migration plan` never inspects the database.** It plans contract to contract from a ref (`db`, `m1`, `m2`, `m3` in `migrations/app/refs/`). Plain `db migrate` never advances a ref; only `--advance-ref <name>`, `db init`, `db update` and `db sign` do.
14. **The raw lane is not on the transaction.**
    - There is no `tx.raw`: you build `db.raw.sql\`…\`.returnsRow({...}).build()` and run it with `tx.query`.
    - `EXPLAIN ${plan}` composes, but there is no `.explain()`.
    - `tx.query()` and ORM calls return `AsyncIterableResult`, which is `PromiseLike` but not a `Promise`, so helpers must accept `PromiseLike<T>`.
15. **pgTAP's `policy_roles_are` cannot match the `PUBLIC` pseudo-role**, so `test/pgtap/rls.sql` reads `pg_policies.roles` directly.
16. **HNSW with a campaign filter.** The filter runs after the index scan, so for a selective campaign a top-k can return fewer than k rows unless pgvector's iterative scan is enabled.
17. **Slowness came from the environment, not from Prisma.**
    - On the SMB share each Prisma CLI call took about 70 s.
    - `pnpm install` took up to 19 minutes, and `pnpm add temporal-polyfill` took 19m10s.
    - A single test file took 100–370 s, mostly the global-setup migrate.

## 5. withTenant

```ts
const warmedUp = new WeakMap<Db, Promise<unknown>>();
function warmUp(db: Db): Promise<unknown> {
  let p = warmedUp.get(db);
  if (!p) { p = db.orm.public.Tenant.first(); warmedUp.set(db, p); }
  return p;
}

export async function withTenant<T>(db: Db, tenantId: string, fn: (tx: Tx) => PromiseLike<T>): Promise<T> {
  await warmUp(db); // avoids the pool-of-one marker deadlock (surprise 3)
  return db.transaction(async (tx) => {
    await tx.query(
      db.raw.sql`SELECT set_config('app.tenant_id', ${tenantId}, true) AS tenant`
        .returnsRow({ tenant: "pg/text@1" })
        .build(),
    );
    return fn(tx);
  });
}
```

Usage: `withTenant(db, tenantId, (tx) => tx.orm.public.Entity.where({ campaignId }).all())`.

`src/db.ts` also needs `import "temporal-polyfill/global"` and the jsonb type-parser workaround.

## 6. Effort

**Quick:**

- RLS and policies in PSL (`@@rls`, `policy_all`);
- the typed ORM;
- T7 (the marker hash is a ready-made fleet state);
- T6a and T6b (single-transaction apply);
- typing per era in T5 (each snapshot ships its own `contract.d.ts`).

**Fought back:**

- the partitioned, trigger-maintained and halfvec parts of the schema, which ended up raw or hand-edited;
- the four runtime surprises (jsonb, Temporal, the pool deadlock, the silent marker check), each found only by a failing test;
- `db verify`'s false policy report;
- RC version skew;
- the CLI's 70 s per call on the share, which dominated wall-clock time.

**Total:** about seven hours wall-clock, roughly half of it waiting on installs and CLI calls.

## 7. Full suite run

This run was made on 2026-10-01 from `arm-prisma` on the Z: share. It ran `node node_modules/typescript/bin/tsc --noEmit` (exit 0), then `node node_modules/vitest/vitest.mjs run --silent=false --reporter=verbose`:

```
 Test Files  8 passed (8)
      Tests  33 passed (33)
   Start at  02:52:07
   Duration  1388.98s (transform 881ms, setup 0ms, import 179.38s, tests 1099.91s, environment 1ms)
vitest exit 0
```

Per file:

| Task | Tests passed |
| --- | --- |
| T1 | 5/5 |
| T2 | 3/3 |
| T3 | 3/3 |
| T4 | 4/4 |
| T5 | 8/8 |
| T6 | 5/5 |
| T7 | 3/3 |
| T8 | 2/2 |

Two of the T4 tests assert the `db verify` bug as it is, not as it should be:

- non-strict: `T4 db verify: exit 4; Database schema does not satisfy contract (9 failures)`, all `postgres-policy`;
- strict: `(53 failures)`.

`pnpm test` on the same share fails before tsc runs:

```
$ tsc --noEmit && vitest run
'\\10.42.1.10\Personal-Drive\projects\skaldryne-spike\spikes\db-tooling\arm-prisma'
CMD.EXE was started with the above path as the current directory.
UNC paths are not supported.  Defaulting to Windows directory.
Error: EISDIR: illegal operation on a directory, lstat 'UNC'
```
