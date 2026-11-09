# 0008 — Inference backend interface

**Status:** Accepted · **Date:** 2026-11-09 · **Serves:** `INF-01`, `INF-02`, `INF-03`, `INF-04`, `INF-05`, `INF-06`, `INF-07`, `INF-08`, `QRY-02`, `QRY-11`, `NFR-04`, `NFR-05`, `NFR-15`

## Context

The pipeline needs speech recognition, speaker separation, a language model, and embeddings, each swappable without code changes (`INF-01`), each working locally (`INF-02`), each accounting for its own cost (`INF-05`), and each failing with a message that says what to fix (`INF-06`). Providers differ in what they support: some return structured output that follows a schema, some take vocabulary hints, some bill in money and some in time. Campaign chat and spoken answers must start responding before the whole answer exists (`QRY-02`, `QRY-11`, `NFR-05`), and different stages may use different models (`INF-03`) under budgets checked before a run (`INF-08`).

## Decision

The pipeline calls one interface per capability. Adapters implement those interfaces for specific backends, and configuration chooses the adapter.

### Capabilities

| Interface | Input | Output |
| --- | --- | --- |
| `Transcriber` | Audio, language hints, vocabulary hints (`CAP-28`) | Timed words with confidence |
| `Diarizer` | Audio, optionally known voice profiles | Timed speaker turns |
| `LanguageModel` | Instructions, a separate data section, an output schema | Output validated against the schema, or streamed text (below) |
| `Embedder` | Text | Vectors, with the model that made them |

- **Later capabilities follow the same pattern.** `INF-01` also names vision, text-to-speech, and image generation. Each gets its own interface, adapters, and capability declaration in the phase that first needs it: text-to-speech for spoken answers (`QRY-11`), vision for video (`CAP-14`), image generation when an output first uses it. None is needed for 0a, and none is added before then.

- **Each adapter declares what it supports:** schema-constrained output, vocabulary hints, context length, languages, and its cost unit. The pipeline adapts to what is declared, such as correcting names after transcription when a `Transcriber` takes no hints.
- **Structured output is always validated** against the record's types ([0004](0004-language-runtime-and-repository.md)). An output that fails validation is retried once with the error attached, and then fails the stage with the invalid output kept for inspection.
- **Answers can stream.** `LanguageModel` has a second mode for answers read by a person (campaign chat, at-table and spoken lookups): it streams text as it is generated, with citation markers inline. When the stream ends, the full answer is checked like structured output: every citation must point at evidence the asker can read ([0007](0007-visibility-enforcement.md)), and an answer that fails is replaced by a refusal rather than left on screen (`QRY-03`). Anything that would change the record never streams; it always uses the validated structured mode.
- **Instructions and data are separate arguments** of `LanguageModel`, never one string, so an adapter cannot concatenate source text into the instructions by accident (`PIPE-13`).
- **Prompts come from templates** (`INF-04`), and each call records the template version and the exact prompt text sent (`TPL-04`).

### Adapters for 0a

- **A generic HTTP adapter for the language model and embeddings**, speaking the chat-completions style of API that most local model servers and many hosted providers implement. One adapter covers the local default and several hosted options.
- **A local speech adapter** that talks to a speech-recognition and speaker-separation server run as its own container ([0010](0010-deployment.md)).
- **Provider-specific adapters are added only when a provider offers something the generic adapter cannot use**, such as a better structured-output mode.

### Choosing backends

- **Configuration names backends per stage**, not once for the whole instance. Each pipeline stage and each query mode (extraction, citation checking, rendering, chat, embeddings, transcription, speaker separation) has its own entry, and a default entry covers any stage not listed. In 0a every stage may point at the same backend; routing a cheaper model to some stages (`INF-03`) is then a configuration change.
- **Changing the embedding backend rebuilds the search index.** Vectors carry the model that made them, and vectors from different models are never compared.

### Every call

- **Can be estimated before it runs.** Each adapter estimates a call's cost in its own unit from the input size, so a session's cost can be checked against a budget before it starts (`INF-08`). Estimates and actual costs are both recorded, so estimates can be corrected over time.
- **Records its cost** in the backend's own unit, its duration, and its retries (`INF-05`).
- **Classifies failures** as retryable (rate limit, timeout, temporary outage) or not (invalid key, model missing, input too large), and reports the stage, the backend, and what to do (`INF-06`).
- **Never logs keys or source content** (`NFR-04`, `NFR-18`).
- **Connects only to the configured endpoint** (`NFR-15`).

## Consequences

- Swapping a backend is a configuration change, as `INF-01` requires.
- Backend qualification (`INF-07`) runs the evaluation suite through the same interfaces, so a qualified backend is measured exactly as it will be used.
- The generic adapter covers many providers at once but uses only the features they share. Provider-specific features wait for a specific adapter.
- Speech recognition and speaker separation have no widely shared API, so the project maintains a small server contract of its own for them.
- A streamed answer can be on screen briefly before its citation check fails and it is replaced. The interface shows streamed answers as unverified until the check passes.
- Every adapter must implement cost estimation, and estimates for time-billed local backends depend on the hardware, so they start rough and improve from recorded actuals.

## Alternatives considered

- **Calling one provider's software development kit directly from the pipeline.** Rejected: it fixes the pipeline to that provider and breaks `INF-01`.
- **A third-party library that abstracts many providers.** It can sit behind an adapter later. Rejected as the core interface, because the pipeline needs capability declarations, cost units, and failure classes that such libraries do not model.
- **One interface for everything.** Rejected: transcription and generation share almost nothing, and one interface would hide real differences.
- **Answers only after full validation, with no streaming.** Simpler and never shows unverified text, but a long answer would keep the asker waiting, and the spoken lookup latency target (`NFR-05`, `QRY-11`) could not be met. Rejected.
