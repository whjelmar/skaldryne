# DB tooling spike: independent verification

Date: 2026-10-01. I copied each arm (without node_modules) to `scratchpad\verify\<arm>`, ran `pnpm install --store-dir scratchpad\pnpm-store`, then `pnpm test`. Nothing under `Z:\projects\skaldryne-spike` was edited. The only files I added are probes inside the scratchpad copies.

## Local `pnpm test` (fresh install, local disk)

| Arm | Install | Files | Tests | Vitest duration | Wall time (incl. tsc and bootstrap) | Exit |
|---|---|---|---|---|---|---|
| A kysely | 1.1s | 8/8 | 15/15 | 41.97s | 74s | 0 |
| B drizzle | 6.4s | 8/8 | 27/27 | 13.48s | 50s | 0 |
| C prisma | 39.7s | 8/8 | 33/33 | 54.38s | 57s (23 min on the share) | 0 |

None of the arms has a `.skip`, `.todo` or `.only`. The only try/catch blocks are the `pgError` helpers in B and C, and both throw when the operation succeeds.

## Catalog spot-check (kysely_main, drizzle_app, prisma_main)

All three databases pass every check:
- RLS is enabled with `tenant_isolation` (cmd ALL, USING equal to WITH CHECK) on all 9 tables. FORCE RLS is off, as in the reference.
- skal_app has no SELECT, INSERT, UPDATE or DELETE on p0–p3; the ACL is skal_migrator only.
- `claim_embedding_hnsw` uses `halfvec_cosine_ops` with m=16 and ef_construction=64.
- Both triggers exist on claim_version.
- There are 4 hash partitions, modulus 4, remainders 0–3.

## Schema compared with the reference

I ran `pg_dump --schema-only --no-owner -n public`, normalised it (comments, SET lines and `\` lines removed; statements and column lines sorted), and compared each arm with `verify_ref`. `verify_ref` is the reference schema.sql plus the M3 rename. The public schema of every arm is identical to the reference (86 lines, including 9 GRANT and 9 POLICY statements). Column order was ignored.

The only differences are the tools' bookkeeping schemas:
- all arms: `tap` (pgTAP);
- A: `graphile_migrate`;
- B: `drizzle.__drizzle_migrations`;
- C: `prisma_contract` (contract, ledger, marker).

## Arm A: graphile-migrate + Kysely

| Task | Claimed | Verified | Evidence |
|---|---|---|---|
| T1 | pass | pass | Reads, updates and deletes of B give 0 rows. Inserts are rejected by the RLS policy and by the named FK. All 4 partitions return 42501. |
| T2 | pass | pass | 120 interleaved requests on pool size 1, plus a control test showing that a session-level setting leaks. |
| T3 | pass (typed partial) | pass (typed partial) | Checks ordering and the campaign filter; EXPLAIN matches `Index Scan using claim_embedding_hnsw`. |
| T4 | partial | partial | There is no diff to run. The substitutes are status, empty-commit refusal, dump equality and codegen --verify. The commit-refusal regex is loose. |
| T5 | pass (typed partial) | pass (typed partial) | M1- and M2-typed clients write concurrently and syncing works both ways. After M3, M1 code fails on the dropped `name`. |
| T6 | pass | pass | (a) The dump and the rows are unchanged. (b) A broken M2 fails late, on a CHECK, and the DB rolls back to M1, verified by full dump and columns. (c) 50 items give 50 skipped and 0 created, plus a control change. |
| T7 | pass | pass | M1 and M2 reach M3. The FINDING test tampers with a stored hash and migrate stays silent. |
| T8 | pass (caveat) | pass | The squawk snapshot is pinned. pgTAP gives 1..32 with no `not ok`. `pnpm test` passes from local disk. |

## Arm B: drizzle 1.0 RC

| Task | Claimed | Verified | Evidence |
|---|---|---|---|
| T1 | pass | pass | All 9 tables are covered, with `$count>0`. Updates and deletes `.returning()` 0 rows. Inserts give 42501 or 23503 with the constraint name. The partitions give 42501. |
| T2 | pass | pass | 30 requests on one backend PID, plus a check after a failed transaction. There is no session-leak control test. |
| T3 | pass (typed partial) | pass (typed partial) | EXPLAIN runs through the raw pg client with the planner's alternatives turned off. |
| T4 | pass | pass, conditional | generate, check and `push --explain` report `no_changes` only with `tablesFilter`. The append-only check is a bare `.rejects.toThrow()`. |
| T5 | pass | pass | The v1, m2 and v2 modules write concurrently, and cross-updates sync in both columns. After M3, m1 and m2 reads give 42703. |
| T6 | pass | pass | (b) `SELECT 1/0` is injected before CREATE TRIGGER; it fails with 22012, the fingerprint equals M1 and the rows are M1 only. (c) 50 imported, then 50 unchanged. |
| T7 | pass | pass | Both reach the same head, fingerprint and (name, hash) list. The CLI re-run gives `7 -> 7` on 3 DBs. |
| T8 | pass | pass | pgTAP 55/55. The squawk test asserts only that squawk ran (`byRule.size>0`); its findings are not pinned. |

## Arm C: Prisma 8 RC

| Task | Claimed | Verified | Evidence |
|---|---|---|---|
| T1 | pass | pass | ORM reads, updates and deletes of B are empty, and B is unchanged afterwards. WITH CHECK gives 42501 and the FK gives 23503. Only `claim_version_p0` is tried directly (gap: p1–p3 are covered only by my catalog check). |
| T2 | pass | pass | Pool max=1 is asserted. 12 interleaved A, B and no-tenant transactions each see only their own rows and their own setting. There is no leak-control test. |
| T3 | pass (typed partial) | pass (typed partial) | Top-5 with the campaign filter. The row type comes from the declared codecs. EXPLAIN matches `Index Scan using claim_embedding_hnsw`. |
| T4 | partial | partial | Fair. `migration plan` says `noOp`, but it never reads the DB, and `db verify` fails on 9 policies (both reproduced). |
| T5 | pass | pass | The M1, M2 and M3 snapshot clients write and update, and both columns sync (checked via psql). After M3, the M1 and M2 clients give 42703. Writes are sequential, not concurrent. |
| T6 | pass | pass | (b) The trigger is broken after addColumn and dropNotNull, and the DB stays at M1 (columns, trigger, function, marker, ledger). This is a targeted fingerprint, not a full dump. |
| T7 | pass | pass | M1 and M2 reach M3 with an equal app hash, and a second pass applies 0 everywhere. |
| T8 | pass, (c) unverified | **pass** | `pnpm test` passes 33/33 from local disk, so (c) is now verified. The squawk test accepts exit 0 or 1 and does not pin the 15 warnings. pgTAP has 5 files with 62 assertions. |

## Claims

### Arm A

- **Applied hashes are never re-verified: CONFIRMED.**
  - In `migration.js`, `getMigrationsAfter` filters by filename only.
  - `calculateHash` is checked only when a migration is pending.
  - The T7 FINDING test tampers with a stored hash, and nothing reacts.
  - One exception: the `previous_hash` foreign key makes a new migration fail to append if its Previous header names a hash the database doesn't have.
- **M1 was re-committed by hand-editing the hash chain: end state CONFIRMED, process unverifiable.**
  - My `hashcheck.mjs` recomputes all three headers, and M1, M2 and M3 match.
  - M1 contains the partition REVOKE.
  - There is no history to show how the chain was edited, and git was off-limits.
- **T4 is partial because the tool has no diff: CONFIRMED.**

### Arm B

- **Without `tablesFilter`, push plans DROP TABLE on the partitions: CONFIRMED.**
  - I reproduced it on drizzle_fleet_a, which planned 4 `DROP TABLE` (text and JSON).
  - With the filter it reports `no_changes`.
  - The partitions are intact afterwards.
- **The migrator stores a hash but never checks it: CONFIRMED.**
  - `getMigrationsToRun` filters by name only.
  - T6 "finding" passes after an applied file was edited.
- **Pending migrations run in one transaction: CONFIRMED.**
  - `migrate()` wraps all pending migrations in one `db.transaction`.
  - T6b rolls back the ADD COLUMN that came from the earlier M2 folder.

### Arm C

- **T2/T5 labels: RESULTS.md is right, and the handback table was wrong.**
  - In the README, T2 is pooling with `withTenant` and T5 is expand/contract.
  - The test files are named `t2-pool-tenant-context` and `t5-expand-contract`.
  - RESULTS.md matches both.
  - The handback table swapped the two notes.
- **`db verify` falsely flags the declared policies: CONFIRMED.**
  - I re-ran it: exit 4, 9 failures, every one a `postgres-policy tenant_isolation` reported with only an `actual` side (that is, as extra).
  - The contract declares all 9 with `@@map("tenant_isolation")` and expressions identical to the DB's.
  - The claim that the pgvector space is the cause is unverifiable: its probe DB was removed, and I did not rebuild it.
- **`migration plan` never inspects the DB: CONFIRMED.**
  - With `DATABASE_URL` set to an unreachable host (port 1), it still returns `ok, noOp:true` and "No changes detected between contracts".
- **A pool of size 1 deadlocks: CONFIRMED.**
  - `pool1-probe` times out after 5s with `verifyMarker=onFirstUse`.
  - It works with `false`, and the warm-up probe also works.
  - This is a client-side wait, not a Postgres deadlock.
- **There is no `tx.raw`: CONFIRMED.**
  - My probe shows the transaction object's keys are `enums, nativeEnums, orm, sql` and its prototype has `execute, invalidated, query`.
  - `typeof tx.raw` is `undefined`.
- **jsonb is double-decoded: CONFIRMED.**
  - `jsonb-probe` fails with `Failed to decode ... "title 0" is not valid JSON` both with a URL and with a supplied pg pool.
  - It passes with the global type-parser workaround.
- **The contract mismatch is silent: CONFIRMED.**
  - prisma_t5's app marker is the M3 hash (`0a97774d…`).
  - An M1-contract client still succeeds with `verifyMarker` set to onFirstUse, onStartup, always or false.
  - In `orm-family-sql/dist/runtime.mjs`, a mismatch only calls `log.warn` (line 1632), and the log defaults to `noopLog` (1187).

## Gaps (low risk, test-quality only)

- B T8a and C T8a do not pin the squawk findings; A pins a snapshot.
- B and C T2 lack a control test showing that a leak would be detected; A has one.
- C T1 checks only partition p0 through the app; C T5 writes are sequential; C T6b uses a targeted fingerprint.
- B T4's append-only assertion accepts any error.
