# 0009 — Pipeline execution

**Status:** Accepted · **Date:** 2026-11-09 · **Serves:** `PIPE-01`–`PIPE-05`, `PIPE-07`, `PIPE-08`, `PIPE-13`, `MODEL-07`, `MODEL-36`, `INF-05`, `INF-06`, `INF-08`, `CAP-07`, `CAP-28`, `NFR-05`, `NFR-25`

## Context

Processing a four-hour session takes hours and passes through several backends. Any stage can fail: a provider rate-limits, a model server restarts, the machine reboots. The PRD requires that a failed stage resume without re-uploading or redoing finished stages (`PIPE-08`), that reruns never duplicate or overwrite reviewed work (`PIPE-07`), and that raw audio be deleted only after processing succeeds (`CAP-07`).

Not every source is a recording. Journals and GM prep are text (`MODEL-07`), and a source can come back edited, in which case its evidence must follow the edit (`MODEL-36`, [0006](0006-record-model.md)). On the reference machine ([0003](0003-local-reference-hardware.md)) one GPU serves both speech and language models and cannot hold them all at once.

## Decision

Each session is processed as a chain of stages. Each stage is a durable job whose output is stored before the next stage starts.

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

### Text sources and new versions

- **Text sources skip the audio stages.** A journal, prep document, or pasted notes is ingested, split into blocks with stable identifiers ([0006](0006-record-model.md)), and then segmented, extracted, verified, resolved, and diffed like a session. GM prep is marked as planned at ingest so it is never proposed as played.
- **A new version of an existing source starts with a match stage.** Ingest recognises the source, writes the new version, and matches its blocks against the previous version. Evidence on unchanged blocks is carried over; claims on changed or deleted blocks are marked as 0006 describes. Extraction then runs only on changed and new blocks, and the diff shows what the edit added, changed, or removed.
- **Re-importing identical content creates nothing.** Ingest finds the content hash already stored and reuses the existing source version (`NFR-25`).

### How jobs run

- **Jobs live in the database queue** ([0005](0005-record-storage.md)). A worker claims one, runs it, stores its output, and enqueues the next stage in the same transaction.
- **Each stage's output is stored and addressed by the hash of its inputs**: the source version, the stage's configuration, the backend and model chosen for that stage ([0008](0008-inference-backend-interface.md)), the template version, and, for transcription and extraction, the glossary version (`CAP-28`). Rerunning a stage whose inputs are unchanged reuses the stored output, and a changed glossary reruns transcription and everything after it.
- **Each backend has a concurrency limit**, set in configuration. A worker claims a job only when the backend that job needs has a free slot, so jobs wait in the queue rather than fail for lack of memory. A local backend defaults to one slot, and a GPU shared by several local backends is declared once so that only one of them runs at a time. Hosted backends default to a few slots, lowered automatically while they rate-limit.
- **Jobs read as the GM and write only proposals.** Extraction and the other stages read source material through the GM audience ([0007](0007-visibility-enforcement.md)), source text always goes to the model as data (`PIPE-13`), and nothing a stage writes reaches canon without review (`PIPE-05`).
- **Retryable failures** back off and retry on their own, and the session shows the stage, the reason, and when the next attempt is (`INF-06`). **Other failures** stop the chain and wait for the operator.
- **A resumed session starts from the first stage without stored output.** Nothing already finished runs again.
- **The operator can pause or cancel a session.** Both take effect at the next stage boundary, or the next window boundary within a long stage. A paused session resumes as above. A cancelled one keeps its upload and stored outputs, so it can be restarted later without redoing finished work. Budget limits (`INF-08`) will use the same pause.
- **Raw audio is deleted by a final step** that runs only after every stage has succeeded, when the campaign's retention choice is delete (`CAP-07`).
- **Workers are separate processes** from the web server, so a long session never slows the interface.
- **Each job records its cost and duration** (`INF-05`), summed per session and stage.

### Long sessions

Transcription and extraction work in overlapping windows, so memory stays bounded and a failure loses only one window. Extraction receives the running entity list so that names stay consistent across windows.

## Consequences

- A failure never costs the upload or the finished stages.
- Changing a template reruns only the stages downstream of it, which also serves re-extraction later (`PIPE-14`).
- Stored intermediate outputs take disk space. They are kept until the session is accepted, then pruned to what evidence and provenance need.
- Windowed extraction can miss facts that span a window boundary. The overlap is sized to make that rare, and the fixtures include a fact stated across a boundary.
- On a single local GPU, stages that need different models run one after another, and switching models costs load time. Workers prefer jobs for the backend already loaded, so a batch of sessions does not reload models between every stage.
- Re-extracting only changed blocks of an edited source can miss a fact that depends on an unchanged neighbour. Extraction is given the surrounding unchanged blocks as context, read-only.

## Alternatives considered

- **One long-running process per session.** Simplest, but any failure restarts the whole session, which `PIPE-08` forbids. Rejected.
- **A workflow engine as a separate service.** Durable and well tested, but another service to install for a chain of eight steps. Rejected.
- **Sending the whole session to the model at once.** Rejected: context limits vary by backend, local models have small contexts, and one failure loses everything.
- **Re-extracting the whole source when it is edited.** Simpler, but every edit would send every claim back through review and could duplicate claims whose wording shifted. Rejected.
