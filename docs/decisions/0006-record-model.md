# 0006 — Record model

**Status:** Open · **Date:** 2026-09-30 · **Serves:** `MODEL-01`, `MODEL-09`, `MODEL-10`, `MODEL-11`, `PIPE-04`, `PIPE-05`, `PIPE-07`, `TPL-04`, `OUT-10`, `SAFE-01`, `OWN-04`

## Context

The PRD makes the structured record primary and prose a rendering of it (`MODEL-01`). Every claim carries evidence, confidence, and the versions that produced it (`MODEL-09`, `TPL-04`). Corrections keep the old value (`MODEL-11`). Nothing reaches the record without review (`PIPE-05`). And redaction must remove a span everywhere (`SAFE-01`), which an append-only history would otherwise keep forever.

## Recommendation

**Recommended, not decided:** the design below.

### Sources and evidence

- **A source** is anything evidence can point into: a recording, a transcript version, an uploaded document, a journal entry. Sources are immutable once written. Retranscribing creates a new transcript version rather than changing the old one.
- **Evidence is a range**, never a point: a source, a start and an end (time for media, character offsets for text), and the transcript version it was read from. A claim may have several evidence ranges.

### Claims and their history

- **A claim** is a typed assertion about an entity: subject, predicate, value, visibility, and the session that established it.
- **Every change is a new row.** A claim's history is a chain of versions: proposed, accepted, corrected, retracted. Nothing is updated in place. The current record is a view over the latest accepted version of each claim.
- **Each version records** who or what made it (a pipeline run, a reviewer, a correction), when, why if given, its confidence and the signals behind it (`MODEL-10`), and the model, backend, and template versions that produced it (`TPL-04`).
- **Proposals and canon share one table**, separated by state. Unreviewed proposals are excluded from every read except review itself ([0007](0007-visibility-enforcement.md)), which is how `PIPE-05` is enforced.
- **A review diff** is the set of proposals from one pipeline run, compared with current canon (`PIPE-04`).
- **Reprocessing is idempotent** (`PIPE-07`): a proposal carries a key derived from its source range and content, so a rerun matches existing claims rather than duplicating them, and accepted corrections are never overwritten by a rerun.

### Rendered outputs

- **Outputs are caches, never sources.** A recap stores the claim versions it was rendered from. When any of them changes, the output is marked stale and regenerated on next read (`OUT-10`).

### Redaction

- **Redaction is the one operation that erases.** It deletes the redacted bytes: the media range is cut and re-encoded, transcript text in the range is replaced by a marker, and every claim version whose only evidence lies in the range is deleted, along with outputs rendered from them.
- **A redaction ledger** records what was redacted by reference only: source, range, who, and when, with no content. The ledger is reapplied on export import, and on backup restore once backups exist (`SAFE-01`).
- **History gaps are visible.** A claim chain that lost versions to redaction shows that something was removed, not what.

## Consequences if adopted

- The record can always answer who changed what and when, and why a claim exists (`OWN-04`).
- Storage grows with every correction and rerun. At the campaign sizes targeted, that growth is small next to media.
- The current-record view must be fast. It is a materialised or indexed view maintained on every accepted change.
- Redaction is the one path that can destroy data, so it is small, heavily tested, and always writes to the ledger before deleting.

## Options considered

- **Mutable records with an audit log beside them.** Simpler queries, but the audit log becomes the real history and the two can disagree. Not recommended.
- **Full event sourcing, with the record rebuilt by replaying every event.** Clean in theory, but redaction then means rewriting the event log, and replays grow slow. The recommended design keeps history per claim, which is what the product needs.
- **Soft-deleting redacted content.** Not recommended: `SAFE-01` requires the content to be gone, not hidden.

## To decide

Append-only claims with redaction as the one erasure, mutable records with an audit log, or full event sourcing? When a maintainer decides, this record becomes Proposed or Accepted with the chosen option, or is replaced by a record that states it.
