# Skaldryne — Product Requirements Document

**Status:** Draft v0.1 · **Last updated:** 2026-09-30 · **Owner:** project maintainers

---

## 1. Overview & Vision

### 1.1 Problem

A tabletop campaign is a story told across months or years, in sessions separated by weeks. The story exists only in the memories of the people at the table, and those memories decay unevenly. The name of the innkeeper who gave the party a warning in session four is gone by session twelve. A promise made to a faction is forgotten, then contradicted. A thread the GM intended to pay off is quietly dropped.

The burden of preventing this falls almost entirely on the Game Master, who is already improvising, adjudicating, and performing. Note-taking during play competes directly with running the game. Note-taking after play competes with the rest of the GM's life. The common outcome is a campaign record that is thin, stale, or nonexistent — and a table that slowly loses continuity with its own story.

### 1.2 Product thesis

Skaldryne captures what actually happened at the table and turns it into a structured, searchable, correctable record of the campaign — characters, places, factions, events, relationships, and lore — without asking anyone to stop playing in order to write it down.

### 1.3 Principles

These are load-bearing. Requirements throughout this document trace back to them.

| Principle | Meaning |
| --- | --- |
| **The record is auditable** | Every machine-derived claim can be traced to the moment in the session that established it, and corrected at the source. A record nobody can verify is a record nobody should trust. |
| **The data is the user's** | A campaign record is a multi-year artifact. The group must be able to read, edit, and export it in full, at any time, without asking. |
| **The models are swappable** | No single inference provider is a dependency. A table that wants everything processed on its own hardware can have that. |
| **Nothing becomes canon unreviewed** | Machine output is a proposal. A human accepts it. |

### 1.4 Non-goals

Stated plainly so scope arguments have a reference point.

- **Not a virtual tabletop.** No maps-with-tokens play surface, no initiative tracker, no dice. Skaldryne integrates with VTTs (§10) rather than replacing them.
- **Not an AI game master.** Skaldryne does not run games, play NPCs, or generate plot for the table to follow.
- **Not a rules engine.** No character-sheet math, no rules adjudication, no system-specific mechanical resolution.
- **Not a solo-play generator.** Skaldryne records play between people. It is not a single-player narrative experience.
- **Not a content marketplace.** No selling or hosting of published adventure material.
- **Not a video editor.** Skaldryne can cut a clip at a cited moment (`OUT-11`); it does not edit, grade, or produce video.
- **Not a biometric identification system.** No persistent face templates in any phase (`SAFE-04`). Voice profiles exist only with consent and only within their own instance (`SAFE-03`).

---

## 2. Users & Jobs

### 2.1 Primary GM

Runs one ongoing campaign for a regular group. Owns the continuity problem.

- **Job:** know what happened last session without re-listening to three hours of audio. *Done when* a recap is readable in minutes and specific enough to open the next session with.
- **Job:** look up a detail mid-session without breaking the scene. *Done when* a query returns the answer in seconds, with the session it came from.
- **Job:** find the threads left open. *Done when* unresolved commitments and dangling hooks are listed without being hand-tracked.
- **Job:** share a recap with players without leaking prep. *Done when* a player-safe version exists without manual redaction.

### 2.2 Multi-table GM

Runs several campaigns, sometimes professionally. Context-switching is the core difficulty.

- **Job:** re-enter the right campaign's headspace before a session. *Done when* a per-campaign catch-up brief is available on demand.
- **Job:** keep campaigns strictly separated. *Done when* no query or generated output can leak across campaign boundaries.

### 2.3 Player

Attends sessions, may miss some, cares about their own character's arc.

- **Job:** catch up after missing a session. *Done when* a spoiler-free summary is readable without an account.
- **Job:** remember their own character's history and relationships. *Done when* a character view shows arc and connections over time.
- **Job:** correct the record about their own character. *Done when* they can edit their character's entry without GM mediation.

### 2.4 Club or shared-world admin

Manages many tables in one setting, often with overlapping canon and rotating GMs.

- **Job:** maintain shared canon across tables. *Done when* multiple campaigns can reference common entities without duplicating them.
- **Job:** control who sees what. *Done when* per-entity and per-journal visibility is enforceable.

### 2.5 Actual-play creator

Records for an audience. Needs publishable output and accurate attribution.

- **Job:** produce episode summaries and show notes. *Done when* publication-ready output requires editing rather than authoring.
- **Job:** keep per-speaker audio intact for production. *Done when* multi-track capture survives the pipeline unmixed.
- **Job:** turn a produced video episode into a record without discarding what was shown on screen. *Done when* maps, handouts, and on-screen text that appeared in the episode are citable evidence, not lost when the audio track is extracted.
- **Job:** find and publish highlight clips. *Done when* a moment in the record exports as a clip bounded by its evidence span.

### 2.6 Fan chronicler

Follows a published actual-play series they did not make, and maintains a record of it for other fans. Has no access to raw per-speaker tracks — only the published episodes and their captions.

- **Job:** build a searchable record of a long-running series from its published episodes. *Done when* episodes, with their published captions where available, produce a reviewable record without the creators' source material.
- **Job:** keep spoilers out of reach of viewers who are behind. *Done when* the record can be browsed "as of" any episode.

The rights questions this user raises are real and are stated in §18.10 rather than resolved here.

### 2.7 Accessibility

This is a primary driver, not an edge case. Several of the jobs above are materially harder for people with memory impairment, ADHD, auditory processing differences, or executive-function load — and the manual alternative, disciplined contemporaneous note-taking, is precisely the thing those conditions make difficult. Two consequences carried into requirements:

- Transcripts and captions are an accessibility feature, not only a processing artifact (`NFR-07`).
- Nothing in the product may assume the user remembers prior context. Catch-up output (`OUT-03`) and surfaced open threads (`QRY-05`) exist for this reason.
- Deaf and hard-of-hearing players benefit during play, not only afterwards. Live captions (`CAP-21`) exist for this reason.

---

## 3. Core Concepts & Data Model

This section defines *what is stored and what guarantees hold over it*. Physical schema, storage engine, and identifier strategy are architecture decisions (§18.8).

### 3.1 The central modelling decision

> **`MODEL-01` (P0) — The structured record is the primary artifact; prose is a view of it.**
> Recaps, briefs, journals, and handouts are rendered from the entity and beat record. They are not themselves the stored representation of what happened.
> *Acceptance:* deleting every rendered output and regenerating loses no campaign information.

This is the decision the rest of the document depends on. The alternative — storing generated prose as the artifact — has two failure modes that compound. Errors in prose cannot be corrected at their source, only patched in place. And each session's generation ingests prior sessions' prose as context, so a single early mistake propagates forward and hardens into canon by repetition.

### 3.2 Hierarchy

- **`MODEL-02` (P0) — Campaign → Session → Beat.** Beats exist at three granularities: **step** (play-by-play), **minor beat** (a scene or sequence), **major beat** (a turning point). Beats are editable and reorderable; machine-proposed structure is a starting point, not a verdict. *Acceptance:* a GM can merge, split, retitle, and re-nest beats without data loss.

### 3.3 Entities

- **`MODEL-03` (P0) — Built-in entity types:** Character (PC or NPC), Location, Faction, Item. Characters support arc tracking across sessions. Locations support parent nesting (room → building → district → city → region).
- **`MODEL-04` (P0) — User-definable entity types.** Operators define new types with their own fields. *Rationale:* no fixed taxonomy survives contact with homebrew — deities, ships, corporations, contracts, and house rules are all load-bearing in some campaign. *Acceptance:* a new entity type can be defined and populated without code changes or a migration.
- **`MODEL-05` (P0) — Quests / objectives** with lifecycle states: planned, active, blocked, failed, complete. *Acceptance:* state transitions are timestamped and attributable to a session.
- **`MODEL-06` (P1) — Moments:** highlights, quotes, and awards, attachable to sessions and characters.
- **`MODEL-07` (P0) — Journals:** free-form documents typed as GM prep, world lore, player log, or reference, each with independent visibility.
- **`MODEL-08` (P1) — Relationship edges** between any two entities, typed (ally, rival, parent, member-of, located-in, owes) and stamped with the session that established them. *Acceptance:* the same pair can hold different relationships at different points in the timeline.

### 3.4 Provenance

- **`MODEL-09` (P0) — Every machine-derived claim carries an evidence span, a confidence value, and an extraction version.** The span is an offset *range* into the source, not a point timestamp — a claim is established by a passage, not an instant. Sources are not only transcripts: a span may be a time range plus frame region of video (`CAP-09`), a region of a photographed page (`CAP-16`), or a range of an event log (`CAP-17`). The extraction version identifies the exact template versions used (`TPL-04`). *Acceptance:* any claim in the record resolves to the passage, frame, or page region that produced it in one navigation step.

- **`MODEL-10` (P0) — Confidence is derived from structural signals, never self-reported by the model.** Candidate signals include corroboration across multiple speakers, corroboration across modalities (a name both spoken and shown on screen), a participant bookmark on the span (`CAP-20`), repetition across the session, transcription quality over the span, and whether the claim was later contradicted. The specific signal set and scoring are architecture decisions; *that confidence must not be a model's own assertion about itself* is a product requirement.
  *Rationale:* language models are poorly calibrated about their own certainty. A "high confidence" badge that merely reflects an assertive generation is worse than no badge at all — it launders uncertainty into false assurance and teaches the GM to stop checking.
  *Acceptance:* the confidence value for a claim can be explained in terms of observable properties of the source material.

- **`MODEL-11` (P0) — Corrections are append-only first-class events.** A correction records who changed what, when, the superseded value, and optionally why. It is not an in-place overwrite. Corrections propagate to every derived output (`OUT-10`).
  *Rationale:* this is what prevents one early extraction error from becoming permanent canon, and it makes the record's own history inspectable.
  *Acceptance:* the full revision history of any claim is retrievable, and correcting a claim once updates every rendering that depends on it.

### 3.5 Visibility

- **`MODEL-12` (P0) — Every record carries a visibility level:** GM-private, player-visible, or public.
- **`MODEL-13` (P0) — Visibility is enforced at query time, including inside AI retrieval.** A secret that leaks through the chat interface is still leaked; filtering rendered output is not sufficient, because the generation itself must never see out-of-scope material. *Acceptance:* an adversarial prompt to the campaign assistant, issued by a player, cannot surface GM-private content.
- **`MODEL-14` (P1) — Visibility can be scoped to named players.** A secret backstory, a private vision, or a handout passed to one character is visible to the GM and that player only. Three levels are not enough; the most important secrets at a table are usually between the GM and one person. *Acceptance:* a record scoped to one player is absent from every other player's search, chat, and rendered output.

### 3.6 Canon & continuity

What was said at the table, what is true in the world, and what each character knows are three different things. A record that collapses them is wrong in ways no correction can fix.

- **`MODEL-15` (P1) — A retcon is distinct from a correction.** A correction (`MODEL-11`) fixes an extraction error: the machine got it wrong. A retcon records that the table decided the story changed: the machine got it right, and the fiction moved. A retconned claim stays in history as played and is marked non-canon from that point on. *Acceptance:* the record can answer both "what is canon now" and "what happened at the table in session seven".
- **`MODEL-16` (P1) — A speaker is not a character.** The GM voices dozens of NPCs. A player may run two characters, change characters after a death, or sit in as a guest. Utterances are attributed to the character speaking, not only to the person speaking. *Acceptance:* a GM-voiced argument between two NPCs produces claims attributed to each NPC, not to "GM".
- **`MODEL-17` (P1) — In-world statements are attributed to their in-world source.** When an NPC lies, the record holds "Lord Vess claimed he was in the capital", not "Lord Vess was in the capital". Rumours, prophecies, and unreliable narrators are modelled as claims *about* claims. *Acceptance:* when a lie is revealed, the record reclassifies the statement; no correction is needed, because nothing was recorded wrongly.
- **`MODEL-18` (P1) — Character knowledge is tracked separately from GM truth.** The record knows which characters witnessed or learned a fact. This is finer than visibility (§3.5): a player may be allowed to see a fact that their character does not know. *Acceptance:* the character journal (`OUT-06`) for a PC who missed a scene does not include that scene's revelations, unless the character later learned them in play.
- **`MODEL-19` (P1) — Contradictions with canon are flagged in review.** A proposed claim that conflicts with committed canon is shown in the review diff (`PIPE-04`) alongside the claim it contradicts, with both evidence spans. The reviewer resolves it as an extraction error, a retcon, or an in-world lie. *Acceptance:* a planted contradiction in a fixture campaign is surfaced, not silently committed.
- **`MODEL-20` (P1) — In-world time is separate from real time.** Beats can carry in-world dates on user-defined calendars. Play can be non-linear: flashbacks, dreams, time travel, parallel groups. *Acceptance:* the timeline (`NAV-01`) can order the same beats by session order or by in-world chronology.
- **`MODEL-21` (P1) — Canon can be shared across campaigns.** Campaigns in a shared world or a club reference common entities without duplicating them, and each campaign may diverge locally. *Acceptance:* an update to a shared entity is visible in every campaign that references it, while a campaign-local divergence is not overwritten by it.
- **`MODEL-22` (P2) — Campaigns can branch.** A spin-off, a one-shot set in the same world, or an alternative timeline starts from a snapshot of existing canon. *Acceptance:* a branch evolves independently without changing its parent.

---

## 4. Capture & Ingest

Groups play in different places with different equipment. Capture cannot assume one setup, so several surfaces are first-class.

### 4.1 Audio & text

- **`CAP-01` (P0) — Audio file upload.** Mixed or multi-track, from any source (phone, laptop, conference mic, streaming software, VTT recording). Long sessions supported with a documented ceiling on duration and file size. *Acceptance:* a four-hour in-person recording from a single phone processes end to end.
- **`CAP-02` (P1) — Voice-channel capture.** A bot joins a group's voice channel on command, records **per-speaker tracks** rather than a single mix, and produces in-progress chapter summaries during play. Initial target: Discord. *Acceptance:* per-speaker tracks survive to diarization unmixed.
- **`CAP-03` (P1) — Recording consent is explicit and revocable per participant.** Consent state is recorded, visible to participants, and withdrawable; withdrawal is honoured for future capture and triggers a documented path for handling prior material. *Rationale:* recording people speaking in character still records people speaking, and consent law varies by jurisdiction (§18.5).
- **`CAP-04` (P1) — Text ingest.** Pasted raw notes, uploaded transcript files (`.txt`, `.md`, `.docx`), and imported chat message ranges for play-by-post campaigns. *Acceptance:* a play-by-post campaign with no audio at all can use the full pipeline.
- **`CAP-05` (P0) — Speaker diarization with persistent voice profiles.** Speaker-to-player-to-character mapping is learned once and reused across sessions. *Acceptance:* session two requires no re-mapping of returning speakers.
- **`CAP-06` (P1) — Multilingual transcription, including mixed-language sessions.** A table that plays in one language and jokes in another is a single recording, not two. *Acceptance:* language switches mid-session do not truncate or garble the transcript.
- **`CAP-07` (P0) — Audio and transcript retention are governed separately.** For raw audio the operator chooses, per campaign, among three options: **delete** after successful processing, **retain** a copy in Skaldryne's storage, or **link** to a copy held elsewhere (§4.5). Delete is the default, and the choice is presented when the campaign is created, with its consequence stated: only retain and link allow playback of the moment behind a claim (`CAP-22`). The transcript is retained by default, because evidence spans (`MODEL-09`) resolve against it.
  *The trade-off must be stated to the operator in plain language:* deleting the transcript degrades the record from auditable to merely asserted. Transcript deletion is offered as an explicit choice with its consequence documented, not as a silent default in either direction.
  *Acceptance:* retention policy for audio and for transcript are independently configurable, and the interface states what is lost by deleting each.

### 4.2 Video

Many sessions are already recorded as video: webcam-grid calls, screen recordings of a VTT, a phone propped over a physical table, and produced multi-camera episodes. Reducing any of these to their audio track throws away a second stream of evidence — the map the party was looking at, the handout on screen, the dice result, where the miniatures stood, the on-screen caption naming who is speaking. Video is treated as a source of evidence, not as a container for audio.

- **`CAP-08` (P1) — Video ingest.** Recorded calls, screen recordings, table cameras, and produced episodes are accepted. The audio track flows into the existing pipeline unchanged; the visual stream is processed alongside it (`PIPE-10`). *Acceptance:* a video with no useful visual content produces the same record as its audio alone. The visual stream only adds.
- **`CAP-09` (P1) — Visual evidence is citable.** A claim can cite a time range plus one or more frames, and a region within a frame. Review shows the cited keyframes next to the claim. *Acceptance:* a fact established only visually — a location name shown on a revealed map and never spoken — can be reviewed against the frame that shows it.
- **`CAP-10` (P1) — Screen content is read.** Text on screen is extracted: handouts, VTT chat, map labels, dice results, character-sheet panels. Scene changes on a shared map are proposed as beat boundaries. *Acceptance:* a handout shown on screen for ten seconds becomes a reviewable claim with its frame as evidence.
- **`CAP-11` (P2) — Physical table cameras.** An overhead or angled camera on a physical table yields map state, miniature and terrain positions, and props. Party-position snapshots feed interactive maps (`NAV-05`). *Acceptance:* a party position read from the table camera appears on the campaign map for that beat.
- **`CAP-12` (P2) — Visual cues assist speaker attribution.** Active-speaker highlighting in call recordings and on-screen name captions improve diarization and character attribution (`MODEL-16`). These cues are per-session; they never become persistent face templates (`SAFE-04`). *Acceptance:* on a fixture grid-call recording, speaker attribution accuracy improves with the visual stream enabled.
- **`CAP-13` (P2) — Produced episodes.** Edited, multi-camera content has properties raw recordings do not. Published captions or subtitles are used as a transcript source when present, since they are usually more accurate than machine transcription. Chapter markers are read. Episodes may map to sessions many-to-one or one-to-many (a session split across episodes, a compilation episode). Edited content may be non-linear. *Acceptance:* an episode with published captions skips machine transcription, and its captions carry evidence spans like any transcript.
- **`CAP-14` (P1) — Visual processing is bounded per inference backend.** Frames are sampled by scene change and on-screen activity rather than at a fixed rate. Budgets and sampling density are set per backend profile (`INF-01`), in the unit that constrains that backend:
  - **Metered hosted APIs:** money or tokens per session.
  - **Subscription or quota-limited hosted services:** request or rate quotas.
  - **Local models:** processing time or GPU-hours per session. There may be no cap at all, since the marginal cost is electricity and waiting.

  The same campaign may therefore sample densely on local hardware and sparsely on a metered API. The operator sees an estimate in the relevant unit before processing starts (`INF-05`). When one backend's budget is exhausted, remaining work can be routed to another backend instead of being reduced (`INF-03`). *Rationale:* a single global cap is wrong for everyone. It is either too tight for a local GPU that costs nothing per frame, or too loose for a metered API billed per image. *Acceptance:* the same session processed on two backend profiles applies each profile's own budget and sampling density, and a session over budget is processed at reduced density, rerouted, or held for approval — never silently truncated.
- **`CAP-15` (P1) — Video retention follows the audio model.** Raw video is deleted, retained, or linked to an external copy on the same terms as audio (`CAP-07`), and deletion is the default. The keyframes cited as evidence are retained by default, because they are to video what the transcript is to audio (`CAP-07`). *Acceptance:* after raw video is deleted, every visual citation still resolves.

### 4.3 Table artifacts

- **`CAP-16` (P1) — Photographs and scans.** Handwritten notes, whiteboards, character sheets, battle maps, and player-made art are ingested with text recognition and attached to a session. *Acceptance:* photographed session notes go through the same claim extraction and review as a transcript.
- **`CAP-17` (P2) — Structured event logs.** Dice-roll logs and VTT chat or combat logs are ingested as timestamped events aligned to the transcript. Outcomes are recorded ("the lock held"); rules are not adjudicated (§1.4). *Acceptance:* a critical failure in the dice log is linked to the beat in which it happened.
- **`CAP-18` (P1) — Between-session material.** Downtime actions, player-to-GM messages, and GM notes to a single player are ingested with the appropriate visibility, including per-player scope (`MODEL-14`). *Acceptance:* a secret message from the GM to one player enters the record visible only to that player and the GM.

### 4.4 In-session controls

- **`CAP-19` (P1) — Off the record.** Any participant can pause live capture, and paused spans are never recorded. For uploaded recordings, the equivalent is excluding spans before processing (`SAFE-01`). *Acceptance:* a paused span leaves no audio, transcript, or claim.
- **`CAP-20` (P1) — Live bookmarks.** Participants mark a moment during play with a single action from a phone or a bot command. Bookmarks raise extraction attention on the span and count as human corroboration for confidence (`MODEL-10`). *Rationale:* the people at the table know what mattered, and a one-tap signal costs them almost nothing. *Acceptance:* a bookmarked span appears in review with the bookmark attached.
- **`CAP-21` (P2) — Live captions.** A running caption stream is available to participants during play. *Acceptance:* a deaf player can follow table talk in real time with latency documented under `NFR-05`.

### 4.5 Playback & linked media

The record should lead back to the table. A session note that says "Mira swore the oath" is more useful when one click plays Mira's player saying it. Evidence spans (`MODEL-09`) already hold the time range, so all that is missing is a playable copy of the media. That copy can live in Skaldryne, or wherever the group already keeps its recordings: a video platform, an audio host, a cloud drive, or the operator's own network storage. Skaldryne does not need to hold the media to point into it.

- **`CAP-22` (P1) — From the record to the moment.** When playable media is available, every beat, claim, moment, timeline node, and recap sentence links to the playback position of its evidence span. Playback opens at the start of the span, with the transcript following along and the cited frames highlighted for video. When no playable media exists, the same link opens the transcript and keyframes instead. *Acceptance:* from any sentence in a recap, one action plays the moment that established it.
- **`CAP-23` (P1) — Media can live elsewhere.** A session's audio or video can be a reference to an external location, instead of or in addition to a retained copy. Supported locations include public and unlisted video platforms, podcast and audio hosts, cloud drives, and local or network paths. Initial targets are YouTube, SoundCloud, Google Drive, and Dropbox, with further locations added by plugin (`INT-08`). Skaldryne stores the reference and its alignment (`CAP-24`), not the media. *Acceptance:* a session whose uploaded audio was deleted after processing, but which has an external reference, still plays from every evidence link.
- **`CAP-24` (P1) — Alignment between the processed copy and the linked copy.** The copy people play back is often not the file that was processed: an intro was added, the pre-game chatter was trimmed, ad breaks were inserted, or the episode was re-cut. The offset mapping between the two is established automatically by matching the audio, can be adjusted by hand, and is piecewise for edited content. A span that does not exist in the linked copy is marked unplayable rather than seeking to the wrong place. *Acceptance:* a linked copy with a 90-second intro added and a break removed plays every moment at the correct position.
- **`CAP-25` (P1) — Link health is monitored.** External references are checked periodically. Links that are broken, moved, made private, or deleted are flagged on the affected sessions. The record falls back to transcript and keyframes and never breaks. *Acceptance:* deleting the external file flags every affected session, and every evidence link in those sessions still resolves to the transcript.
- **`CAP-26` (P1) — Linking never widens access.** A viewer plays externally held media only with their own access to it; Skaldryne does not proxy a private file to someone the owner never shared it with. Separately, a playback link appears only where the viewer can see the span it points into (`MODEL-13`, `MODEL-14`). An unlisted episode link in a player-safe recap never exposes a GM-private span. *Acceptance:* a player without access to the GM's private cloud folder sees the transcript fallback, not the recording.
- **`CAP-27` (P2) — Ingest by reference.** Processing can start from an external link, fetched with the operator's authorisation. The reference and its alignment are recorded automatically, so linking requires no extra step. *Acceptance:* pasting a link to a recording processes the session and leaves every evidence span playable from that link.

---

## 5. Processing Pipeline

Stages are ordered, individually resumable, and observable:

```
ingest ─┬─ audio:  transcribe → diarize → segment ─┐
        ├─ visual: sample frames → read screen ─────┼→ claim extraction
        └─ text / images / event logs ──────────────┘
       → cite-then-check → beat construction → rendering
       → human review gate → commit to record
```

- **`PIPE-01` (P0) — Claim extraction emits structured claims with evidence spans, not prose.** Each output is a typed assertion about an entity, bound to the transcript range that established it.
  *Cost, stated deliberately:* this is a more expensive prompt architecture than "summarize this session" — it consumes more tokens and constrains model selection to those that follow structured-output and citation instructions reliably. That cost is accepted in exchange for `MODEL-09`, and it is surfaced to the operator under `INF-05`.

- **`PIPE-02` (P0) — Cite-then-check runs as a separate verification stage.** A second pass confirms that each cited span actually supports its claim. Claims failing verification are downgraded in confidence or held for review rather than committed.
  *Rationale:* a model asked to cite will sometimes cite the wrong passage. Without verification the audit trail is decorative — and a decorative audit trail is worse than none, because it invites trust it has not earned.
  *Acceptance:* a deliberately mis-cited claim in a fixture set is caught rather than committed. This stage may use a smaller, cheaper model than extraction.

- **`PIPE-03` (P0) — In-character and out-of-character discourse are distinguished.** Rules arguments, snack logistics, and real-world conversation must not become canon. *Acceptance:* on a labelled fixture session, out-of-character passages do not generate entity claims.

- **`PIPE-04` (P0) — Session output is a structured diff against existing canon**, not a standalone document. Review is "approve these fourteen changes", not "read this essay and hope". *Acceptance:* each proposed change is independently approvable.

- **`PIPE-05` (P0) — Human review gate.** Nothing reaches the campaign record without a human accepting it. Review supports merge, split, edit, and reject per proposed change. *Acceptance:* an unreviewed session's claims are absent from search, chat retrieval, and all rendered output.

- **`PIPE-06` (P0) — Extraction verbosity is configurable** across at least three levels (essential / balanced / exhaustive), trading recall against review burden.

- **`PIPE-07` (P0) — Reprocessing is idempotent.** Re-running a session does not duplicate entities or beats, and does not silently discard accepted human corrections. *Acceptance:* reprocessing a reviewed session preserves corrections and reports what changed.

- **`PIPE-08` (P0) — Per-stage failure isolation, retry, and resumption.** A failure in one stage does not discard completed upstream work. *Acceptance:* a transcription failure on a three-hour upload does not require re-uploading.

- **`PIPE-09` (P1) — Pipeline progress and per-stage status are visible** while a session processes.

- **`PIPE-10` (P1) — Visual and audio evidence merge into one set of claims.** The visual branch produces claims with frame citations. Where both branches support the same claim, they corroborate it rather than duplicating it. Cite-then-check (`PIPE-02`) applies to visual citations as well. *Acceptance:* a name spoken aloud and shown on screen produces one claim with two evidence spans, not two claims.

- **`PIPE-11` (P1) — Planned material is never committed as played.** GM prep ingested as a journal (`MODEL-07`) is marked as planned. The pipeline can match what happened against what was planned, but prep never enters canon as though it occurred. *Acceptance:* a prepared encounter the party skipped does not appear in any recap.

---

## 6. Output & Synthesis

Every output here is a **rendering of the record** (`MODEL-01`), never independently stored prose.

- **`OUT-01` (P0) — Narrative recap** in prose, suitable for reading aloud or sharing.
- **`OUT-02` (P0) — Structured outline** of the session: beats, participants, locations, outcomes.
- **`OUT-03` (P0) — Catch-up brief** for a player returning after absence, scoped to what they can know.
- **`OUT-04` (P0) — Compendium entries** for entities, updated as sessions accumulate rather than rewritten.
- **`OUT-05` (P0) — Quest-log delta:** what changed in objective state this session.
- **`OUT-06` (P1) — Per-player character journal**, written in that character's voice.
- **`OUT-07` (P1) — In-world flavour artifacts**, such as a newspaper or chronicle framing of recent events.

- **`OUT-08` (P0) — Tone and length are configurable** via presets and freeform instruction, per campaign, changeable at any time without reprocessing.

- **`OUT-09` (P0) — Every output renders in both a GM-private and a player-safe variant, generated together.** The GM must never hand-redact a recap before sharing it. *Acceptance:* the player-safe variant of any output contains no content marked GM-private, verified against a fixture campaign containing planted secrets.

- **`OUT-10` (P0) — Corrections regenerate affected outputs.** If rendered prose is cached for performance, invalidation on record change is a requirement, not an optimization.
  *Rationale:* a stale recap still displaying a corrected error defeats the entire provenance design — the user sees the wrong fact and has no signal that it was fixed.
  *Acceptance:* correcting a claim updates every rendered output containing it, with no manual regeneration step.

- **`OUT-11` (P1) — Clips.** A moment (`MODEL-06`) or any claim with an audio or video span can be exported as a clip bounded by that span, individually or as a highlight reel. Clips can be cut from a retained copy, or from linked external media where the operator can access it (`CAP-23`). Clips respect consent (`CAP-03`) and redaction (`SAFE-01`). *Acceptance:* a clip cannot be cut from a span that has been redacted or whose speaker withdrew consent.
- **`OUT-12` (P2) — Campaign chronicle.** An entire campaign or arc is compiled into a long-form, book-like document for print or e-reader, with chapters, an index of entities, and optional illustrations from the record. *Rationale:* a campaign that ran for three years deserves an artifact the group can keep on a shelf.
- **`OUT-13` (P2) — Per-reader language.** Outputs render in each reader's chosen language, independently of the language the session was played in.
- **`OUT-14` (P1) — Visual evidence in outputs.** Recaps and compendium entries may embed cited keyframes, handouts, and photographed artifacts, subject to the same visibility rules as the text around them.

---

## 7. Retrieval & Query

- **`QRY-01` (P0) — Combined full-text and semantic search** across sessions, transcripts, entities, and journals.
- **`QRY-02` (P0) — Grounded campaign chat.** Answers cite the sessions and passages they draw from.
- **`QRY-03` (P0) — The assistant declines rather than invents.** When the record does not support an answer, it says so. *Acceptance:* on a fixture campaign, questions about events that never occurred produce a refusal, not a plausible fabrication.
- **`QRY-04` (P0) — Retrieval respects the asker's visibility scope** (`MODEL-13`).
- **`QRY-05` (P1) — Open-thread surfacing.** Unresolved commitments, unanswered questions, and dangling hooks are listed for prep.
- **`QRY-06` (P2) — Configurable assistant persona**, separate from output tone (`OUT-08`).
- **`QRY-07` (P1) — Planned versus played.** The GM's prep is compared against what actually happened (`PIPE-11`). Prep that was never used is surfaced for reuse, and plans the table diverged from are highlighted. *Rationale:* unused prep is one of a GM's largest sunk costs, and knowing where the table went off-script is useful when planning the next session.
- **`QRY-08` (P2) — Visual queries.** "Show me the map when we entered the vault" returns the cited frames. *Acceptance:* a query about a visually established fact returns the frame, not only the text claim.
- **`QRY-09` (P1) — "As of" browsing.** The record, search, and chat can be scoped to their state as of any session or episode, so someone catching up is never spoiled by what comes later. *Acceptance:* a query scoped to session five returns nothing established in session six or later.

---

## 8. Navigation & Visualization

- **`NAV-01` (P1) — Interactive timeline** with multiple layouts, and editable, reorderable nodes.
- **`NAV-02` (P1) — Relationship graph** across entities, factions, and locations, with filtering by type and time range.
- **`NAV-03` (P1) — Bidirectional wiki linking** with `[[bracket]]` syntax, hover previews, and link integrity maintained through renames and aliasing. *Acceptance:* renaming an entity does not orphan existing links.
- **`NAV-04` (P1) — Character arc view:** one character's history, relationships, and turning points over time.
- **`NAV-05` (P2) — Interactive maps** with nested zoom, region shapes, routes, and party position.

### 8.1 Table dynamics

- **`NAV-06` (P2) — Table-dynamics analytics** — speaking-time share, spotlight balance, pacing, sentiment trend, engagement over time — presented as a facilitation aid for the GM.

- **`NAV-07` (P2) — The product states a position on quantifying players, in the interface and in the documentation.** At minimum: which metrics are deliberately *not* computed, who can see per-person figures, and whether per-person metrics can be disabled entirely.
  *Rationale:* these numbers describe the GM's friends. "The quiet player spoke 6% of the time" is useful for noticing someone has been sidelined and corrosive as a scoreboard, and which one it becomes depends on framing and audience. Shipping per-person scores without taking a position is still a position — taken by omission, and by default the less careful one.
  *Acceptance:* per-person metrics have a documented default audience and an off switch.

---

## 9. Sharing, Publishing & Export

- **`SHARE-01` (P0) — Role-based permissions:** owner, admin, GM, player, guest — with per-entity and per-journal overrides.
- **`SHARE-02` (P0) — Players edit their own character** without GM mediation.
- **`SHARE-03` (P1) — Public read-only campaign pages** requiring no account from the reader. Raw transcripts are never public.
- **`SHARE-04` (P2) — Printable session handouts** with selectable sections and visual themes.
- **`SHARE-05` (P2) — Shareable entity cards** as images.

- **`SHARE-06` (P0) — Complete data export.** Two formats: a full-fidelity structured export that round-trips into a fresh instance without loss, and a Markdown-plus-wikilink bundle that opens directly in a plain-text notes vault.
  Export is a stated project principle, not a feature: a campaign record is a multi-year artifact, and the group must be able to leave with all of it whenever they choose.
  *Acceptance:* a full export re-imported into an empty instance reproduces the original record, including provenance and correction history.

---

## 10. Integrations & Extensibility

- **`INT-01` (P1) — Read/write REST API** with scoped, revocable tokens.
- **`INT-02` (P1) — MCP server** exposing campaign read and write, so any compatible AI client can serve as a front end. Write access requires an explicit scope grant.
- **`INT-03` (P1) — Chat-platform bot beyond capture:** post recaps, answer questions in-channel.
- **`INT-04` (P1) — Bidirectional VTT sync** for journals, actors, and compendium entries. Initial target: Foundry. Subsequent: Roll20.
- **`INT-05` (P2) — Plain-text notes-vault sync**, consistent with the export format in `SHARE-06`.
- **`INT-06` (P2) — Outbound webhooks** on session completion and record change.
- **`INT-07` (P2) — Import from common hosted campaign-wiki export formats.**
- **`INT-08` (P1) — Plugin architecture for game-system behaviour.** System-specific extraction hints, entity types, and terminology live in packages, not in core. *Rationale:* the number of systems is unbounded and core cannot absorb them. *Acceptance:* a new system's support can be added without modifying core.

---

## 11. Pluggable Inference

- **`INF-01` (P0) — A single provider interface with independently swappable language-model, speech-recognition, and vision backends.** Changing any of them is configuration, not code.
- **`INF-02` (P0) — Locally hosted models are first-class, not a degraded fallback.** A table processing sensitive — or simply private — conversation must be able to keep everything on its own hardware. *Acceptance:* a documented configuration completes the full pipeline with no outbound network calls.
- **`INF-03` (P1) — Per-stage model routing.** A cheaper model can verify citations or render prose while a stronger model extracts claims.
- **`INF-04` (P0) — Prompts are versioned, inspectable, user-overridable templates**, not strings buried in source. *Rationale:* an operator who cannot read the prompt cannot audit the output, and extraction quality is the product's dominant variable (§18.1).
- **`INF-05` (P0) — Cost and token accounting surfaced per session, per stage, and per backend**, in each backend's own unit — money, tokens, quota, or processing time — including the overhead added by citation-bearing extraction (`PIPE-01`). The self-hoster pays this directly and should see it.
- **`INF-06` (P0) — Graceful degradation with actionable failure messages** when a provider is unavailable, rate-limited, or misconfigured. A stalled pipeline must say why.

---

## 12. Templates & Customization

Templates are how a group fits the product to its table: the prompts that extract and render, the structure of each output, the entity types, and the visual themes. They are also the easiest way to quietly break the guarantees in §3.4. An edited extraction prompt that drops citations turns the audit trail decorative without anyone noticing. The requirements below make templates fully user-owned *and* keep them from undermining provenance.

- **`TPL-01` (P0) — Every template kind is a first-class, versioned object.** Template kinds include extraction and verification prompts, rendering prompts, output structures, entity-type definitions (`MODEL-04`), tone presets (`OUT-08`), and visual themes (`SHARE-04`). *Acceptance:* every template in effect can be listed, read, and diffed against its previous versions.
- **`TPL-02` (P0) — Scope and precedence are defined and inspectable.** Templates apply at instance, campaign, or user level. Narrower scope wins: a player's journal voice overrides the campaign's, which overrides the instance default. *Acceptance:* for any output, the interface shows which template, at which scope and version, produced it.
- **`TPL-03` (P0) — Templates that affect extraction are validated before activation.** An edited extraction or verification template must pass the fixture suite before it can be used: valid structured output, citation accuracy, and precision and recall within a configured tolerance of the current baseline. A failing template can be saved as a draft but cannot be activated. *Rationale:* without this gate, `INF-04` becomes the easiest way to defeat `MODEL-09` and `PIPE-02`. *Acceptance:* a template edit that removes the citation instruction fails validation.
- **`TPL-04` (P0) — Claims record the template versions that produced them.** This makes the extraction version in `MODEL-09` concrete. *Acceptance:* from any claim, one navigation step reaches the exact prompt text used to extract it and to verify it.
- **`TPL-05` (P1) — Template changes identify what they affect.** Changing an extraction template lists the sessions extracted under the previous version and offers to reprocess them (`PIPE-07`). Changing a rendering template or output structure regenerates outputs without re-extraction. *Acceptance:* a rendering-only change never triggers inference over transcripts.
- **`TPL-06` (P1) — Preview before adopting.** A template can be dry-run against a past session and its result shown as a diff against the current record or output, without committing anything. *Acceptance:* a preview leaves the record and every output unchanged.
- **`TPL-07` (P1) — Users define output structure, not only tone.** Users can author the sections, ordering, included entity types, and per-section length of recaps, briefs, and journals, and create entirely new output formats from the record. *Acceptance:* a user-defined output format renders both GM-private and player-safe variants (`OUT-09`) without further configuration.
- **`TPL-08` (P1) — Upgrades never silently overwrite user overrides.** When a release changes a default that a user has overridden, the override is flagged as drifted and shown as a diff. The user chooses to keep it, adopt the new default, or merge the two. *Acceptance:* upgrading an instance leaves every overridden template byte-identical until the user acts.
- **`TPL-09` (P1) — Template edits are audited and revertible.** Each edit records who changed what and when, following the model of `MODEL-11`. *Acceptance:* any template can be reverted to any previous version in one action.
- **`TPL-10` (P1) — Templates are portable.** Templates export and import individually or as packs, are included in full data export (`SHARE-06`), and can ship inside plugins (`INT-08`). Imported extraction templates go through validation (`TPL-03`) like any other edit. *Acceptance:* a template pack exported from one instance imports into another and passes validation there.
- **`TPL-11` (P2) — Starter packs.** Game-system and genre plugins can bundle entity types, extraction hints, output structures, and themes as a starting configuration for a new campaign.

---

## 13. Participant Rights & Safety

The people being recorded are not all the people running the software. A player's voice, face, words, and out-of-character life belong to that player. Recording consent is covered by `CAP-03`. The requirements here cover what happens after recording.

- **`SAFE-01` (P0) — Redaction removes a span everywhere at once.** One action removes a span from audio, video, transcript, keyframes, every claim whose only evidence lies in that span, and every output derived from those claims. The fact of redaction is logged — by whom, and when — but its content is not.
  *This is the one deliberate exception to append-only history (`MODEL-11`).* Corrections preserve what they supersede; redaction destroys it. A player who said something personal at the table must be able to make it gone, not merely superseded.
  *Linked media is the limit of this guarantee.* Skaldryne cannot delete a copy it does not hold (`CAP-23`). Redacting a span in a linked session removes the span's playback link, and it tells the redacting participant and the media owner, in plain language, that the external copy still contains the span and must be edited or removed at its source.
  *Acceptance:* after redaction, the span's content cannot be recovered through search, chat, export, reprocessing, regenerated outputs, or playback from within Skaldryne. When an external copy exists, its owner is notified.
- **`SAFE-02` (P1) — Safety tools are part of the record.** A campaign can record its lines and veils. Content under a line is excluded from outputs; content under a veil is summarised at the level the table chose. Invoking a content-stop tool during play (an X-card or equivalent, by bot command or bookmark) marks the span for exclusion before any processing. *Acceptance:* a span marked by a content-stop invocation produces no claims and appears in no output.
- **`SAFE-03` (P0) — Voice profiles are biometric data belonging to the participant.** They are created only with the participant's consent, used only within their own instance, and deletable by the participant at any time. After deletion the participant becomes an unidentified speaker in future sessions. *Acceptance:* a participant can delete their own voice profile without GM or admin action.
- **`SAFE-04` (P1) — No persistent face templates.** Visual speaker cues (`CAP-12`) rely only on per-session signals such as the active-speaker tile and on-screen captions. No persistent facial identification is built or stored, in any phase. *Acceptance:* nothing derived from a face survives the end of the session's processing.
- **`SAFE-05` (P1) — Participants can leave with what is theirs.** A departing player can export their own character's record and their own journals, delete their voice profile, and request redaction of their out-of-character speech. Campaign canon their character took part in remains with the group. *Acceptance:* the departure flow distinguishes personal content from shared canon and handles each as documented.
- **`SAFE-06` (P1) — Campaigns with minors have stricter defaults.** A campaign can be marked as including minors — schools, libraries, family tables. Guardian consent is recorded through the `CAP-03` flow. Stricter defaults apply: no public pages, immediate deletion of raw audio and video, and per-person analytics (`NAV-06`) off. *Acceptance:* marking a campaign as including minors applies every stricter default at once, and relaxing any of them is an explicit, logged choice.
- **`SAFE-07` (P1) — Shared outputs carry content warnings.** Player-facing and public outputs can carry content warnings derived from session content and the campaign's lines and veils.

---

## 14. Ownership & Portability

Commitments that follow from being self-hosted, written as testable requirements rather than values.

- **`OWN-01` (P0)** — No seat caps. A campaign's players are not billable units.
- **`OWN-02` (P0)** — No session or usage metering in the software.
- **`OWN-03` (P0)** — A fully local inference path exists and is documented (`INF-02`).
- **`OWN-04` (P0)** — Extraction is auditable end to end (`MODEL-09`, `PIPE-02`).
- **`OWN-05` (P0)** — Prompts and every other template are user-owned and user-editable, with validation protecting provenance (`INF-04`, §12).
- **`OWN-06` (P0)** — Schema is user-extensible (`MODEL-04`).
- **`OWN-07` (P0)** — Export is complete and lossless (`SHARE-06`).
- **`OWN-08` (P1)** — Behaviour is extensible by plugin (`INT-08`).
- **`OWN-09` (P0)** — Data handling is documented, and defaults favour deletion of raw material (`CAP-07`, `CAP-15`). Retaining or linking media is an explicit, per-campaign choice with its playback consequence stated, and it can be changed later.
- **`OWN-10` (P0)** — Ownership extends to participants, not only operators: each person controls their own voice profile and can redact their own words (§13).

---

## 15. Non-Functional Requirements

- **`NFR-01` (P0) — Single-command deployment** via containers, with a documented upgrade path. *Rationale:* install friction is the primary barrier to a self-hosted product reaching users; a product nobody can stand up has no users regardless of its features.
- **`NFR-02` (P0) — Cost transparency** (`INF-05`), including citation overhead.
- **`NFR-03` (P0) — Retention defaults favour deletion of audio**, with transcript governed separately and its trade-off documented (`CAP-07`).
- **`NFR-04` (P0) — Security posture** consistent with [SECURITY.md](SECURITY.md): secret handling for provider keys, an authenticated API surface, no credentials in logs.
- **`NFR-05` (P0) — Documented performance targets:** maximum session duration, processing latency budget relative to session length, video resolution and duration ceilings, live-caption latency, and campaign size ceiling. Every limit is a stated decision rather than an emergent surprise.
- **`NFR-06` (P1) — Observability:** per-stage timing, failure rates, and token spend queryable by the operator.
- **`NFR-07` (P1) — Accessibility.** WCAG 2.2 AA as the interface target. Transcript and caption availability are treated as accessibility features in their own right (§2.7).
- **`NFR-08` (P1) — Backup and restore** covering the record and its provenance, verifiable by test restore.
- **`NFR-09` (P2) — Internationalization** of the interface, independent of transcription language support (`CAP-06`).
- **`NFR-10` (P0) — Licensing and contribution** consistent with [LICENSING.md](LICENSING.md), [CLA.md](CLA.md), and [CONTRIBUTING.md](CONTRIBUTING.md).
- **`NFR-11` (P1) — Storage footprint is documented and bounded.** Video multiplies storage needs by orders of magnitude over audio. Expected storage per hour for each media type and retention setting is documented, and the operator is warned before a retention setting would exceed available storage.

---

## 16. Phased Roadmap

### Phase 0 — MVP

**Goal:** one capture surface end to end, with the provenance guarantees intact. Audio upload leads because it is the cheapest path to a complete pipeline and it covers in-person tables, which voice-channel capture does not.

Scope: `CAP-01`, `CAP-05`, `CAP-07` · the full `PIPE-*` P0 set including cite-then-check · `MODEL-01`–`MODEL-05`, `MODEL-07`, `MODEL-09`–`MODEL-13` · `OUT-01`–`OUT-05`, `OUT-08`–`OUT-10` · `QRY-01`–`QRY-04` · `SHARE-01`, `SHARE-02`, `SHARE-06` · `INF-01`–`INF-02`, `INF-04`–`INF-06` · `TPL-01`–`TPL-04` · `SAFE-01`, `SAFE-03` · `NFR-01`–`NFR-05`.

Templates and redaction are in Phase 0 on purpose. Editable prompts without validation (`TPL-03`) would ship a way to defeat provenance in the first release, and a recording product with no way to remove something said at the table should not be shipped at all.

**Exit criteria:** a GM uploads a recording, reviews a structured diff, accepts it, reads a recap, shares a player-safe variant, searches prior sessions, corrects a wrong fact and sees the recap update, and exports everything — deployed by someone who is not a maintainer, following only the documentation.

### Phase 1 — v1

Remaining audio and text surfaces (`CAP-02`–`CAP-04`, `CAP-06`) · playback from the record to the moment, with retained or linked media (`CAP-22`–`CAP-26`) · video from calls and screen recordings with visual evidence (`CAP-08`–`CAP-10`, `CAP-14`, `CAP-15`, `PIPE-10`, `OUT-14`) · photographed artifacts and between-session material (`CAP-16`, `CAP-18`) · off-the-record and live bookmarks (`CAP-19`, `CAP-20`) · per-player secrets and canon & continuity (`MODEL-14`–`MODEL-21`) · planned versus played and "as of" browsing (`PIPE-11`, `QRY-07`, `QRY-09`) · clips (`OUT-11`) · the rest of templates (`TPL-05`–`TPL-10`) · the rest of participant rights (`SAFE-02`, `SAFE-04`–`SAFE-07`) · storage bounds (`NFR-11`) · relationship edges and moments · timeline, graph, wiki links, character arcs (`NAV-01`–`NAV-04`) · open-thread surfacing · public pages · API, MCP, chat bot, first VTT integration, plugin architecture · per-stage routing · observability, accessibility, backup.

**Exit criteria:** a campaign can be run entirely through Skaldryne without touching the filesystem; an external tool can read and write the record through a documented interface; and a recorded video call produces claims whose only evidence is on screen.

### Phase 2 — v2+

Table-dynamics analytics with its stated position (`NAV-06`, `NAV-07`) · physical table cameras, visual speaker cues, and produced episodes (`CAP-11`–`CAP-13`) · event logs and live captions (`CAP-17`, `CAP-21`) · campaign branching (`MODEL-22`) · ingest by reference from an external link (`CAP-27`) · campaign chronicle and per-reader language (`OUT-12`, `OUT-13`) · visual queries (`QRY-08`) · starter packs (`TPL-11`) · maps · handouts and cards · flavour artifacts · notes-vault sync, webhooks, wiki import · assistant persona · internationalization · and a managed-hosting track, out of scope for this document beyond the requirement that nothing in Phases 0–1 forecloses it.

---

## 17. Success Metrics

| Metric | Why it matters |
| --- | --- |
| **Activation:** installs reaching a first processed session | Measures `NFR-01`. Self-hosted products die at install. |
| **Retention:** sessions per campaign over elapsed weeks | The product's value is cumulative; a campaign that stops logging has churned. |
| **Extraction precision and recall** against a hand-labelled fixture set | The dominant quality variable (§18.1). Tracked per model and per prompt version. |
| **Correction rate per session** | Proxy for output quality, and a regression signal when it rises after a prompt or model change. |
| **Cite-then-check rejection rate** | Directly measures whether the audit trail is real. |
| **Export usage** | A portability promise nobody exercises is untested. |
| **Template validation failure rate** | Shows whether `TPL-03` is catching regressions, and whether its tolerance is set too tight to be usable. |
| **Contradictions flagged per session** | Measures whether `MODEL-19` is surfacing continuity problems or staying silent. |
| **Contributor count and external plugins** | Health of the open-source premise. |

---

## 18. Open Questions & Risks

**18.1 Extraction quality is the dominant product risk.** Everything downstream renders from extracted claims. If extraction is mediocre, no amount of interface quality compensates, and the review gate turns from a safeguard into tedious manual data entry. Mitigation: a labelled fixture corpus from day one, precision and recall tracked per prompt and model version, and correction rate monitored as a regression signal.

**18.2 Inference cost falls directly on self-hosters.** Citation-bearing extraction plus a verification pass is meaningfully more expensive than naive summarization. Open question: whether cite-then-check should be configurable. The argument against is that making verification optional means most deployments ship the decorative version by default — which `PIPE-02` explicitly identifies as worse than having no audit trail. Unresolved; currently specified as mandatory.

**18.3 The local-model quality floor is unproven.** `INF-02` and `OWN-03` promise a fully local path. Whether locally runnable models can produce structured claims with reliable citations at acceptable quality is an empirical question to answer in Phase 0, not assume. If they cannot, the promise needs restating honestly rather than quietly dropping.

**18.4 Diarization of in-person tables on a single microphone** is materially harder than per-speaker channel capture, and `CAP-01` makes that the MVP path. Speaker attribution quality may be the weakest link in Phase 0.

**18.5 Consent and recording law vary by jurisdiction.** `CAP-03` requires revocable per-participant consent, but the product cannot adjudicate local law. Open question: how far the documentation should go toward jurisdictional guidance without purporting to give legal advice.

**18.6 Publishing copyrighted adventure content.** Public campaign pages (`SHARE-03`) may reproduce substantial material from commercial adventures. Open question: what guidance or guardrails belong in the product versus the documentation.

**18.7 Scope creep toward becoming a VTT.** §1.4 exists to be cited. Maps (`NAV-05`), character data, and initiative-adjacent features are the likely entry points.

**18.8 Technical architecture is unresolved.** Stack, storage, queue, schema, and identifier strategy are deliberately absent from this document. They belong in a follow-on `ARCHITECTURE.md` or ADR set, which is the recommended next step once this PRD is accepted.

**18.9 Vision is expensive, and its quality varies widely by content.** Reading a crisp VTT screen recording is very different from reading a dim phone video of a hand-drawn map. `CAP-14` bounds cost, but the quality floor — especially for local vision models (§18.3) — needs measuring against fixture recordings of each video kind before the video requirements are committed to a phase.

**18.10 Ingesting content someone else owns.** The fan chronicler (§2.6) builds a record from episodes they did not make. Transcribing and summarising a published series may conflict with its creators' rights or its platform's terms, and publishing that record adds further exposure. The product cannot adjudicate this. Open question: whether public pages (`SHARE-03`) built from third-party episodes should be disabled by default, and what attribution is required.

**18.11 Redaction and provenance are in tension.** `SAFE-01` removes claims whose only evidence was redacted, which may leave gaps in the record. The alternative — keeping those claims uncited — contradicts `MODEL-09`. This PRD takes the position that consent outranks completeness. The review experience for the resulting gaps still needs to be designed.

**18.12 Modelling knowledge and in-world truth is hard.** Distinguishing a lie from a fact, or knowing which character learned what (`MODEL-17`, `MODEL-18`), depends on context that extraction will often miss. These claims must be conservative by default and always go through review. The risk is a review burden that makes the features cost more effort than they save.

**18.13 External media platforms vary and change.** Support for seeking to a time offset, access control, and programmatic access differ by platform and change without notice, and some platforms' terms restrict automated fetching (`CAP-27`). Linked playback (`CAP-22`–`CAP-26`) must degrade to transcript and keyframes rather than break, and each location's plugin owns its own compliance with that platform's terms.
