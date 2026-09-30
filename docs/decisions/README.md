# Decision Records

Each file here records one decision: what was decided, why, what else was considered, and what it costs. The [PRD](../../PRD.md) says what Skaldryne must do. These records say how, and which product questions the PRD left open have been answered.

## How a record works

- **One decision per file**, numbered in the order it was written: `NNNN-short-title.md`. Numbers are never reused.
- **Status** is one of:
  - **Proposed:** written and waiting for a maintainer's approval.
  - **Accepted:** approved; the work follows it.
  - **Superseded by NNNN:** replaced by a later record, and kept for history.
  - **Rejected:** considered and declined, and kept so the question is not reopened without new information.
- **A record is not edited once accepted**, except to change its status. Changing a decision means writing a new record that supersedes it.
- **Every record links the requirements it serves** by ID, and names the PRD open decision it answers, if any (PRD §18).
- **Sections:** Context, Decision, Consequences, and Alternatives considered. Add a Follow-up section when the decision leaves work or a later decision behind it.

## Index

| # | Decision | Status | Answers | Needed by |
| --- | --- | --- | --- | --- |
| [0001](0001-default-inference-configuration.md) | Local models are the default inference configuration | Proposed | Open decision 1 | 0a |
| [0002](0002-evaluation-fixture-sources.md) | Evaluation fixtures start scripted, and real sessions join later with a release | Proposed | Open decision 3 | 0a |
| [0003](0003-local-reference-hardware.md) | One named reference machine for the local path | Proposed | Open decision 4 | 0a |
| [0004](0004-language-runtime-and-repository.md) | TypeScript on Bun, in one repository | Proposed | — | 0a |
| [0005](0005-record-storage.md) | PostgreSQL holds the record, the search indexes, and the job queue | Proposed | — | 0a |
| [0006](0006-record-model.md) | Claims are append-only, and redaction is the one erasure | Proposed | — | 0a |
| [0007](0007-visibility-enforcement.md) | Visibility is enforced by the database, and model context is built by one audience-scoped reader | Proposed | — | 0a |
| [0008](0008-inference-backend-interface.md) | One interface per model capability, with adapters behind it | Proposed | — | 0a |
| [0009](0009-pipeline-execution.md) | Pipeline stages are durable, idempotent jobs | Proposed | — | 0a |
| [0010](0010-deployment.md) | One container composition, started with one command | Proposed | — | 0a |

## Not yet decided

These are needed later and are deliberately left open until then.

| Question | Needed by | Notes |
| --- | --- | --- |
| Quality thresholds and the backend qualification floor (PRD open decision 2) | 0a exit | Set from a baseline run on the fixtures of [0002](0002-evaluation-fixture-sources.md), not guessed in advance. |
| Web interface framework | 0a | The 0a interface is small (upload, review, read, search). Decide once the review screen is sketched. |
| Authentication and single sign-on library | 0b | Needed for `SHARE-07`. |
| Default retention window for raw audio (PRD open decision 5) | 0b | |
| Object storage beyond the local disk | 1c | Video makes media storage large enough to matter (`NFR-11`). |
