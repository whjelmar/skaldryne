# 0010 — Deployment

**Status:** Accepted · **Date:** 2026-11-09 · **Serves:** `NFR-01`, `NFR-04`, `NFR-15`, `NFR-18`, `NFR-24`, `INF-02`, `OWN-03`

## Context

The PRD requires a one-command install with a documented upgrade path (`NFR-01`), migrations that are tested and safe to repeat (`NFR-24`), a fully local option (`INF-02`, `OWN-03`), no outbound traffic by default (`NFR-15`), encryption in transit and at rest, and secrets kept out of logs and exports (`NFR-18`). The decisions above add a database ([0005](0005-record-storage.md)) with separate roles for the application, migrations, and redaction ([0007](0007-visibility-enforcement.md)), pipeline workers that share one GPU on the reference machine ([0009](0009-pipeline-execution.md), [0003](0003-local-reference-hardware.md)), and model servers ([0008](0008-inference-backend-interface.md)).

## Decision

Skaldryne ships as a container composition that one command starts. Model servers are optional services in the same composition.

### Services

| Service | Role | Always on |
| --- | --- | --- |
| `migrate` | Applies database migrations, then exits | Runs before every start |
| `server` | API and web interface | Yes |
| `worker` | Pipeline jobs; scaled by running more copies | Yes |
| `db` | PostgreSQL with `pgvector` | Yes |
| `llm` | Local language and embedding model server | In the `local` profile |
| `speech` | Local speech-recognition and speaker-separation server | In the `local` profile |

- **Two profiles:** `local` starts every service, including the model servers, and is the default ([0001](0001-default-inference-configuration.md)). `external` starts no model servers, and every backend points at an endpoint the operator configures: a hosted provider, or a model server running natively on the host, such as the advanced Mac setup in [0003](0003-local-reference-hardware.md).
- **Install** is one documented command that fetches the composition, generates the instance key and the database passwords, asks for the profile, and starts it. It prints the address of first-run setup when it is done.
- **Configuration** lives in one file plus the instance's secrets directory. Keys are never passed on the command line or stored in the composition file.
- **Volumes:** one for the database, one for media, one for model weights. A backup is the database dump plus the media volume; model weights can be fetched again.
- **Networking:** only the `server` port is published. Model servers and the database are reachable only inside the composition. No service makes outbound connections except to fetch model weights at install, and to the endpoints the operator configured.
- **Images** are built by the project's release pipeline, signed, and published with their checksums.

### Database roles and migrations

- **Install creates three database roles**, each with its own generated password in the secrets directory: the application role used by `server` and `worker`, which cannot bypass row-level security; the migration role, used only by `migrate`; and the redaction role, used only by the redaction job ([0007](0007-visibility-enforcement.md)).
- **Migrations run in their own step.** `migrate` takes a database snapshot, applies pending migrations as the migration role, and exits. `server` and `worker` start only after it succeeds, so several copies never race to migrate. If a migration fails, nothing else starts, and the snapshot is left to restore.
- **Migrations are safe to repeat** (`NFR-24`): an applied migration is skipped, and one interrupted part-way completes when `migrate` runs again.
- **Every process checks the schema version on start** and refuses to run against a version it was not built for, with a message saying which step to run.

### Encryption and secrets

- **The secrets directory is the instance's secrets store** (`NFR-18`). It holds the instance key, the database passwords, and provider keys and tokens. Its contents never enter the record, logs, or exports. Keys can be rotated without downtime: the new key is added, used for new work, and the old one is removed once nothing needs it.
- **Media and backups are encrypted at rest with keys derived from the instance key.** Retained audio, video, and uploaded documents are encrypted per file. Backups are encrypted before they leave the instance.
- **The database volume is expected to sit on encrypted storage.** Install checks for it where the platform allows and warns when it cannot confirm it. Encrypting the database inside PostgreSQL is not part of this decision.
- **In transit:** traffic between services stays inside the composition's private network. In 0a, `server` listens only on the local machine, because no one else connects. Before players connect in 0b, `server` must be reachable only over TLS; how certificates are provided is a follow-up below.

### GPU

- **In the `local` profile the GPU is given to `llm` and `speech`**, and declared as one shared device so the pipeline schedules them one at a time ([0009](0009-pipeline-execution.md)). `server`, `worker`, and `db` never need it.
- **Without a usable GPU**, `local` runs the model servers on the processor, slowly, and install says so before it starts.

### Offline install

- **Model weights can be installed from a local folder** instead of downloaded. With the images and weights already on the machine, install and every later run make no outbound connection, which is how the fully local configuration meets `INF-02`.

### Upgrades

- **An upgrade pulls the new images and restarts.** `migrate` runs first, as above.
- **Every release is tested by upgrading a copy of the previous release** with campaign data in it (`NFR-01`), and every migration is tested twice against an empty database and against reference-scale data (`NFR-24`).

## Consequences

- An operator installs one container runtime and runs one command.
- A machine without a capable GPU can still run the `local` profile slowly, or the `external` profile at full speed.
- The composition targets a single machine. Clustered deployments are out of scope until hosting is decided (PRD open decision 10).
- Model server images are large, and the `local` profile needs several gigabytes of disk for weights. Install states this before downloading.
- Losing the instance key makes encrypted media and backups unreadable. Install tells the operator to keep a copy of the key somewhere outside the instance, and first-run setup asks them to confirm they have.
- Database encryption at rest depends on the operator's storage. The project documents how to set it up on each supported platform, but cannot enforce it.

## Alternatives considered

- **A single all-in-one image.** Simplest to run, but the database, workers, and model servers would share one process lifecycle, and model servers could not be dropped for the `external` profile. Rejected.
- **Native installers per operating system.** Rejected for Phase 0: several packaging paths to maintain, and model servers vary too much across systems.
- **A cluster orchestrator as the primary target.** Rejected: far more than a home or club operator needs, and it would make one-command install impossible.
- **Applying migrations when `server` starts.** Rejected: with several `worker` copies and `server` starting together, more than one could try to migrate, and the application role would need rights that 0007 keeps from it.
- **Encrypting the database inside PostgreSQL.** Rejected for now: it needs extensions or a modified server that the standard image does not provide, and encrypted storage gives the same protection against a stolen disk.

## Follow-up

- **TLS for 0b:** a bundled reverse proxy that obtains certificates automatically, a certificate the operator provides, or both. Decided before any player connects.
- **Backups:** scheduling, where backups are written, and reapplying the redaction ledger on restore ([0006](0006-record-model.md)) are decided when backups are built.
