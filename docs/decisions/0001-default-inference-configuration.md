# 0001 — Local models by default, with setup suggesting a hosted provider on weak hardware

**Status:** Proposed · **Date:** 2026-09-30 · **Answers:** PRD open decision 1 · **Serves:** `INF-01`, `INF-02`, `NFR-01`, `NFR-15`, `OWN-03`

## Context

A new install needs a speech-recognition model, a language model, and an embedding model before it can process anything. There are two kinds of backend: models that run on the operator's machine, or a hosted provider reached with the operator's own key.

The default matters more than the option. Most operators keep what they are given, so the default decides whether a table's conversation leaves the machine, what the first session costs, and how good the first recap is. The PRD promises that nothing is sent anywhere unless the operator configured it (`NFR-15`) and that local models are first-class (`INF-02`). But an operator on a machine without a capable GPU who is given local models, and not told otherwise, waits hours for a first recap and may conclude the product does not work.

## Decision

**Local models are the default. First-run setup checks the machine, and when it falls below the reference hardware, it suggests a hosted provider instead. Nothing is sent off the machine until the operator confirms a hosted provider.**

- **Setup checks the machine** against the reference hardware ([0003](0003-local-reference-hardware.md)): graphics memory, system memory, and processor.
- **At or above the reference**, local is preselected, with the expected processing time for a four-hour session.
- **Below the reference**, setup suggests a hosted provider and shows both choices side by side: the expected local processing time on this machine, and, for the hosted choice, that session audio and transcripts will be sent to the named provider, with its expected cost. Local remains available and one click away.
- **The operator confirms either way.** A suggestion is never applied on its own, and the confirmed choice is recorded with the operator who made it.
- **An unattended install** (no one at setup, such as a scripted install) always gets local. Hosted is never chosen without a person choosing it.
- **The choice can be changed later** in settings, with the same explanation of what a hosted provider receives.
- **Stages can be mixed** once per-stage routing ships (`INF-03`, milestone 1d): for example, local speech recognition with a hosted language model. Until then, each capability has one backend ([0008](0008-inference-backend-interface.md)).
- **The default models are named in configuration, not code**, and are chosen by the evaluation suite: the bundled defaults are the best-scoring local models that fit the reference machine (`PIPE-12`, `INF-07`).

## Consequences

- The promise that nothing leaves the machine holds for anyone who does not actively choose otherwise.
- Operators on weak hardware learn at setup that there is a faster path, instead of discovering it after a slow first session.
- The local path cannot quietly rot, because it is what the project's own evaluation runs and what most operators with capable hardware run.
- Setup gains a hardware check and a comparison screen. The check has to be conservative: a machine it wrongly rates as capable gives a slow first run, and one it wrongly rates as weak only gets a suggestion that can be declined.
- The model weights for local use are large. The installer states the download size before fetching, and fetches from the project's documented sources only (`NFR-18`). An operator who confirms a hosted provider at setup can skip the download.
- First-run quality on the local path depends on local model quality. If the best local models fall short of the quality thresholds (open decision 2), this decision has to be revisited, and the evaluation suite is what tells us so.

## Alternatives considered

- **Local by default, with no hardware check.** Simplest, and the same privacy outcome. Not chosen: operators without a capable GPU get a slow first run with no hint that there is another way.
- **A hosted provider by default.** Best first-run quality on any machine, with no large download. Not chosen: every default install would send table audio to a third party, contradicting `NFR-15`, and the local path would become the neglected one.
- **No default: the operator must choose before anything works.** Honest, but it asks a question before the operator knows enough to answer it, which works against one-command setup (`NFR-01`).
- **Local by default, with automatic fallback to a hosted provider when local is slow.** Not chosen: an automatic fallback is the product deciding to send data off the machine, which only the operator may decide.

## Follow-up

- Name the default models once the fixtures ([0002](0002-evaluation-fixture-sources.md)) exist and a baseline run can compare candidates.
- Define the hardware check's thresholds once the reference hardware ([0003](0003-local-reference-hardware.md)) is decided.
- Document the download sizes and where weights come from.
