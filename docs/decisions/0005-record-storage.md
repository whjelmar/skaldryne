# 0005 — PostgreSQL holds the record, the search indexes, and the job queue

**Status:** Proposed · **Date:** 2026-09-30 · **Serves:** `MODEL-01`, `MODEL-11`, `MODEL-13`, `QRY-01`, `PIPE-08`, `NFR-01`, `NFR-04`, `NFR-14`, `NFR-18`, `SAFE-01`, `SHARE-06`

## Context

The record needs relational structure (entities, claims, evidence, corrections), full-text and semantic search across it (`QRY-01`), visibility enforced on every read (`MODEL-13`), and durable pipeline jobs (`PIPE-08`). It must install with one command (`NFR-01`), so every extra service is a cost to every operator.

## Decision

**One PostgreSQL database holds the record, both search indexes, and the job queue. Media files live on disk, outside the database.**

- **Record:** ordinary tables for campaigns, entities, sources, claims, evidence, and history ([0006](0006-record-model.md)).
- **Relationships are claims** whose value is another entity, so the campaign's graph lives in the same tables, under the same visibility rules. The questions the product asks are mostly one to three hops ("who knows about the cult, and through whom?"), which recursive queries answer at the campaign sizes targeted (`NFR-14`).
- **Game-system attributes** that differ between systems (stats, sheets, custom entity fields) are stored as validated JSON columns beside the relational core, not as new tables per system.
- **Full-text search:** PostgreSQL's built-in text search, with a dictionary configured per campaign language.
- **Semantic search:** the `pgvector` extension, with embeddings stored next to the rows they describe.
- **Hybrid search:** both result lists are merged by rank fusion, then filtered by the same visibility rules as everything else ([0007](0007-visibility-enforcement.md)).
- **Visibility:** row-level security policies ([0007](0007-visibility-enforcement.md)).
- **Jobs:** a queue table read with `FOR UPDATE SKIP LOCKED` ([0009](0009-pipeline-execution.md)). No separate message broker.
- **Media:** raw audio, transcripts' source files, and exports live in a storage directory on disk, addressed by content hash and encrypted with a per-instance key. The database stores references, never media bytes.
- **Encryption at rest:** media is encrypted by the application. The database volume is expected to sit on encrypted storage, and provider keys are stored encrypted with the instance key, never in plain text (`NFR-18`).
- **Plain text is an export, not the storage.** The Markdown-plus-wikilink bundle (`SHARE-06`) gives operators a readable, portable copy of everything they can see, generated from the database under the same visibility rules.
- **Schema changes** are plain SQL migrations, applied in order on upgrade, and tested against a copy of the previous release's schema (`NFR-01`).

## Consequences

- One stateful service to install, back up, and upgrade. A backup is a database dump plus the media directory.
- Visibility, search, and records share one transaction, so a search can never see a claim that the same query could not read.
- The ceiling on vector search is lower than a dedicated vector database's. At the campaign sizes the PRD targets (`NFR-14`), that ceiling is far away.
- Embeddings must be recomputed when the embedding model changes; each embedding records the model that made it.

## Alternatives considered

- **SQLite with extensions.** Simpler still, and attractive for a single-user install. Rejected: row-level security has no equivalent, concurrent pipeline workers contend for one writer, and the move to a hosted offering (`NFR-16`) would force a migration later.
- **A dedicated vector database alongside PostgreSQL.** Rejected: a second service to install and keep in sync, and visibility would have to be enforced twice.
- **A graph database.** The record is shaped like a graph, and multi-hop questions are natural to write in a graph query language. Rejected: per-record access control is limited or sold separately in the available engines, so visibility would move back into application code, which [0007](0007-visibility-enforcement.md) exists to prevent. Search and jobs would need further services, and erasing a span atomically across the graph and its indexes is harder. If deep traversal ever becomes a real need, a graph query extension for PostgreSQL can add it inside the same database and policies.
- **A document database.** Flexible fields suit game-system attributes, and rendered pages are naturally documents. Rejected: claims are small records full of cross-references (claim to entity, evidence to source, version to version), which is relational work; there is no row-level security; and redacting one span across many documents in one transaction is harder. JSON columns in PostgreSQL cover the flexible part.
- **Plain-text files under version control.** Best for readability and portability, with history for free. Rejected as the source of truth: a file cannot hide one paragraph from one reader; redaction would mean rewriting history in every copy of the repository, against `SAFE-01`; concurrent pipeline workers have no transactions; and search would still need a separate index. Its strengths are delivered by the Markdown export instead.
- **A separate message broker for jobs.** Rejected: a third service for a workload the database handles at this scale.
