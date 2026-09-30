# 0010 — One container composition, started with one command

**Status:** Proposed · **Date:** 2026-09-30 · **Serves:** `NFR-01`, `NFR-04`, `NFR-15`, `NFR-18`, `INF-02`, `OWN-03`

## Context

The PRD requires a one-command install with a documented upgrade path (`NFR-01`), a fully local option (`INF-02`, `OWN-03`), no outbound traffic by default (`NFR-15`), and secrets kept out of logs and exports (`NFR-18`). The decisions above add a database ([0005](0005-record-storage.md)), pipeline workers ([0009](0009-pipeline-execution.md)), and model servers ([0008](0008-inference-backend-interface.md)).

## Decision

**Skaldryne ships as a container composition that one command starts. Model servers are optional services in the same composition.**

### Services

| Service | Role | Always on |
| --- | --- | --- |
| `server` | API and web interface | Yes |
| `worker` | Pipeline jobs; scaled by running more copies | Yes |
| `db` | PostgreSQL with `pgvector` | Yes |
| `llm` | Local language and embedding model server | In the local profile |
| `speech` | Local speech-recognition and speaker-separation server | In the local profile |

- **Two profiles:** `local` starts every service, including the model servers, and is the default ([0001](0001-default-inference-configuration.md)). `hosted` starts only the first three, for operators who configure a hosted provider.
- **Install** is one documented command that fetches the composition, generates the instance key and database password, asks for the profile, and starts it. It prints the address of first-run setup when it is done.
- **Configuration** lives in one file plus the instance's secrets directory. Keys are never passed on the command line or stored in the composition file.
- **Volumes:** one for the database, one for media, one for model weights. A backup is the database dump plus the media volume; model weights can be fetched again.
- **Networking:** only the `server` port is published. Model servers and the database are reachable only inside the composition. No service makes outbound connections except to fetch model weights at install, and to the hosted provider if one is configured.
- **Images** are built by the project's release pipeline, signed, and published with their checksums.

### Upgrades

- **An upgrade pulls the new images and restarts.** The `server` applies migrations on start, after taking a database snapshot, and refuses to start if a migration fails, leaving the snapshot to restore.
- **Every release is tested by upgrading a copy of the previous release** with campaign data in it (`NFR-01`).

## Consequences

- An operator installs one container runtime and runs one command.
- A machine without a capable GPU can still run the `local` profile slowly, or the `hosted` profile at full speed.
- The composition targets a single machine. Clustered deployments are out of scope until hosting is decided (PRD open decision 10).
- Model server images are large, and the `local` profile needs several gigabytes of disk for weights. Install states this before downloading.

## Alternatives considered

- **A single all-in-one image.** Simplest to run, but the database, workers, and model servers would share one process lifecycle, and model servers could not be dropped for the hosted profile.
- **Native installers per operating system.** Rejected for Phase 0: several packaging paths to maintain, and model servers vary too much across systems.
- **A cluster orchestrator as the primary target.** Rejected: far more than a home or club operator needs, and it would make one-command install impossible.
