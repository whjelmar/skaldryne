# 0001 — Default inference configuration

**Status:** Open · **Date:** 2026-09-30 · **Answers:** PRD open decision 1 · **Serves:** `INF-01`, `INF-02`, `NFR-15`, `OWN-03`

## Context

A new install needs a speech-recognition model, a language model, and an embedding model before it can process anything. There are two defaults on offer: models that run on the operator's machine, or a hosted provider reached with the operator's own key.

The default matters more than the option. Most operators keep what they are given, so the default decides whether a table's conversation leaves the machine, what the first session costs, and how good the first recap is. The PRD promises that nothing is sent anywhere unless the operator configured it (`NFR-15`) and that local models are first-class (`INF-02`).

## Recommendation

**Recommended, not decided:** The default configuration runs every model locally. A hosted provider is one setting away, and first-run setup offers it plainly.

- **First-run setup checks the machine** against the reference hardware ([0003](0003-local-reference-hardware.md)) and says what to expect: "this machine meets the reference; a four-hour session takes about N hours", or "this machine is below the reference; processing will be slow, and you may prefer a hosted provider".
- **Choosing a hosted provider is explicit.** Setup states that session audio and transcripts will be sent to that provider, and the choice is recorded with the operator who made it.
- **Stages can be mixed** once per-stage routing ships (`INF-03`, milestone 1d): for example, local speech recognition with a hosted language model. Until then, each capability has one backend ([0008](0008-inference-backend-interface.md)).
- **The default models are named in configuration, not code**, and are chosen by the evaluation suite: the bundled defaults are the best-scoring local models that fit the reference machine (`PIPE-12`, `INF-07`).

## Consequences if adopted

- The promise that nothing leaves the machine holds for anyone who never opens settings.
- The local path cannot quietly rot, because it is what the project's own evaluation runs and most early users run.
- First-run quality depends on local model quality. If the best local models fall short of the quality thresholds (open decision 2), this decision has to be revisited, and the evaluation suite is what tells us so.
- The container image or first run must fetch model weights, which are large. The installer states the download size before fetching, and fetches from the project's documented sources only (`NFR-18`).
- Operators without capable hardware get a slow first experience unless they choose a hosted provider, so setup has to make that choice easy to find.

## Options considered

- **A hosted provider by default.** Better first-run quality on weak hardware and no large download. Not recommended: every default install would send table audio to a third party, contradicting `NFR-15`, and the local path would become the neglected one.
- **No default: the operator must choose before anything works.** Honest, but it adds a decision to install before the operator knows enough to make it, which works against one-command setup (`NFR-01`).
- **Local by default, with automatic fallback to a hosted provider when local is slow.** Not recommended: an automatic fallback is the product deciding to send data off the machine, which only the operator may decide.

## Follow-up

- Name the default models once the fixtures ([0002](0002-evaluation-fixture-sources.md)) exist and a baseline run can compare candidates.
- Document the download sizes and where weights come from.

## To decide

Local models by default, a hosted provider by default, or no default until the operator chooses? When a maintainer decides, this record becomes Proposed or Accepted with the chosen option, or is replaced by a record that states it.
