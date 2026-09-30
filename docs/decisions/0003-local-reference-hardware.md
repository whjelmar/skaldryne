# 0003 — One reference machine with a 16 GB GPU, and two unpromised profiles

**Status:** Proposed · **Date:** 2026-09-30 · **Answers:** PRD open decision 4 · **Serves:** `INF-02`, `INF-07`, `NFR-05`, `OWN-03`

## Context

"Local models are first-class" (`INF-02`) is only a promise if it names a machine. The performance targets (`NFR-05`) — session length, processing time, campaign size — mean nothing without the hardware they were measured on. Operators also need to know before they install whether their machine is good enough, and first-run setup compares the machine with this reference to decide whether to suggest a hosted provider ([0001](0001-default-inference-configuration.md)).

Graphics memory sets how large a local model can be, and so caps local extraction quality.

## Decision

**The project names one reference machine, measures every release on it, and states every local performance target against it.**

| Component | Reference |
| --- | --- |
| GPU | A consumer graphics card with **16 GB** of video memory, supported by the default local model runtime |
| CPU | 8 cores, x86-64, from the last four years |
| Memory | 32 GB |
| Storage | 1 TB solid-state drive |
| Operating system | Linux, running the container composition of [0010](0010-deployment.md) |

- **The initial processing target** is a four-hour session processed end to end in no more than four hours on the reference machine. This is a starting point for `NFR-05`, confirmed or revised by the first baseline run.
- **The default local models** ([0001](0001-default-inference-configuration.md)) must fit on the reference machine at the same time, or be scheduled so they do not need to.
- **The specific card and processor used by the project's own measurement machine are listed in the documentation**, so results can be reproduced. Any machine meeting the table above counts as meeting the reference.

### Unpromised profiles

Two more profiles are documented and measured, but carry no performance promise. The pipeline must complete on them, and their processing times are published, not targeted.

- **CPU only**, on the same composition, with smaller or more heavily quantized models.
- **Apple silicon Macs with 32 GB or more of unified memory.** Containers on macOS generally cannot use the Apple GPU, so the standard composition runs its model servers on the CPU there. Running the model servers natively, outside the containers, is documented as an advanced setup, not a supported install path.

Promoting either profile to a promised reference is a new decision record.

## Consequences

- Operators can tell before installing whether their machine will meet the targets, and setup can tell them too.
- 16 GB of video memory limits the local default to models of roughly 14 billion parameters at 4 to 5 bits. That ceiling is the honest version of "local is first-class".
- Many existing gaming PCs have 8 to 12 GB of video memory. They fall below the reference and get setup's hosted-provider suggestion, though they may still run the pipeline locally.
- Mac owners can run Skaldryne, but slowly by default. If many operators are on Macs, a native install path becomes the next decision.
- The project needs access to a reference machine for every release, and measures the two unpromised profiles as well, which is an ongoing cost.

## Alternatives considered

- **A 12 GB reference.** Covers more home machines, but limits the default to models of about 8 billion parameters with shorter context windows, which extract and cite noticeably worse and may fail the quality thresholds.
- **A 24 GB reference.** Clearly better local quality, but only high-end or workstation cards qualify, so most operators would fall below it.
- **Apple silicon as a second promised reference.** Many GMs own Macs, and unified memory fits large models. Not chosen now, because promising it means a second, native install path alongside the container composition.
- **CPU-only as the reference.** Most inclusive, but too slow for a four-hour session with models good enough to pass the thresholds.
- **No reference; publish results from whatever hardware contributors have.** Targets would drift with every contributor's machine, and setup would have nothing to compare against.
