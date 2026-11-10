# Experiment 4b: type safety under a rename

Measured on branch `spike/db-tooling`, run identically in both stable arms. Spec: `EXPERIMENTS.md`, Experiment 4, "4b". The scripts, raw results and renderer are listed at the end so a verifier can rerun them.

Arms: Kysely 0.29.6 with kysely-codegen 0.20.0 and TypeScript 5.9.3 (`arm-kysely-stable`), Drizzle ORM 0.45.4 with TypeScript 7.0.2 (`arm-drizzle-stable`). Both ran the Experiment 1 tests with vitest.

## Method

1. Column list: every database column that the Experiment 1 query code (Q1 graph hops, Q2 full-text search, Q3 hybrid search, Q4 job queue) names, from `src/exp1.ts` of either arm. 25 columns, the same list for both arms (table.column): claim_current.{subject_id, object, tenant_id}, entity.{tenant_id, id, display_name}, transcript_segment.{id, session_no, start_ms, tsv, text, tenant_id, campaign_id}, segment_embedding.{tenant_id, segment_id, embedding}, job.{state, locked_by, locked_at, attempts, tenant_id, id, run_after, kind, payload}.
2. References are counted per arm per query by hand, including references inside raw `sql` text, and guarded by a drift check (each listed line must still contain its snippet). Counts differ per arm because the two arms write the same query differently (Kysely: 76 references, Drizzle: 78).
3. For each column, one at a time, in a work copy of the arm and a private `rename_*` database:
   - Kysely: `ALTER TABLE ... RENAME COLUMN c TO c_r` on the database, then regenerate `src/db/types-exp1.ts` with kysely-codegen.
   - Drizzle, variant D2 (primary): rename the TypeScript property and the database name in the schema source (`subjectIdR: uuid('subject_id_r')`), update the schema-internal uses of that property, and apply the same rename to the database.
   - Drizzle, variant D1 (supplementary): rename only the database name string in the schema source and the database column, keeping the TypeScript property.
   - Run `tsc --noEmit`, then the Experiment 1 tests. Collect Postgres server-log errors ("column ... does not exist") to see which statement was rejected.
   - Revert everything and verify: schema or types identical to the original, tsc clean, tests green. All 25 columns in every run reverted cleanly.
4. Classification of each reference:
   - compile: tsc reports an error attributable to the reference.
   - runtime: no tsc error, but a test of that query fails. "observed" means the database log shows a rejected statement of that very function; "inferred" means another statement of the same query was rejected and this one's was not seen.
   - passes wrongly (undetected): no tsc error and no failure of the query.
   - unaffected: Drizzle D1 only. The code names the property, which did not change.
5. Score: share of references caught at compile time, per arm and per query.

## Headline scores

| Arm | References | Caught at compile time | Runtime-only | Passes wrongly |
|---|---:|---:|---:|---:|
| Kysely, strict (error on the reference's own line) | 76 | 49 (64.5%) | 27 | 0 |
| Kysely, attributed (call-start errors counted) | 76 | 56 (73.7%) | 20 | 0 |
| Drizzle D2 (property and database name renamed) | 78 | 78 (100%) | 0 | 0 |
| Drizzle D1 (database name only renamed) | 78 | 0 | 0 | 0 (78 unaffected) |

Per query, Kysely strict / attributed: Q1 50.0% / 62.5% (16 refs), Q2 50.0% / 80.0% (10), Q3 80.0% / 93.3% (15), Q4 68.6% / 68.6% (35). Drizzle D2: 100% in all four queries (16, 10, 15, 37 refs).

Nothing passed wrongly in either arm: every stale reference was noticed by at least one of tsc or the tests. The measure therefore separates "caught early" from "caught by running the query", not "caught" from "missed".

## What the Kysely runtime-only references are

- Raw `sql` text (10 refs, for example `` sql`... c.subject_id ...` ``): unchecked by design.
- `.set((eb) => ({ key: ... }))` callback-form keys (11 refs, all in Q4 `job` updates): not excess-property-checked.
- Typed-string references that tsc did not flag separately even though they are typed (L83 `s.session_no`, L84 `s.start_ms`, L177 `job.id`): these follow a failed `.select(...)` call call earlier in the same chain, and tsc reported no second error for the later calls (likely masking, not verified). This undercounts Kysely compile-time catches; see the caveats.

## How Kysely errors were attributed

tsc reports a failed overload of `.select([...])` (TS2769, "No overload matches this call") at the line where the call starts, not at the failing element. The strict score counts only errors on the reference's own line and so undercounts. The attributed score additionally counts a typed-string reference as caught when an otherwise-unmatched TS2769 starts a call whose extent (by indentation, up to its closing line) contains the reference. This is valid under the assumption that the call compiled at baseline and only this column changed; tsc's detail text echoes the whole argument array, so it does not itself name the failing element. The truth for Kysely lies between the two scores. Later typed references in a chain whose earlier call already failed (L83, L84, L177) are probably also compile-time errors that tsc does not report separately, which would put the true figure higher still; this was not verified by renaming in isolation. Unmatched errors (including TS2322 at L15, a cascade) are listed per arm below.

## Caveats and blind spots

Several of these favour Drizzle, some favour Kysely. None was corrected for.

Favouring Drizzle (or against Kysely):
- Only a schema rename of the TypeScript property is scored for Drizzle D2. Kysely has no TypeScript-level property to rename: its types come from the database, and its column names are strings.
- Kysely typed-string references are not checked against the renamed column in the same spot tsc stops reporting, so the Kysely score is a lower bound (see above).
- Drizzle's references use properties of the table objects, so every reference was checked by the compiler by construction; the raw sql parts reference columns through `${table.prop}`. Drizzle's `exp1.ts` contains no raw column-name text at all, so D1 is trivially "all unaffected".

Favouring Kysely (or against Drizzle):
- D2 edits the schema source per rename (1 to 7 lines in `define.ts`, `m3.ts` or `m4.ts`, see per-column tables), plus TypeScript errors in other files (tsc errors "all files" exceeds errors in `exp1.ts` in many rows). Kysely needs one migration and a regeneration.
- The schema source has raw-text column references of its own (row-level-security policies `tenant_id = ...`, the queue index `where state = 'queued'`, the generated tsvector expression, check constraints). They are not scored and were not updated; a real Drizzle rename would have to find them. The same applies to Kysely migrations (not scored either).
- A real rename in an IDE (rename-symbol) would fix every Drizzle TypeScript reference automatically. The script does not model that. Kysely has no counterpart for string references.
- Drizzle D1 shows that a database-only rename is invisible to the compiler: it is caught only if the code names the column in text (none does in this arm). In a codebase with raw sql, D1 would behave like Kysely's raw-text references.

Neutral limits:
- The Experiment 1 database is built from reference SQL, not by a real graphile-migrate migration. Kysely migration mechanics were not exercised.
- Trigger plpgsql bodies are not updated by a bare `RENAME COLUMN` (same for both arms, not scored).
- `drizzle-kit` was not exercised.
- The test harnesses contain raw SQL naming `job` columns (Drizzle `exp1.test.ts` around L200-216). Failures there are not `exp1.ts` reference failures and were not counted as such.
- Q4 tests hang when `claimJobs` throws; a 20 second test timeout is used, so some Q4 "inferred" evidence labels come from a stopped test.
- The Postgres log carries no database name, so the two arms were run strictly one after the other. A short probe of the Drizzle script overlapped the Kysely run, which could affect evidence labels (observed or inferred) of a few `hybridSearch` rows, never verdicts.
- Line-based attribution assumes `src/exp1.ts` is unchanged (verified: both arms are byte-identical to the commit).
- 25 columns, one rename each, one TypeScript version per arm. The two arms use different TypeScript major versions (5.9.3 and 7.0.2); error reporting positions may differ for that reason.

## Files

- `arm-kysely-stable/scripts/exp4b-kysely.ts`, `arm-drizzle-stable/scripts/exp4b-drizzle.ts`: the runs (`node scripts/exp4b-<arm>.ts` from the arm directory; `EXP4B_ONLY=table.col,...` limits the columns).
- `reference/exp4b-common.mts`, `reference/exp4b-render.ts`: shared helpers and the renderer (`node reference/exp4b-render.ts` writes `exp4b-results/tables.md`, from which the tables below are copied).
- `exp4b-results/kysely.json`, `kysely.partial.json` (re-run of five columns with the full tsc error text; the renderer uses it in place of those columns in `kysely.json`), `drizzle.json`, and the run logs.

## Tables

Generated by `reference/exp4b-render.ts`. "Score" gives references per query; "Per column" gives the counts and the schema edit; the unattributed table lists tsc errors in `src/exp1.ts` on a line holding no listed reference of that column.

### Kysely (strict: error on the reference's own line)

#### Score

| Query | References | Compile-time | Runtime-only | Passes wrongly | Unaffected | Caught at compile time |
|---|---:|---:|---:|---:|---:|---:|
| Q1 | 16 | 8 | 8 | 0 | 0 | 50.0% |
| Q2 | 10 | 5 | 5 | 0 | 0 | 50.0% |
| Q3 | 15 | 12 | 3 | 0 | 0 | 80.0% |
| Q4 | 35 | 24 | 11 | 0 | 0 | 68.6% |
| **All** | 76 | 49 | 27 | 0 | 0 | 64.5% |

#### Per column

| Column | Refs | Compile | Runtime | Passes wrongly | Unaffected | tsc errors (all files) | tsc errors in exp1.ts | Schema/migration edit |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| claim_current.subject_id | 6 | 1 | 5 | 0 | 0 | 5 | 4 | 1 migration, types regenerated |
| claim_current.object | 5 | 2 | 3 | 0 | 0 | 2 | 2 | 1 migration, types regenerated |
| claim_current.tenant_id | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 1 migration, types regenerated |
| entity.tenant_id | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 1 migration, types regenerated |
| entity.id | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 1 migration, types regenerated |
| entity.display_name | 1 | 1 | 0 | 0 | 0 | 2 | 1 | 1 migration, types regenerated |
| transcript_segment.id | 4 | 2 | 2 | 0 | 0 | 4 | 4 | 1 migration, types regenerated |
| transcript_segment.session_no | 2 | 0 | 2 | 0 | 0 | 1 | 1 | 1 migration, types regenerated |
| transcript_segment.start_ms | 2 | 0 | 2 | 0 | 0 | 1 | 1 | 1 migration, types regenerated |
| transcript_segment.tsv | 4 | 4 | 0 | 0 | 0 | 4 | 4 | 1 migration, types regenerated |
| transcript_segment.text | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 1 migration, types regenerated |
| transcript_segment.tenant_id | 4 | 4 | 0 | 0 | 0 | 4 | 4 | 1 migration, types regenerated |
| transcript_segment.campaign_id | 3 | 3 | 0 | 0 | 0 | 3 | 3 | 1 migration, types regenerated |
| segment_embedding.tenant_id | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 1 migration, types regenerated |
| segment_embedding.segment_id | 3 | 2 | 1 | 0 | 0 | 3 | 3 | 1 migration, types regenerated |
| segment_embedding.embedding | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 1 migration, types regenerated |
| job.state | 6 | 4 | 2 | 0 | 0 | 4 | 4 | 1 migration, types regenerated |
| job.locked_by | 5 | 3 | 2 | 0 | 0 | 3 | 3 | 1 migration, types regenerated |
| job.locked_at | 3 | 1 | 2 | 0 | 0 | 1 | 1 | 1 migration, types regenerated |
| job.attempts | 6 | 5 | 1 | 0 | 0 | 6 | 4 | 1 migration, types regenerated |
| job.tenant_id | 2 | 1 | 1 | 0 | 0 | 1 | 1 | 1 migration, types regenerated |
| job.id | 8 | 6 | 2 | 0 | 0 | 8 | 6 | 1 migration, types regenerated |
| job.run_after | 3 | 2 | 1 | 0 | 0 | 2 | 2 | 1 migration, types regenerated |
| job.kind | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 1 migration, types regenerated |
| job.payload | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 1 migration, types regenerated |

#### Errors in src/exp1.ts on a line that holds no listed reference of that column

| Column | Line | Code | Message |
|---|---:|---|---|
| claim_current.subject_id | 15 | TS2322 | Type 'SelectQueryBuilder<DB & { walk: { depth: any; path: any; entity_id: any; }; } & { c: ClaimCurrent; }, "c", { [x: string]: any; object… |
| claim_current.subject_id | 17 | TS2769 | No overload matches this call. |
| claim_current.subject_id | 35 | TS2769 | No overload matches this call. |
| transcript_segment.id | 72 | TS2769 | No overload matches this call. |
| transcript_segment.id | 111 | TS2769 | No overload matches this call. |
| transcript_segment.session_no | 72 | TS2769 | No overload matches this call. |
| transcript_segment.start_ms | 72 | TS2769 | No overload matches this call. |
| segment_embedding.segment_id | 130 | TS2769 | No overload matches this call. |

#### Per reference

#### Q1

| Line | Column | Form | Result | Evidence |
|---:|---|---|---|---|
| 18 | claim_current.subject_id | typed-string | runtime | observed: column c.subject_id does not exist at character 64 |
| 20 | claim_current.object | raw-sql-text | runtime | observed: column c.object does not exist at character 118 |
| 20 | claim_current.subject_id | raw-sql-text | runtime | observed: column c.subject_id does not exist at character 64 |
| 22 | claim_current.tenant_id | typed-string | compile | TS2345 at L22 |
| 23 | claim_current.object | typed-string | compile | TS2345 at L23 |
| 24 | claim_current.object | raw-sql-text | runtime | observed: column c.object does not exist at character 118 |
| 25 | claim_current.subject_id | typed-string | compile | TS2345 at L25 |
| 31 | claim_current.tenant_id | typed-string | compile | TS2345 at L31 |
| 32 | claim_current.object | typed-string | compile | TS2345 at L32 |
| 33 | claim_current.object | raw-sql-text | runtime | observed: column c.object does not exist at character 118 |
| 36 | claim_current.subject_id | typed-string | runtime | observed: column c.subject_id does not exist at character 64 |
| 38 | claim_current.subject_id | raw-sql-text | runtime | observed: column c.subject_id does not exist at character 64 |
| 41 | claim_current.subject_id | raw-sql-text | runtime | observed: column c.subject_id does not exist at character 64 |
| 48 | entity.id | typed-string | compile | TS2345 at L48 |
| 48 | entity.tenant_id | typed-string | compile | TS2345 at L48 |
| 49 | entity.display_name | typed-string | compile | TS2769 at L49 |

#### Q2

| Line | Column | Form | Result | Evidence |
|---:|---|---|---|---|
| 73 | transcript_segment.id | typed-string | runtime | observed: column s.id does not exist at character 8 |
| 74 | transcript_segment.session_no | typed-string | runtime | observed: column s.session_no does not exist at character 18 |
| 75 | transcript_segment.start_ms | typed-string | runtime | observed: column s.start_ms does not exist at character 51 |
| 76 | transcript_segment.tsv | typed-string | compile | TS2820 at L76 |
| 77 | transcript_segment.text | typed-string | compile | TS2820 at L77 |
| 79 | transcript_segment.tenant_id | typed-string | compile | TS2345 at L79 |
| 80 | transcript_segment.campaign_id | typed-string | compile | TS2345 at L80 |
| 81 | transcript_segment.tsv | typed-string | compile | TS2345 at L81 |
| 83 | transcript_segment.session_no | typed-string | runtime | observed: column s.session_no does not exist at character 18 |
| 84 | transcript_segment.start_ms | typed-string | runtime | observed: column s.start_ms does not exist at character 51 |

#### Q3

| Line | Column | Form | Result | Evidence |
|---:|---|---|---|---|
| 112 | transcript_segment.id | typed-string | runtime | observed: column s.id does not exist at character 23 |
| 115 | transcript_segment.id | typed-string | compile | TS2769 at L115 |
| 115 | transcript_segment.tsv | typed-string | compile | TS2820 at L115 |
| 120 | transcript_segment.tenant_id | typed-string | compile | TS2345 at L120 |
| 121 | transcript_segment.campaign_id | typed-string | compile | TS2345 at L121 |
| 122 | transcript_segment.tsv | typed-string | compile | TS2345 at L122 |
| 129 | segment_embedding.segment_id | typed-string | compile | TS2345 at L129 |
| 129 | segment_embedding.tenant_id | typed-string | compile | TS2345 at L129 |
| 129 | transcript_segment.id | typed-string | compile | TS2345 at L129 |
| 129 | transcript_segment.tenant_id | typed-string | compile | TS2345 at L129 |
| 131 | segment_embedding.segment_id | typed-string | runtime | observed: column e.segment_id does not exist at character 602 |
| 134 | segment_embedding.embedding | raw-sql-text | runtime | observed: column e.embedding does not exist at character 408 |
| 134 | segment_embedding.segment_id | typed-string | compile | TS2769 at L134 |
| 139 | transcript_segment.tenant_id | typed-string | compile | TS2345 at L139 |
| 140 | transcript_segment.campaign_id | typed-string | compile | TS2345 at L140 |

#### Q4

| Line | Column | Form | Result | Evidence |
|---:|---|---|---|---|
| 165 | job.state | typed-set-key | runtime | observed: column "state" does not exist at character 169 |
| 166 | job.locked_by | typed-set-key | runtime | observed: column "locked_by" of relation "job" does not exist at character 32 |
| 167 | job.locked_at | typed-set-key | runtime | observed: column "locked_at" of relation "job" does not exist at character 50 |
| 168 | job.attempts | typed-set-key | compile | TS2345 at L168 |
| 168 | job.attempts | typed-string | compile | TS2345 at L168 |
| 173 | job.id | typed-string | compile | TS2769 at L173 |
| 173 | job.tenant_id | typed-string | compile | TS2769 at L173 |
| 174 | job.state | typed-string | compile | TS2345 at L174 |
| 175 | job.run_after | typed-string | compile | TS2345 at L175 |
| 176 | job.run_after | typed-string | compile | TS2769 at L176 |
| 177 | job.id | typed-string | runtime | observed: column "id" does not exist at character 147 |
| 181 | job.id | raw-sql-text | runtime | observed: column "id" does not exist at character 147 |
| 181 | job.tenant_id | raw-sql-text | runtime | observed: column "tenant_id" does not exist at character 134 |
| 183 | job.attempts | typed-string | compile | TS2769 at L183 |
| 183 | job.id | typed-string | compile | TS2769 at L183 |
| 183 | job.kind | typed-string | compile | TS2769 at L183 |
| 183 | job.payload | typed-string | compile | TS2769 at L183 |
| 192 | job.locked_at | typed-set-key | compile | TS2353 at L192 |
| 192 | job.locked_by | typed-set-key | compile | TS2353 at L192 |
| 192 | job.state | typed-set-key | compile | TS2353 at L192 |
| 193 | job.id | typed-string | compile | TS2345 at L193 |
| 194 | job.locked_by | typed-string | compile | TS2345 at L194 |
| 195 | job.id | typed-string | compile | TS2769 at L195 |
| 195 | job.state | typed-string | compile | TS2769 at L195 |
| 205 | job.attempts | typed-string | compile | TS2345 at L205 |
| 205 | job.state | typed-set-key | runtime | inferred: another statement of Q4 (claimJobs) was rejected (column "state" does not exist… |
| 206 | job.attempts | raw-sql-text | runtime | inferred: another statement of Q4 (claimJobs) was rejected (column "attempts" does not ex… |
| 206 | job.run_after | typed-set-key | runtime | inferred: another statement of Q4 (claimJobs) was rejected (column "run_after" does not e… |
| 207 | job.locked_by | typed-set-key | runtime | inferred: another statement of Q4 (claimJobs) was rejected (column "locked_by" of relatio… |
| 208 | job.locked_at | typed-set-key | runtime | inferred: another statement of Q4 (claimJobs) was rejected (column "locked_at" of relatio… |
| 210 | job.id | typed-string | compile | TS2345 at L210 |
| 211 | job.locked_by | typed-string | compile | TS2345 at L211 |
| 212 | job.attempts | typed-string | compile | TS2769 at L212 |
| 212 | job.id | typed-string | compile | TS2769 at L212 |
| 212 | job.state | typed-string | compile | TS2769 at L212 |

### Kysely (attributed: call-start errors counted)

#### Score

| Query | References | Compile-time | Runtime-only | Passes wrongly | Unaffected | Caught at compile time |
|---|---:|---:|---:|---:|---:|---:|
| Q1 | 16 | 10 | 6 | 0 | 0 | 62.5% |
| Q2 | 10 | 8 | 2 | 0 | 0 | 80.0% |
| Q3 | 15 | 14 | 1 | 0 | 0 | 93.3% |
| Q4 | 35 | 24 | 11 | 0 | 0 | 68.6% |
| **All** | 76 | 56 | 20 | 0 | 0 | 73.7% |

#### Per column

| Column | Refs | Compile | Runtime | Passes wrongly | Unaffected | tsc errors (all files) | tsc errors in exp1.ts | Schema/migration edit |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| claim_current.subject_id | 6 | 3 | 3 | 0 | 0 | 5 | 4 | 1 migration, types regenerated |
| claim_current.object | 5 | 2 | 3 | 0 | 0 | 2 | 2 | 1 migration, types regenerated |
| claim_current.tenant_id | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 1 migration, types regenerated |
| entity.tenant_id | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 1 migration, types regenerated |
| entity.id | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 1 migration, types regenerated |
| entity.display_name | 1 | 1 | 0 | 0 | 0 | 2 | 1 | 1 migration, types regenerated |
| transcript_segment.id | 4 | 4 | 0 | 0 | 0 | 4 | 4 | 1 migration, types regenerated |
| transcript_segment.session_no | 2 | 1 | 1 | 0 | 0 | 1 | 1 | 1 migration, types regenerated |
| transcript_segment.start_ms | 2 | 1 | 1 | 0 | 0 | 1 | 1 | 1 migration, types regenerated |
| transcript_segment.tsv | 4 | 4 | 0 | 0 | 0 | 4 | 4 | 1 migration, types regenerated |
| transcript_segment.text | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 1 migration, types regenerated |
| transcript_segment.tenant_id | 4 | 4 | 0 | 0 | 0 | 4 | 4 | 1 migration, types regenerated |
| transcript_segment.campaign_id | 3 | 3 | 0 | 0 | 0 | 3 | 3 | 1 migration, types regenerated |
| segment_embedding.tenant_id | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 1 migration, types regenerated |
| segment_embedding.segment_id | 3 | 3 | 0 | 0 | 0 | 3 | 3 | 1 migration, types regenerated |
| segment_embedding.embedding | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 1 migration, types regenerated |
| job.state | 6 | 4 | 2 | 0 | 0 | 4 | 4 | 1 migration, types regenerated |
| job.locked_by | 5 | 3 | 2 | 0 | 0 | 3 | 3 | 1 migration, types regenerated |
| job.locked_at | 3 | 1 | 2 | 0 | 0 | 1 | 1 | 1 migration, types regenerated |
| job.attempts | 6 | 5 | 1 | 0 | 0 | 6 | 4 | 1 migration, types regenerated |
| job.tenant_id | 2 | 1 | 1 | 0 | 0 | 1 | 1 | 1 migration, types regenerated |
| job.id | 8 | 6 | 2 | 0 | 0 | 8 | 6 | 1 migration, types regenerated |
| job.run_after | 3 | 2 | 1 | 0 | 0 | 2 | 2 | 1 migration, types regenerated |
| job.kind | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 1 migration, types regenerated |
| job.payload | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 1 migration, types regenerated |

#### Errors in src/exp1.ts on a line that holds no listed reference of that column

| Column | Line | Code | Message |
|---|---:|---|---|
| claim_current.subject_id | 15 | TS2322 | Type 'SelectQueryBuilder<DB & { walk: { depth: any; path: any; entity_id: any; }; } & { c: ClaimCurrent; }, "c", { [x: string]: any; object… |
| claim_current.subject_id | 17 | TS2769 | No overload matches this call. |
| claim_current.subject_id | 35 | TS2769 | No overload matches this call. |
| transcript_segment.id | 72 | TS2769 | No overload matches this call. |
| transcript_segment.id | 111 | TS2769 | No overload matches this call. |
| transcript_segment.session_no | 72 | TS2769 | No overload matches this call. |
| transcript_segment.start_ms | 72 | TS2769 | No overload matches this call. |
| segment_embedding.segment_id | 130 | TS2769 | No overload matches this call. |

#### Per reference

#### Q1

| Line | Column | Form | Result | Evidence |
|---:|---|---|---|---|
| 18 | claim_current.subject_id | typed-string | compile | attributed: TS2769 at L17 (start of the enclosing call) |
| 20 | claim_current.object | raw-sql-text | runtime | observed: column c.object does not exist at character 118 |
| 20 | claim_current.subject_id | raw-sql-text | runtime | observed: column c.subject_id does not exist at character 64 |
| 22 | claim_current.tenant_id | typed-string | compile | TS2345 at L22 |
| 23 | claim_current.object | typed-string | compile | TS2345 at L23 |
| 24 | claim_current.object | raw-sql-text | runtime | observed: column c.object does not exist at character 118 |
| 25 | claim_current.subject_id | typed-string | compile | TS2345 at L25 |
| 31 | claim_current.tenant_id | typed-string | compile | TS2345 at L31 |
| 32 | claim_current.object | typed-string | compile | TS2345 at L32 |
| 33 | claim_current.object | raw-sql-text | runtime | observed: column c.object does not exist at character 118 |
| 36 | claim_current.subject_id | typed-string | compile | attributed: TS2769 at L35 (start of the enclosing call) |
| 38 | claim_current.subject_id | raw-sql-text | runtime | observed: column c.subject_id does not exist at character 64 |
| 41 | claim_current.subject_id | raw-sql-text | runtime | observed: column c.subject_id does not exist at character 64 |
| 48 | entity.id | typed-string | compile | TS2345 at L48 |
| 48 | entity.tenant_id | typed-string | compile | TS2345 at L48 |
| 49 | entity.display_name | typed-string | compile | TS2769 at L49 |

#### Q2

| Line | Column | Form | Result | Evidence |
|---:|---|---|---|---|
| 73 | transcript_segment.id | typed-string | compile | attributed: TS2769 at L72 (start of the enclosing call) |
| 74 | transcript_segment.session_no | typed-string | compile | attributed: TS2769 at L72 (start of the enclosing call) |
| 75 | transcript_segment.start_ms | typed-string | compile | attributed: TS2769 at L72 (start of the enclosing call) |
| 76 | transcript_segment.tsv | typed-string | compile | TS2820 at L76 |
| 77 | transcript_segment.text | typed-string | compile | TS2820 at L77 |
| 79 | transcript_segment.tenant_id | typed-string | compile | TS2345 at L79 |
| 80 | transcript_segment.campaign_id | typed-string | compile | TS2345 at L80 |
| 81 | transcript_segment.tsv | typed-string | compile | TS2345 at L81 |
| 83 | transcript_segment.session_no | typed-string | runtime | observed: column s.session_no does not exist at character 18 |
| 84 | transcript_segment.start_ms | typed-string | runtime | observed: column s.start_ms does not exist at character 51 |

#### Q3

| Line | Column | Form | Result | Evidence |
|---:|---|---|---|---|
| 112 | transcript_segment.id | typed-string | compile | attributed: TS2769 at L111 (start of the enclosing call) |
| 115 | transcript_segment.id | typed-string | compile | TS2769 at L115 |
| 115 | transcript_segment.tsv | typed-string | compile | TS2820 at L115 |
| 120 | transcript_segment.tenant_id | typed-string | compile | TS2345 at L120 |
| 121 | transcript_segment.campaign_id | typed-string | compile | TS2345 at L121 |
| 122 | transcript_segment.tsv | typed-string | compile | TS2345 at L122 |
| 129 | segment_embedding.segment_id | typed-string | compile | TS2345 at L129 |
| 129 | segment_embedding.tenant_id | typed-string | compile | TS2345 at L129 |
| 129 | transcript_segment.id | typed-string | compile | TS2345 at L129 |
| 129 | transcript_segment.tenant_id | typed-string | compile | TS2345 at L129 |
| 131 | segment_embedding.segment_id | typed-string | compile | attributed: TS2769 at L130 (start of the enclosing call) |
| 134 | segment_embedding.embedding | raw-sql-text | runtime | observed: column e.embedding does not exist at character 408 |
| 134 | segment_embedding.segment_id | typed-string | compile | TS2769 at L134 |
| 139 | transcript_segment.tenant_id | typed-string | compile | TS2345 at L139 |
| 140 | transcript_segment.campaign_id | typed-string | compile | TS2345 at L140 |

#### Q4

| Line | Column | Form | Result | Evidence |
|---:|---|---|---|---|
| 165 | job.state | typed-set-key | runtime | observed: column "state" does not exist at character 169 |
| 166 | job.locked_by | typed-set-key | runtime | observed: column "locked_by" of relation "job" does not exist at character 32 |
| 167 | job.locked_at | typed-set-key | runtime | observed: column "locked_at" of relation "job" does not exist at character 50 |
| 168 | job.attempts | typed-set-key | compile | TS2345 at L168 |
| 168 | job.attempts | typed-string | compile | TS2345 at L168 |
| 173 | job.id | typed-string | compile | TS2769 at L173 |
| 173 | job.tenant_id | typed-string | compile | TS2769 at L173 |
| 174 | job.state | typed-string | compile | TS2345 at L174 |
| 175 | job.run_after | typed-string | compile | TS2345 at L175 |
| 176 | job.run_after | typed-string | compile | TS2769 at L176 |
| 177 | job.id | typed-string | runtime | observed: column "id" does not exist at character 147 |
| 181 | job.id | raw-sql-text | runtime | observed: column "id" does not exist at character 147 |
| 181 | job.tenant_id | raw-sql-text | runtime | observed: column "tenant_id" does not exist at character 134 |
| 183 | job.attempts | typed-string | compile | TS2769 at L183 |
| 183 | job.id | typed-string | compile | TS2769 at L183 |
| 183 | job.kind | typed-string | compile | TS2769 at L183 |
| 183 | job.payload | typed-string | compile | TS2769 at L183 |
| 192 | job.locked_at | typed-set-key | compile | TS2353 at L192 |
| 192 | job.locked_by | typed-set-key | compile | TS2353 at L192 |
| 192 | job.state | typed-set-key | compile | TS2353 at L192 |
| 193 | job.id | typed-string | compile | TS2345 at L193 |
| 194 | job.locked_by | typed-string | compile | TS2345 at L194 |
| 195 | job.id | typed-string | compile | TS2769 at L195 |
| 195 | job.state | typed-string | compile | TS2769 at L195 |
| 205 | job.attempts | typed-string | compile | TS2345 at L205 |
| 205 | job.state | typed-set-key | runtime | inferred: another statement of Q4 (claimJobs) was rejected (column "state" does not exist… |
| 206 | job.attempts | raw-sql-text | runtime | inferred: another statement of Q4 (claimJobs) was rejected (column "attempts" does not ex… |
| 206 | job.run_after | typed-set-key | runtime | inferred: another statement of Q4 (claimJobs) was rejected (column "run_after" does not e… |
| 207 | job.locked_by | typed-set-key | runtime | inferred: another statement of Q4 (claimJobs) was rejected (column "locked_by" of relatio… |
| 208 | job.locked_at | typed-set-key | runtime | inferred: another statement of Q4 (claimJobs) was rejected (column "locked_at" of relatio… |
| 210 | job.id | typed-string | compile | TS2345 at L210 |
| 211 | job.locked_by | typed-string | compile | TS2345 at L211 |
| 212 | job.attempts | typed-string | compile | TS2769 at L212 |
| 212 | job.id | typed-string | compile | TS2769 at L212 |
| 212 | job.state | typed-string | compile | TS2769 at L212 |

### Drizzle D2

#### Score

| Query | References | Compile-time | Runtime-only | Passes wrongly | Unaffected | Caught at compile time |
|---|---:|---:|---:|---:|---:|---:|
| Q1 | 16 | 16 | 0 | 0 | 0 | 100.0% |
| Q2 | 10 | 10 | 0 | 0 | 0 | 100.0% |
| Q3 | 15 | 15 | 0 | 0 | 0 | 100.0% |
| Q4 | 37 | 37 | 0 | 0 | 0 | 100.0% |
| **All** | 78 | 78 | 0 | 0 | 0 | 100.0% |

#### Per column

| Column | Refs | Compile | Runtime | Passes wrongly | Unaffected | tsc errors (all files) | tsc errors in exp1.ts | Schema/migration edit |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| claim_current.subject_id | 6 | 6 | 0 | 0 | 0 | 7 | 6 | define.ts:3 lines |
| claim_current.object | 5 | 5 | 0 | 0 | 0 | 9 | 5 | define.ts:1 lines |
| claim_current.tenant_id | 2 | 2 | 0 | 0 | 0 | 8 | 2 | define.ts:6 lines |
| entity.display_name | 1 | 1 | 0 | 0 | 0 | 14 | 1 | m3.ts:1 lines |
| entity.tenant_id | 1 | 1 | 0 | 0 | 0 | 13 | 1 | define.ts:7 lines |
| entity.id | 1 | 1 | 0 | 0 | 0 | 17 | 1 | define.ts:5 lines |
| transcript_segment.tsv | 4 | 4 | 0 | 0 | 0 | 4 | 4 | m4.ts:2 lines |
| transcript_segment.id | 4 | 4 | 0 | 0 | 0 | 5 | 4 | define.ts:2, m4.ts:3 lines |
| transcript_segment.session_no | 2 | 2 | 0 | 0 | 0 | 4 | 2 | define.ts:2, m4.ts:1 lines |
| transcript_segment.start_ms | 2 | 2 | 0 | 0 | 0 | 4 | 2 | define.ts:2, m4.ts:1 lines |
| transcript_segment.text | 1 | 1 | 0 | 0 | 0 | 2 | 1 | define.ts:1, m4.ts:1 lines |
| transcript_segment.tenant_id | 4 | 4 | 0 | 0 | 0 | 7 | 4 | define.ts:4, m4.ts:3 lines |
| transcript_segment.campaign_id | 3 | 3 | 0 | 0 | 0 | 4 | 3 | define.ts:3, m4.ts:1 lines |
| segment_embedding.embedding | 1 | 1 | 0 | 0 | 0 | 1 | 1 | m4.ts:2 lines |
| segment_embedding.segment_id | 3 | 3 | 0 | 0 | 0 | 3 | 3 | m4.ts:3 lines |
| segment_embedding.tenant_id | 1 | 1 | 0 | 0 | 0 | 1 | 1 | m4.ts:3 lines |
| job.tenant_id | 4 | 4 | 0 | 0 | 0 | 4 | 4 | m4.ts:2 lines |
| job.id | 8 | 8 | 0 | 0 | 0 | 8 | 8 | m4.ts:2 lines |
| job.state | 6 | 6 | 0 | 0 | 0 | 6 | 6 | m4.ts:2 lines |
| job.run_after | 3 | 3 | 0 | 0 | 0 | 3 | 3 | m4.ts:2 lines |
| job.attempts | 6 | 6 | 0 | 0 | 0 | 6 | 6 | m4.ts:1 lines |
| job.locked_by | 5 | 5 | 0 | 0 | 0 | 5 | 5 | m4.ts:1 lines |
| job.locked_at | 3 | 3 | 0 | 0 | 0 | 3 | 3 | m4.ts:1 lines |
| job.kind | 1 | 1 | 0 | 0 | 0 | 1 | 1 | m4.ts:1 lines |
| job.payload | 1 | 1 | 0 | 0 | 0 | 1 | 1 | m4.ts:1 lines |

#### Errors in src/exp1.ts on a line that holds no listed reference of that column

(none)

#### Per reference

#### Q1

| Line | Column | Form | Result | Evidence |
|---:|---|---|---|---|
| 24 | claim_current.object | property-in-sql-template | compile | TS2551 at L24 |
| 24 | claim_current.subject_id | property-in-sql-template | compile | TS2551 at L24 |
| 24 | claim_current.subject_id | property-in-sql-template | compile | TS2551 at L24 |
| 26 | claim_current.object | property-in-sql-template | compile | TS2551 at L26 |
| 26 | claim_current.tenant_id | property-in-sql-template | compile | TS2551 at L26 |
| 27 | claim_current.object | property-in-sql-template | compile | TS2551 at L27 |
| 27 | claim_current.subject_id | property-in-sql-template | compile | TS2551 at L27 |
| 29 | claim_current.subject_id | property-in-sql-template | compile | TS2551 at L29 |
| 29 | claim_current.subject_id | property-in-sql-template | compile | TS2551 at L29 |
| 31 | claim_current.object | property-in-sql-template | compile | TS2551 at L31 |
| 31 | claim_current.tenant_id | property-in-sql-template | compile | TS2551 at L31 |
| 32 | claim_current.object | property-in-sql-template | compile | TS2551 at L32 |
| 33 | claim_current.subject_id | property-in-sql-template | compile | TS2551 at L33 |
| 39 | entity.display_name | property | compile | TS2551 at L39 |
| 41 | entity.id | property | compile | TS2339 at L41 |
| 41 | entity.tenant_id | property | compile | TS2551 at L41 |

#### Q2

| Line | Column | Form | Result | Evidence |
|---:|---|---|---|---|
| 56 | transcript_segment.tsv | property-in-sql-template | compile | TS2551 at L56 |
| 59 | transcript_segment.id | property | compile | TS2339 at L59 |
| 60 | transcript_segment.session_no | property | compile | TS2551 at L60 |
| 61 | transcript_segment.start_ms | property | compile | TS2551 at L61 |
| 63 | transcript_segment.text | property-in-sql-template | compile | TS2551 at L63 |
| 66 | transcript_segment.campaign_id | property | compile | TS2551 at L66 |
| 66 | transcript_segment.tenant_id | property | compile | TS2551 at L66 |
| 66 | transcript_segment.tsv | property-in-sql-template | compile | TS2551 at L66 |
| 67 | transcript_segment.session_no | property | compile | TS2551 at L67 |
| 67 | transcript_segment.start_ms | property | compile | TS2551 at L67 |

#### Q3

| Line | Column | Form | Result | Evidence |
|---:|---|---|---|---|
| 80 | transcript_segment.id | property | compile | TS2339 at L80 |
| 80 | transcript_segment.id | property-in-sql-template | compile | TS2339 at L80 |
| 80 | transcript_segment.tsv | property-in-sql-template | compile | TS2551 at L80 |
| 82 | transcript_segment.campaign_id | property | compile | TS2551 at L82 |
| 82 | transcript_segment.tenant_id | property | compile | TS2551 at L82 |
| 82 | transcript_segment.tsv | property-in-sql-template | compile | TS2551 at L82 |
| 86 | segment_embedding.embedding | property-in-sql-template | compile | TS2551 at L86 |
| 89 | segment_embedding.segment_id | property-in-sql-template | compile | TS2551 at L89 |
| 89 | segment_embedding.segment_id | property-in-sql-template | compile | TS2551 at L89 |
| 91 | segment_embedding.segment_id | property | compile | TS2551 at L91 |
| 91 | segment_embedding.tenant_id | property | compile | TS2551 at L91 |
| 91 | transcript_segment.id | property | compile | TS2339 at L91 |
| 91 | transcript_segment.tenant_id | property | compile | TS2551 at L91 |
| 92 | transcript_segment.campaign_id | property | compile | TS2551 at L92 |
| 92 | transcript_segment.tenant_id | property | compile | TS2551 at L92 |

#### Q4

| Line | Column | Form | Result | Evidence |
|---:|---|---|---|---|
| 111 | job.id | property | compile | TS2339 at L111 |
| 111 | job.tenant_id | property | compile | TS2551 at L111 |
| 113 | job.run_after | property | compile | TS2551 at L113 |
| 113 | job.state | property | compile | TS2551 at L113 |
| 114 | job.id | property | compile | TS2339 at L114 |
| 114 | job.run_after | property | compile | TS2551 at L114 |
| 119 | job.attempts | property-in-sql-template | compile | TS2561 at L119 |
| 119 | job.attempts | set-key | compile | TS2561 at L119 |
| 119 | job.locked_at | set-key | compile | TS2561 at L119 |
| 119 | job.locked_by | set-key | compile | TS2561 at L119 |
| 119 | job.state | set-key | compile | TS2561 at L119 |
| 120 | job.id | property-in-sql-template | compile | TS2339 at L120 |
| 120 | job.tenant_id | property-in-sql-template | compile | TS2551 at L120 |
| 121 | job.attempts | property | compile | TS2551 at L121 |
| 121 | job.id | property | compile | TS2339 at L121 |
| 121 | job.kind | property | compile | TS2551 at L121 |
| 121 | job.payload | property | compile | TS2551 at L121 |
| 129 | job.locked_at | set-key | compile | TS2561 at L129 |
| 129 | job.locked_by | set-key | compile | TS2561 at L129 |
| 129 | job.state | set-key | compile | TS2561 at L129 |
| 130 | job.id | property | compile | TS2339 at L130 |
| 130 | job.locked_by | property | compile | TS2551 at L130 |
| 130 | job.tenant_id | property | compile | TS2551 at L130 |
| 131 | job.id | property | compile | TS2339 at L131 |
| 131 | job.state | property | compile | TS2551 at L131 |
| 140 | job.attempts | property-in-sql-template | compile | TS2551 at L140 |
| 140 | job.state | set-key | compile | TS2561 at L140 |
| 141 | job.attempts | property-in-sql-template | compile | TS2551 at L141 |
| 141 | job.run_after | set-key | compile | TS2561 at L141 |
| 142 | job.locked_by | set-key | compile | TS2561 at L142 |
| 143 | job.locked_at | set-key | compile | TS2561 at L143 |
| 145 | job.id | property | compile | TS2339 at L145 |
| 145 | job.locked_by | property | compile | TS2551 at L145 |
| 145 | job.tenant_id | property | compile | TS2551 at L145 |
| 146 | job.attempts | property | compile | TS2551 at L146 |
| 146 | job.id | property | compile | TS2339 at L146 |
| 146 | job.state | property | compile | TS2551 at L146 |

### Drizzle D1

#### Score

| Query | References | Compile-time | Runtime-only | Passes wrongly | Unaffected | Caught at compile time |
|---|---:|---:|---:|---:|---:|---:|
| Q1 | 16 | 0 | 0 | 0 | 16 | 0.0% |
| Q2 | 10 | 0 | 0 | 0 | 10 | 0.0% |
| Q3 | 15 | 0 | 0 | 0 | 15 | 0.0% |
| Q4 | 37 | 0 | 0 | 0 | 37 | 0.0% |
| **All** | 78 | 0 | 0 | 0 | 78 | 0.0% |

#### Per column

| Column | Refs | Compile | Runtime | Passes wrongly | Unaffected | tsc errors (all files) | tsc errors in exp1.ts | Schema/migration edit |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| claim_current.subject_id | 6 | 0 | 0 | 0 | 6 | 0 | 0 | define.ts:1 lines |
| claim_current.object | 5 | 0 | 0 | 0 | 5 | 0 | 0 | define.ts:1 lines |
| claim_current.tenant_id | 2 | 0 | 0 | 0 | 2 | 0 | 0 | define.ts:1 lines |
| entity.display_name | 1 | 0 | 0 | 0 | 1 | 0 | 0 | m3.ts:1 lines |
| entity.tenant_id | 1 | 0 | 0 | 0 | 1 | 0 | 0 | define.ts:1 lines |
| entity.id | 1 | 0 | 0 | 0 | 1 | 0 | 0 | define.ts:1 lines |
| transcript_segment.tsv | 4 | 0 | 0 | 0 | 4 | 0 | 0 | m4.ts:1 lines |
| transcript_segment.id | 4 | 0 | 0 | 0 | 4 | 0 | 0 | define.ts:1, m4.ts:1 lines |
| transcript_segment.session_no | 2 | 0 | 0 | 0 | 2 | 0 | 0 | define.ts:1, m4.ts:1 lines |
| transcript_segment.start_ms | 2 | 0 | 0 | 0 | 2 | 0 | 0 | define.ts:1, m4.ts:1 lines |
| transcript_segment.text | 1 | 0 | 0 | 0 | 1 | 0 | 0 | define.ts:1, m4.ts:1 lines |
| transcript_segment.tenant_id | 4 | 0 | 0 | 0 | 4 | 0 | 0 | define.ts:1, m4.ts:1 lines |
| transcript_segment.campaign_id | 3 | 0 | 0 | 0 | 3 | 0 | 0 | define.ts:1, m4.ts:1 lines |
| segment_embedding.embedding | 1 | 0 | 0 | 0 | 1 | 0 | 0 | m4.ts:1 lines |
| segment_embedding.segment_id | 3 | 0 | 0 | 0 | 3 | 0 | 0 | m4.ts:1 lines |
| segment_embedding.tenant_id | 1 | 0 | 0 | 0 | 1 | 0 | 0 | m4.ts:1 lines |
| job.tenant_id | 4 | 0 | 0 | 0 | 4 | 0 | 0 | m4.ts:1 lines |
| job.id | 8 | 0 | 0 | 0 | 8 | 0 | 0 | m4.ts:1 lines |
| job.state | 6 | 0 | 0 | 0 | 6 | 0 | 0 | m4.ts:1 lines |
| job.run_after | 3 | 0 | 0 | 0 | 3 | 0 | 0 | m4.ts:1 lines |
| job.attempts | 6 | 0 | 0 | 0 | 6 | 0 | 0 | m4.ts:1 lines |
| job.locked_by | 5 | 0 | 0 | 0 | 5 | 0 | 0 | m4.ts:1 lines |
| job.locked_at | 3 | 0 | 0 | 0 | 3 | 0 | 0 | m4.ts:1 lines |
| job.kind | 1 | 0 | 0 | 0 | 1 | 0 | 0 | m4.ts:1 lines |
| job.payload | 1 | 0 | 0 | 0 | 1 | 0 | 0 | m4.ts:1 lines |

#### Errors in src/exp1.ts on a line that holds no listed reference of that column

(none)

#### Per reference

#### Q1

| Line | Column | Form | Result | Evidence |
|---:|---|---|---|---|
| 24 | claim_current.object | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 24 | claim_current.subject_id | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 24 | claim_current.subject_id | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 26 | claim_current.object | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 26 | claim_current.tenant_id | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 27 | claim_current.object | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 27 | claim_current.subject_id | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 29 | claim_current.subject_id | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 29 | claim_current.subject_id | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 31 | claim_current.object | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 31 | claim_current.tenant_id | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 32 | claim_current.object | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 33 | claim_current.subject_id | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 39 | entity.display_name | property | unaffected | nothing stale: code names the property, not the database column |
| 41 | entity.id | property | unaffected | nothing stale: code names the property, not the database column |
| 41 | entity.tenant_id | property | unaffected | nothing stale: code names the property, not the database column |

#### Q2

| Line | Column | Form | Result | Evidence |
|---:|---|---|---|---|
| 56 | transcript_segment.tsv | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 59 | transcript_segment.id | property | unaffected | nothing stale: code names the property, not the database column |
| 60 | transcript_segment.session_no | property | unaffected | nothing stale: code names the property, not the database column |
| 61 | transcript_segment.start_ms | property | unaffected | nothing stale: code names the property, not the database column |
| 63 | transcript_segment.text | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 66 | transcript_segment.campaign_id | property | unaffected | nothing stale: code names the property, not the database column |
| 66 | transcript_segment.tenant_id | property | unaffected | nothing stale: code names the property, not the database column |
| 66 | transcript_segment.tsv | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 67 | transcript_segment.session_no | property | unaffected | nothing stale: code names the property, not the database column |
| 67 | transcript_segment.start_ms | property | unaffected | nothing stale: code names the property, not the database column |

#### Q3

| Line | Column | Form | Result | Evidence |
|---:|---|---|---|---|
| 80 | transcript_segment.id | property | unaffected | nothing stale: code names the property, not the database column |
| 80 | transcript_segment.id | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 80 | transcript_segment.tsv | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 82 | transcript_segment.campaign_id | property | unaffected | nothing stale: code names the property, not the database column |
| 82 | transcript_segment.tenant_id | property | unaffected | nothing stale: code names the property, not the database column |
| 82 | transcript_segment.tsv | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 86 | segment_embedding.embedding | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 89 | segment_embedding.segment_id | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 89 | segment_embedding.segment_id | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 91 | segment_embedding.segment_id | property | unaffected | nothing stale: code names the property, not the database column |
| 91 | segment_embedding.tenant_id | property | unaffected | nothing stale: code names the property, not the database column |
| 91 | transcript_segment.id | property | unaffected | nothing stale: code names the property, not the database column |
| 91 | transcript_segment.tenant_id | property | unaffected | nothing stale: code names the property, not the database column |
| 92 | transcript_segment.campaign_id | property | unaffected | nothing stale: code names the property, not the database column |
| 92 | transcript_segment.tenant_id | property | unaffected | nothing stale: code names the property, not the database column |

#### Q4

| Line | Column | Form | Result | Evidence |
|---:|---|---|---|---|
| 111 | job.id | property | unaffected | nothing stale: code names the property, not the database column |
| 111 | job.tenant_id | property | unaffected | nothing stale: code names the property, not the database column |
| 113 | job.run_after | property | unaffected | nothing stale: code names the property, not the database column |
| 113 | job.state | property | unaffected | nothing stale: code names the property, not the database column |
| 114 | job.id | property | unaffected | nothing stale: code names the property, not the database column |
| 114 | job.run_after | property | unaffected | nothing stale: code names the property, not the database column |
| 119 | job.attempts | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 119 | job.attempts | set-key | unaffected | nothing stale: code names the property, not the database column |
| 119 | job.locked_at | set-key | unaffected | nothing stale: code names the property, not the database column |
| 119 | job.locked_by | set-key | unaffected | nothing stale: code names the property, not the database column |
| 119 | job.state | set-key | unaffected | nothing stale: code names the property, not the database column |
| 120 | job.id | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 120 | job.tenant_id | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 121 | job.attempts | property | unaffected | nothing stale: code names the property, not the database column |
| 121 | job.id | property | unaffected | nothing stale: code names the property, not the database column |
| 121 | job.kind | property | unaffected | nothing stale: code names the property, not the database column |
| 121 | job.payload | property | unaffected | nothing stale: code names the property, not the database column |
| 129 | job.locked_at | set-key | unaffected | nothing stale: code names the property, not the database column |
| 129 | job.locked_by | set-key | unaffected | nothing stale: code names the property, not the database column |
| 129 | job.state | set-key | unaffected | nothing stale: code names the property, not the database column |
| 130 | job.id | property | unaffected | nothing stale: code names the property, not the database column |
| 130 | job.locked_by | property | unaffected | nothing stale: code names the property, not the database column |
| 130 | job.tenant_id | property | unaffected | nothing stale: code names the property, not the database column |
| 131 | job.id | property | unaffected | nothing stale: code names the property, not the database column |
| 131 | job.state | property | unaffected | nothing stale: code names the property, not the database column |
| 140 | job.attempts | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 140 | job.state | set-key | unaffected | nothing stale: code names the property, not the database column |
| 141 | job.attempts | property-in-sql-template | unaffected | nothing stale: code names the property, not the database column |
| 141 | job.run_after | set-key | unaffected | nothing stale: code names the property, not the database column |
| 142 | job.locked_by | set-key | unaffected | nothing stale: code names the property, not the database column |
| 143 | job.locked_at | set-key | unaffected | nothing stale: code names the property, not the database column |
| 145 | job.id | property | unaffected | nothing stale: code names the property, not the database column |
| 145 | job.locked_by | property | unaffected | nothing stale: code names the property, not the database column |
| 145 | job.tenant_id | property | unaffected | nothing stale: code names the property, not the database column |
| 146 | job.attempts | property | unaffected | nothing stale: code names the property, not the database column |
| 146 | job.id | property | unaffected | nothing stale: code names the property, not the database column |
| 146 | job.state | property | unaffected | nothing stale: code names the property, not the database column |
## Rerun on TypeScript 7.0.2 and schema-source references

### Test harness fix

`pnpm test` failed in both stable arms with TS1295, TS1287 and TS1470 in `reference/exp4b-common.ts` (a CommonJS-typed file using ESM syntax). The file is now `reference/exp4b-common.mts` and the three exp4b scripts and the renderer import it by that name. The code is unchanged, so the scripts measure the same thing. `tsc --noEmit` exits 0 in both arms.

### Kysely 4b on TypeScript 7.0.2

Run in a scratch copy outside the repo (`C:\Users\walte\dev\scratch\ts7`) with TypeScript 7.0.2 installed there (pnpm, `--store-dir C:\Users\walte\dev\.pnpm-store`). The arm's `package.json` and lockfile were not touched. Same 25 columns, same references, same classification and attribution code (the renderer and `exp4b-common.mts` are copies of the repo's). Databases were prefixed `rename2_` for this run (the scratch script's prefix was changed from `rename_`; the repo script still uses `rename_`). Kysely 0.29.6, kysely-codegen 0.20.0, vitest 4.1.11 unchanged. Baseline: codegen matches the committed types, 0 tsc errors, all tests pass. All 25 columns reverted cleanly.

| Kysely | References | Compile-time on 5.9.3 | Compile-time on 7.0.2 | Runtime-only (5.9.3 / 7.0.2) | Passes wrongly |
|---|---:|---:|---:|---:|---:|
| Strict | 76 | 49 (64.5%) | 49 (64.5%) | 27 / 27 | 0 / 0 |
| Attributed | 76 | 56 (73.7%) | 56 (73.7%) | 20 / 20 | 0 / 0 |

Per query (strict / attributed) is also identical: Q1 50.0% / 62.5%, Q2 50.0% / 80.0%, Q3 80.0% / 93.3%, Q4 68.6% / 68.6%.

Differences between the two versions: none in the scores. A comparison of the raw data found the same set of tsc errors (file, line, code) for all 25 columns, and the same test outcomes. The only textual difference is the order of properties inside one printed type in a TS2322 message (claim_current.subject_id, L15), which does not affect attribution.

What this tells us:
- TS2769 is still reported at the start of the `.select([...])` call and not at the failing element on 7.0.2, so the gap between strict and attributed (7 references) is not a TypeScript 5 artefact.
- The three typed references that the earlier note suspected of masking (L83 `s.session_no`, L84 `s.start_ms`, L177 `job.id`) are still not reported separately on 7.0.2, so the masking is not specific to 5.9.3. Whether they would be errors in isolation is still unverified.
- The earlier caveat that the arms' TypeScript majors might change error positions is answered for Kysely: no change.

### Schema-source references (the auditor's alternative)

The score above counts only references in `src/exp1.ts`. Both arms also hold column names in raw SQL text outside the query code, which tsc does not check. Counted here, only for the 25 columns:

Drizzle (schema source), 12 references:
- `pgPolicy` text in `m4.ts` `isolation()`: `tenant_id = ...` in `using` and in `withCheck`, applied to transcript_segment, segment_embedding and job: 2 text occurrences, 6 references per use.
- `define.ts`: entity policy (tenant_id), claim_current policy (tenant_id), transcript_segment policy (tenant_id), check `end_ms >= start_ms` (start_ms): 4.
- tsvector expression `to_tsvector(ts_config, text)`: 1 (text).
- `job_ready_idx` predicate `state = 'queued'`: 1 (state).
- Sensitivity: counting each policy once instead of using and withCheck separately gives 9.

Kysely (migration SQL), 16 references (11 with each policy counted once): the same kinds of text in `reference/exp1-m4.sql` and the committed migrations (policies on entity, claim_current, segment_embedding and job, the job state CHECK, the tsvector expression, the `job_ready_idx` predicate, the `claim_current_object_entity_idx` expression and predicate). Index column lists and foreign keys in the migrations are not counted, since Drizzle's counterparts are property references. This is the less certain of the two counts, because it was enumerated by hand in one pass.

Classification, same rules as above: tsc reports nothing for any of them, and no Experiment 1 test exercises the raw text (Postgres `RENAME COLUMN` rewrites policies, check constraints, index predicates and generated expressions in the live database, so the database keeps working and the source text is simply stale). Verified against the Drizzle D1 data: with the database name renamed only, no `exp1.ts` reference and no raw schema reference produces a tsc error. All of them classify as passes wrongly (undetected).

| Arm | References | Compile-time | Share caught at compile time | With policies counted once |
|---|---:|---:|---:|---:|
| Drizzle D2, `exp1.ts` only | 78 | 78 | 100% | 100% |
| Drizzle D2, plus 12 schema-source | 90 | 78 | 86.7% | 89.7% (87 refs) |
| Kysely strict, `exp1.ts` only | 76 | 49 | 64.5% | 64.5% |
| Kysely strict, plus 16 migration | 92 | 49 | 53.3% | 56.3% (87 refs) |
| Kysely attributed, `exp1.ts` only | 76 | 56 | 73.7% | 73.7% |
| Kysely attributed, plus 16 migration | 92 | 56 | 60.9% | 64.4% (87 refs) |

Passes wrongly goes from 0 to 12 (9) in Drizzle and from 0 to 16 (11) in Kysely. Drizzle's lead shrinks from about 35 points (strict) to about 33 points but stays: the raw text is a similar absolute burden in both, and Drizzle's larger count of checked references keeps its share higher. The two raw counts are not directly comparable, because Drizzle's schema source is the single place a developer edits, while Kysely's raw text sits in historical migrations that should not be edited after they ship (a rename adds a new migration, which restates the policy), so for Kysely the stale text matters less in practice than the count suggests. A real rename in an IDE would also not touch either raw set.
