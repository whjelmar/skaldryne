# Skaldryne — Product Requirements Document

**Status:** Draft v0.4 · **Last updated:** 2026-09-30 · **Owner:** project maintainers

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
| **Opinionated, but never locked** | Every choice ships with a strong default and the reasoning behind it, so a new table gets good results without configuring anything. Every default is a setting, template, or plugin the group can change. Customization is bounded only by the other principles: no setting can switch off provenance, visibility, consent, or review. |

### 1.4 Non-goals

Stated plainly so scope arguments have a reference point.

- **Not a virtual tabletop.** No maps-with-tokens play surface, no live initiative tracker, no dice. Combat is recorded (`MODEL-28`), not run. Skaldryne integrates with VTTs (§10) rather than replacing them.
- **Not an AI game master.** Skaldryne does not run games, play NPCs, or generate plot for the table to follow.
- **Not a rules engine in core.** Core tracks state and records outcomes — character sheets, encounters, party resources (§3.8) — but never computes or adjudicates rules. Rules-aware behaviour, such as a system's sheet layout or its action economy, comes from game-system plugins (`INT-08`) and is advisory only.
- **Not a solo-play generator.** Skaldryne records play between people. It is not a single-player narrative experience.
- **Not a content marketplace.** No selling or hosting of published adventure material.
- **Not a chat or community platform.** Skaldryne delivers messages through the channels a group already uses (§9.1) and configures its own presence on them (`INT-10`). It does not host conversation or moderate a community.
- **Not a soundboard or ambience player.** Music and sound effects at the table are left to the tools groups already use. Skaldryne records what was played when it is audible or logged, but does not play it.
- **Not a matchmaking service.** Skaldryne serves groups that already exist. It does not find players, list open games, or match strangers into tables.
- **Not a video editor.** Skaldryne can cut a clip at a cited moment (`OUT-11`); it does not edit, grade, or produce video.
- **Not a biometric identification system.** No persistent face templates in any phase (`SAFE-04`). Voice profiles exist only with consent and only within their own instance (`SAFE-03`).
- **Not a scoreboard for players.** Skaldryne celebrates what a table did together (§8.2), but never ranks, scores, or keeps streaks for the people at it (`NAV-07`).

---

## 2. Users & Jobs

### 2.1 Primary GM

Runs one ongoing campaign for a regular group. Owns the continuity problem.

- **Job:** know what happened last session without re-listening to three hours of audio. *Done when* a recap is readable in minutes and specific enough to open the next session with.
- **Job:** look up a detail mid-session without breaking the scene. *Done when* a query returns the answer in seconds, with the session it came from.
- **Job:** find the threads left open. *Done when* unresolved commitments and dangling hooks are listed without being hand-tracked.
- **Job:** share a recap with players without leaking prep. *Done when* a player-safe version exists without manual redaction.
- **Job:** walk into the next session prepared. *Done when* a prep brief built from open threads, likely NPCs, and character knowledge is ready without assembling it by hand.
- **Job:** tell one player a secret, at the table or between sessions. *Done when* it reaches only that player, through the channel they prefer, and enters the record with that player's visibility.

### 2.2 Multi-table GM

Runs several campaigns, sometimes professionally. Context-switching is the core difficulty.

- **Job:** re-enter the right campaign's headspace before a session. *Done when* a per-campaign catch-up brief is available on demand.
- **Job:** keep campaigns strictly separated. *Done when* no query or generated output can leak across campaign boundaries.

### 2.3 Player

Attends sessions, may miss some, cares about their own character's arc.

- **Job:** catch up after missing a session. *Done when* a spoiler-free summary is readable without an account.
- **Job:** remember their own character's history and relationships. *Done when* a character view shows arc and connections over time.
- **Job:** correct the record about their own character. *Done when* they can edit their character's entry without GM mediation.
- **Job:** get better at playing their character, if they want to. *Done when* private, opt-in suggestions about their own play are available, and nobody else sees them.

### 2.4 Club or shared-world admin

Manages many tables in one setting, often with overlapping canon and rotating GMs.

- **Job:** maintain shared canon across tables. *Done when* multiple campaigns can reference common entities without duplicating them.
- **Job:** control who sees what. *Done when* per-entity and per-journal visibility is enforceable.
- **Job:** bring members in and out cleanly. *Done when* joining is an invite link, chat-server roles map to campaign roles, and removing someone revokes their access everywhere at once.
- **Job:** trust what the club installs. *Done when* every plugin shows what it can reach, and nothing reaches data it was not granted.

### 2.5 Actual-play creator

Records for an audience. Needs publishable output and accurate attribution.

- **Job:** produce episode summaries and show notes. *Done when* publication-ready output requires editing rather than authoring.
- **Job:** keep per-speaker audio intact for production. *Done when* multi-track capture survives the pipeline unmixed.
- **Job:** turn a produced video episode into a record without discarding what was shown on screen. *Done when* maps, handouts, and on-screen text that appeared in the episode are citable evidence, not lost when the audio track is extracted.
- **Job:** find and publish highlight clips. *Done when* a moment in the record exports as a clip bounded by its evidence span.
- **Job:** show the game's world to a live audience. *Done when* the current scene, NPC names, and quests appear on the broadcast without exposing anything GM-private.
- **Job:** keep guests and crew who did not sign up out of the record. *Done when* anyone recorded without consent stays unattributed and out of published output.

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

### 2.8 Instance operator

Runs the software for a group: often the GM, sometimes the one technical person in a club. Not necessarily an engineer, and accountable for other people's data.

- **Job:** install, upgrade, and restore without specialist help. *Done when* deployment is one command, upgrades are documented, and a backup restores cleanly.
- **Job:** know what it costs and keep it within budget. *Done when* cost is shown before and after each session, per stage and per backend, and budgets are enforced.
- **Job:** choose models with confidence. *Done when* the operator can measure whether their backends are good enough before trusting them with a real campaign.
- **Job:** keep keys, data, and plugins safe. *Done when* secrets never appear in logs or exports, and plugins reach only what they were granted.
- **Job:** answer a privacy request. *Done when* a request from anyone who was recorded, member or not, is fulfilled in one workflow with a record that it was done.

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
- **`MODEL-23` (P0) — Aliases and entity resolution.** Every entity holds a canonical name alongside alternative spellings, nicknames, titles, and epithets ("the old wizard", "Grandmother"). Extraction resolves each mention to an existing entity before proposing a new one. Review supports merging duplicates and splitting a wrongly merged entity, and every claim follows its entity. *Rationale:* the structured diff (`PIPE-04`) is only as good as its matching. A record that grows a new NPC every time a name is misheard or a character is called by a title fragments quietly and becomes unsearchable. *Acceptance:* in a fixture campaign where one NPC is referred to by three names and one misspelling, extraction proposes a single entity, and a merge performed in review rewrites no evidence spans.

### 3.4 Provenance

- **`MODEL-09` (P0) — Every machine-derived claim carries an evidence span, a confidence value, and an extraction version.** The span is an offset *range* into the source, not a point timestamp — a claim is established by a passage, not an instant. Sources are not only transcripts: a span may be a time range plus frame region of video (`CAP-09`), a region of a photographed page (`CAP-16`), or a range of an event log (`CAP-17`). The extraction version identifies the exact template versions used (`TPL-04`). *Acceptance:* any claim in the record resolves to the passage, frame, or page region that produced it in one navigation step.

- **`MODEL-10` (P0) — Confidence is derived from structural signals, never self-reported by the model.** Candidate signals include corroboration across multiple speakers, corroboration across modalities (a name both spoken and shown on screen), a participant bookmark on the span (`CAP-20`), repetition across the session, transcription quality over the span, and whether the claim was later contradicted. The specific signal set and scoring are architecture decisions; *that confidence must not be a model's own assertion about itself* is a product requirement.
  *Rationale:* language models are poorly calibrated about their own certainty. A "high confidence" badge that merely reflects an assertive generation is worse than no badge at all — it launders uncertainty into false assurance and teaches the GM to stop checking.
  *Acceptance:* the confidence value for a claim can be explained in terms of observable properties of the source material.

- **`MODEL-11` (P0) — Corrections are append-only first-class events.** A correction records who changed what, when, the superseded value, and optionally why. It is not an in-place overwrite. Corrections propagate to every derived output (`OUT-10`).
- **`MODEL-30` (P1) — An accepted session can be reverted as a whole.** A GM who accepted a bad diff can revert everything that session's review committed in one action. The revert is itself an append-only event (`MODEL-11`): it records who reverted and why, leaves corrections made to other sessions intact, and shows which later claims depended on the reverted ones so the GM can decide what happens to them. The session can then be reviewed again. *Rationale:* a review mistake is made once, and repairing it one fact at a time invites a second mistake. *Acceptance:* reverting a session whose diff introduced forty claims removes all forty from search, chat retrieval, and outputs in one action, and re-reviewing it restores only what is accepted the second time.
  *Rationale:* this is what prevents one early extraction error from becoming permanent canon, and it makes the record's own history inspectable.
  *Acceptance:* the full revision history of any claim is retrievable, and correcting a claim once updates every rendering that depends on it.

### 3.5 Visibility

- **`MODEL-12` (P0) — Every record carries a visibility level:** GM-private, player-visible, or public.
- **`MODEL-13` (P0) — Visibility is enforced at query time, including inside AI retrieval.** A secret that leaks through the chat interface is still leaked; filtering rendered output is not sufficient, because the generation itself must never see out-of-scope material. *Acceptance:* an adversarial prompt to the campaign assistant, issued by a player, cannot surface GM-private content.
- **`MODEL-14` (P1) — Visibility can be scoped to named players.** A secret backstory, a private vision, or a handout passed to one character is visible to the GM and that player only. Three levels are not enough; the most important secrets at a table are usually between the GM and one person. *Acceptance:* a record scoped to one player is absent from every other player's search, chat, and rendered output.
- **`MODEL-24` (P1) — More than one GM.** Co-GMs, and rotating GMs in a shared world, each hold their own GM-private material. GM-private visibility can be scoped to named GMs, and a GM can share prep with another GM without making it player-visible. *Acceptance:* in a two-GM campaign, a secret held by one GM is absent from the other's search, chat, and outputs until it is shared.

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

### 3.7 Sessions & participants

Who was at the table, and what kind of game it is, changes what the record may say.

- **`MODEL-25` (P0) — Attendance is recorded per session.** Each session records which people attended and which characters they played, including guests, drop-ins, and a character run by a stand-in. Attendance is proposed from diarization and identity links (`CAP-05`, `SHARE-07`) and confirmed in review. It drives catch-up briefs (`OUT-03`), character knowledge (`MODEL-18`), consent checks (`CAP-03`), and notifications (`MSG-01`). *Acceptance:* a player marked absent receives a catch-up brief for that session, and their character is not recorded as knowing its revelations.
- **`MODEL-26` (P1) — Campaign lifecycle.** A session-zero record captures expectations, tone, and safety tools (`SAFE-02`) as the campaign's first entry. One-shots, short arcs, and open-ended campaigns are distinct kinds, each with suitable defaults. A finished campaign can be concluded and archived read-only, and stays searchable and exportable. *Acceptance:* an archived campaign accepts no new sessions, remains readable by its members, and can be reopened by its owner.
- **`MODEL-31` (P1) — Continuous play has sessions too.** Play-by-post and other asynchronous campaigns have no natural session boundary, so the campaign chooses how one is drawn: by date window, by chat thread or channel, or by the GM marking a break. Each resulting segment is processed, reviewed, and recapped like a session, with attendance taken from who posted. Posts that arrive after a segment is reviewed go into the next segment, never silently into an accepted one. *Acceptance:* a month of play-by-post imported from a chat channel with weekly windows produces four reviewable segments, each with its own recap and attendance.

### 3.8 Play state

Tables care about the concrete state of play: who holds the cursed sword, what the party owes the guild, what level a character reached, how a fight went. Skaldryne tracks that state and records how it changed, with evidence, like any other claim. Core does not calculate it (§1.4): a hit-point total is recorded as stated at the table or synced from a sheet, never computed from a damage roll.

- **`MODEL-27` (P1) — Character sheets are versioned state.** A PC's sheet — level, attributes, abilities, conditions, inventory, and any system-specific field — is stored as a sequence of snapshots tied to sessions, not as a single current value. Snapshots come from VTT sync (`INT-04`), photographed sheets (`CAP-16`), player edits (`SHARE-02`), or claims accepted in review. Sheet structure comes from the game-system plugin (`INT-08`); without one, a sheet is a set of user-defined fields (`MODEL-04`). *Acceptance:* the record answers "what did this character have at the start of session twelve", and a sheet change made at the table cites the moment it happened.
- **`MODEL-28` (P1) — Encounters are recorded.** A fight, chase, or other structured scene is recorded as an encounter: participants, the sequence of rounds or turns where known, notable actions, and the outcome, each with evidence. Encounters are proposed from the transcript; VTT combat and dice logs (`CAP-17`) add precision when present but are not required. *Acceptance:* an encounter proposed from audio alone lists its participants and outcome with citations, and one with an attached combat log also lists its turn order.
- **`MODEL-29` (P1) — Party resources have custody and a ledger.** Items record who holds them and when custody changed. Money, debts, favours, and shared treasure are tracked as ledger entries with evidence. Splitting loot is recorded, not calculated. *Acceptance:* the custody history of an item and the balance of a debt both trace to the sessions that changed them.

---

## 4. Capture & Ingest

Groups play in different places with different equipment. Capture cannot assume one setup, so several surfaces are first-class.

### 4.1 Audio & text

- **`CAP-01` (P0) — Audio file upload.** Mixed or multi-track, from any source (phone, laptop, conference mic, streaming software, VTT recording). Long sessions supported with a documented ceiling on duration and file size. *Acceptance:* a four-hour in-person recording from a single phone processes end to end.
- **`CAP-02` (P1) — Voice-channel capture.** A bot joins a group's voice channel on command, records **per-speaker tracks** rather than a single mix, and produces in-progress chapter summaries during play. Initial target: Discord. *Acceptance:* per-speaker tracks survive to diarization unmixed.
- **`CAP-03` (P0) — Recording consent is explicit and revocable per participant.** Consent state is recorded, visible to participants, and withdrawable; withdrawal is honoured for future capture and triggers a documented path for handling prior material. *Rationale:* recording people speaking in character still records people speaking, and consent law varies by jurisdiction (§18.5).
- **`CAP-04` (P1) — Text ingest.** Pasted raw notes, uploaded transcript files (`.txt`, `.md`, `.docx`), and imported chat message ranges for play-by-post campaigns. *Acceptance:* a play-by-post campaign with no audio at all can use the full pipeline.
- **`CAP-05` (P0) — Speaker diarization with persistent voice profiles.** Speaker-to-player-to-character mapping is learned once and reused across sessions. *Acceptance:* session two requires no re-mapping of returning speakers.
- **`CAP-06` (P1) — Multilingual transcription, including mixed-language sessions.** A table that plays in one language and jokes in another is a single recording, not two. *Acceptance:* language switches mid-session do not truncate or garble the transcript.
- **`CAP-07` (P0) — Audio and transcript retention are governed separately.** For raw audio the operator chooses, per campaign, among three options: **delete** after successful processing, **retain** a copy in Skaldryne's storage, or **link** to a copy held elsewhere (§4.5). Delete is the default, and the choice is presented when the campaign is created, with its consequence stated: only retain and link allow playback of the moment behind a claim (`CAP-22`). Link is offered once linked media ships (`CAP-23`); until then the choice is delete or retain. The transcript is retained by default, because evidence spans (`MODEL-09`) resolve against it.
  *The trade-off must be stated to the operator in plain language:* deleting the transcript degrades the record from auditable to merely asserted. Transcript deletion is offered as an explicit choice with its consequence documented, not as a silent default in either direction.
  *Acceptance:* retention policy for audio and for transcript are independently configurable, and the interface states what is lost by deleting each.
- **`CAP-28` (P0) — The campaign glossary feeds transcription.** Entity names, aliases (`MODEL-23`), and system terminology from plugins (`INT-08`) are supplied to speech recognition as vocabulary hints where the backend supports them, and used to correct recognised text where it does not. The glossary grows with the record, and users can add entries directly, with pronunciations. *Rationale:* invented names are exactly the words speech recognition gets wrong, and they are the words the record depends on most. *Acceptance:* on a fixture session, glossary-assisted transcription measurably reduces misspelled entity names compared with transcription without it.
- **`CAP-29` (P1) — Backlog import.** An existing campaign can be brought in whole: past recordings, notes, and documents are queued as a batch, with a cost and time estimate shown before anything runs (`INF-05`). Sessions process in chronological order, so each is diffed against the canon of the sessions before it, and review can be batched (`PIPE-15`) or delegated. *Acceptance:* a fifty-session backlog shows its estimate first, can be paused and resumed, and produces a record in which later sessions build on earlier canon.
- **`CAP-30` (P1) — Split party: simultaneous scenes in one session.** When the party splits across rooms, voice channels, or tables, each scene is captured as its own stream belonging to the same session, with its own attendance (`MODEL-25`). Claims from a scene default to the visibility of the people present in it, so a character does not know what happened in a scene they were absent from (`MODEL-18`). The timeline and recap interleave the scenes in play order, and review shows them side by side. *Acceptance:* in a session split into two concurrent scenes, a player's catch-up brief and their character's knowledge include only their own scene until the table shares the other.
- **`CAP-31` (P1) — Multiple and imperfect recordings.** A session can have several recordings: two phones on one table, a recorder that died and was restarted, a voice channel plus a room microphone. Overlapping recordings are aligned and merged into one transcript, using the clearer source for each span, and each evidence span records which source it came from. Gaps are recorded as gaps: a recap never bridges missing time as though it were continuous, and the GM can fill a gap with notes (`CAP-04`), marked as notes rather than transcript. *Acceptance:* two overlapping phone recordings of one session produce a single transcript with no duplicated speech, and a twenty-minute gap appears as missing in the timeline and the GM-private recap.

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

- **`PIPE-06` (P1) — Extraction verbosity is configurable** across at least three levels (essential / balanced / exhaustive), trading recall against review burden.

- **`PIPE-07` (P0) — Reprocessing is idempotent.** Re-running a session does not duplicate entities or beats, and does not silently discard accepted human corrections. *Acceptance:* reprocessing a reviewed session preserves corrections and reports what changed.

- **`PIPE-08` (P0) — Per-stage failure isolation, retry, and resumption.** A failure in one stage does not discard completed upstream work. *Acceptance:* a transcription failure on a three-hour upload does not require re-uploading.

- **`PIPE-09` (P1) — Pipeline progress and per-stage status are visible** while a session processes.

- **`PIPE-10` (P1) — Visual and audio evidence merge into one set of claims.** The visual branch produces claims with frame citations. Where both branches support the same claim, they corroborate it rather than duplicating it. Cite-then-check (`PIPE-02`) applies to visual citations as well. *Acceptance:* a name spoken aloud and shown on screen produces one claim with two evidence spans, not two claims.

- **`PIPE-11` (P1) — Planned material is never committed as played.** GM prep ingested as a journal (`MODEL-07`) is marked as planned. The pipeline can match what happened against what was planned, but prep never enters canon as though it occurred. *Acceptance:* a prepared encounter the party skipped does not appear in any recap.
- **`PIPE-12` (P0) — Extraction quality is measured, not assumed.** Skaldryne ships an evaluation suite: fixture sessions annotated by hand with the expected claims, entities, planted secrets, and planted instruction-injection attempts (`PIPE-13`). It reports claim precision and recall, citation accuracy, entity-resolution accuracy (`MODEL-23`), player-safe leak rate (`OUT-09`), and injection resistance. The suite runs in continuous integration against the default templates as a regression gate, and operators can run it against their own configuration (`INF-07`). *Rationale:* extraction quality is the dominant product risk (§18.1), and a risk that is not measured cannot be managed. *Acceptance:* a change to a default template that drops any reported score below its threshold fails the build.
- **`PIPE-13` (P0) — Source material is data, never instructions.** Everything Skaldryne ingests — transcripts, uploaded documents, whispers, chat logs, captions, on-screen text — can contain text that reads as instructions to a model, whether planted deliberately or said in play. The pipeline treats all of it as data. Source material is kept structurally separate from instructions in every model call. A render for an audience is assembled only from claims that audience may see, so GM-private content is never in the context of a player-safe render in the first place, rather than filtered out afterwards. Model-proposed actions are limited to proposals that go through review (`PIPE-05`). *Rationale:* the product's central promise is keeping secrets, and a model that follows an instruction hidden in a player's uploaded backstory can break that promise without anyone noticing. *Acceptance:* the evaluation suite's injection fixtures, including an uploaded document instructing the model to reveal GM notes, produce no leak into any player-facing output and no action outside review.
- **`PIPE-14` (P1) — Old sessions can benefit from better models and templates.** When a newer model, backend, or extraction template scores better on the evaluation suite (`PIPE-12`), the operator is told which sessions were processed with older versions (`TPL-04`) and what re-extraction would cost (`INF-05`). Re-extraction is opt-in, per campaign or per session, runs through the same idempotent path (`PIPE-07`), and produces a structured diff for review, so accepted corrections survive and only changes the GM accepts reach the record. *Rationale:* without it, a campaign's earliest sessions stay at the quality of the release that first processed them. *Acceptance:* after a template upgrade, the operator sees how many sessions are affected and the estimated cost, and re-extracting one session yields a diff containing only the differences.
- **`PIPE-15` (P1) — Bulk review keeps the gate without the drudgery.** Reviewing many sessions at once — a backlog (`CAP-29`) or a re-extraction (`PIPE-14`) — is still human review (`PIPE-05`), with tools that make it proportionate. The reviewer can accept every claim above a chosen confidence level in one action, while still reviewing individually every claim below it, every contradiction (`MODEL-19`), everything GM-private or per-player, and every new entity merge (`MODEL-23`). Bulk acceptance is recorded as the reviewer's decision, with the threshold used. *Acceptance:* a ten-session batch can be reviewed by handling only its flagged items individually, and the record shows which claims were accepted in bulk and at what threshold.

---

## 6. Output & Synthesis

Every output here is a **rendering of the record** (`MODEL-01`), never independently stored prose.

- **`OUT-01` (P0) — Narrative recap** in prose, suitable for reading aloud or sharing.
- **`OUT-02` (P1) — Structured outline** of the session: beats, participants, locations, outcomes.
- **`OUT-03` (P0) — Catch-up brief** for a player returning after absence, scoped to what they can know.
- **`OUT-04` (P0) — Compendium entries** for entities, updated as sessions accumulate rather than rewritten.
- **`OUT-05` (P0) — Quest-log delta:** what changed in objective state this session.
- **`OUT-06` (P1) — Per-player character journal**, written in that character's voice.
- **`OUT-07` (P2) — In-world flavour artifacts**, such as a newspaper or chronicle framing of recent events.

- **`OUT-08` (P1) — Tone and length are configurable** via presets and freeform instruction, per campaign, changeable at any time without reprocessing.

- **`OUT-09` (P0) — Every output renders in both a GM-private and a player-safe variant, generated together.** The GM must never hand-redact a recap before sharing it. *Acceptance:* the player-safe variant of any output contains no content marked GM-private, verified against a fixture campaign containing planted secrets.

- **`OUT-10` (P0) — Corrections regenerate affected outputs.** If rendered prose is cached for performance, invalidation on record change is a requirement, not an optimization.
  *Rationale:* a stale recap still displaying a corrected error defeats the entire provenance design — the user sees the wrong fact and has no signal that it was fixed.
  *Acceptance:* correcting a claim updates every rendered output containing it, with no manual regeneration step.

- **`OUT-11` (P1) — Clips.** A moment (`MODEL-06`) or any claim with an audio or video span can be exported as a clip bounded by that span, individually or as a highlight reel. Clips can be cut from a retained copy, or from linked external media where the operator can access it (`CAP-23`). Clips respect consent (`CAP-03`) and redaction (`SAFE-01`). *Acceptance:* a clip cannot be cut from a span that has been redacted or whose speaker withdrew consent.
- **`OUT-12` (P2) — Campaign chronicle.** An entire campaign or arc is compiled into a long-form, book-like document for print or e-reader, with chapters, an index of entities, and optional illustrations from the record. *Rationale:* a campaign that ran for three years deserves an artifact the group can keep on a shelf.
- **`OUT-13` (P2) — Per-reader language.** Outputs render in each reader's chosen language, independently of the language the session was played in.
- **`OUT-14` (P1) — Visual evidence in outputs.** Recaps and compendium entries may embed cited keyframes, handouts, and photographed artifacts, subject to the same visibility rules as the text around them.
- **`OUT-15` (P1) — Next-session prep brief.** Built from the record for the GM before each session: open threads and dangling hooks (`QRY-05`), NPCs and locations likely to reappear with how they were last portrayed, what each character knows (`MODEL-18`), unused prep worth reusing (`QRY-07`), and a read-aloud "previously on" with a player-safe variant. Its sections are a template (`TPL-07`). *Acceptance:* the brief is ready once a session is accepted, and every item in it links to its evidence.
- **`OUT-16` (P1) — Session awards.** After a session, the record nominates moments for awards — best line, MVP, clutch play, best roleplay — from moments, bookmarks, and quotes (`MODEL-06`, `CAP-20`). The table votes in the web interface or through the chat bot (`INT-10`), and winners are stored as moments with their evidence. Categories, voting rules, and whether awards exist at all are campaign settings. The default set is small and celebratory, and there are no negative awards. *Acceptance:* an award plays back its moment (`CAP-22`), and a campaign can switch awards off entirely.
- **`OUT-17` (P2) — Audio recap.** A session or arc recap is rendered as a narrated audio episode through a text-to-speech backend (`INF-01`), optionally interleaved with clips of the actual moments (`OUT-11`). Narration never imitates a participant's voice without that participant's explicit consent, governed like a voice profile (`SAFE-03`). A player-safe variant is produced alongside (`OUT-09`). *Acceptance:* the audio recap can be published as a podcast episode, and every interleaved clip respects consent and redaction.
- **`OUT-18` (P2) — Arc infographics.** A session, arc, or campaign renders as a one-page visual summary: route through locations, key beats, faction standings, quest outcomes, and the characters involved. The layout is generated deterministically from the record, not drawn by a model; generated illustration is optional and labelled. Layouts are templates. *Acceptance:* every element in an infographic traces to a claim, and its player-safe variant omits GM-private content.
- **`OUT-19` (P1) — Readers can flag outputs.** Anyone reading an output can flag a passage as wrong, missing something, too long, or off-tone. A flag on a factual error opens a correction against the underlying claim (`MODEL-11`); a flag on form goes to the GM as feedback on the template that produced it. Flag rates per template are reported (§17). *Rationale:* review catches errors before commit, but readers find the rest, and without a path back their knowledge is lost. *Acceptance:* flagging a wrong fact in a player-safe recap creates a correction proposal citing the flagged passage, visible to the GM in review.
- **`OUT-20` (P2) — Live-stream overlays.** For creators broadcasting play, Skaldryne serves an overlay source that shows the current scene, the names of NPCs as they appear, active quests, and recent moments, updated from the live transcript (`CAP-21`) and the record. Only content marked public-safe appears, and the GM can hold or clear the overlay instantly. *Acceptance:* a newly introduced NPC's name appears on the overlay within the live-caption latency target, and a GM-private NPC never does.

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
- **`QRY-10` (P1) — At-table lookup.** During play, a GM-only lookup answers names, facts, and "what did they promise" questions from the record and, once live captions exist (`CAP-21`), from the live transcript of the session in progress. The answer and its source appear on a phone or second screen within the latency target (`NFR-05`). *Acceptance:* a fact from any processed session is returned with its source within the target; with live captions enabled, an NPC introduced an hour earlier in the same session is found before the session has been processed.

---

## 8. Navigation & Visualization

- **`NAV-01` (P1) — Interactive timeline** with multiple layouts, and editable, reorderable nodes.
- **`NAV-02` (P1) — Relationship graph** across entities, factions, and locations, with filtering by type and time range.
- **`NAV-03` (P1) — Bidirectional wiki linking** with `[[bracket]]` syntax, hover previews, and link integrity maintained through renames and aliasing. *Acceptance:* renaming an entity does not orphan existing links.
- **`NAV-04` (P1) — Character arc view:** one character's history, relationships, and turning points over time.
- **`NAV-05` (P2) — Interactive maps** with nested zoom, region shapes, routes, and party position.
- **`NAV-08` (P1) — Quest board.** The current state of every objective (`MODEL-05`), filterable by status, giver, faction, and character, with each objective's history and the sessions that changed it. Players see the board through their visibility scope. *Acceptance:* a quest's lifecycle, from the session it was given to the session it ended, is readable in one view.
- **`NAV-09` (P1) — Roster.** Every character, PC and NPC, with appearance count, first and last session seen, who voiced them, relationships (`NAV-02`), and dormancy — NPCs not seen for a configurable number of sessions. Each session also has its own roster of who appeared. *Rationale:* a GM's NPC cast grows without limit, and the NPCs players care about are often the ones the GM has forgotten. *Acceptance:* the roster sorts NPCs by last appearance, and each entry opens that character's arc (`NAV-04`).
- **`NAV-10` (P1) — World history.** The GM authors the setting's history — eras, wars, foundings, prophecies — on the same in-world calendars as played beats (`MODEL-20`). The timeline (`NAV-01`) shows authored history and played events together or separately. Authored history carries visibility like any record and is marked as authored rather than played. *Acceptance:* the timeline shows a five-hundred-year authored history with the campaign's played beats at their in-world positions, and a player sees only the parts visible to them.

### 8.1 Table dynamics & analytics

- **`NAV-06` (P2) — Table-dynamics analytics** — speaking-time share, spotlight balance, pacing, sentiment trend, engagement over time — presented as a facilitation aid for the GM.

- **`NAV-07` (P2) — The product states a position on quantifying players, in the interface and in the documentation.** At minimum: which metrics are deliberately *not* computed, who can see per-person figures, and whether per-person metrics can be disabled entirely. Some things are never built, in any phase or under any setting: leaderboards, points or experience for players, streaks, and any ranking of people by a per-person measure such as speaking time or the number of claims their speech produced. Celebration features (§8.2) reward the group and the story, never one player against another.
  *Rationale:* these numbers describe the GM's friends. "The quiet player spoke 6% of the time" is useful for noticing someone has been sidelined and corrosive as a scoreboard, and which one it becomes depends on framing and audience. Shipping per-person scores without taking a position is still a position — taken by omission, and by default the less careful one.
  *Acceptance:* per-person metrics have a documented default audience and an off switch.
- **`NAV-11` (P2) — Opt-in play coaching for players.** A player can ask for private suggestions about their own play: abilities they often forget, options they have never used, spotlight openings they passed up. Rules-aware suggestions ("you have not used your bonus action in four encounters") need a game-system plugin that defines those rules (`INT-08`), plus sheets and encounters (`MODEL-27`, `MODEL-28`); without one, suggestions are limited to narrative patterns. Coaching is off by default, is enabled only by the player it concerns, is visible only to that player unless they share it, and never reaches the GM as a ranking (`NAV-07`). *Acceptance:* no one but the player can see their coaching, including the campaign owner, and switching it off deletes it.
- **`NAV-12` (P2) — GM self-review.** For the GM only: prep used versus prepared (`QRY-07`), threads opened versus paid off, NPC introduction and reuse, and the balance of combat, exploration, and roleplay against plan. Framed as reflection, not a score. *Acceptance:* GM analytics are visible only to the GM they describe.
- **`NAV-13` (P2) — Trends across sessions.** Any per-session measure can be viewed as a trend over the campaign: pacing, open-thread count, rate of new entities, spotlight balance. *Acceptance:* each point on a trend opens the session behind it.
- **`NAV-14` (P2) — Across campaigns.** A GM running several campaigns sees their own patterns across them — pacing, prep usage, thread resolution — and can reuse their own authored material (NPCs, locations, prep) in another campaign by explicit copy. Only aggregates cross campaign boundaries on their own; content never does (§2.2). *Acceptance:* no query, output, or suggestion in one campaign surfaces content from another unless it was deliberately copied.

### 8.2 Celebration & discovery

Everything in this section rewards the group and the story. Each item is a campaign setting, off by default in a campaign that includes minors (`SAFE-06`), and bound by the exclusions in `NAV-07`.

- **`NAV-15` (P2) — Campaign milestones.** The record marks milestones the whole table reached: the tenth session, a year of play, the first arc completed, the hundredth NPC met. Each milestone links to the session or moment that reached it (`MODEL-06`), and a campaign can edit the set, add its own, or switch milestones off. Milestones belong to the campaign, never to one person. *Acceptance:* a milestone opens the session behind it, and no milestone names or counts an individual player.
- **`NAV-16` (P2) — Discovery progress.** A player can see how much of the world their character has uncovered: districts visited, factions met, how much of a known hierarchy is filled in. Progress is counted only over what that player may see (`MODEL-13`), and a total is shown only when the GM has made the total itself player-visible, so progress can never reveal that hidden content exists. Each player sees only their own progress. *Rationale:* it rewards curiosity about the world rather than any measure of how someone plays. *Acceptance:* adding a GM-private location changes no player's progress display.
- **`NAV-17` (P2) — Recall prompts before a session.** Before play, a player can take a short, optional set of questions drawn from the player-safe recaps of recent sessions (`OUT-09`), to refresh what their character knows. Answers are not stored, scored, or shown to anyone else. *Acceptance:* every prompt cites the recap passage that answers it, and no prompt draws on content the player may not see.
- **`NAV-18` (P2) — Credit for contributions to the record.** Award categories (`OUT-16`) can credit what players write into the record, such as journal entries, backstory, and in-character letters (`MODEL-07`, `SHARE-02`), as well as moments at the table. Nominations cite the contribution, and credit is for the writing, never for its volume. *Acceptance:* a contribution award opens the entry it celebrates, and no category is computed from word counts or entry counts.

---

## 9. Sharing, Publishing & Export

- **`SHARE-01` (P0) — Role-based permissions:** owner, admin, GM, player, guest — with per-entity and per-journal overrides.
- **`SHARE-02` (P0) — Players edit their own character** without GM mediation.
- **`SHARE-03` (P1) — Public read-only campaign pages** requiring no account from the reader. Raw transcripts are never public.
- **`SHARE-04` (P2) — Printable session handouts** with selectable sections and visual themes.
- **`SHARE-05` (P2) — Trading cards.** Characters, NPCs, items, locations, and moments render as collectible cards — art, a line of flavour, and fields chosen from the record — shareable as images, printable as sheets, and collected into a campaign set. Card layouts are templates, and fields can come from sheets (`MODEL-27`) or user-defined types (`MODEL-04`). Awards (`OUT-16`) can unlock cards. *Acceptance:* a card respects its viewer's visibility, and a card for a GM-private NPC cannot be generated for a player.

- **`SHARE-06` (P0) — Complete data export.** Two formats: a full-fidelity structured export that round-trips into a fresh instance without loss, and a Markdown-plus-wikilink bundle that opens directly in a plain-text notes vault.
  Export is a stated project principle, not a feature: a campaign record is a multi-year artifact, and the group must be able to leave with all of it whenever they choose.
  *Acceptance:* a full export re-imported into an empty instance reproduces the original record, including provenance and correction history.
- **`SHARE-07` (P0) — Accounts, invitations, and identity links.** The GM invites players by link. People sign in with local accounts or through a single sign-on provider the operator configures, and read-only guests need no account. Each person's identity links their chat-platform account, voice profile (`SAFE-03`), character or characters (`MODEL-16`), and delivery preferences (`MSG-02`). *Rationale:* consent, biometric ownership, per-player visibility, and whispers are only enforceable if the product knows which person a voice, a chat account, and a character belong to. *Acceptance:* a player joins from an invite link, consents to a voice profile, and is attributed correctly in the next session without the GM mapping them. The chat-account link and delivery preferences arrive with chat capture and messaging (`CAP-02`, `MSG-02`), and from then on joining includes linking a chat account.

### 9.1 Messaging, whispers & notifications

The group already has places where it talks: a chat server, text messages, email, a workplace chat. Skaldryne sends through those rather than asking people to check another inbox.

- **`MSG-01` (P1) — Notifications.** People are told when something needs them or concerns them: review is waiting, processing finished or failed, a recap is ready, a consent request is pending, a whisper arrived, or linked media broke (`CAP-25`). Each person can switch each notification type off. *Acceptance:* each event in this list notifies the right people and no one else.
- **`MSG-02` (P1) — Each person chooses their channel.** Delivery goes where each person prefers: a direct message on the campaign's chat platform by default, with email, SMS, and other messaging services available through delivery plugins. *Acceptance:* two players in one campaign receive the same notification on different channels, each by their own choice.
- **`MSG-03` (P1) — Whispers.** The GM can send a private message to one player or a subset of the table, and players can whisper to the GM, from the web interface, a bot command, or a phone, during play or between sessions. Delivery follows each recipient's channel choice (`MSG-02`). *Acceptance:* a whisper sent at the table reaches its recipient within seconds and is visible to no other player in any channel.
- **`MSG-04` (P1) — Whispers are part of the record.** A whisper enters the record scoped to its sender and recipients (`MODEL-14`), is available as between-session material for extraction (`CAP-18`), and can carry a handout. Replies arriving by any channel are threaded back to their whisper. The sender can choose to keep a whisper out of the record. *Acceptance:* a whisper and its reply by text message appear as one thread in the record, visible only to the GM and that player.
- **`MSG-05` (P1) — Session scheduling.** The GM proposes dates, players answer an availability poll through their chosen channel (`MSG-02`) or the chat bot (`INT-10`), and the confirmed session is sent as a calendar invitation with reminders. Expected attendance feeds the prep brief (`OUT-15`) and is reconciled with actual attendance (`MODEL-25`). *Acceptance:* a GM schedules a session from a poll without leaving Skaldryne or the chat platform, and each player receives reminders on their own channel.

---

## 10. Integrations & Extensibility

- **`INT-01` (P1) — Read/write REST API** with scoped, revocable tokens.
- **`INT-02` (P1) — MCP server** exposing campaign read and write, so any compatible AI client can serve as a front end. Write access requires an explicit scope grant. Automations (`INT-09`) are exposed as tools, so an AI client can run them.
- **`INT-03` (P1) — Chat-platform bot beyond capture:** post recaps, answer questions in-channel.
- **`INT-04` (P1) — Bidirectional VTT sync** for journals, actors, and compendium entries. Initial target: Foundry. Subsequent: Roll20.
- **`INT-05` (P2) — Plain-text notes-vault sync**, consistent with the export format in `SHARE-06`.
- **`INT-06` (P2) — Outbound webhooks** on session completion and record change.
- **`INT-07` (P2) — Import from common hosted campaign-wiki export formats.**
- **`INT-08` (P1) — Plugin architecture for game-system behaviour.** System-specific extraction hints, entity types, and terminology live in packages, not in core. *Rationale:* the number of systems is unbounded and core cannot absorb them. *Acceptance:* a new system's support can be added without modifying core.
- **`INT-09` (P1) — Automations.** Users define workflows as a trigger, optional conditions, and actions — for example, "when a session is accepted, post the player-safe recap to the recaps channel and send each absent player their catch-up brief". Triggers include record events, schedules, and chat commands. Actions include rendering outputs, delivering messages (§9.1), calling webhooks (`INT-06`), and invoking MCP tools (`INT-02`). Skaldryne ships a small library of starter automations, and automations are portable like templates (`TPL-10`). An automation runs with the permissions of the person who created it and cannot commit to canon without review (`PIPE-05`). *Acceptance:* the example above runs end to end from a starter automation, and an automation that attempts to accept a diff is refused.
- **`INT-10` (P1) — Discord server integration.** Beyond voice capture (`CAP-02`) and posting (`INT-03`), Skaldryne maps server roles to campaign roles (`SHARE-01`), can create a campaign's channels and threads (one thread per session by default), and offers commands for lookup, bookmarks, consent, whispers, and award voting. Discord is the initial target; other chat platforms follow through the same interface. Skaldryne configures its own channels and roles but does not moderate the server (§1.4). *Acceptance:* a GM adds the bot to a server and links a campaign, and players holding the mapped role gain campaign access without separate invitations.
- **`INT-11` (P1) — Plugins run with declared, granted permissions.** Every plugin declares what it needs — which record data, which visibility scopes, network access, and which external services — and the operator grants it at install. A plugin never receives GM-private or per-player content unless that scope was granted, and is isolated from core and from other plugins. Plugins carry a trust level: bundled, signed by a known publisher, or unsigned, and installing an unsigned plugin requires an explicit choice. *Rationale:* rules, delivery, media locations, and automations all run as plugins, so the plugin boundary is where secrets and participants' data would leak. It ships with the plugin architecture (`INT-08`), never after it. *Acceptance:* a plugin that attempts to read a scope it did not declare is refused and the attempt is logged.
- **`INT-12` (P1) — A versioned plugin interface, with data migrations.** The plugin interface is versioned, with documented compatibility and deprecation periods. When a plugin's schema changes — a game system publishes a revised edition, or a plugin is retired — the plugin supplies a migration for sheets, entity types, and fields, previewed and applied through review. Data from a removed plugin remains readable as user-defined fields (`MODEL-04`). *Acceptance:* upgrading a game-system plugin to a new edition migrates existing sheets with a reviewable diff, and uninstalling it loses no data.

---

## 11. Pluggable Inference

- **`INF-01` (P0) — A single provider interface with independently swappable language-model, speech-recognition, vision, text-to-speech, and image-generation backends.** Changing any of them is configuration, not code.
- **`INF-02` (P0) — Locally hosted models are first-class, not a degraded fallback.** A table processing sensitive — or simply private — conversation must be able to keep everything on its own hardware. *Acceptance:* a documented configuration completes the full pipeline with no outbound network calls.
- **`INF-03` (P1) — Per-stage model routing.** A cheaper model can verify citations or render prose while a stronger model extracts claims.
- **`INF-04` (P0) — Prompts are versioned, inspectable, user-overridable templates**, not strings buried in source. *Rationale:* an operator who cannot read the prompt cannot audit the output, and extraction quality is the product's dominant variable (§18.1).
- **`INF-05` (P0) — Cost and token accounting surfaced per session, per stage, and per backend**, in each backend's own unit — money, tokens, quota, or processing time — including the overhead added by citation-bearing extraction (`PIPE-01`). The self-hoster pays this directly and should see it.
- **`INF-06` (P0) — Graceful degradation with actionable failure messages** when a provider is unavailable, rate-limited, or misconfigured. A stalled pipeline must say why.
- **`INF-07` (P0) — Backend qualification.** An operator can run the evaluation suite (`PIPE-12`) against their configured backends and compare the scores with reference results before trusting a backend with a real campaign. Backends below a documented floor are flagged, not blocked. *Rationale:* local models are first-class (`INF-02`), but their quality floor is unproven (§18.3), and the operator needs to know what their own hardware produces. *Acceptance:* qualification reports scores per stage, and a backend below the floor is labelled wherever it can be selected.
- **`INF-08` (P1) — Budgets are enforced, not only reported.** The operator sets spending limits per campaign and per instance, in each backend's unit (`INF-05`). Before a session runs, Skaldryne estimates its cost against the remaining budget, showing the visual-processing share separately (`CAP-14`). When a run would exceed a limit, the operator chooses: pause it, switch to a cheaper backend for the remaining stages (`INF-03`), reduce visual sampling, or proceed past the limit as an explicit, logged decision. Nothing exceeds a budget silently. *Acceptance:* a session whose estimate exceeds the remaining campaign budget does not start until the operator chooses one of the options, and a run that overshoots its estimate mid-way pauses at the limit.

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
- **`TPL-12` (P1) — Style guides.** A campaign style guide is a template that governs every rendered output: voice and person, tense, reading level, spelling and capitalisation of names, in-world terminology, words to avoid, and example passages. Tone presets (`OUT-08`) apply on top of it. A club can define a house style shared by its campaigns (`TPL-02`). *Acceptance:* changing how the style guide spells a name changes it in every output on the next render.

### 12.1 Guides & onboarding

Opinionated software should explain its opinions. The guides are the product's defaults written out, and like every other default they can be changed.

- **`GUIDE-01` (P1) — First-run onboarding.** A new campaign is guided from setup to its first reviewed session: the retention choice (`CAP-07`), consent (`CAP-03`), inviting players (`SHARE-07`), recording setup suited to the table, and the first review. *Acceptance:* a GM who has never used the product reaches an accepted first session without reading separate documentation.
- **`GUIDE-02` (P1) — GM guide.** Best practices for recording at the table, reviewing efficiently, keeping secrets with visibility, running a session zero that covers recording, and using the record in prep and play. *Acceptance:* each recommendation links to the settings that implement it.
- **`GUIDE-03` (P1) — Player guide.** What is recorded, who can see what, how to use off-the-record, bookmarks, whispers, and corrections, and what rights a player has over their voice and data (§13). *Acceptance:* the player guide is reachable from the invitation a player receives.
- **`GUIDE-04` (P1) — Guides are editable.** Guides ship as versioned documents that a club or GM can edit, extend, or replace, like any template (`TPL-01`). *Acceptance:* a club's edited player guide is the one its invited players see.

---

## 13. Participant Rights & Safety

The people being recorded are not all the people running the software. A player's voice, face, words, and out-of-character life belong to that player. Recording consent is covered by `CAP-03`. The requirements here cover what happens after recording.

- **`SAFE-01` (P0) — Redaction removes a span everywhere at once.** One action removes a span from audio, video, transcript, keyframes, every claim whose only evidence lies in that span, and every output derived from those claims. The fact of redaction is logged — by whom, and when — but its content is not. Redaction also reaches the instance's own copies at rest: each redaction is kept in a ledger that contains no redacted content and is reapplied whenever a backup is restored (`NFR-08`) or a full export is imported (`SHARE-06`), so a restore can never bring redacted material back. Some copies are beyond the instance's reach: whispers and notifications already delivered through outside channels (`MSG-02`), media held elsewhere (`CAP-23`), exports already downloaded, and public pages already cached by others. For those, Skaldryne removes its own link or copy, lists what it cannot recall, and notifies the owner of each linked copy and the person who asked for the redaction. The interface states this limit before anyone shares material outside the instance. *Acceptance:* a span redacted after an export or a backup was taken is absent once that export is imported or that backup is restored, and the redaction lists the delivered messages and linked copies it could not recall.
  *This is the one deliberate exception to append-only history (`MODEL-11`).* Corrections preserve what they supersede; redaction destroys it. A player who said something personal at the table must be able to make it gone, not merely superseded.
  *Linked media is the limit of this guarantee.* Skaldryne cannot delete a copy it does not hold (`CAP-23`). Redacting a span in a linked session removes the span's playback link, and it tells the redacting participant and the media owner, in plain language, that the external copy still contains the span and must be edited or removed at its source.
  *Acceptance:* after redaction, the span's content cannot be recovered through search, chat, export, reprocessing, regenerated outputs, or playback from within Skaldryne. When an external copy exists, its owner is notified.
- **`SAFE-02` (P1) — Safety tools are part of the record.** A campaign can record its lines and veils. Content under a line is excluded from outputs; content under a veil is summarised at the level the table chose. Invoking a content-stop tool during play (an X-card or equivalent, by bot command or bookmark) marks the span for exclusion before any processing. *Acceptance:* a span marked by a content-stop invocation produces no claims and appears in no output.
- **`SAFE-03` (P0) — Voice profiles are biometric data belonging to the participant.** They are created only with the participant's consent, used only within their own instance, and deletable by the participant at any time. After deletion the participant becomes an unidentified speaker in future sessions. *Acceptance:* a participant can delete their own voice profile without GM or admin action.
- **`SAFE-04` (P1) — No persistent face templates.** Visual speaker cues (`CAP-12`) rely only on per-session signals such as the active-speaker tile and on-screen captions. No persistent facial identification is built or stored, in any phase. *Acceptance:* nothing derived from a face survives the end of the session's processing.
- **`SAFE-05` (P0) — Participants can leave with what is theirs.** A departing player can export their own character's record and their own journals, delete their voice profile, and request redaction of their out-of-character speech. Campaign canon their character took part in remains with the group. *Acceptance:* the departure flow distinguishes personal content from shared canon and handles each as documented.
- **`SAFE-06` (P0) — Campaigns with minors have stricter defaults.** A campaign can be marked as including minors — schools, libraries, family tables. Guardian consent is recorded through the `CAP-03` flow. Stricter defaults apply: no public pages, immediate deletion of raw audio and video, and per-person analytics (`NAV-06`) off. *Acceptance:* marking a campaign as including minors applies every stricter default at once, and relaxing any of them is an explicit, logged choice. It ships in the first release that records other people (Phase 0b), because a family or school table can be recorded from that release onward.
- **`SAFE-07` (P1) — Shared outputs carry content warnings.** Player-facing and public outputs can carry content warnings derived from session content and the campaign's lines and veils.
- **`SAFE-08` (P1) — Blocking, muting, and reporting between participants.** Whispers, direct messages, award nominations, and card sharing give participants private ways to reach each other. Any participant can block another from contacting them through Skaldryne, and can report a message or behaviour to the GM, or, when the GM is the subject, to the campaign owner or instance operator. Blocking is silent to the blocked person. It ships with whispers (`MSG-03`), the first private channel between participants. *Acceptance:* a blocked participant's whispers, nominations, and shares do not reach the person who blocked them through any channel, and a report about the GM does not route to that GM.
- **`SAFE-09` (P1) — Post-session check-in.** After each session, participants can answer a short, optional check-in — what worked, what did not, anything the table should adjust — anonymously if the campaign allows it. Answers go to the GM, never into the record or any output, and can prompt a review of lines and veils (`SAFE-02`). The GM's own summary of responses can feed their self-review (`NAV-12`). *Acceptance:* check-in answers never appear in search, chat, exports shared with players, or outputs, and an anonymous answer cannot be attributed by anyone, including the operator.
- **`SAFE-10` (P0) — People who are not members.** Anyone recorded who is not a campaign member — a housemate passing through, a child in the background, a guest who never made an account — is an unidentified speaker. Their speech is never attributed to a member or given a voice profile, is excluded from outputs by default, and can be deleted on request without their needing an account (`SAFE-11`). The GM can mark a guest who has consented as a participant for that session (`MODEL-25`). *Acceptance:* in a fixture session with an unconsented background speaker, no output quotes or attributes their speech, and one action removes it everywhere (`SAFE-01`).
- **`SAFE-11` (P1) — Privacy requests handled by the operator.** Any person — member, former member, or someone recorded who never joined — can ask the operator to see or delete the data held about them. Operator tooling finds that person's speech, voice profile, and attributed claims across the instance's campaigns, then exports or redacts them (`SAFE-01`), and logs that the request was fulfilled without logging its content. *Acceptance:* a request from a non-member identified by the GM in two sessions is fulfilled in one workflow, and the completion record contains none of the redacted content.

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
- **`OWN-11` (P1)** — Third-party material is marked. Published adventures, sourcebooks, and other material the group does not own can be marked third-party when ingested as prep or reference. It is usable privately within the campaign, but excluded from public pages (`SHARE-03`), public outputs, and exports shared outside the group, and the operator is warned before publishing anything derived from it. *Acceptance:* an adventure ingested as GM prep never appears on a public page, even after it has been played through.
- **`OWN-12` (P0)** — Membership can end and ownership can change hands. Removing a member revokes their access at once through every interface — web, chat bot, MCP, feeds, and share links issued to them — ends their attribution and consent in future sessions, and leaves them the rights in `SAFE-05`. A campaign's owner can transfer it to another GM, and an operator can reassign a campaign whose owner is gone, as a logged action that notifies the members. GM-private material transfers with ownership only when the outgoing owner, or the operator in their absence, chooses. *Acceptance:* a removed player's existing sessions, links, and tokens stop working within one minute, and a transferred campaign keeps its complete history.

---

## 15. Non-Functional Requirements

- **`NFR-01` (P0) — Single-command deployment** via containers, with a documented upgrade path. *Rationale:* install friction is the primary barrier to a self-hosted product reaching users; a product nobody can stand up has no users regardless of its features.
- **`NFR-02` (P0) — Cost transparency** (`INF-05`), including citation overhead.
- **`NFR-03` (P0) — Retention defaults favour deletion of audio**, with transcript governed separately and its trade-off documented (`CAP-07`).
- **`NFR-04` (P0) — Security posture** consistent with [SECURITY.md](SECURITY.md): secret handling for provider keys, an authenticated API surface, no credentials in logs.
- **`NFR-05` (P0) — Documented performance targets:** maximum session duration, processing latency budget relative to session length, video resolution and duration ceilings, live-caption latency, at-table lookup latency (`QRY-10`), and campaign size ceiling (`NFR-14`). Every limit is a stated decision rather than an emergent surprise.
- **`NFR-06` (P1) — Observability:** per-stage timing, failure rates, and token spend queryable by the operator.
- **`NFR-07` (P1) — Accessibility.** WCAG 2.2 AA as the interface target. Transcript and caption availability are treated as accessibility features in their own right (§2.7).
- **`NFR-08` (P1) — Backup and restore** covering the record and its provenance, verifiable by test restore.
- **`NFR-09` (P2) — Internationalization** of the interface, independent of transcription language support (`CAP-06`).
- **`NFR-10` (P0) — Licensing and contribution** consistent with [LICENSING.md](LICENSING.md), [CLA.md](CLA.md), and [CONTRIBUTING.md](CONTRIBUTING.md). Skaldryne is source-available under the PolyForm Perimeter License, not open source, and the product, documentation, and interface describe it that way. The terms on which third-party plugins, integrations, and templates may be written and distributed are documented alongside the plugin interface (`INT-12`), so authors know what they may publish before they build.
- **`NFR-11` (P1) — Storage footprint is documented and bounded.** Video multiplies storage needs by orders of magnitude over audio. Expected storage per hour for each media type and retention setting is documented, and the operator is warned before a retention setting would exceed available storage.
- **`NFR-12` (P1) — Usable on a phone.** Every reader and player flow — recaps, search, chat, bookmarks, whispers, award voting, at-table lookup — works on a phone; review works on a tablet. *Acceptance:* these flows complete on a phone-sized viewport without horizontal scrolling.
- **`NFR-13` (P2) — Offline reading.** The compendium, recaps, and a player's own character can be read without a connection, and sync when it returns. *Acceptance:* a device synced beforehand reads the compendium with the network disconnected.
- **`NFR-14` (P1) — Performance at campaign scale.** Targets hold for long campaigns, not only long sessions: the diff for a new session retrieves the relevant canon rather than the whole record, and search and chat stay within their latency targets as the campaign grows. Reference scale: 200 sessions and 5,000 entities. *Acceptance:* per-session processing time and cost at reference scale stay within documented bounds of a new campaign's.
- **`NFR-15` (P0) — No telemetry by default.** The software sends nothing to the project or any third party unless the operator enables it. Any opt-in telemetry is documented field by field, and inference traffic goes only to the backends the operator configured. *Acceptance:* a default install makes no outbound connection except to configured providers and integrations.
- **`NFR-16` (P1) — Ready for hosting later.** Self-hosting comes first, but nothing may foreclose a hosted offering. The licence reserves competing hosted services to separate commercial terms ([LICENSING.md](LICENSING.md)), so whether and how a hosted offering exists is the maintainers' decision (§18, open decision 10). Every record belongs to an explicit tenant boundary, provider keys and storage are scoped per tenant, and no feature assumes a single trusted operator. *Acceptance:* two tenants on one instance cannot read each other's data through any interface, verified by test.
- **`NFR-17` (P2) — Moderation of public content.** Public pages (`SHARE-03`) have a reporting path and a takedown workflow for the operator, including for content about real people. *Acceptance:* the operator can take down a reported public page without deleting the underlying campaign.
- **`NFR-18` (P0) — Encryption, secrets, and a published threat model.** Data is encrypted in transit and at rest, including retained media and backups. Provider keys, chat-bot tokens, and plugin credentials are stored in a secrets store, never in the record, logs, or exports, and can be rotated without downtime. The project publishes a threat model covering GM-private leakage, participant data, plugins, and ingested content, and a process for reporting vulnerabilities. *Acceptance:* a full export and the application logs contain no provider key or token, and rotating a provider key requires no restart.

---

## 16. Phased Roadmap

**Priorities.** P0 is required to meet Phase 0's exit criteria. P1 is scheduled in Phase 1, and P2 in Phase 2 or later. A requirement's priority and its phase always agree, so changing one means changing the other. Every requirement below is placed by ID, in exactly one milestone.

**Invariants.** The ownership commitments (`OWN-01`–`OWN-07`, `OWN-09`, `OWN-10`) and licensing (`NFR-10`) are not scheduled. They hold from the first release, and every milestone must preserve them.

**Features that arrive later.** When a requirement mentions something scheduled for a later milestone, such as linked media, backups, or the chat bot, that part applies from the milestone where it ships, and the requirement's acceptance test is extended then. Until then the requirement is met for everything that exists.

### Phase 0 — MVP

**Goal:** one capture surface end to end, with the provenance guarantees intact. Audio upload leads because it is the cheapest path to a complete pipeline, and it covers in-person tables, which voice-channel capture does not.

Phase 0 is split so the pipeline is proven before anyone else is recorded. Milestone 0a is internal and ships to no one: it establishes extraction quality, provenance, and injection resistance on fixtures, because nothing downstream is worth building if extraction is poor (§18.1). Milestone 0b is the first release. Consent, redaction, voice-profile ownership, and the handling of non-members are in it, because a product that records other people must not ship without them. Accounts, attendance, and member removal are in it because sharing with players is part of its exit criteria. Template validation is in Phase 0 because editable prompts without it (`TPL-03`) would ship a way to defeat provenance in the first release.

#### 0a — A trustworthy record (internal)

Scope: `MODEL-01`–`MODEL-05`, `MODEL-07`, `MODEL-09`–`MODEL-12`, `MODEL-23` · `CAP-01`, `CAP-05`, `CAP-07`, `CAP-28` · `PIPE-01`–`PIPE-05`, `PIPE-07`, `PIPE-08`, `PIPE-12`, `PIPE-13` · `OUT-01`, `OUT-04`, `OUT-05`, `OUT-10` · `QRY-01`–`QRY-03` · `SHARE-06` · `INF-01`, `INF-02`, `INF-04`–`INF-07` · `TPL-01`–`TPL-04` · `NFR-01`–`NFR-05`, `NFR-15`, `NFR-18`.

Until voice-profile consent exists (0b), speakers are labelled per session and no persistent profile is created, so the acceptance test of `CAP-05` is met in 0b.

**Exit criteria:** on the evaluation fixtures, including the injection fixtures, the default pipeline meets its quality thresholds (§18, open decision 2); and a maintainer uploads a recording, reviews a structured diff, accepts it, reads a recap, searches prior sessions, corrects a wrong fact and sees the recap update, and exports everything.

#### 0b — Players join safely (first release)

Scope: `CAP-03` · `MODEL-13`, `MODEL-25` · `OUT-03`, `OUT-09` · `QRY-04` · `SHARE-01`, `SHARE-02`, `SHARE-07` · `SAFE-01`, `SAFE-03`, `SAFE-05`, `SAFE-06`, `SAFE-10` · `OWN-12`.

**Exit criteria:** a GM invites their players, who consent before anything they said is processed; the GM uploads a recording, reviews and accepts the diff, and shares a player-safe recap; each player sees only what their visibility allows and receives a catch-up brief for a session they missed; a player redacts something they said and it is gone everywhere; a removed player loses access at once and leaves with what is theirs; a background voice that never consented appears in no output; and marking a campaign as including minors applies every stricter default. All of it is deployed by someone who is not a maintainer, following only the documentation.

### Phase 1 — v1

Milestone 1a comes first, because every later milestone assumes the players are present. Milestones 1b, 1c, and 1d depend only on 1a and can proceed in parallel.

#### 1a — The table joins in

Scope: `CAP-02`, `CAP-04`, `CAP-06`, `CAP-19`, `CAP-20`, `CAP-31` · `MODEL-14`, `MODEL-16`, `MODEL-17`, `MODEL-24`, `MODEL-26`, `MODEL-31` · `PIPE-09` · `OUT-08`, `OUT-19` · `QRY-10` · `MSG-01`–`MSG-05` · `INT-03`, `INT-10` · `INF-08` · `SAFE-02`, `SAFE-07`–`SAFE-09` · `GUIDE-01`–`GUIDE-04` · `NFR-12`.

**Exit criteria:** a group plays over a voice channel with the bot recording, takes something off the record, and bookmarks moments; the GM whispers one player through that player's chosen channel; the next session is scheduled from a poll; a play-by-post channel becomes reviewable segments; a session that would exceed its budget waits for the operator's choice; a new player joins from an invite and completes onboarding without the GM's help; and a player can block another participant.

#### 1b — A deeper record

Scope: `MODEL-06`, `MODEL-08`, `MODEL-15`, `MODEL-18`–`MODEL-21`, `MODEL-27`–`MODEL-30` · `CAP-16`, `CAP-18`, `CAP-29`, `CAP-30` · `PIPE-11`, `PIPE-14`, `PIPE-15` · `OUT-02`, `OUT-06`, `OUT-15` · `QRY-05`, `QRY-07`, `QRY-09` · `NAV-01`–`NAV-04`, `NAV-08`–`NAV-10` · `SHARE-03` · `INT-04` · `OWN-11` · `NFR-14`.

**Exit criteria:** a fifty-session backlog imports, with later sessions diffed against earlier canon, and is reviewed in bulk by handling only its flagged items; a wrongly accepted session is reverted and reviewed again; an old session is re-extracted after a template upgrade; the GM prepares the next session from the prep brief alone; the record answers what a character knew, held, and had on their sheet at any session; a contradiction and a retcon are each resolved in review; and the timeline, graph, quest board, and roster each open to their evidence.

#### 1c — Video and the moment

Scope: `CAP-08`–`CAP-10`, `CAP-14`, `CAP-15`, `CAP-22`–`CAP-26` · `PIPE-10` · `OUT-11`, `OUT-14`, `OUT-16` · `SAFE-04` · `NFR-11`.

**Exit criteria:** a recorded video call produces claims whose only evidence is on screen; any claim plays back its moment from retained or linked media without widening access; a clip exports bounded by its evidence span; and a session award plays back the moment it celebrates.

#### 1d — An open platform

Scope: `INT-01`, `INT-02`, `INT-08`, `INT-09`, `INT-11`, `INT-12` · `OWN-08` · `INF-03` · `PIPE-06` · `TPL-05`–`TPL-10`, `TPL-12` · `SAFE-11` · `NFR-06`–`NFR-08`, `NFR-16`.

**Exit criteria:** an external tool reads and writes the record through the documented API and MCP interfaces; a starter automation runs end to end; a game-system plugin installs with declared permissions and moves to a new edition through a reviewable migration; the instance is backed up and restored; and an operator fulfils a privacy request in one workflow.

### Phase 2 — v2+

Scope: `MODEL-22` · `CAP-11`–`CAP-13`, `CAP-17`, `CAP-21`, `CAP-27` · `OUT-07`, `OUT-12`, `OUT-13`, `OUT-17`, `OUT-18`, `OUT-20` · `QRY-06`, `QRY-08` · `NAV-05`–`NAV-07`, `NAV-11`–`NAV-18` · `SHARE-04`, `SHARE-05` · `INT-05`–`INT-07` · `TPL-11` · `NFR-09`, `NFR-13`, `NFR-17`.

Phase 2 is not a single release, and its order is set by what Phase 1 teaches. A managed-hosting track is out of scope for this document beyond the requirement that nothing in Phases 0–1 forecloses it (`NFR-16`, open decision 10).

---

## 17. Success Metrics

Skaldryne sends nothing home by default (`NFR-15`), so every metric names how it is gathered. There are four sources: **evaluation**, the project's own evaluation-suite runs (`PIPE-12`); **opt-in**, an anonymous usage report an operator may choose to send, whose exact contents they can inspect first; **local**, figures each instance shows its own operator (`NFR-06`), which the operator may choose to share; and **public**, what can be counted from the project's repositories and plugin listings. A metric that cannot be gathered from these sources is not a target.

| Metric | Why it matters | Source |
| --- | --- | --- |
| **Activation:** installs reaching a first processed session | Measures `NFR-01`. Self-hosted products die at install. | Opt-in; install tests that follow only the documentation |
| **Retention:** sessions per campaign over elapsed weeks | The product's value is cumulative; a campaign that stops logging has churned. | Opt-in; local |
| **Extraction precision and recall** against a hand-labelled fixture set | The dominant quality variable (§18.1). Tracked per model and per prompt version. | Evaluation |
| **Correction rate per session** | Proxy for output quality, and a regression signal when it rises after a prompt or model change. | Local; opt-in |
| **Cite-then-check rejection rate** | Directly measures whether the audit trail is real. | Evaluation; local |
| **Export usage** | A portability promise nobody exercises is untested. | Opt-in; round-trip tests in evaluation |
| **Template validation failure rate** | Shows whether `TPL-03` is catching regressions, and whether its tolerance is set too tight to be usable. | Local; opt-in |
| **Contradictions flagged per session** | Measures whether `MODEL-19` is surfacing continuity problems or staying silent. | Evaluation; local |
| **Contributor count and external plugins** | Health of the source-available, community-built premise. | Public |
| **Evaluation suite scores per release** | The output of `PIPE-12`: whether extraction is getting better or worse across versions and backends. | Evaluation |
| **Entity merges per session** | Rising merges mean resolution (`MODEL-23`) is fragmenting the record. | Local; opt-in |
| **Opt-in rate for coaching and analytics** | Whether the framing in `NAV-07` and `NAV-11` earns players' trust. | Opt-in |
| **Output flag rate per template** | From `OUT-19`: where readers find errors and friction that review missed. | Local; opt-in |

---

## 18. Risks & Open Decisions

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

**18.14 The rules boundary will be pushed.** Sheets, encounters, and coaching (§3.8, `NAV-11`) sit one step from a rules engine, and every system's community will ask for that step. The line holds by keeping rules in plugins and suggestions advisory. The risk is plugins becoming the product's real surface while core cannot vouch for their correctness.

**18.15 Coaching and analytics can feel like surveillance.** Even opt-in, private suggestions describe a person's play, and a table can come to feel watched. The defaults in `NAV-07` and `NAV-11` mitigate this, but the risk is social, not technical, and it is measured only by whether people opt in.

**18.16 Messaging channels cost money and carry rules.** SMS is charged per message and needs recipient consent under messaging regulations in many jurisdictions, and chat platforms rate-limit bots and change their APIs. Delivery plugins own their compliance, and the default stays on the chat platform the group already uses.

**18.17 Everything ingested is untrusted input.** Players upload documents, speak freely, and send whispers, and any of it can carry instructions aimed at the model. `PIPE-13` and the injection fixtures in `PIPE-12` reduce the risk, but model behaviour under adversarial input is not fully predictable. Keeping GM-private content out of the context of player-facing renders is the control that does not depend on the model behaving.

### Open decisions

These need an answer before the milestone shown. Owners are roles until the project names maintainers for each area.

| # | Decision | Why it matters | Owner | Needed by |
|---|---|---|---|---|
| 1 | Default inference configuration for a new install: local models, or a hosted provider using the operator's key | Sets first-run quality, cost, and whether anything leaves the machine (`INF-02`, `NFR-15`) | Inference | 0a |
| 2 | Quality thresholds for the evaluation suite, and the backend qualification floor | `PIPE-12` can gate builds and `INF-07` can label backends only once the numbers exist; set them from a baseline run | Pipeline | 0a exit |
| 3 | Where evaluation fixtures come from: real sessions released by every participant, scripted sessions, or both | Real sessions are representative but need everyone's release; scripted ones are safe but can flatter the pipeline | Pipeline | 0a |
| 4 | Reference hardware for the fully local path | "Local is first-class" (`INF-02`, `OWN-03`) needs a named machine on which the `NFR-05` targets are promised | Inference | 0a |
| 5 | Default retention window for raw audio and video | Deletion by default (`CAP-07`, `NFR-03`) against time to re-listen during review | Product | 0b |
| 6 | Which delivery channels are bundled, and which chat platform follows Discord | SMS and email carry cost and compliance (§18.16); every platform is ongoing maintenance (`MSG-02`, `INT-10`) | Integrations | 1a |
| 7 | Minimum group size for anonymous check-ins | At a table of three, anonymity is nominal (`SAFE-09`) | Product | 1a |
| 8 | Who signs plugins, and whether the project runs a registry | The trust levels in `INT-11` mean nothing without a signing authority | Security | 1d |
| 9 | Which game systems ship as bundled plugins | Sets what sheets, encounters, and coaching can do on day one (`INT-08`, `MODEL-27`, `TPL-11`) | Integrations | 1d |
| 10 | Whether the project will offer managed hosting, and who would run it | Tenant boundaries (`NFR-16`) are built regardless; the licence reserves hosted services to commercial terms, so the answer also shapes what a commercial licence covers | Maintainers | Phase 2 |

---

## 19. Revision history

| Version | Date | Changes |
|---|---|---|
| 0.1 | 2026-09-30 | Initial draft. |
| 0.2 | 2026-09-30 | Added linked-media playback; play state (sheets, encounters, party resources); messaging, whispers, and scheduling; automations and Discord server integration; analytics and opt-in coaching; guides and style guides; the security baseline; and handling of non-members and privacy requests. Added the instance operator as a user. Scoped the roadmap: a strict priority definition, Phase 0 split into 0a and 0b, Phase 1 split into four milestones with their own exit criteria, and every requirement placed by ID. Added the open-decisions register. |
| 0.3 | 2026-09-30 | Stated how each success metric is gathered without telemetry. Added budget enforcement, session revert, sessions for continuous play, re-extraction of old sessions, and bulk review. Moved campaigns with minors into the first release. Defined what redaction can and cannot reach, with a ledger reapplied on restore. Described the licence accurately as source-available and tied hosting to its commercial terms. |
| 0.4 | 2026-09-30 | Added Phase 0 user stories (`docs/stories/phase-0.md`). Stated how requirements that mention later features are met before those features ship, and made the acceptance tests of `CAP-07`, `SHARE-07`, and `SAFE-01` passable in Phase 0. Moved leaving with what is yours (`SAFE-05`) into the first release, so a removed member keeps their rights from the start. Added campaign milestones, discovery progress, recall prompts, and credit for contributions, and ruled out leaderboards, player points, and streaks. |
