# 0002 — Evaluation fixtures come from five sources, reported separately

**Status:** Proposed · **Date:** 2026-09-30 · **Answers:** PRD open decision 3 · **Serves:** `PIPE-12`, `PIPE-13`, `OUT-09`, `QRY-03`, `SAFE-10`, `INF-07`

## Context

The evaluation suite (`PIPE-12`) measures claim precision and recall, citation accuracy, entity resolution, player-safe leaks, and injection resistance. It needs recorded sessions with hand-labelled answers: which claims each session supports, which passages support them, what is GM-private, and what must never appear in a player-safe output.

No single source gives all of that. Real play is the true test but is slow to get released and rarely contains the high-stakes cases on demand. Scripted play covers those cases but is cleaner than real play. Synthetic speech is cheap but hides speech-recognition failures. Meeting recordings have excellent speaker labels but no tabletop content. Broadcast play is plentiful and real but belongs to others.

Milestone 0a cannot exit without fixtures, and many Phase 0 story scenarios run against them ("(fixture)" in [the stories](../stories/phase-0.md)).

## Decision

**Fixtures come from five sources. Each is its own set, and the suite reports every set separately, never as one blended number.**

### 1. Scripted sessions, performed (from 0a)

- **Written to cover every fixture scenario in the Phase 0 stories:** planted GM-private secrets; an uploaded document and a spoken line that each try to instruct the model; out-of-character stretches; one NPC under several names and a misspelling; an event that never happened, to be asked about; a background voice that never consented; invented names for glossary tests; and facts stated by several speakers or by one.
- **Performed at a real table**, on real devices, with crosstalk and background noise, by contributors who sign a release for the recording.
- **Kept in the repository** under `eval/fixtures/`, with recordings, scripts, and labels under a licence that lets anyone rerun the suite. Large recordings may live in a separate download that the suite fetches and checks by hash.

### 2. Scripted sessions, synthetic voices (from 0a)

- **The same scripts, and variations of them**, voiced by speech synthesis: more speakers, other languages, other accents, different pacing.
- **Used for extraction, visibility, and injection tests**, where the text matters more than the audio, and to test scale cheaply.
- **Not used to judge speech recognition or speaker labelling**, because clean synthetic audio flatters both.

### 3. Openly licensed meeting recordings (from 0a)

- **Multi-speaker recordings with professionally labelled speaker turns and transcripts**, used to test the speech stages only: transcription, speaker labelling, and overlapping speech.
- **Only sets whose licence allows commercial use and redistribution of results** are included. Each set's licence and source are recorded beside it.
- **Fetched by the suite and checked by hash**, not copied into the repository.

### 4. Broadcast actual-play recordings (from 0b)

- **Used only with written permission from the rights holder**, stating what may be done: evaluation only, or also publishing labels and results.
- **Held outside the public repository** unless the permission covers publishing, and never redistributed as audio.
- **Performers are named in the permission request**, and a recording is withdrawn if the rights holder or a performer asks.

### 5. Real sessions from Skaldryne tables (from 0b)

- **Accepted only with a written release from every person audible**, including anyone in the background, with the right to withdraw it later.
- **Held separately**, possibly outside the public repository, when participants release them for evaluation but not for publication.
- **Labelled by the GM who ran the session**, and reviewed by a second person.

### Labels and reporting

- **Labels are data**, in one documented format for every set: claims with their evidence ranges, visibility, entity aliases, and the strings that must never appear in each audience's outputs. Sets that cannot support a label type (meeting recordings have no secrets) simply omit it.
- **Every set is reported on its own.** Thresholds (open decision 2) are set against the performed scripted set first, and revisited as the broadcast and real sets grow. A large gap between scripted and real scores is treated as a finding, not averaged away.

## Consequences

- Fixtures can be written now, before any pipeline code, and the pipeline is built against them from its first commit.
- Rare, high-stakes cases (leaks, injection, non-consenting voices) are covered deliberately, while meeting, broadcast, and real recordings test the pipeline against speech it was not written for.
- Five sets are more to maintain: five sources, five licences or permissions, and one label format that fits them all.
- Broadcast recordings depend on permissions that may be slow or refused. The suite must work without them.
- Labelling is the largest cost. Synthetic variations are cheap to label because their scripts already are; broadcast and real sessions are the most expensive.

## Alternatives considered

- **Scripted, performed sessions alone, with real sessions later.** Simpler, but it tests the speech stages on only a handful of recordings, and leaves scale and language variations untested until real sessions arrive.
- **Real sessions only.** Not chosen for 0a: releases take time, rare cases would be missing, and a leak test needs a secret we planted on purpose.
- **Synthetic voices as the only audio.** Not chosen: clean synthetic speech hides the transcription and speaker-labelling failures that dominate real tables.
- **Broadcast recordings used without permission.** Not chosen: the rights belong to others, and performers did not agree to this use.

## Follow-up

- Write the fixture label format as part of the first evaluation work.
- Find performers for the scripted sessions, or recruit volunteers, and draft their release.
- Draft the participant release for real sessions, including withdrawal, before collecting any.
- Shortlist openly licensed meeting-recording sets and check each licence.
- Draft the permission request for broadcast recordings, and decide which productions to approach.
