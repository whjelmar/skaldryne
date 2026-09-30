# 0011 — Hono for the HTTP server, with schema-driven validation and OpenAPI

**Status:** Proposed · **Date:** 2026-09-30 · **Serves:** `INT-01`, `INT-03`, `INT-08`, `INT-11`, `INT-12`, `MODEL-13`, `NFR-04`, `NFR-10`

## Context

The server ([0004](0004-language-runtime-and-repository.md)) serves the web interface's API in 0a, and from Phase 1 a public read/write REST API (`INT-01`), a chat-platform bot (`INT-03`), and a versioned plugin interface (`INT-08`, `INT-12`). Every request must run inside a database transaction that has set its audience, so row-level security applies ([0007](0007-visibility-enforcement.md)). Input must be validated at the boundary, and third parties need accurate API documentation.

The server spends its time waiting on the database and on model servers, so raw request throughput does not decide this.

## Decision

**The HTTP server is built on Hono, running on Node.js through its Node adapter.**

- **Web-standard handlers.** Hono is written against `Request` and `Response`, which matches 0004's rule that application code prefers web-standard APIs. Handlers can be tested by calling them with a `Request`, with no server running.
- **One schema per boundary.** Request and response shapes are defined once as schemas, using Zod through the Standard Schema interface, so the validator could be replaced without rewriting routes. The same schemas are shared with the worker, the bot, and the plugin interface.
- **OpenAPI is generated from those schemas**, never written by hand, and published with each release. The public API (`INT-01`) and plugin interface are versioned in the path and documented from the same source.
- **An audience middleware** runs on every authenticated route: it opens a transaction, sets the campaign, person, and role for row-level security, stores the connection in the request context, and commits or rolls back when the handler finishes. Routes cannot reach the database any other way.
- **Security middleware** for secure headers, CSRF protection on cookie-authenticated routes, request size limits, and rate limits on authentication and upload routes (`NFR-04`). Logs never include request bodies, keys, or source content.
- **The server also serves the web interface** as static files ([0012](0012-web-interface.md)), so there is one process to run.
- **The chat bot and plugin interface** call the same REST API, or the same internal services under the same audience rules. They never get a separate path to the database (`INT-11`).

## Consequences

- Handlers, validation, and API documentation cannot drift apart, because they come from one set of schemas.
- Visibility enforcement is structural: a route that forgets the audience middleware has no database connection.
- Hono's plugin ecosystem is smaller than the largest Node frameworks'. Needs outside it (uploads resumable across disconnects, for instance) are met with small libraries or our own middleware.
- The OpenAPI generator is a community package rather than part of Hono's core. It is pinned, and generated output is checked in CI.
- Hono on Node runs through an adapter and is slower than a framework built directly on Node's HTTP server. At this workload the difference is not measurable against database and model time.

## Alternatives considered

- **Fastify.** Mature, well governed, with the largest plugin ecosystem and native JSON Schema validation, and faster on Node. A strong choice and the closest alternative. Not chosen because it is built on Node's own request objects rather than web-standard ones, which ties handlers to Node and works against the portability 0004 asks for.
- **Express.** Universally known, but its middleware model and error handling are dated, and typed validation and OpenAPI are all add-ons.
- **Full-stack frameworks with their own data layer and dependency injection.** Heavier than a small team needs, and their data layers work against the row-level security design in [0007](0007-visibility-enforcement.md).
- **A typed RPC layer as the whole API.** Good for the web interface, but third-party plugins and bots need plain REST with OpenAPI. A typed RPC layer can be added on top of Hono later for the web interface alone, if hand-written client calls become a burden.
