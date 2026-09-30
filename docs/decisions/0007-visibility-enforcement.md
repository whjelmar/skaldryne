# 0007 — Visibility is enforced by the database, and model context is built by one audience-scoped reader

**Status:** Proposed · **Date:** 2026-09-30 · **Serves:** `MODEL-12`, `MODEL-13`, `QRY-04`, `OUT-09`, `PIPE-05`, `PIPE-13`, `SHARE-01`

## Context

Keeping the GM's secrets is the product's central promise. Every record carries a visibility level (`MODEL-12`), and that level must hold in the interface, the API, search, and, above all, inside AI retrieval and rendering (`MODEL-13`, `QRY-04`, `OUT-09`). The PRD requires that a player-safe render be built only from what players may see, so that a model is never given a secret it could then leak (`PIPE-13`).

Checks written in application code are easy to miss in one query out of hundreds. Filtering a model's output afterwards is too late.

## Decision

**The database enforces visibility on every read, and all model context is assembled through one component that reads as the audience.**

### In the database

- **Every table that holds campaign content has row-level security.** Each request runs as a database role with no way around the policies, and sets its audience at the start of the transaction: the campaign, the person, and their role.
- **Policies decide what the audience can see** from the row's visibility, the person's role (`SHARE-01`), and the review state. Unreviewed proposals are visible only to reviewers (`PIPE-05`).
- **Search runs under the same policies**, so counts, snippets, and rankings never reflect rows the asker cannot read (`QRY-04`).
- **The application connects with a role that cannot bypass these policies.** Only migrations and the redaction job run with elevated rights, each with its own role.

### For models

- **One component, the audience-scoped reader, builds every model context** used for rendering or answering: recaps, catch-up briefs, compendium entries, and campaign chat.
- **It opens its own transaction as the target audience**, not as the requester. A player-safe recap requested by the GM is built as a player reads it, so it cannot contain anything a player could not read.
- **Each output variant has its own context.** The GM-private and player-safe variants of a recap (`OUT-09`) are two renders from two contexts, never one render that is filtered afterwards.
- **Extraction is the exception:** it reads source material as the GM, because it proposes claims for review. Its output is proposals only, and it never renders for an audience.
- **Source text is placed in a data section of the prompt, never in the instructions** (`PIPE-13`), and every model output that would change the record becomes a proposal.

### Testing

- **Every policy has tests that attempt forbidden reads** as each role.
- **The evaluation suite's leak tests** ([0002](0002-evaluation-fixture-sources.md)) render every output for every audience and search each for the planted secrets.

## Consequences

- A missing check in application code cannot leak a secret, because the database refuses the row.
- A player-safe output cannot contain a secret even if a planted instruction asks the model to reveal one, because the secret was never in its context.
- Every request pays the cost of setting its audience, and policies make some queries slower. Indexes on visibility and campaign columns keep that small.
- Debugging becomes harder when a query silently returns fewer rows. Tooling that runs a query as a named audience is part of the developer setup.

## Alternatives considered

- **Visibility checks in application code only.** Rejected: one forgotten filter is a leak, and there will be hundreds of queries.
- **Filtering model output for secrets after rendering.** Rejected: a model can paraphrase a secret, and the PRD forbids relying on this.
- **Separate databases or schemas per audience.** Strong isolation, but every claim would be copied, and visibility changes would mean moving data between stores.
