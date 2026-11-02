# 0008 — Inference backend interface

**Status:** Open · **Date:** 2026-09-30 · **Serves:** `INF-01`, `INF-02`, `INF-04`, `INF-05`, `INF-06`, `INF-07`, `NFR-04`, `NFR-15`

## Context

The pipeline needs speech recognition, speaker separation, a language model, and embeddings, each swappable without code changes (`INF-01`), each working locally (`INF-02`), each accounting for its own cost (`INF-05`), and each failing with a message that says what to fix (`INF-06`). Providers differ in what they support: some return structured output that follows a schema, some take vocabulary hints, some bill in money and some in time.

## Recommendation

**Recommended, not decided:** The pipeline calls one interface per capability. Adapters implement those interfaces for specific backends, and configuration chooses the adapter.

### Capabilities

| Interface | Input | Output |
| --- | --- | --- |
| `Transcriber` | Audio, language hints, vocabulary hints (`CAP-28`) | Timed words with confidence |
| `Diarizer` | Audio, optionally known voice profiles | Timed speaker turns |
| `LanguageModel` | Instructions, a separate data section, an output schema | Output validated against the schema |
| `Embedder` | Text | Vectors, with the model that made them |

- **Each adapter declares what it supports:** schema-constrained output, vocabulary hints, context length, languages, and its cost unit. The pipeline adapts to what is declared, such as correcting names after transcription when a `Transcriber` takes no hints.
- **Structured output is always validated** against the record's types ([0004](0004-language-runtime-and-repository.md)). An output that fails validation is retried once with the error attached, and then fails the stage with the invalid output kept for inspection.
- **Instructions and data are separate arguments** of `LanguageModel`, never one string, so an adapter cannot concatenate source text into the instructions by accident (`PIPE-13`).
- **Prompts come from templates** (`INF-04`), and each call records the template version and the exact prompt text sent (`TPL-04`).

### Adapters for 0a

- **A generic HTTP adapter for the language model and embeddings**, speaking the chat-completions style of API that most local model servers and many hosted providers implement. One adapter covers the local default and several hosted options.
- **A local speech adapter** that talks to a speech-recognition and speaker-separation server run as its own container ([0010](0010-deployment.md)).
- **Provider-specific adapters are added only when a provider offers something the generic adapter cannot use**, such as a better structured-output mode.

### Every call

- **Records its cost** in the backend's own unit, its duration, and its retries (`INF-05`).
- **Classifies failures** as retryable (rate limit, timeout, temporary outage) or not (invalid key, model missing, input too large), and reports the stage, the backend, and what to do (`INF-06`).
- **Never logs keys or source content** (`NFR-04`, `NFR-18`).
- **Connects only to the configured endpoint** (`NFR-15`).

## Consequences if adopted

- Swapping a backend is a configuration change, as `INF-01` requires.
- Backend qualification (`INF-07`) runs the evaluation suite through the same interfaces, so a qualified backend is measured exactly as it will be used.
- The generic adapter covers many providers at once but uses only the features they share. Provider-specific features wait for a specific adapter.
- Speech recognition and speaker separation have no widely shared API, so the project maintains a small server contract of its own for them.

## Options considered

- **Calling one provider's software development kit directly from the pipeline.** Not recommended: it fixes the pipeline to that provider and breaks `INF-01`.
- **A third-party library that abstracts many providers.** Considered; it can sit behind an adapter later. Not recommended as the core interface, because the pipeline needs capability declarations, cost units, and failure classes that such libraries do not model.
- **One interface for everything.** Not recommended: transcription and generation share almost nothing, and one interface would hide real differences.

## To decide

One interface per capability with our own adapters, or a third-party multi-provider library at the core? When a maintainer decides, this record becomes Proposed or Accepted with the chosen option, or is replaced by a record that states it.
