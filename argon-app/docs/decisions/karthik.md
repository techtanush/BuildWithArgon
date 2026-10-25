# Decisions — karthik

Format: `| ID | Decision | Reason |` rows; IDs `<INITIAL>-NN`.

## 2026-10-25 implementation decisions

| ID | Decision | Reason |
|---|---|---|
| K-01 | Keep STT_PRIMARY=browser until live S5 passes; explicit server mode remains testable. | No live transcription credentials/probe; do not claim measured Gemini latency. |
| K-02 | Gemini PCM fallback is wrapped as WAV and served through an additional /media/audio/{sha}.wav route. | Preserve actual PCM rather than mislabel bytes as MP3. |
| K-03 | Provider setup is offline dry-run unless --apply and an approved new_capability gate are supplied. | Registering/updating a paid voice agent must not happen implicitly. |
| K-04 | Publish only measured, licensed, built assets; empty avatar/vehicle inventory means procedural fallback. | No fabricated asset completion; rig conversion/inspection is a separate gate. |
| K-05 | Persist no credentials, transcripts or persona prompts in session metrics. | Only short-lived connection credentials reach the browser as required. |
| K-06 | Local Git is an archive-derived testing snapshot; publish source through authenticated GitHub commits. | Git CLI lacks authentication. Never push the local synthetic history. |
