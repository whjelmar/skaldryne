# 0012 — Web interface framework

**Status:** Open · **Date:** 2026-09-30 · **Serves:** `PIPE-04`, `PIPE-05`, `PIPE-15`, `QRY-01`, `CAP-22`, `OUT-09`, `NFR-01`, `NFR-07`, `NFR-09`, `NFR-12`, `NFR-13`

## Context

Everything in the web interface is behind a login, so search-engine rendering brings nothing. It is highly interactive:

- **Review** (`PIPE-04`, `PIPE-05`, `PIPE-15`): structured diffs of proposed claims, with accept, edit, and reject, one at a time or in bulk.
- **Evidence playback** (`CAP-22`): an audio player and transcript that scrub together, with the cited range highlighted.
- **Search and reading** (`QRY-01`): combined search, and a wiki-like reader of the record.
- **Later:** maps, relationship graphs, timelines, and offline reading (`NFR-13`).

It must meet accessibility requirements (`NFR-07`), work on a phone (`NFR-12`), and be translatable (`NFR-09`). Operators install one composition ([0010](0010-deployment.md)), so a separate rendering server is a cost.

## Recommendation

**Recommended, not decided:** Build the web interface as a React single-page app with Vite, compiled to static files and served by the API server ([0011](0011-http-framework.md)). The points below describe what adopting it would mean.

- **React** with the React Compiler, for the largest contributor pool and the widest choice of components for diffs, waveforms, graphs, maps, and timelines.
- **TanStack Router** for typed, file-based routing, and **TanStack Query** for server data: caching, refetching after review actions, and optimistic updates.
- **A typed API client generated from the server's OpenAPI description**, so the interface and server cannot disagree about shapes.
- **Components:** shadcn/ui on Base UI primitives for most of the interface. The component source is copied into the repository, so we own and can fix it. **React Aria Components** are used where accessibility and localization demands are highest: date and time pickers, comboboxes, and the review controls.
- **Accessibility target:** WCAG 2.2 AA. Automated accessibility checks run in CI on every screen, and keyboard-only review is part of the review screen's acceptance tests.
- **Translation:** all interface text goes through ICU messages from the first screen, with Lingui, so adding a language never means hunting for strings (`NFR-09`).
- **Phone layouts** are designed with each screen, not retrofitted (`NFR-12`).
- **Offline reading** (`NFR-13`, Phase 2) is added later as a service worker over the same app; nothing in this decision blocks it.
- **Audience in the interface is presentation only.** What a person can see is decided by the server ([0007](0007-visibility-enforcement.md)); the interface never receives data and hides it.

## Consequences if adopted

- One process serves the API and the interface, and one container image carries both.
- The first page load is heavier than a server-rendered page. Routes are split so the review and reader screens load only what they use.
- Base UI is young, and the React Compiler's build setup has changed recently. Both are pinned and upgraded deliberately.
- Two component libraries means two sets of conventions. React Aria is limited to the components listed above, and the shared design tokens keep them visually consistent.

## Options considered

- **SvelteKit.** Smaller bundles and very high developer satisfaction. Not recommended: a much smaller contributor pool, fewer accessible component kits, a coming major version with breaking changes, and its own server layer beside our API.
- **Server-rendering React frameworks.** They need their own rendering server, and their rendering and caching machinery buys nothing behind a login.
- **Server-rendered pages with htmx.** The simplest to run. Not recommended: the review diff, synced evidence playback, graphs, and maps need rich client state, which would become hand-written script without the structure or accessible components a framework provides.
- **SolidJS.** Excellent update performance, which suits a scrubbing player. Not recommended for its small contributor pool and a major version still in beta.

## To decide

A React single-page app, or another framework or rendering model? When a maintainer decides, this record becomes Proposed or Accepted with the chosen option, or is replaced by a record that states it.
