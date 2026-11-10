# Experiment 4c: Node.js 24 LTS

Spec: [EXPERIMENTS.md](EXPERIMENTS.md), "4c: Node.js 24 LTS" (committed eb51330). Run 2026-11-09 on branch `spike/db-tooling`.

**Result: pass. Same results as on Node 25.3.0, in both arms. No differences to explain.**

## Node used

- Version: **v24.22.2** (codename Krypton, LTS, released 2026-10-27). Latest v24.x LTS in `https://nodejs.org/dist/index.json` at run time.
- File: `node-v24.22.2-win-x64.zip` from `https://nodejs.org/dist/v24.22.2/`.
- SHA-256: `ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2`. It matches the line in `SHASUMS256.txt` from the same directory (checked with `sha256sum`). The SHASUMS file itself was not signature-checked.
- Extracted to `C:\Users\walte\dev\scratch\node24\`. Used only by prepending it to PATH inside my own commands. Machine default Node (v25.3.0), global PATH and global config were not touched.
- `node --version` printed `v24.22.2` in the shell of each run.
- pnpm 12.8.1 (the machine's global pnpm, run on Node 24), `--store-dir C:\Users\walte\dev\.pnpm-store`.

## How the database was pointed at 55433

Second container, same image, separate name: `docker run -d --name db-tooling-node24 -p 55433:5432 -e POSTGRES_PASSWORD=postgres skaldryne-spike-pg:18` (the same env as `compose.yaml`; the image's init script creates `skal_migrator` and `skal_app`). `db-tooling-db-1` on 55432 was not touched. Container removed at the end.

Environment variables only, no committed file edited:

| Variable | Value | Used by |
| --- | --- | --- |
| `PGHOST` | `localhost` | kysely arm (`src/config.ts`) |
| `PGPORT` | `55433` | kysely arm |
| `DB_CONTAINER` | `db-tooling-node24` | kysely arm (`docker exec psql`/`pg_dump` in `test/helpers.ts`) |
| `SPIKE_DB_HOST` | `localhost` | drizzle arm (`src/db.ts`) |
| `SPIKE_DB_PORT` | `55433` | drizzle arm |

Setup beyond that:
- Both arms' tests need the `exp1_main` template, so I ran `PG_CONTAINER=db-tooling-node24 sh reference/build-exp1.sh kysely drizzle` against the new container (the spec's own script).
- I ran in a copy so the tree stays clean: `C:\Users\walte\dev\scratch\node24-run\` holds the working-tree files of both stable arms plus `reference/` (excluding `node_modules`, `.tmp`, and the other agents' untracked `test/exp4a.test.ts` files, which `pnpm test` would otherwise have picked up). No file in the copy was edited. `pnpm install --frozen-lockfile` was run in the copy on Node 24 and resolved the same versions as the Node 25 runs (kysely arm: vitest 4.1.11, typescript 5.9.3; drizzle arm: vitest 5.1.0, typescript 7.0.2).
- The first drizzle attempt failed with ENOENT on `..\reference\schema.sql` because I had not yet copied `reference/`. I copied it and reran. That was a harness mistake, not a Node difference.
- Logs: `C:\Users\walte\dev\scratch\node24-run\kysely-run1.log`, `kysely-run2.log`, `drizzle-run1.log`.

## Results

| Arm | Node 25.3.0 (arm's RESULTS.md) | Node 24.22.2 | Same? |
| --- | --- | --- | --- |
| arm-kysely-stable | 30 passed, 1 failed (31 tests; 10 of 11 files pass) | 30 passed, 1 failed (31 tests; 10 of 11 files pass), twice | yes |
| arm-drizzle-stable | 36 passed, 0 failed (9 files) | 36 passed, 0 failed (9 files) | yes |

Command in both arms: `pnpm test`. For kysely that is `tsc --noEmit && vitest run`. For drizzle it is `bootstrap && tsc --noEmit && vitest run`. Typecheck passed in both.

The one kysely failure is `T10b killed no-transaction file (T9 file as committed)`, the failure `arm-kysely-stable/RESULTS.md` already records. The assertion is `rerun ended with a valid index: expected false to be true`. On Node 24 the observed behavior is the same as on Node 25: after the kill the index stays INVALID, the rerun of the unchanged file fails with `already exists`, and the runner does not report success. I reran the whole suite once to rule out flakiness: same failure, same counts.

## Differences and explanation

None in outcomes. Timings differ (kysely 57 s; drizzle 20 s, with bootstrap 25 s), but they were measured on a different database container and are not part of the criterion.

The kysely T10b failure is a graphile-migrate behavior (a half-created index from a killed `CREATE INDEX CONCURRENTLY` is not cleaned up on rerun), which is independent of the Node version.

## Caveats

- The two arms were run one after the other, not in parallel, against the single container.
- The kysely arm's runtime (graphile-migrate 1.4.1, `pg`) and drizzle's `pg` driver ran on Node 24 without any change.
