# 0004 — TypeScript on Bun, in one repository

**Status:** Proposed · **Date:** 2026-09-30 · **Serves:** `NFR-01`, `NFR-10`, `INT-08`, `INT-12`

## Context

Skaldryne has a web interface, an API, a background pipeline, and, later, a chat bot and a plugin interface. Plugin authors and contributors need to be able to read and extend it. Model inference itself runs in separate model servers ([0008](0008-inference-backend-interface.md)), so the application code orchestrates rather than computes.

## Decision

**All application code is TypeScript, run on Bun, in one repository.**

- **One language** across the web interface, API, pipeline workers, chat bot, and plugin interface, so types for the record are shared end to end and a plugin author learns one stack.
- **Bun** as runtime, package manager, test runner, and bundler. Its built-in PostgreSQL client and test runner remove several dependencies.
- **One repository with workspaces:**
  - `packages/record`: the record model, its types, and all database access ([0005](0005-record-storage.md), [0006](0006-record-model.md), [0007](0007-visibility-enforcement.md)).
  - `packages/inference`: capability interfaces and adapters ([0008](0008-inference-backend-interface.md)).
  - `packages/pipeline`: stages and jobs ([0009](0009-pipeline-execution.md)).
  - `packages/templates`: default templates and the template engine (`TPL-01`).
  - `apps/server`: API and web interface.
  - `apps/worker`: pipeline worker.
  - `eval/`: the evaluation suite and fixtures ([0002](0002-evaluation-fixture-sources.md)).
- **Strict type checking** and schema validation at every boundary where data enters: uploads, API requests, and model outputs.
- **No other language in the application.** Model servers are separate processes behind the inference interface and may be written in anything.

## Consequences

- Contributors and plugin authors need only TypeScript.
- Bun is younger than the most common alternative runtime, so some libraries may misbehave. The mitigation is to keep dependencies few and covered by tests.
- Structured model output is validated in the same types the record uses, so a malformed claim is rejected at the boundary.

## Alternatives considered

- **The most common server-side JavaScript runtime.** More mature, but slower tooling and more dependencies for the same result. Nothing in the application needs what only it offers.
- **Python for the pipeline and TypeScript for the web.** Python's machine-learning ecosystem is stronger, but inference runs in separate model servers, so the pipeline only orchestrates. Two languages would split the record's types and double the contributor learning curve.
- **Several repositories.** Rejected: the record's types change often in early development, and changes that span packages should land in one commit.
