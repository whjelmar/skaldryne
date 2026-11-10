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

## Round 2 verification (2026-11-09)

Independent pass over `arm-kysely-stable` (Experiments 1, 2) and `arm-drizzle-stable` (Experiments 1, 3). I wrote none of the code. Suites were run one after the other against `db-tooling-db-1`; `exp1_main` was not touched. Nothing was committed.

### Verdict

Kysely: PASS on counts, with T10b a real, correctly reported failure. Drizzle: counts PASS, but the raw-share figures in its `EXP1.md` are not reproducible and are heavily overstated.

### Test counts (fresh runs)

| Arm | Claimed | Observed | Note |
| --- | --- | --- | --- |
| Kysely | 30 of 31 | 1 failed, 30 passed (31); 10 of 11 files pass | Only failure: `T10b killed no-transaction file` |
| Drizzle | 36 of 36 | 36 passed (9 files), exit 0 | tsc clean, 9.4 s |

### T10b and Experiment 2 (Kysely)

- T10b is a genuine failure. The assertion `end?.valid` is `true` fails because the rerun of the unchanged file exits 1 with `42P07 relation "entity_kind_conc_idx" already exists`; the index stays `{valid:false, ready:false}` and 000004 stays unrecorded. The "never success while INVALID" guard (line 142) correctly did not trip. The test was not weakened.
- Variant D (DROP then CREATE in one `--! no-transaction` file): confirmed it cannot apply (25001, no index created). Matches the claim.
- Manual recovery: confirmed (drop index, rerun exits 0, valid index).
- Variant N (`IF NOT EXISTS`): confirmed the dangerous case. The rerun exits 0, prints "1 committed migrations executed", and the index is still INVALID. The test records this without asserting it, as stated.
- T9 control and real path, T10a: assertions are exact and match the log.
- Tamper checks: (a) and (b) not detected (exit 0), (c) detected (exit 1, hash mismatch). Matches the claim. Not tested against rc.5 here.

### Raw SQL share (spec method, comments excluded, `${}` inside a template counted as raw)

| Query | Kysely claimed | Kysely recomputed | Drizzle claimed | Drizzle recomputed |
| --- | --- | --- | --- | --- |
| Q1 | 22.7% | 22.7% | 73.4% | 56.7% (59.0% strict) |
| Q2 | 12.7% | 12.7% | 80.6% | 35.6% (43.8%) |
| Q3 | 15.1% | 15.1% | 88.9% | 36.9% (41.8%) |
| Q4 claim | 8.8% | 8.7% | 67.2% | 17.0% (19.1%) |
| Q4 complete | 0% | 0% | 0% | 0% |
| Q4 retry | 16.4% | 16.1% | 78.5% | 29.8% (34.5%) |
| Q4 combined | 9.8% | 9.6% | not reported | 17.7% (20.6%) |

Kysely agrees within 0.3 points. Drizzle does not: only Q1 stays above 50%, so Q2, Q3 and Q4 are not "mostly raw" and the claimed 80 to 89% cannot be reproduced under any counting variant I tried. No counting script is saved in the Drizzle arm. Comparable Q4 figure: Kysely 9.6%, Drizzle about 18 to 21%. Result-typing labels (Kysely Q1 to Q3 partial, Q4 yes; Drizzle Q3 partial) are consistent with the code.

### Deviations

- Drizzle `exp1(tx, tenantId)` factory: accepted. `tx` must be bound for RLS; parameters and results match the spec.
- Drizzle Q3 `expectTypeOf` changed to `number` while nulls occur: the type is wrong for the data, which supports the "partial" typing label. Runtime assertions are unchanged, so the result is valid. Disclosed in its `EXP1.md`.
- Drizzle raw-share fairness: partly overstated. `cosineDistance(e.embedding, QV)` exists and, run against `exp1_drizzle`, reproduced the spec vector order (4,5,3,6,2,7,1,8,9) and emitted `"embedding" <=> $1` (no explicit `halfvec(768)` cast). Q1 could be unrolled to a fixed depth of 3 with `unionAll` and self-joins. Recursive CTEs, windows, `case` and `coalesce` have no helper in 0.45, so those stay raw.
- Kysely fairness: `eb.lit(1)`, `eb(col, "<=>", ...)`, `eb.ref(...,"->>").key(...)` and `||` compile, so some small fragments could be builders. The tuple IN does not type-check as a builder (TS2345), which confirms the author's claim. A naive builder score compiles to `1 / 60 + r` (precedence trap), supporting the raw score. Caveat: `eb.fn("ts_rank_cd")`, `eb.fn("ts_headline")` and `eb.cast` are unchecked string escapes the spec's share definition does not count, which flatters Kysely against Drizzle.
- Kysely LF conversion and `.gitattributes` (`* text=auto eol=lf`): accepted as disclosed. Both arm directories are untracked, so I could not diff the conversion against a baseline. Lockfile regeneration with pinned devDependencies: accepted, not independently diffed.

### Test audit

- Experiment 1 Q1 to Q3 (both arms) assert full rows with `toEqual`: order, rank to 4 dp, headline, score to 6 dp. The RLS check covers an empty tenant for Q1 to Q3 and a `claim_current` count of 0 (Drizzle also tests a null tenant).
- Q4 non-blocking proof: W1 holds its transaction open, W2 is raced against a 5 s timeout on a separate pooled connection, W3 gets `[]` (Drizzle claims W3 while W1 and W2 are open). Pool size is implicit: a pool of 1 would trip the timeout.
- Weak spots in Kysely Q4: claimed ids are compared after `.sort()` so claim order is not asserted, and `kind` and `payload` are not asserted.
- Drizzle T4: `generate` and `check` find no changes, and generate also passes with no database reachable. This only proves that generate is an offline snapshot diff; it never sees partitions, triggers or policies. Presence of triggers, partitions, HNSW and 9 policies is asserted separately, plus a catalog diff against `reference/schema.sql`.
- Drizzle T6: a failure in the second pending file rolls back the first file's ADD COLUMN, so all pending files share one transaction. `drizzle-kit migrate` exits non-zero but prints no Postgres error text.

### SQL shape against `reference/exp1-queries.sql`

| Shape | Kysely log | Drizzle log |
| --- | --- | --- |
| `tsv @@ q` | `"tsv" @@ "q"."q"` | `"tsv" @@ websearch_to_tsquery(...)` inline |
| `<=>` against `halfvec(768)` | `<=> $6::halfvec(768)` | `<=> $8::halfvec(768)` |
| `object ->> 'entity'` with `object ? 'entity'` | both literal | both literal |
| `state = 'queued'` | bound `$4` (reference has a literal) | bound `$3` (reference has a literal) |

Only the last row differs from the reference. Kysely's EXPLAIN shows `job_ready_idx` still used with `state` bound. I did not replay Drizzle's EXPLAIN, and Drizzle's arm has no EXPLAIN report to compare.

### Gaps and unconfirmed

- Drizzle raw-share claims: cannot confirm (unreproducible). Request that `EXP1.md` be corrected or the counting script be supplied.
- Kysely `.key()` typed `never` on codegen `Json`: not checked at the type level.
- Drizzle `job_ready_idx` use under a bound `state`: not verified.
- Lockfile and LF conversion not diffed (no baseline in git).
- Several Drizzle T1 to T8 tests (T1, T2, T3, T5, T7, T8) were run and passed but their assertions were not individually audited.

## Round 2 bias audit (2026-11-09)

This is the Critic pass. It was read-only: I ran no suite and committed nothing.

I read:
- `EXPERIMENTS.md` and its history (9515ee8, 406700a);
- both stable arms' `EXP1.md`, `RESULTS.md`, `src/exp1.ts` and `test/exp1.test.ts`;
- the Kysely metrics script;
- the partial attempt in `dev/scratch/0017-partial-2026-10-01`.

I also recomputed both arms' raw shares with one script. The Round 2 verification above did the same independently, and its numbers agree with mine to within about 2 points.

### Verdict

The headline numbers are tilted toward Kysely. The raw-share gap is overstated, and the migration tests asked Kysely harder questions than Drizzle. The typing self-scores lean the other way, toward Drizzle.

Kysely still wins on query ergonomics after correction. The migration comparison is less settled than the two reports make it look.

Confidence: medium-high.

### 1. Pre-registration

- Fixtures, expected rows and scoring definitions are unchanged since 9515ee8. Dropping the Prisma arms does not favour either remaining arm.
- The 406700a amendment says nothing else changes. In fact it adds a new ordering rule: migration experiment first, then Experiment 1. The rule is harmless, but it is a change and should be declared as one.
- The amendment describes the 2026-10-01 partial attempt as "interrupted after a few minutes, before any Experiment 1 query code or results existed", with its files "moved out of the tree unread". That is false:
  - The files span 10:38 to 12:05, about 90 minutes.
  - They include Prisma 7 Experiment 1 code: `arm-prisma7/src/exp1.ts`, `prisma/sql/*.sql` and `exp1-sql.log`.
  - They include Experiment 3 outputs: `arm-drizzle-stable/out/t4-*`, `t6-batch-failure.txt`, `t6-out-of-order.txt`, `t7` and `t8`.
  - They include Kysely T9/T10 preparation: `000004-m4-index-concurrently.sql`, `db/drop-invalid-indexes.sql` and `test/m4.ts`.
  - "Unread" cannot be verified.
- Many of this round's files are byte-identical to the partial attempt's files. I traced this to the same deterministic copy-and-rename from the round-1 arms. I found no sign that the partial attempt's results leaked into this round.
- Some skeleton files are dated 10:38, before the pre-registration commit at 11:57.
- Fix: correct the amendment in a new commit that states what the partial attempt contained and that the ordering rule is new.

### 2. Fixtures, criteria and help

- Fixtures are the same in both arms: both clone `exp1_main`.
- Both tests assert the same rows and the same Q4 sequence. Neither uses skip, only or todo.
- Drizzle's test is slightly stricter: it adds `expectTypeOf` checks and a null-tenant RLS case.
- Drizzle was allowed to read the M1–M3 SQL. That SQL is canonical input, not Experiment 1 code, so it gave no real advantage.
- Only the Drizzle brief said "Give Drizzle a fair, competent effort". The briefs are therefore unequal, but the extra line was meant to help Drizzle.
- Drizzle finished Experiment 1 at 18:56. Kysely wrote its Experiment 1 files at 18:58–19:04, in a shared tree. I found no evidence that the Kysely agent read the Drizzle code, but the shared tree means it cannot be ruled out.
- Kysely broke the protocol. Line 219 says that if 1.4.1 fails a must-have, the arm should "stop and report". T10b failed, and the arm went on to Experiment 1 anyway. This has no effect on fairness.

### 3. Raw-SQL share: biased against Drizzle

- Drizzle's self-reported shares (67–89%) cannot be reproduced, and the arm contains no counting script. The two arms counted the same pattern differently:
  - Both Q4 claims use `(tenant_id, id) in ${builderSubquery}`.
  - Drizzle reported this as 67.2% raw; recomputed, it is 17–19%. Drizzle evidently counted the interpolated builder subquery as raw.
  - Kysely reported the same pattern as 8.8%.
  - On a consistent method, Drizzle's headline figures overstate the gap by about 15 to 50 points per query.
- The metric counts typed column interpolations as raw. In `sql\`ts_rank_cd(${s.tsv}, ${q})\``, `s.tsv` is a schema-typed column that a rename would catch. Excluding typed `${}` gives Drizzle 8–28% (Q1 28.1, Q2 27.4, Q3 25.8, claim 8.4, retry 24.5) against Kysely 7–22% (22.3, 9.6, 12.7, 7.0, 16.0).
- The metric does not count string-named functions. Kysely's `eb.fn<string>("ts_headline", ...)`, `eb.fn("ts_rank_cd", ...)` and `eb.cast<number>` are as unchecked as Drizzle's `sql<string>` (the verifier made the same point). The share measures builder shape, not type safety.
- Drizzle could have used fewer raw fragments. The verifier ran `cosineDistance()` and it works; Q1 could be unrolled to a fixed depth. Drizzle's real gaps remain: no recursive CTE, window functions, CASE or arithmetic.
- Fix: publish one saved script and report both variants (typed `${}` counted and excluded). Clarify "inside the template" in a new record, not by editing this one. Until then, quote only the recomputed figures, never the Drizzle `EXP1.md` figures.

### 4. Typing self-scores: biased toward Drizzle

- The spec says "a generic on a raw call" scores partial. Kysely applied that rule strictly to Q1–Q3.
- Drizzle scored Q1 and Q2 "full", but `depth`, `path`, `rank` and `headline` come from author-written `sql<T>` generics. By the spec they are partial.
- The verifier called the typing labels "consistent with the code". I disagree for Drizzle's Q1 and Q2.
- Drizzle's Q3 is worse than partial. The type says `number` and the runtime value is `null`, so the type is wrong, not merely unchecked. The test was edited to assert that wrong type. The edit is disclosed, but the test now encodes the defect.
- Fix: rescore Drizzle Q1 and Q2 as partial. Label Q3 "wrong type" separately from partial.

### 5. Migration findings: the two arms were asked different questions

Both arms reported their findings honestly. The tests were not symmetric.

- **Kysely (Experiment 2)** was given T9 (CONCURRENTLY) and T10a/T10b (killed runs) as must-haves.
  - T10b fails.
  - The `IF NOT EXISTS` variant reports success while the index is INVALID.
  - Tamper cases (a) and (b) are not detected; (c), an edit to a pending file, is.
- **Drizzle (Experiment 3)** got no T9 or T10 at all.
  - Its migrator wraps all pending files in one transaction. My inference, not tested: `CREATE INDEX CONCURRENTLY` cannot run through it at all, which would be a T9 fail.
  - The hash is stored and never checked, which is equal to or weaker than graphile-migrate, since graphile-migrate catches edits to pending files.
  - A late-merged older migration is skipped silently: no error, and the table never exists. Kysely was never given an out-of-order test, although graphile-migrate's `--! Previous` chain is designed to catch this.
  - `drizzle-kit migrate` prints no error text.
- Net effect: Kysely carries the only red must-have mark, partly because it was the only arm tested where the hard failures live.
  - Drizzle's silent skip is arguably the most dangerous behaviour in the round, yet it is reported as a finding with no must-have weight.
  - The parallel case for Kysely is the `IF NOT EXISTS` false success. The two should be weighed the same: "reports success on a broken state".
- The spec contradicts itself. Line 217 says T7 tamper is "not scored as a must-have"; line 219 lists T7 as a must-have. Resolve this before scoring.
- Fix:
  - Run T9, T10a and T10b on Drizzle.
  - Run an out-of-order merge test on Kysely.
  - Then score both arms on the same must-have list.

### 6. Gaps that could change the conclusion

- **T10b with an idempotent recipe on Kysely.** Use a `drop-invalid-indexes` pre-step, or one CONCURRENTLY statement per file. If it passes, T10b is a recipe gap rather than a tool gap.
- **Drizzle T9 through its migrator.** If it fails, Drizzle needs a second runner for CONCURRENTLY. That is the same cost the spec charges Kysely for T10b.
- **Type safety by breakage, not character share.** Rename or retype a column and count the compile failures in each arm.
- **Nullability over outer joins.** Kysely types `coalesce` correctly as `string | null`; Drizzle's full join infers a wrong type. This needs a direct test.
- **Not tested at all:**
  - drizzle 1.0 versus 0.45 pinning;
  - two fleet nodes running `migrate` concurrently;
  - EXPLAIN on a fixture large enough to reach HNSW and GIN.
- **A slip in the verification above.** The Round 2 verification says the Drizzle arm "has no EXPLAIN report to compare". In fact `arm-drizzle-stable/out/exp1-explain.txt` (24 KB) exists.
- **Process.** The coordinator who wrote the original Kysely recommendation also wrote the amendment and briefed both arms. The independent verifier is the main safeguard, and it confirmed the Drizzle share overstatement.

## Round 3 verification (2026-11-09)

Independent pass by a verifier who did not author round 3. Nothing was committed and no authored file was edited. The authors' `exp4b-results/` files were backed up before my 4b sample run and restored byte-identical. No `verify3_` database remains.

### Defect found: `pnpm test` fails in both arms

The tsc step of `pnpm test` now fails with 25 TS1295/TS1287/TS1470 errors, all in `reference/exp4b-common.ts`. Both arms' tsconfig `include` covers `scripts/`, the `exp4b-*.ts` scripts import `../../reference/exp4b-common.ts`, and that directory has no `type: module` package. Vitest never runs. The "pnpm test passes" claims were true only for the Node 24 copy, which excluded the exp4b files. Fix: exclude `scripts/exp4b-*` from tsconfig, or give `reference/` its own package.json. I ran `node node_modules/vitest/vitest.mjs run` directly instead.

### 4a (tests rerun)

- Kysely: 45 passed, 1 failed (46 tests). The failure is the known round-2 T10b assertion. All 15 exp4a tests pass.
- Drizzle: 50 passed, 0 failed. All 14 exp4a tests pass.
- The kill lands mid-build. The helper blocks the build on a table lock, waits for `wait_event_type = 'Lock'` on the CIC backend, then terminates it. Tests assert `indisvalid=false, indisready=false` afterwards.
- Drizzle's COMMIT;/BEGIN; hack is fairly described as unsupported: a test greps the Drizzle sources for a no-transaction switch and finds none.
- Drizzle's T11 skip is silent: `migrate()` and the CLI both exit 0 with a success message.
- Kysely S4 (hand re-chained file) is silently skipped, exit 0 "Already up to date". It needs hand-editing an applied file. Realistic cases S1-S3 refuse loudly.

### T10b judgement

- Kysely P7 (`beforeAllMigrations` dropping INVALID indexes) meets the literal criterion. It ends with a valid index on rerun, uses no manual SQL, and a re-kill gives an error rather than success. It is a documented runner feature.
- Caveats: it is global rather than per-migration, it drops any INVALID index in `public` including another session's in-flight build, and it lives outside the migration file. All file-based patterns fail, and P2 (`IF NOT EXISTS`) reports success on an INVALID index.
- Verdict: **pass with caveats**. The authors' "fail plus flag" is conservative but defensible.
- Drizzle: the drop-then-CIC pattern inside COMMIT;/BEGIN; ends valid but relies on an undocumented hack that also commits earlier pending files in the batch, and there is no hook mechanism. Verdict: **fail / not applicable**. The asymmetry is documented-versus-unsupported and should be stated as such.

### Verdicts per test

| Test | Kysely | Drizzle |
|---|---|---|
| T9 | pass | fail |
| T10a | pass | pass |
| T10b | pass with caveats (P7) | fail / n.a. |
| T11 | pass on realistic cases, S4 caveat | fail |
| T7 | reported, reproduced | reported, reproduced |

### 4b (rename blast radius)

- I reran 5 columns per arm: `session_no`, `subject_id`, `entity.id`, `job.kind`, `embedding`. Classifications match the saved tables exactly, reverts were clean, and results were restored.
- The column list (25 columns) is identical across arms and scoring uses the shared `classifyRefs`.
- Reference totals differ, 76 versus 78, only because Drizzle's `job` queries filter on `tenantId` explicitly while Kysely's rely on RLS. This is a query-code difference.
- The lower-bound claim for Kysely is **verified**. On a renamed column, a standalone probe reports TS2769 on the `.orderBy` call at its own line. Within a failed `.select([...])` chain only the call start is reported, so later typed references are masked. The strict score is a true lower bound.
- Caveats: TypeScript versions differ (5.9.3 versus 7.0.2). Drizzle D2 scoring 100% is near-true by construction. D1 shows the mapping layer absorbs a DB-only rename.

### 4c (Node 24)

- Node v24.22.2 exists at `C:\Users\walte\dev\scratch\node24\node.exe`.
- The saved logs do not print the Node version, so use of Node 24 is plausible but not demonstrable from the artefacts.
- Results match Node 25 (Kysely 30/1, Drizzle 36/0). The exp4a tests were not run on Node 24, which the spec did not require.
- Verdict: **accepted, evidence weak**.

### 4d (pgvector at scale)

Rerun on the existing `vecscale` data, using temp tables only:

| Mode | recall@10 | short | p50 ms | p95 ms |
|---|---|---|---|---|
| exact | 1.0 | 0 | 38.5 | 48.1 |
| partitioned, ef 1000 | 0.980 | 0 | 21.4 | 27.7 |
| partial, ef 1000 | 0.974 | 0 | 24.6 | 34.1 |
| partitioned, ef 800 | 0.947 | 0 | 23.0 | 35.0 |

Recall is identical to the authors' numbers. Latency is somewhat lower.

**The data is not representative.** Within-cluster ranking is almost pure noise: same-cluster cosine distance is about 0.80, other-cluster about 1.0, and d10/d11 is 0.998. Recall against the exact top-10 is therefore a harsh metric on near-ties. The mean cosine distance of returned rows shows this:

| Mode | mean distance |
|---|---|
| exact | 0.7911 |
| partitioned, ef 1000 | 0.7912 |
| partitioned, ef 200 | 0.8116 |
| partitioned, ef 40 | 0.8340 |
| mode (i), ef 200 | 0.8361 |
| mode (ii) relaxed, ef 200 | 0.8491 |

Rows scored as recall 0.18 to 0.43 are only 0.04 to 0.065 worse in distance. Real embeddings have clearer neighbours.

**Lower-noise sample** (2 campaigns, 110,000 rows, 40 queries, same HNSW parameters):

| sigma | mean d1/d10 | unfiltered recall at ef 40 | at ef 200 | at ef 1000 |
|---|---|---|---|---|
| 0.5 | 0.955 | 0.915 | 0.918 | 0.975 |
| 2.5 (authors', 550k rows) | 0.962 | about 0.18 | not remeasured | not remeasured |

Reported figures for the authors' data are the 0.18 unfiltered recall and the ef 1000 pass. The sample is smaller, so it is not a like-for-like comparison. It shows that recall is very sensitive to the noise level, and that d1/d10 does not distinguish the two datasets. The d1/d10 ratio is therefore not evidence of a realistic dataset.

**Points that do transfer:** post-filter HNSW under-returns rows (62 to 79 of 100 queries return fewer than 10 rows in mode (i)), and relaxed_order iterative scan fixes the row count.

**The "pass only via per-campaign HNSW at ef 1000" framing is misleading.** Exact mode meets the literal pass criterion: recall 1.0, 10 rows, p95 about 43 to 48 ms, under 100 ms. At about 55k rows per campaign a brute-force filtered scan is already enough, and the HNSW passes are not much faster.

`01_generate.sql` has a stale `\set sigma 1.5` while the SQL hardcodes 2.5. Sigma was tuned (1.5 discarded, then 2.5) before benchmarking, which the authors disclosed.

**Verdict:** the numbers are reproducible, but the verdict is **not trustworthy as a forecast**. The reliable conclusions are narrower: filtered HNSW needs iterative scan or per-campaign indexes, and exact scan fits the budget at reference scale.


## Round 3 bias audit (2026-11-09)

This is the Critic pass for Experiment 4. It was read-only: I ran no suite and committed nothing. I wrote none of the round 3 work.

Sources read:
- `EXPERIMENTS.md`. Unchanged since eb51330, and every round 3 file is dated after that commit.
- Both arms' "Experiment 4a (round 3)" sections and their `test/exp4a.test.ts`.
- `EXP4B.md` and the Drizzle schema source.
- `EXP4C.md`.
- `EXP4D.md` and `exp4d/`.
- The coordinator's briefs to each round 3 agent. I diffed the two 4a briefs word by word.

### Verdict

Round 3 tilts both ways, the tilts partly cancel, and none of them reverses a result.

- **4a leans toward graphile-migrate**, through unequal briefs and a generous T11 label. The Kysely arm's own T10b headline goes the other way and understates graphile.
- **The 4b headline leans toward Drizzle.** 100% against 64.5% overstates the gap, though the direction is real.
- **4d is framed too darkly** and misses that the exact scan passes. It does not bear on the tool choice.
- **4c is clean.**

### 1. The 4a briefs did not use the same words

**T10b effort.**
- Kysely brief: "try EVERY idempotent pattern graphile-migrate 1.4.1 supports (read its docs/source in node_modules: e.g. splitting across files, `--! no-transaction` constraints, idempotent single statements, DO blocks, anything else)". It restates the pass rule.
- Drizzle brief: "If T9 failed, record T10b as not applicable/fail and why". It gives no hints and no restated pass rule, and it supplies the verdict in advance.
- Result: graphile got 9 patterns, and the hints led to P7, its only passing route. Drizzle got 3 patterns.
- Never tried for Drizzle: the counterpart of P7, a cleanup step in the code that wraps `migrate()`.

**T11 framing.**
- Kysely brief: "model a realistic two-branch merge". It ran six scenarios.
- Drizzle brief: "rerun to confirm round 2's finding". It ran one scenario.
- Never tested: whether a realistic merge collides in `meta/_journal.json` or the snapshot `prevId` chain (a git conflict, or `drizzle-kit check`). That collision could be Drizzle's counterpart of graphile's chain refusal.

**4b and 4c briefs:** neutral.

### 2. 4a judgement calls

**T10b.** The labels are inconsistent in both directions.
- graphile P7 is a documented runner feature (`beforeAllMigrations`). It ends with a valid index, needs no SQL run by hand, and never reported success early. It meets the literal pass rule, so the "FAIL" headline understates graphile.
- Drizzle's `COMMIT;…BEGIN;` file is not a runner mechanism, so T9 "fail" is correct. Inside that hack, though, pattern 1 also reaches a valid index.
- Caveats on P7:
  - It drops every INVALID index in `public` with a locking, non-concurrent `DROP INDEX`.
  - That includes an index another node is still building concurrently (untested).
- Caveat on the Drizzle hack: it commits earlier pending files partway through the batch, which breaks the T6 all-or-nothing guarantee.
- Both arms show the same `IF NOT EXISTS` false success and reported it the same way.

**T11.** The graphile "pass on the realistic cases" is generous. The spec has no carve-out for realistic cases.
- S1 and S2 refuse clearly.
- S3a and S3b refuse, but only with misleading errors ("column already exists", FK 23503).
- S4 skips silently. That path is reached by re-chaining the file by hand, which is the natural response to the S2 error.
- Correct label: conditional pass.
- Drizzle skips silently in the default flow, and its CLI prints success. Its fail stands, and graphile still leads.

**T7 and T10a:** symmetric. In T10a, both harnesses needed a workaround for a crash on a lost connection, and both disclosed it.

### 3. 4b scoring

- **D2 as the primary variant is defensible.** It renames both the column and the code's name for it, which is what a Kysely rename forces.
- **D2 scores 100% by construction.** A renamed TypeScript property cannot compile. The D1 row ("0 caught / 78 unaffected") invites a misreading.
- **Raw column text in the Drizzle schema source was not scored.** About 8–10 references sit in `sql` text:
  - `tenant_id` in the tenant-isolation policies;
  - `start_ms` in the CHECK constraint;
  - `text` in the `tsv` generated expression;
  - `state` in the `job_ready_idx` predicate.

  Postgres rewrites the live objects on RENAME, so these become stale source text, not query failures.
- **Neither arm generated a migration for the rename.** That leaves out drizzle-kit's prompt to choose rename or drop-and-add, a real hazard on the Drizzle side.
- **The TypeScript versions differ:** 5.9.3 for Kysely, `^7.0.2` for Drizzle. Kysely's strict/attributed split depends on where TS2769 lands, so rerun Kysely under 7.0.2.
- **The Kysely `.set(eb => ({...}))` callback form** accounts for 11 of its runtime-only references. That is an authoring choice; whether the object form would be caught is unchecked.

### 4. 4d dataset and framing

- **The exact scan passes.** Mode (iii) has recall 1.000, 0 short, and p95 43.1 ms, below the 100 ms bar. The verdict "PASS ... only through index design plus a very high ef_search" is wrong.
- **The data was steered toward a worst case.**
  - The spec asks only for clustered data. The brief added "meaningful but overlapping" and "show the data isn't trivially separable".
  - Sigma 2.5 makes the top 10 near ties (d10/d11 0.998), so recall@10 mostly measures how ties are broken.
  - `01_generate.sql` still has a stale `\set sigma 1.5`.
- **"Pessimistic bound" is not a bound.**
  - Pessimistic: the flat structure within each cluster.
  - Optimistic: the campaign filter is perfectly correlated with the clusters, and there are only 10 campaigns.
  - Per-campaign indexes or partitions also mean DDL for every new campaign.
- **Tool relevance: none.** Both arms can express the query.
  - Open question: a generic prepared plan (Drizzle `.prepare()`, or any pooled prepare) may not match a partial index. Partitions are not affected.

### 5. Corrected headlines

**4a, graphile-migrate 1.4.1:**
- T9 pass.
- T10a pass.
- T10b: no pattern inside a migration file passes. It passes through the documented global `beforeAllMigrations` hook, which drops all INVALID indexes with a locking drop.
- T11: refuses in the default flows, gives misleading errors after a rebase, and skips silently after a re-chain by hand.
- T7: detects edits to pending files only.

**4a, Drizzle Kit 0.31:**
- T9 fail.
- T10a pass.
- T10b: not reachable natively. An undocumented `COMMIT;…BEGIN;` hack works but breaks batch atomicity.
- T11 fail: skips silently and reports success. A realistic merge through the journal and snapshots is untested.
- T7: no detection.

**Both runners:** `IF NOT EXISTS` reports success while the index is INVALID.

**4b:** compile-time catch on a full rename, with 0 silent passes in either arm.
- Kysely: about 74% (range 64–78%).
- Drizzle: 100% of query-code references, or about 90% counting raw SQL in the schema source.
- The TypeScript versions differ (see section 3).

**4c:** pass, identical on Node 24.22.2.

**4d:**
- At reference scale, the filtered exact scan passes (p95 43 ms).
- Filtered global HNSW fails on this synthetic data.
- Per-campaign HNSW passes only at `ef_search` 1000.
- The data is unrepresentative in both directions.
- 4d does not separate the tools.

### 6. Fixes before 0017 is decided

- Give Drizzle the same T10b and T11 brief graphile got.
- Rerun Kysely 4b under TypeScript 7.0.2.
- Report the 4b score with and without the raw SQL in the schema source.
- Correct the EXP4D verdict.
- Commit each coordinator brief next to its result.

## Experiment 5 verification (2026-11-10)

Independent rerun and audit of `exp5/5a` and `exp5/5b` against the criteria in EXPERIMENTS.md, section "Experiment 5". The verifier did not write either experiment. Only `lock5_` and `schema5_` databases were used; none remain (checked in `pg_database` at the end). The authors' `reports/exp5a.log`, `results.json` and `results/*.json` were overwritten by the reruns and then restored from copies taken before (5b results confirmed byte-identical with `cmp`). This section is the only file edited.

### 0. Pre-registration integrity

- **CONFIRMED.** The Experiment 5 section of EXPERIMENTS.md has one commit (`4c05a18`, 2026-11-10 09:06, "Pre-register Experiment 5"), and `git diff` shows no later edit. Criteria were not changed after results.
- **MINOR DEVIATION.** The brief names the output `EXP5.md`; the authors wrote `EXP5A.md` and `EXP5B.md`. No tracked file is modified (`git status`: only `exp5/` and the pre-existing `arm-drizzle-stable/.r3tmp/` untracked).
- **CONFIRMED.** 5b `base/` equals the arms: `diff -rq` of `base/migrations/committed` against `arm-kysely-stable/migrations/committed` is empty; `base/schema/define.ts`, `base/schema/m3.ts` and `base/drizzle.config.arm.ts` are identical to the files in `arm-drizzle-stable/`; `current.sql` is identical.

### 1. Experiment 5a

Rerun: `node node_modules/vitest/vitest.mjs run` in `exp5/5a`, 142 s, "25 passed (25)". The log has 25 lines: 20 `pass=true`, 5 `pass=false`, and the five false ones are exactly K1 #1 to #5.

| Claim | Status | Evidence |
|---|---|---|
| S1, S2, S3 pass 5/5 | CONFIRMED | Rerun log: all 15 lines `pass=true`. The `pass` expression in `test/exp5a.test.ts` (lines 55, 111-113) requires: no overlap, M4 recorded exactly once, loser output matches `/Failed to get exclusive lock/`, a rerun exits 0, and for S2/S3 the invalid index keeps its OID and ends valid. Winner order varied between runs (`final codes=0/1` vs `1/0`). |
| Second run refused with "Failed to get exclusive lock" | CONFIRMED | The regex is part of the pass condition for S1/S2/S3. The log's `msg=` field shows only the last 120 characters of output (a stack frame), which looks like it lacks the message, but the test applies the regex to the full output. The five K1 lines print the message literally. |
| No double apply; building index not dropped | CONFIRMED | `M4 rows=1` in every line; `dropped` is asserted false in S2/S3. |
| K2 (backend terminated) releases the lock, 5/5 | CONFIRMED | K2 lines: `advisory held after A died=false`, B code 0, index rebuilt with a new OID and valid, M4 rows=1. |
| K1 (Node client hard-killed) fails 0/5 | CONFIRMED | K1 lines: `orphan backend gone within 10s=false, advisory still held=true`; B refused while the blocker was held; after release the lock freed, index VALID, `M4 recorded=false`, later rerun `code=1` with Postgres `index_create` "already exists". Same in all five. |
| Verdict 3 of 4 criteria | CONFIRMED | Matches the log and the criterion table in EXP5A.md section 5. |

**K1 fairness: fair, with caveats.** K1's pass condition (`orphanGone && holdersAfterKill.length === 0`) is a literal reading of "a killed run does not leave the lock held". EXP5A.md reports the failure, and its section 6 says the held lock is also what stopped a second run's hook from touching the in-flight index, so the mitigating effect is not hidden.
- K1 tests do not call `expect`, so Vitest says "25 passed" while 5 runs failed their criterion. The prose and the log are correct; a skim of the Vitest line would not show it.
- The brief's step 4 (build a wrapper, rerun S1-S3 "also with a run killed while it holds the lock") was conditional on 1.4.1 not preventing overlap. The authors did not build one, since 1.4.1 does lock, and argued that a client-side wrapper lock would be released when the wrapper dies, permitting the overlap. That argument is untested, and K1 is the case the wrapper clause was written for. Not bias, but the criterion stays open rather than closed.

**Other 5a notes.**
- Source citations (file and line numbers) come from WebFetch renderings of GitHub v1.4.1 and are labelled approximate in EXP5A.md section 1. I did not re-derive them; the run-time behaviour (a granted advisory lock in `pg_locks` held by the migrating backend, refusal on the second run) independently supports the claim.
- S3 is a second OS process, not a second container; stated in EXP5A.md section 2.

### 2. Experiment 5b

Rerun: `node run.ts` (all variants, 141 s) and the C3 Vitest file. Detection, finding counts and error counts matched the authors' `results/results.json` in every cell, for all five candidates.

| Claim | Status | Evidence |
|---|---|---|
| C2 and C3 detect D1-D8 on both sides, 0 control false alarms | CONFIRMED | Rerun: control findings 0 for c2 and c3; `detected` true for every `*m` and `*s` variant of D1-D8 for both. Both also detect D9 and D10 on both sides. |
| C3 control: 64 tests, 0 failed | CONFIRMED | Run by hand on a freshly migrated database: "64 passed (64)". |
| C1 has 15 control false alarms (partitioned parent invisible) | CONFIRMED | Rerun control findings 15, all `schema only: claim_version...` per EXP5B.md; D10m not detected by C1. These are explained baseline differences, not unexplained false alarms in the pre-registered sense. |
| C4 has 20 false alarms; exit code 0 even on prompt stops | CONFIRMED | Rerun control 20 findings; `facts.exit` is 0 in all 23 variants; prompt stops in `d1m`, `d1s`, `d8m` only. The raw control statement count was 36 in the authors' run and 24 in mine, which confirms the primary key churn instability. |
| C4 changes nothing | CONFIRMED | `facts.unchanged` true in all 23 variants. |
| About 1 s, far under 60 s | CONFIRMED | Rerun median per check: c1 1730, c2 1258, c2b 1032, c3 970, c4 899 ms. Authors: 1743, 1276, 1046, 971, 907. Create plus migrate 104-177 ms confirmed from the stored results. |
| C2 needs superuser for `CREATE EXTENSION vector` | CONFIRMED | As `skal_migrator` on a new database: "permission denied to create extension vector ... Must be superuser". `createDatabase` uses `postgres` for that statement. |
| `push` without `--strict` and without a TTY executes statements | CONFIRMED | By hand, outside the harness: `drizzle-kit push` with stdin from `/dev/null` against an empty scratch database printed "Changes applied", exit 0; 9 tables existed afterwards. Scratch database and the temporary `work/` directory removed. |
| C2b D9s blind; C4 D9 and D10m blind | CONFIRMED | Rerun matrix: `c2b d9s` not detected; `c4 d9m, d9s, d10m` not detected; `c1 d10m` not detected. |

**DISCREPANCY (minor, count only).** EXP5B.md says "22 variants", "22 total" databases, "each of the 22 `push --strict --verbose` runs" and "all 22 runs", and its how-to-run comment says "all 22 variants". `results.json` holds 23 variants: `ctl` plus 11 drift cases (D1, D2, D3a, D3b, D4-D10) times 2 sides. The data are right; the prose count is off by one.

### 3. Planted drift implements D1-D10

**CONFIRMED** from `lib/drift.ts`. Each case is applied to one side of a fresh copy of the unchanged pair and the other side is untouched. `inBlock` throws unless its edit pattern is unique, so a no-op edit cannot slip through.
- D1: rename `campaign.name` to `title` (migration `RENAME COLUMN` vs schema `text('title')`).
- D2: `DROP NOT NULL` vs removing `.notNull()`.
- D3a: `entity.kind` text vs `varchar(100)`. D3b: `halfvec(768)` vs `halfvec(384)`.
- D4: default `'{}'` vs `'[]'`.
- D5: index on `transcript_segment (tenant_id, speaker)`.
- D6: FK `entity.tenant_id -> tenant`, same constraint name on both sides.
- D7: `CHECK (length(name) > 0)`.
- D8: `audit_log` table with matching columns and primary key.
- D9: policy `USING (true) WITH CHECK (true)` vs `tenantIsolation(sql true)`.
- D10: `claim_version.note` added on the partition parent.

Migration-side drift is added as a proper committed file with a computed hash; graphile-migrate accepted all 23 variants without error.

**Control differences are explained, not hidden: CONFIRMED, with a caveat.** EXP5B.md lists five baseline differences and attributes the C1 and C4 control findings to them (partitioned parent invisible to `pull`; NULLS NOT DISTINCT; hnsw readback; primary key churn). The C1 findings are all `claim_version` lines. Caveat: C2 and C3 score 0 partly because the catalog query and the C3 test exclude partitions on purpose (`NOT c.relispartition`), while C1 and C4 cannot choose. EXP5B.md says this ("neither can see partitions, triggers or grants"), so it is disclosed, but a reader comparing "0 vs 15 vs 20" should know the 0 covers a narrower scope. C3 also carries hand-tuned normalisers (`typeText`, shared `canonExpr`) developed against this control pair; C2 compares raw catalog text with only the `public.` prefix stripped, so C2's zero is the less tuned of the two.

### 4. Bias check

- Criteria changed after the fact: no (section 0).
- Cases dropped: none. D1-D10 are all present on both sides; D3 is split into 3a and 3b, which adds cases.
- Counts that do not match logs: 5a none; 5b only the 22 vs 23 variant count.
- Detection rule: "detected" means a candidate's findings differ from its own control findings. This is stated in EXP5B.md and is the only fair rule for C1 and C4, but it lets C1 and C4 "pass" through baseline lists the authors maintain, and for C4 the D1m, D1s and D8m detections exist only because drizzle-kit stopped at a rename prompt. EXP5B.md flags both (`DET*`) and hedges its C1 and C4 verdicts. I agree with the hedging; I would not call C1 or C4 a clean pass.
- C4's `dropPkeyChurn` filter hides a real primary key column reorder; disclosed in EXP5B.md.
- The privilege finding (C1 and C4 gain false alarms under `skal_app`; cause "not confirmed in source") is reported as observed only. I did not rerun it.

### 5. Spot check by hand: D5 (index on one side) through C3

Independent of `run.ts` and its drift builder: created `schema5_hand`, migrated `base/migrations` with graphile-migrate, then:
1. `pg_indexes` count for `transcript_segment_speaker_idx` = 0, and the name appears in no `base/schema/define.ts` and no committed migration.
2. C3 against the untouched database: 64 passed.
3. `CREATE INDEX transcript_segment_speaker_idx ON transcript_segment (tenant_id, speaker)` by psql, then C3 again: 1 failed, 63 passed. The failing test is `transcript_segment > has matching indexes`: `schema only: [] database only: [transcript_segment_speaker_idx: btree (tenant_id,speaker) with()]`.

**CONFIRMED.** The detection is real: it names the right table, aspect and index, only that test fails, and the same database with the index absent is clean. Database dropped afterwards.

### 6. Findings

| # | Item | Severity |
|---|---|---|
| 1 | EXP5B.md says 22 variants; there are 23 (`ctl` plus 22 drift variants). | Low, wording |
| 2 | 5a K1 runs do not assert, so Vitest reports 25 passed while 5 runs failed the criterion; the log, `results.json` and EXP5A.md state it correctly. | Low, presentation |
| 3 | Brief asks for `EXP5.md`; two files were written. | Low |
| 4 | 5a: wrapper not built or tested; the argument that it cannot help with K1 is unverified. | Medium, open question |
| 5 | 5a: S3 is a second process, not a second container; pgbouncer transaction mode untested (both stated by the authors). | Low |
| 6 | 5a: source line numbers come from a WebFetch rendering and were not re-verified by me; behaviour supports the claim. | Low |

**Overall:** every numeric claim in the 5a and 5b write-ups that I reran was reproduced, apart from the variant count. No evidence of bias, dropped cases, or criteria edits. K1 is reported fairly.

## Experiment 5c verification (2026-11-10)

Verifier: a separate agent, not an author of 5c. Reran `test/probe.test.ts` (6 of 6 passed) and `test/exp5c.test.ts` (40 of 40 passed, 197 s) from `exp5/5c/` against `db-tooling-db-1`, then compared with the author's saved logs. The reruns overwrote the logs and JSON in `exp5/5c/`; I restored the author's originals afterwards (copies were taken first). Databases used: the harness's `lock5c_*` plus my own `lock5c_vdblink_*`; all dropped, 0 `lock5c_` databases remain. Nothing was committed and nothing else was edited.

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | F1 refused with 25001; `COMMIT;` does not help; nothing recorded | CONFIRMED | Fresh `probe.log`: F1, F1b and F1c each exit 1, `DROP INDEX CONCURRENTLY cannot run inside a transaction block`, `recorded:[0]`, `index:null`. The "one query, implicit transaction" cause is inferred from behaviour and 5a's source reading; I did not read the runner source. |
| 2 | `DO` block with `EXECUTE` of both is refused | CONFIRMED | Fresh F2b: exit 1, `DROP INDEX CONCURRENTLY cannot be executed from a function`, `recorded:[0]`. The DO block fails on the DROP, which comes first, so the CREATE is never reached. Round 3 P5 covers CREATE. |
| 3 | F2a and F2c accepted; CLEAN, R3, S2 5/5, K2 5/5 for each | CONFIRMED | Fresh `exp5c.log`: for each of F2a and F2c, CLEAN 1/1, R3 1/1, S2 5/5, K2 5/5 true. Both probes exit 0, index valid, `recorded:[1,1]`. The pass/fail column of the 40 lines is identical to the author's log. |
| 4 | K1 0/5 for both; drop file recorded, orphan finishes, create file unrecorded, next run fails 42P07 | CONFIRMED | Fresh log, 10 of 10 K1 lines: orphan alive 2 s after SIGKILL and advisory lock still held; index valid with one index; `000004.sqlx1,000005.sqlx0`; next migrate exit 1 with `already exists` and 42P07. The test asserts only the refusal, so Vitest shows K1 as passing while the criterion fails; the log lines carry the real verdict (same presentation point as finding 2 for 5a). |
| 5 | Lock held about 1.7-2.0 s after SIGKILL on 1.5M rows; second run refused in all 16 runs before its hook ran; no in-progress index dropped | DISCREPANCY (minor) | Refusal: CONFIRMED, 16 of 16 (10 K1 + 6 K1T) show `refused=true` with `Failed to get exclusive lock`; in the 10 K1 runs the index OID is unchanged during B. Duration: in the author's retained log it is 1,726-1,850 ms, not the 1,739-1,974 ms written in section 5 (the write-up figures probably come from the first of the two battery runs, whose log was overwritten). In my rerun it was 1,794 / 1,930 / 3,014 ms (F2a) and 3,101 / 3,377 / 3,238 ms (F2c). So the figure is machine- and load-dependent and "about 1.7-2.0 s" understates what I saw; "about 2-3.4 s on this machine at 1.5M rows" is safer. Post-release free time was 7-123 ms in my run (write-up says 7-69 ms). Two weaker points: "before its hook ran" is not asserted directly; it is inferred from B's refusal message and the unchanged OID (a hook DROP would block behind the test's blocker anyway). K1T does not check the index OID at all, so "no index dropped" rests on the 10 K1 runs and the 5a S2 pattern. |
| 6 | No missed plain-SQL form | CONFIRMED, with one caveat | See below. |
| 7 | Bias: criteria unchanged, no dropped runs, counts match logs, 5a/5b/arms untouched | CONFIRMED | `git log -- EXPERIMENTS.md` last touched by 54f841b; no working-tree diff to it. `git diff --stat` is empty, so nothing tracked in 5a, 5b or the arms changed; the only untracked paths are `exp5/5c/` and `arm-drizzle-stable/.r3tmp/` (a round 3 leftover, not 5c). Log has 40 battery lines = 2 forms x (1 CLEAN + 1 R3 + 5 S2 + 5 K2 + 5 K1 + 3 K1T), 6 probe lines = 6 forms, matching the write-up. The pass condition in `exp5c.test.ts` matches the pre-registered K1 criterion (exit 0, one valid index, every file recorded once). |

### Claim 6: could any form make K1 pass?

Reasoning. graphile-migrate records a file only after its SQL ends, and a `--! no-transaction` file cannot hold two top-level statements. So with a plain drop-before-create, the drop is either in its own file, which is recorded before the create starts and is never rerun, or in the same file, which Postgres refuses. A killed client leaves the create unrecorded while the orphan completes it, so any rerun hits an existing index. No pure drop-before-create arrangement of files can pass K1. This agrees with the author's section 6.

The one place the pre-registration's "plain SQL" wording leaves a gap is an extension-based form, which the author did not try. I tried it: `dblink` is available in the image (1.2). One `--! no-transaction` file with `SELECT dblink_exec(conn,'DROP INDEX CONCURRENTLY IF EXISTS x'), dblink_exec(conn,'CREATE INDEX CONCURRENTLY x ...')`, run by `skal_migrator` after `CREATE EXTENSION dblink` as postgres:
- Connecting via `localhost` fails with `dblink_security_check` (container loopback is trust auth and non-superusers must use a password); connecting by the container IP works.
- The form then **hangs even on a clean run with no blocker**: after 30 s the migrate process is still running, the dblink caller waits in `DblinkGetResult` and the remote CIC waits on `virtualxid`. The CIC waits for the caller's own transaction, which is waiting for the CIC, and Postgres cannot see that deadlock across a dblink connection.
- In the K1 shape the migration never recorded, the index stayed invalid and the advisory lock was still held 60 s after the blocker was released.

So the extension-based form does not work, for a different reason than F1. The author's omission is therefore not a missed passing form, but the write-up should say "extension-based forms (dblink) fail: CIC deadlocks on the caller's own snapshot" rather than "not tried". Related, still untested by anyone: `CREATE INDEX CONCURRENTLY IF NOT EXISTS` plus the existing hook would very likely pass K1 (the orphan leaves a valid index and the file then records), but it is not drop-before-create and reverses the 0017 rule; the author lists it correctly as a next step. I did not run it.

### Other observations

| # | Item | Severity |
|---|---|---|
| 1 | Section 5 lock-hold range (1,739-1,974 ms) is not in the retained log (1,726-1,850 ms); my rerun gave 1,794-3,377 ms. | Low, wording; the conclusion (lock lives as long as the backend and scales with table size) holds |
| 2 | Vitest reports K1 and K1T as passing while the criterion fails; only the log and `results.json` carry the verdict. | Low, presentation |
| 3 | The "not tried" note on extension forms in section 3 can be replaced by the dblink result above. | Low |
| 4 | `reports/` keeps only the last battery run; the first run (mentioned in section 1) is not retained. | Low |

**Overall:** the verdict (no form passes K1; F2a and F2c are valid but do not fix it) is reproduced. No evidence of bias, dropped runs or criteria edits. One minor numeric discrepancy (lock-hold duration) and one omission (dblink) that does not change the result.
