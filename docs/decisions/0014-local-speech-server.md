# 0014 — Local speech server

**Status:** Open · **Date:** 2026-09-30 · **Serves:** `CAP-01`, `CAP-05`, `CAP-06`, `CAP-28`, `CAP-31`, `SAFE-03`, `INF-01`, `INF-02`, `NFR-05`, `NFR-15`

## Context

Sessions are three to four hours long, with three to seven speakers, often on one table microphone with crosstalk, full of invented names, and sometimes in more than one language (`CAP-06`). The `Transcriber` and `Diarizer` interfaces ([0008](0008-inference-backend-interface.md)) need:

- word-level timestamps and per-word confidence, for evidence ranges;
- a way to favour the campaign glossary (`CAP-28`);
- speaker diarization with a hint for the number of speakers;
- speaker embeddings, so enrolled voice profiles recognise players across sessions (`CAP-05`), stored as the participant's biometric data (`SAFE-03`).

It must run on the reference machine ([0003](0003-local-reference-hardware.md)) and complete on CPU alone. No shared API exists for speech servers, so [0008](0008-inference-backend-interface.md) already expects a small server contract of our own.

## Recommendation

**Recommended, not decided:** Build the `speech` service as a small Python HTTP server, maintained in this repository, that implements our speech contract by composing three pieces: The points below describe what adopting it would mean.

1. **Transcription:** faster-whisper, running the default multilingual speech model named in configuration (MIT-licensed weights). Audio is first split by voice-activity detection, and each chunk is transcribed without conditioning on the previous chunk's text, to limit repeated or invented text over long recordings.
2. **Word alignment:** forced alignment of the transcript to the audio, for accurate word timings where an alignment model exists for the language. Where none exists, the transcriber's own word timings are used and marked as less precise.
3. **Diarization and speaker embeddings:** pyannote.audio's open diarization pipeline in its exclusive mode (one speaker per word), with speaker-count hints, and its embedding model for voice profiles. Diarization is reconciled with the words by time.

Around those pieces:

- **The glossary is used three ways:** as a prompt to the transcriber; as a fuzzy correction pass that compares low-confidence words against glossary entries; and, where configured, as a language-model cleanup pass that proposes corrections for review rather than applying them.
- **Speaker identification** compares each diarized speaker's embedding with enrolled voice profiles and assigns a match only above a threshold. Below it, the speaker stays unlabelled for the GM to assign. Profiles are stored and deleted as `SAFE-03` requires; the speech server keeps nothing between requests.
- **Multitrack recordings** (`CAP-31`), such as one track per voice-chat participant, skip diarization entirely: each track is transcribed on its own and merged by time, which also removes most crosstalk.
- **CPU-only profile:** the same server with an 8-bit quantized model and a smaller model size by default. Processing time is published, not targeted ([0003](0003-local-reference-hardware.md)).
- **Every component and model is pinned** to an exact version and checksum. The diarization weights are gated behind an account on their hosting site but licensed CC-BY-4.0, so they are bundled with attribution and install needs no account.
- **The contract is ours**, so any piece can be replaced by a better model without touching the application.

## Consequences if adopted

- Every requirement above is met by open components under permissive licences.
- We own a small Python service: its dependencies, its image, and its updates. This is the one place [0004](0004-language-runtime-and-repository.md) allows another language.
- faster-whisper's maintenance has slowed. Pinning protects us now, and the owned contract lets us swap the transcription engine later without changing the application.
- Overlapping speech on a single microphone remains the weakest case. The evaluation fixtures include it ([0002](0002-evaluation-fixture-sources.md)), and multitrack capture is the documented remedy.
- Diarization on CPU is slow for four-hour sessions. The CPU-only profile will be measured in hours.

## Options considered

- **An all-in-one transcription, alignment, and diarization package.** Quicker to start, and built from the same pieces. Not recommended as a dependency: we would inherit its choices and its release pace, and its own documentation notes weak handling of overlapping speech. We compose the pieces directly instead.
- **A CPU-first C++ speech engine.** Excellent on CPU and actively released, but its diarization is experimental and limited to two speakers. It remains a candidate for the transcription step of the CPU-only profile.
- **Transducer-based speech models with a streaming diarizer.** Fast and accurate for English and some European languages, with good vocabulary boosting. Not recommended: the diarizer is capped at four speakers, the toolkit is heavy and effectively tied to one GPU vendor, and CPU performance is poor.
- **Newer language-model-decoder speech models.** At or near the top of public leaderboards, but slower, and their timestamps and speaker labels cover only a handful of languages, or are absent. To be benchmarked on real sessions through the same contract before any switch.

## To decide

Our own speech server composed from these pieces, or an all-in-one package? When a maintainer decides, this record becomes Proposed or Accepted with the chosen option, or is replaced by a record that states it.
