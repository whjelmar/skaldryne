# Experiment 5b: CI check that the Drizzle schema matches the migrated database

Branch `spike/db-tooling`, local clone. Postgres 18.6 in `db-tooling-db-1`, drizzle-orm 0.45.4, drizzle-kit 0.31.11, graphile-migrate 1.4.1, Vitest 4.1.11, Node and pnpm (store `C:\Users\walte\dev\.pnpm-store`). Nothing was committed. The arm directories were not edited: the schema, migrations and config were copied into `base/` and drift was planted in per-variant copies under `work/<variant>/` (removed after the run; `run.ts` rebuilds them).

Reading `node_modules/graphile-migrate` was denied by a permission rule, so the migration hash scheme was worked out empirically (hash = `sha1:` + sha1(previous hash, newline, trimmed body, newline), checked against all three committed files). This is what lets a drifted migration be added as a proper committed file.

## How to run

```
cd exp5/5b
pnpm install --store-dir C:\Users\walte\dev\.pnpm-store
node run.ts                       # all 23 variants (control plus 22 drift), writes results/results.json
node run.ts --only ctl,d1m        # subset
CHECK_ROLE=skal_app node run.ts --priv   # control only, checks run as skal_app
```

Every variant gets its own database `schema5_<variant>` (23 total, plus a `_b` twin during C2). All were dropped; the final check found no `schema5_*` database left.

## Setup of the comparison

Variants: `ctl` (unchanged pair) plus, for each of D1, D2, D3a (text vs varchar(100)), D3b (halfvec 768 vs 384), D4 ... D10, an `m` variant (drift added as an extra committed migration `000004-drift-<id>.sql`) and an `s` variant (the same drift applied to the Drizzle schema copy). Each drift is applied alone to a fresh copy.

"Detected" means the candidate's set of findings differs from its own findings on the control. That is the only fair rule for C1 and C4, whose control output is not empty. The raw count is also in `results/results.json` (`findings`, `newFindings`, `fires`).

## Baseline: real differences between the unchanged pair

These exist before any drift is planted. They are properties of Drizzle versus the hand-written SQL, not of any checker.

1. **Partitioned table `claim_version`.** The schema declares it as an ordinary table; the migrations create it `PARTITION BY` with partitions `claim_version_p*`. `drizzle-kit pull` does not return a partitioned parent at all. `generate` does emit it. The partitions themselves, triggers and grants cannot be expressed in the Drizzle schema, so no candidate here compares them (the catalog query and C3 exclude partitions on purpose).
2. **Row level security flag.** `generate` records a table with policies as RLS-enabled in its SQL but not in its snapshot JSON; `pull` records the real flag. C1 normalises this.
3. **Primary key and unique representation in `pull`.** A single-column primary key is reported on the column without its name; composite key and unique columns come back in an order that is not the constraint order; `NULLS NOT DISTINCT` on `field_definition` is lost; non-btree operator classes are attached to btree columns in odd ways. C1 compares key and unique columns as sets and the opclass only for non-btree indexes.
4. **Expression text.** Postgres deparses `value_type IN (...)` as `= ANY (ARRAY[...])`, adds parentheses and `::text` casts. `lib/canon.ts` strips these before comparison (C1 and C3).
5. **Column order** differs between the two sides and is not compared by any candidate.

## Candidate by drift matrix

DET = the candidate's findings differ from its control. `-` = no difference. `*` = detected only because drizzle-kit stopped at an interactive rename prompt (see C4). `m` = drift in migrations only, `s` = drift in the Drizzle schema only. C2 is the `generate` path. C2b (the `push`-to-scratch variant of C2) is shown separately.

| Drift | C1 pull + diff | C2 generate + catalog | C2b push + catalog | C3 Vitest | C4 push strict |
|---|---|---|---|---|---|
| D1 renamed column | m DET, s DET | m DET, s DET | m DET, s DET | m DET, s DET | m DET*, s DET* |
| D2 nullability | m DET, s DET | m DET, s DET | m DET, s DET | m DET, s DET | m DET, s DET |
| D3a text vs varchar | m DET, s DET | m DET, s DET | m DET, s DET | m DET, s DET | m DET, s DET |
| D3b halfvec 768 vs 384 | m DET, s DET | m DET, s DET | m DET, s DET | m DET, s DET | m DET, s DET |
| D4 default | m DET, s DET | m DET, s DET | m DET, s DET | m DET, s DET | m DET, s DET |
| D5 index | m DET, s DET | m DET, s DET | m DET, s DET | m DET, s DET | m DET, s DET |
| D6 foreign key | m DET, s DET | m DET, s DET | m DET, s DET | m DET, s DET | m DET, s DET |
| D7 check | m DET, s DET | m DET, s DET | m DET, s DET | m DET, s DET | m DET, s DET |
| D8 whole table | m DET, s DET | m DET, s DET | m DET, s DET | m DET, s DET | m DET*, s DET |
| D9 RLS policy (reported) | m DET, s DET | m DET, s DET | m DET, **s -** | m DET, s DET | **m -, s -** |
| D10 partition parent column (reported) | **m -**, s DET | m DET, s DET | m DET, s DET | m DET, s DET | **m -**, s DET |

Notes on the misses:

- **C1, D10m.** `pull` cannot see `claim_version`, so a column added to the partition parent by migration is invisible. D10s is caught only because the schema side gains a line in the "schema only" set; that is incidental.
- **C4, D10m and D9.** The control already lists the whole `claim_version` table as to-be-created, and the policy statements `push` prints have no `USING` or `WITH CHECK` clause at all (see the push hazard below), so policy differences do not show up. D10s is caught by the incidental `"note" text,` line inside the control's `CREATE TABLE claim_version`.
- **C2b, D9s.** Same cause: `push` builds the second database with policies that have no expressions, so a schema-side expression change cannot differ.
- **C4 prompt stops.** Only D1m, D1s and D8m stopped at a prompt. D1m and D1s end at the column rename question (`promptColumnsConflicts`), D8m at the table rename question (`promptNamedWithSchemasConflict`), so there is no statement list for those three. The gate still fails (fail-closed) but the finding says nothing about what differs.

## False alarms on the control

The control is the unchanged pair, so any finding is either a real baseline difference (listed above) or a false alarm of the tool. Control findings and their explanation:

| Candidate | Control findings | Explanation |
|---|---|---|
| C1 | 15, all "schema only: claim_version..." | Real baseline difference 1 (pull misses the partitioned parent). Explained, stable across runs. |
| C2 (generate) | 0 | none |
| C2b (push) | 18 (9 tables x 2 lines) | Tool defect: push creates every policy without `USING` / `WITH CHECK`, so database-side and schema-side policy lines differ for all nine tables. Explained, stable. |
| C3 | 0 | none (64 tests, 0 failed) |
| C4 | 20 statement lines (after filtering) | (a) `CREATE TABLE claim_version`, its constraints, RLS and `CREATE POLICY` (real baseline difference 1); (b) `DROP INDEX` / `CREATE INDEX claim_embedding_hnsw`: `pull` reads the hnsw index back differently (tool false alarm); (c) `ADD` / `DROP` of the `NULLS NOT DISTINCT` unique on `field_definition` (baseline difference 3, tool false alarm). |

C4 has a further, unstable false alarm: `DROP CONSTRAINT` plus `ADD CONSTRAINT ... PRIMARY KEY` for keys that did not change, on 2 to 6 of the tables, different between runs on the same database (24 raw lines on one run, 36 on another). The raw statement list is therefore not comparable between runs. `candidates/c4.ts` removes same-name drop and add pairs of primary keys (`dropPkeyChurn`); this is glue that was needed, and it also hides a real reordering of a primary key's columns.

## Timing

Wall clock per check, 23 variants (ms, min / median / max). Database create plus migrate costs 104 to 177 ms per variant and is common to all candidates.

| Candidate | min | median | max |
|---|---|---|---|
| C1 | 1701 | 1743 | 2026 |
| C2 | 1238 | 1276 | 1490 |
| C2b | 1006 | 1046 | 1911 |
| C3 | 948 | 971 | 2603 |
| C4 | 884 | 907 | 961 |

Three further control repeats gave the same figures (C1 about 1.7 s, C2 about 1.3 s, C3 about 1.0 s, C4 about 0.9 s). All are far inside the 60 s limit. The C3 time includes Vitest start-up. These are warm-cache numbers on one machine against a local container.

## Prompts and privileges

- **Prompts.** None of the candidates waits for input when run with stdin closed. `push` in strict mode prints the statements and then fails with "Interactive prompts require a TTY"; the process exit code is 0 in all 23 runs including the cases where it stopped at a prompt, so a CI job must parse the output and cannot rely on the exit code. A "renamed or new?" prompt comes before any statement list when a column or table appears to be renamed (D1, D8m).
- **C4 changes nothing.** A catalog snapshot (the fixed catalog query) taken before and after each of the 23 `push --strict --verbose` runs was identical in every case.
- **Roles.** The checks ran as `skal_migrator` (default). C2 needs more: it creates a second database (CREATEDB, which skal_migrator has) and `CREATE EXTENSION vector` in it needs a superuser, so its setup step uses `postgres`. C1, C3, C4 only read.
- **Run as `skal_app`** (control only, `CHECK_ROLE=skal_app`): C2 and C3 gave the same clean result (0 findings). C1 and C4 gained false alarms: every primary key and the `field_definition` unique appear missing from the database (C1 +9 "schema only" lines, C4 +8 `ADD CONSTRAINT ... PRIMARY KEY` lines and no longer the unique drop). The likely cause is that `pull` introspects constraints through a view that hides constraints on tables the role does not own; this was observed, not confirmed in source (node_modules reading was denied for graphile-migrate, and not attempted for drizzle-kit). So C1 and C4 must run as the table owner.

## Push hazard

`drizzle-kit push` has no dry-run flag. Without `--strict` and without a TTY it goes on to execute the statements it prints (observed on a scratch database). `--strict --verbose` is the safe form, and it is the only one used against the control-style databases here. Every `push` in this experiment ran against a `schema5_` database. Separately, the statements `push` prints for policies lack `USING` and `WITH CHECK` (`CREATE POLICY "tenant_isolation" ON "claim_version" AS PERMISSIVE FOR ALL TO public;`), and the policies created in the C2b scratch database really are empty; `generate` produces them correctly. Applying `push` output to a real database would therefore weaken row level security. This is a finding about the tool version, outside the pass criteria.

## Glue size

Non-blank, non-comment lines of the code a CI job would carry, measured as written (they include the experiment's `Outcome` plumbing, so a leaner version would be somewhat smaller):

| Candidate | Lines | Made of |
|---|---|---|
| C1 | 65 | `candidates/c1.ts` 59 + `lib/canon.ts` 6; baseline of 15 expected lines must be kept |
| C2 | 81 | `candidates/c2.ts` 46 (both `generate` and `push` variants) + `lib/catalog.ts` 35 (the fixed query and diff); no per-aspect code |
| C3 | 133 | `tests/c3.test.ts` 127 + `lib/canon.ts` 6; runner `candidates/c3.ts` 19 is harness only |
| C4 | 38 | `candidates/c4.ts`, of which about 12 are the primary key churn filter; baseline of 20 expected lines must be kept |

All candidates share the 8-line `drizzle.config.ts`.

## Pass / fail against the criteria

Criteria: detect D1 to D8; no unexplained false alarm on the control; under 60 s; no prompts. D9 and D10 are reported, not required.

| Candidate | D1 to D8 (both sides) | Control | Time | Prompts | Verdict |
|---|---|---|---|---|---|
| C1 | all detected | 15 explained findings | 1.7 s | none | pass, needs a baseline; blind to claim_version drift in migrations |
| C2 | all detected | 0 | 1.3 s | none | pass; needs superuser for the second database's extension |
| C2b | all detected | 18 explained findings | 1.0 s | none | pass on D1 to D8 only through delta detection; blind to D9s |
| C3 | all detected | 0 | 1.0 s | none | pass |
| C4 | all detected, but D1m, D1s and D8m only as prompt stops | 20 explained, one source unstable | 0.9 s | none (but rename prompts block the listing) | pass on the letter of the criteria only via delta and the churn filter; D9 and D10m missed |

## Best combination

C2 and C3 both meet every required criterion with no baseline to maintain, and both also catch D9 and D10 on either side. They differ in cost and reach:

- C3 reads the schema directly and the catalog with plain queries, needs no second database and no superuser, and runs under a read-only role. Its comparison logic is the largest (133 lines) and only covers the aspects it was written for (columns, keys, uniques, foreign keys, checks, indexes, policies, RLS flag).
- C2 compares whole catalogs with one fixed query, so any fact the query reports is compared without per-aspect code (81 lines). It needs CREATEDB plus a superuser for the vector extension and builds a second database on each run.

Running both gives the widest coverage; neither can see partitions, triggers or grants, because the Drizzle schema cannot express them. C1 and C4 are weaker as sole gates: C1 is blind to the partitioned table, and C4 needs a maintained 20-line baseline, one unstable false alarm source and output parsing, and cannot be trusted on exit code.

## Files

- `run.ts`: runner; `results/results.json` (all variants), `results/results-skal_app.json` (privilege trial), `results/results-partial.json` (last control repeat).
- `lib/`: `env.ts`, `databases.ts`, `catalog.ts`, `canon.ts`, `drift.ts` (drift cases D1 to D10).
- `candidates/`: `c1.ts`, `c2.ts` (c2 and c2b), `c3.ts` (runner), `c4.ts`, `types.ts`.
- `tests/c3.test.ts`: the C3 Vitest file (needs `SCHEMA_DIR` and `DATABASE_URL`).
- `base/`: copies of the unchanged schema, migrations and config.
