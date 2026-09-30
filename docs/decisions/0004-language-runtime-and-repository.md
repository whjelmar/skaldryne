# 0004 — TypeScript on Node.js, in one repository

**Status:** Proposed · **Date:** 2026-09-30 · **Serves:** `NFR-01`, `NFR-10`, `INT-08`, `INT-12`

## Context

Skaldryne has a web interface, an API, a background pipeline, and, later, a chat bot and a plugin interface. Plugin authors and contributors need to be able to read and extend it. Model inference itself runs in separate model servers ([0008](0008-inference-backend-interface.md)), so the application code orchestrates rather than computes. Its time is spent waiting on models and the database, not in the runtime.

Operators never see the runtime, because they run containers ([0010](0010-deployment.md)). The runtime matters to contributors, plugin authors, and the libraries we depend on.

## Decision

**All application code is TypeScript, run on Node.js, in one repository.**

- **One language** across the web interface, API, pipeline workers, chat bot, and plugin interface, so types for the record are shared end to end and a plugin author learns one stack.
- **Node.js on its current Active LTS line**: 24 at the time of writing, moving to each new LTS line within one release after it enters LTS.
- **Portable code.** Application code uses web-standard APIs (`fetch`, `Request`, `Response`, Web Streams, Web Crypto) wherever they exist, and keeps runtime-specific calls behind small modules. Changing runtime later should be a contained change, not a rewrite.
- **Tooling:**
  - **pnpm** workspaces for packages.
  - **The TypeScript compiler** for type checking, with strict settings and erasable syntax only, so development code runs directly under Node's built-in type stripping. Production images ship compiled JavaScript.
  - **Vitest** for tests, shared with the web interface's build tooling.
- **One repository with workspaces:**
  - `packages/record`: the record model, its types, and all database access ([0005](0005-record-storage.md), [0006](0006-record-model.md), [0007](0007-visibility-enforcement.md)).
  - `packages/inference`: capability interfaces and adapters ([0008](0008-inference-backend-interface.md)).
  - `packages/pipeline`: stages and jobs ([0009](0009-pipeline-execution.md)).
  - `packages/templates`: default templates and the template engine (`TPL-01`).
  - `apps/server`: API and web interface.
  - `apps/worker`: pipeline worker.
  - `eval/`: the evaluation suite and fixtures ([0002](0002-evaluation-fixture-sources.md)).
- **Schema validation at every boundary** where data enters: uploads, API requests, and model outputs.
- **No other language in the application.** Model servers are separate processes behind the inference interface and may be written in anything; the local speech server, for one, is expected to be Python.

## Consequences

- Contributors and plugin authors need only TypeScript and the runtime almost all of them already know.
- Every library written for server-side JavaScript works without compatibility caveats.
- Governance of the runtime sits with a foundation rather than a single company.
- Tooling is several tools (package manager, compiler, test runner, bundler) rather than one. Each is mainstream and well documented.
- Structured model output is validated in the same types the record uses, so a malformed claim is rejected at the boundary.

## Alternatives considered

- **Bun as runtime and toolchain.** Faster installs, startup, and tests, with a package manager, test runner, bundler, and PostgreSQL client built in. Rejected: its advantages are mostly developer speed, which matters little for a service that waits on models; compatibility with the wider library ecosystem is very good but not complete; fewer contributors know it; and it is owned by a single company. Because the code sticks to web-standard APIs, this can be revisited without a rewrite.
- **Deno.** Secure by default, with strong tooling and web-standard APIs. Rejected for the same contributor and ecosystem reasons, to a greater degree.
- **Python for the pipeline and TypeScript for the web.** Python's machine-learning ecosystem is stronger, but inference runs in separate model servers, so the pipeline only orchestrates. Two languages would split the record's types and double the contributor learning curve.
- **Several repositories.** Rejected: the record's types change often in early development, and changes that span packages should land in one commit.
