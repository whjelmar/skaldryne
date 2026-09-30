# 0002 — Evaluation fixture sources

**Status:** Open · **Date:** 2026-09-30 · **Answers:** PRD open decision 3 · **Serves:** `PIPE-12`, `PIPE-13`, `OUT-09`, `QRY-03`, `SAFE-10`, `INF-07`

## Context

The evaluation suite (`PIPE-12`) measures claim precision and recall, citation accuracy, entity resolution, player-safe leaks, and injection resistance. It needs recorded sessions with hand-labelled answers: which claims each session supports, which passages support them, what is GM-private, and what must never appear in a player-safe output.

Fixtures can be real sessions, released by everyone in them, or scripted sessions written and performed for the purpose. Real sessions are the true test, but need every participant's release and are hard to label for rare cases. Scripted sessions are safe to publish and can contain exactly the cases that matter, but can flatter the pipeline because they are cleaner than real play.

Milestone 0a cannot exit without fixtures, and many Phase 0 story scenarios run against them ("(fixture)" in [the stories](../stories/phase-0.md)).

## Recommendation

**Recommended, not decided:** Start with scripted fixtures, add real sessions as they are released, and report the two sets separately.

### Scripted fixtures (0a)

- **Written to cover every fixture scenario in the Phase 0 stories:** planted GM-private secrets; an uploaded document and a spoken line that each try to instruct the model; out-of-character stretches; one NPC under several names and a misspelling; an event that never happened, to be asked about; a background voice that never consented; invented names for glossary tests; and facts stated by several speakers or by one.
- **Performed, not only written.** Contributors read the scripts at a real table, on real devices, with crosstalk and background noise, and sign a release for the recording. Synthetic voices may fill in variations, such as a second language or more speakers, but at least one performed recording covers each case.
- **Kept in the repository** under `eval/fixtures/`, with recordings, scripts, and labels under a licence that lets anyone rerun the suite. Large recordings may live in a separate download that the suite fetches and checks by hash.
- **Labels are data**, in a documented format: claims with their evidence ranges, visibility, entity aliases, and the list of strings that must never appear in each audience's outputs.

### Real sessions (from 0b onward)

- **Accepted only with a written release from every person audible**, including anyone in the background, and with the right to withdraw it later.
- **Held separately**, possibly outside the public repository, when participants release them for evaluation but not for publication.
- **Labelled by the GM who ran the session**, reviewed by a second person.

### Reporting

The suite reports scripted and real results side by side and never as one blended number, so a gap between them is visible. Thresholds (open decision 2) are set against the scripted set first and revisited once there are enough real sessions.

## Consequences if adopted

- Fixtures can be written now, before any pipeline code, and the pipeline is built against them from its first commit.
- Rare, high-stakes cases (leaks, injection, non-consenting voices) are covered deliberately rather than by luck.
- Scripted sessions will be cleaner than real play, so early scores will be optimistic. Reporting the two sets separately is the guard against that.
- Writing and performing good scripts is real work, and labelling takes longer than recording.

## Options considered

- **Real sessions only.** Not recommended for 0a: releases take time, rare cases would be missing, and a leak test needs a secret we planted on purpose.
- **Synthetic voices only.** Not recommended: clean synthetic speech hides the transcription and speaker-labelling failures that dominate real tables.
- **Public recordings of broadcast play.** Not recommended: their rights belong to others, and publishing labelled derivatives would need their permission.

## Follow-up

- Write the fixture label format as part of the first evaluation work.
- Draft the participant release, including withdrawal, before collecting any real session.

## To decide

Scripted fixtures first with real sessions added later, or a different mix of sources? When a maintainer decides, this record becomes Proposed or Accepted with the chosen option, or is replaced by a record that states it.
