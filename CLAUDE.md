# Skaldryne — project instructions

## Runtime and tooling

- **Node.js on its current Active LTS line, with pnpm.** This overrides any global preference for Bun: do not use `bun`, `bunx`, or Bun-only APIs, and do not commit Bun lockfiles. See [decision 0004](docs/decisions/0004-language-runtime-and-repository.md).
- Use `pnpm` / `pnpm dlx` for packages and one-off tools, the TypeScript compiler for type checking, and Vitest for tests.
- Application code is TypeScript and prefers web-standard APIs (`fetch`, `Request`, `Response`, Web Streams, Web Crypto) over runtime-specific ones.
- Python is allowed only inside model servers behind the inference interface (for example the local speech server, [decision 0014](docs/decisions/0014-local-speech-server.md)).

## Documents

- [PRD.md](PRD.md) says what the product must do. Requirement IDs (`CAP-05`, `NFR-18`, …) are stable; a requirement's priority always matches its phase (P0 = Phase 0, P1 = Phase 1, P2 = Phase 2).
- [docs/stories/](docs/stories/) holds user stories with Given/When/Then scenarios that cite requirement IDs.
- [docs/decisions/](docs/decisions/) holds decision records. Follow the process in its README: accepted records are not edited except for status; change a decision by writing a new record that supersedes it.
- Architecture follows the decision records. If code needs to depart from one, write a new record first.

## Git

- Commits are signed. Never bypass signing or hooks.
