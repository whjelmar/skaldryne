# 0003 — One named reference machine for the local path

**Status:** Proposed · **Date:** 2026-09-30 · **Answers:** PRD open decision 4 · **Serves:** `INF-02`, `INF-07`, `NFR-05`, `OWN-03`

## Context

"Local models are first-class" (`INF-02`) is only a promise if it names a machine. The performance targets (`NFR-05`) — session length, processing time, campaign size — mean nothing without the hardware they were measured on. Operators also need to know before they install whether their machine is good enough.

## Decision

**The project names one reference machine, measures every release on it, and states every local performance target against it.**

| Component | Reference |
| --- | --- |
| GPU | A consumer graphics card with **16 GB** of video memory, supported by the default local model runtime |
| CPU | 8 cores, x86-64, from the last four years |
| Memory | 32 GB |
| Storage | 1 TB solid-state drive |
| Operating system | Linux, running the container composition of [0010](0010-deployment.md) |

- **The initial processing target** is a four-hour session processed end to end in no more than four hours on the reference machine. This is a starting point for `NFR-05` and is confirmed or revised by the first baseline run.
- **The default local models** ([0001](0001-default-inference-configuration.md)) must fit on the reference machine at the same time, or be scheduled so they do not need to.
- **A second, CPU-only profile** is documented but not promised: the pipeline must complete on it, and its processing time is published, not targeted.
- **The specific card and processor used by the project's own measurement machine are listed in the documentation**, so results can be reproduced. Any machine meeting the table above counts as meeting the reference.

## Consequences

- Operators can tell before installing whether their machine will meet the targets.
- 16 GB of video memory sets a ceiling on local model size, which in turn caps local extraction quality. That ceiling is the honest version of "local is first-class".
- The project needs access to a reference machine for every release, which is an ongoing cost.
- Laptops and machines with shared memory are left out of the promise, though many will run the pipeline. Adding a second promised profile later is a new decision record.

## Alternatives considered

- **No reference; publish results from whatever hardware contributors have.** Rejected: targets would drift with every contributor's machine.
- **A higher reference, such as 24 GB of video memory.** Better local quality, but it excludes most home machines, so fewer people could use the local default.
- **CPU-only as the reference.** Most inclusive, but too slow for a four-hour session to process in reasonable time with models good enough to pass the thresholds.
