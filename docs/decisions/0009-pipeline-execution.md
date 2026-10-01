# 0009 — Pipeline execution

**Status:** Open · **Date:** 2026-09-30 · **Serves:** `PIPE-01`–`PIPE-05`, `PIPE-07`, `PIPE-08`, `INF-05`, `INF-06`, `CAP-07`, `NFR-05`

## Context

Processing a four-hour session takes hours and passes through several backends. Any stage can fail: a provider rate-limits, a model server restarts, the machine reboots. The PRD requires that a failed stage resume without re-uploading or redoing finished stages (`PIPE-08`), that reruns never duplicate or overwrite reviewed work (`PIPE-07`), and that raw audio be deleted only after processing succeeds (`CAP-07`).

## Recommendation

**Recommended, not decided:** Each session is processed as a chain of stages. Each stage is a durable job whose output is stored before the next stage starts.

### Stages for 0a

1. **Ingest:** store the upload by content hash, read its metadata, and check its limits (`NFR-05`).
2. **Transcribe:** speech recognition, with the campaign glossary as vocabulary hints (`CAP-28`).
3. **Separate speakers:** speaker turns, labelled per session until voice profiles exist in 0b.
4. **Segment:** mark in-character and out-of-character stretches (`PIPE-03`).
5. **Extract:** propose claims with evidence ranges (`PIPE-01`).
6. **Verify:** check each claim's citations in a separate call (`PIPE-02`).
7. **Resolve:** match proposed entities to existing ones and aliases (`MODEL-23`).
8. **Diff:** compare proposals with canon and open review (`PIPE-04`).

Rendering outputs happens after review, on demand, and is not part of this chain.

### How jobs run

- **Jobs live in the database queue** ([0005](0005-record-storage.md)). A worker claims one, runs it, stores its output, and enqueues the next stage in the same transaction.
- **Each stage's output is stored and addressed by the hash of its inputs** (source, configuration, model, and template versions). Rerunning a stage whose inputs are unchanged reuses the stored output.
- **Retryable failures** back off and retry on their own, and the session shows the stage, the reason, and when the next attempt is (`INF-06`). **Other failures** stop the chain and wait for the operator.
- **A resumed session starts from the first stage without stored output.** Nothing already finished runs again.
- **Raw audio is deleted by a final step** that runs only after every stage has succeeded, when the campaign's retention choice is delete (`CAP-07`).
- **Workers are separate processes** from the web server, so a long session never slows the interface.
- **Each job records its cost and duration** (`INF-05`), summed per session and stage.

### Long sessions

Transcription and extraction work in overlapping windows, so memory stays bounded and a failure loses only one window. Extraction receives the running entity list so that names stay consistent across windows.

## Consequences if adopted

- A failure never costs the upload or the finished stages.
- Changing a template reruns only the stages downstream of it, which also serves re-extraction later (`PIPE-14`).
- Stored intermediate outputs take disk space. They are kept until the session is accepted, then pruned to what evidence and provenance need.
- Windowed extraction can miss facts that span a window boundary. The overlap is sized to make that rare, and the fixtures include a fact stated across a boundary.

## Options considered

- **One long-running process per session.** Simplest, but any failure restarts the whole session. Not recommended by `PIPE-08`.
- **A workflow engine as a separate service.** Durable and well tested, but another service to install for a chain of eight steps.
- **Sending the whole session to the model at once.** Not recommended: context limits vary by backend, local models have small contexts, and one failure loses everything.

## To decide

Durable jobs on the database queue, a workflow engine, or one process per session? When a maintainer decides, this record becomes Proposed or Accepted with the chosen option, or is replaced by a record that states it.
