# 0013 — llama.cpp server runs the local language and embedding models

**Status:** Proposed · **Date:** 2026-09-30 · **Serves:** `INF-01`, `INF-02`, `INF-07`, `PIPE-01`, `PIPE-12`, `NFR-01`, `NFR-05`, `NFR-15`, `OWN-03`

## Context

The `local` profile ([0010](0010-deployment.md)) must run a language model and an embedding model on the reference machine ([0003](0003-local-reference-hardware.md)): one 16 GB consumer GPU, with a CPU-only profile that must also complete. Extraction produces structured claims that must follow a JSON schema exactly (`PIPE-01`). The application talks to language models through one generic adapter that speaks the common chat-completions and embeddings HTTP protocol ([0008](0008-inference-backend-interface.md)), so the server is replaceable, but the bundled default is what most operators will run.

Operators are mostly hobbyists: installing and updating models must be simple, and GPUs from more than one vendor should work.

## Decision

**The `local` profile runs llama.cpp's HTTP server, as two services: one for the language model and one for the embedding model.**

- **Why this server:**
  - MIT-licensed and very actively maintained.
  - Enforces a JSON schema during generation, by turning the schema into a grammar, so extraction output always has the right shape.
  - One codebase runs on NVIDIA, AMD, Intel, and Apple GPUs and on CPU alone, so the CPU-only profile uses the same server and the same behaviour.
  - Speaks the chat-completions and embeddings protocol our adapter already uses.
  - Small container images.
- **Image variants** for CUDA, Vulkan (which covers AMD and Intel GPUs), and CPU, selected by a composition profile at install.
- **Configuration per profile:** context size matched to the extraction window, one or two parallel slots, flash attention, and a quantized attention cache to fit long windows in 16 GB. Any "thinking" mode of the chosen model is turned off for extraction, so output arrives as the schema rather than as reasoning text.
- **Models are quantized weight files** named in configuration with their checksum ([0001](0001-default-inference-configuration.md)). Install downloads them from the documented source, verifies the checksum, and stores them in the model volume. Updating a model is a configuration change plus a download, never an image change.
- **The default models are chosen by the evaluation suite** (`PIPE-12`), within the reference machine's memory: in 2026 that means a language model of roughly 14 billion parameters at 4 to 5 bits, and a small multilingual embedding model that also runs acceptably on CPU.
- **Validation still happens in the application** ([0008](0008-inference-backend-interface.md)). Constrained generation guarantees shape, not content.
- **A conformance test** runs a schema-extraction fixture against every server the documentation lists as supported. A server that fails it is not documented as supported (`INF-07`).
- **Documented alternatives** that operators may point the adapter at instead, provided they pass the conformance test:
  - **Ollama**, for its easier model management. Its context size must be set explicitly, because its default is far smaller than our extraction windows.
  - **vLLM**, for operators with larger GPUs serving several campaigns at once.

## Consequences

- One server covers every GPU vendor and the CPU-only profile, so the local path behaves the same everywhere and is tested once.
- Model management is ours to provide: named models, checksums, download, and upgrade. That is extra work, but it keeps the download sources and sizes documented, as [0001](0001-default-inference-configuration.md) requires.
- Throughput with many simultaneous requests is lower than a datacenter-oriented server's. A single table's pipeline does not need more.
- Schema enforcement has edge cases with some models' chat templates. The conformance test and the application's own validation catch them.

## Alternatives considered

- **Ollama as the default.** The easiest model management for hobbyists, with good Apple and AMD support. Not the default because schema enforcement through its chat-completions endpoint has been unreliable in reports, and its small default context silently truncates transcript windows unless changed. Kept as a documented alternative.
- **vLLM.** The best throughput and strong schema enforcement. Rejected as the default: large images, fragile on a 16 GB consumer card, and weak on CPU and Apple hardware. Kept as a documented alternative for larger installs.
- **Datacenter-oriented servers.** Excellent throughput with no realistic CPU-only path.
- **All-in-one local model platforms.** Broad API coverage, but more moving parts, with the same underlying engine for our use.
- **Proprietary desktop model runners.** Cannot be redistributed in an open container composition.
