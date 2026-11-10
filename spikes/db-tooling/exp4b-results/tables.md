
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