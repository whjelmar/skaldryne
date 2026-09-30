# 0005 — PostgreSQL holds the record, the search indexes, and the job queue

**Status:** Proposed · **Date:** 2026-09-30 · **Serves:** `MODEL-01`, `MODEL-11`, `MODEL-13`, `QRY-01`, `PIPE-08`, `NFR-01`, `NFR-04`, `NFR-18`, `SHARE-06`

## Context

The record needs relational structure (entities, claims, evidence, corrections), full-text and semantic search across it (`QRY-01`), visibility enforced on every read (`MODEL-13`), and durable pipeline jobs (`PIPE-08`). It must install with one command (`NFR-01`), so every extra service is a cost to every operator.

## Decision

**One PostgreSQL database holds the record, both search indexes, and the job queue. Media files live on disk, outside the database.**

- **Record:** ordinary tables for campaigns, entities, sources, claims, evidence, and history ([0006](0006-record-model.md)).
- **Full-text search:** PostgreSQL's built-in text search, with a dictionary configured per campaign language.
- **Semantic search:** the `pgvector` extension, with embeddings stored next to the rows they describe.
- **Hybrid search:** both result lists are merged by rank fusion, then filtered by the same visibility rules as everything else ([0007](0007-visibility-enforcement.md)).
- **Visibility:** row-level security policies ([0007](0007-visibility-enforcement.md)).
- **Jobs:** a queue table read with `FOR UPDATE SKIP LOCKED` ([0009](0009-pipeline-execution.md)). No separate message broker.
- **Media:** raw audio, transcripts' source files, and exports live in a storage directory on disk, addressed by content hash and encrypted with a per-instance key. The database stores references, never media bytes.
- **Encryption at rest:** media is encrypted by the application. The database volume is expected to sit on encrypted storage, and provider keys are stored encrypted with the instance key, never in plain text (`NFR-18`).
- **Schema changes** are plain SQL migrations, applied in order on upgrade, and tested against a copy of the previous release's schema (`NFR-01`).

## Consequences

- One stateful service to install, back up, and upgrade. A backup is a database dump plus the media directory.
- Visibility, search, and records share one transaction, so a search can never see a claim that the same query could not read.
- The ceiling on vector search is lower than a dedicated vector database's. At the campaign sizes the PRD targets (`NFR-14`), that ceiling is far away.
- Embeddings must be recomputed when the embedding model changes; each embedding records the model that made it.

## Alternatives considered

- **SQLite with extensions.** Simpler still, and attractive for a single-user install. Rejected: row-level security has no equivalent, concurrent pipeline workers contend for one writer, and the move to a hosted offering (`NFR-16`) would force a migration later.
- **A dedicated vector database alongside PostgreSQL.** Rejected: a second service to install and keep in sync, and visibility would have to be enforced twice.
- **A separate message broker for jobs.** Rejected: a third service for a workload the database handles at this scale.
