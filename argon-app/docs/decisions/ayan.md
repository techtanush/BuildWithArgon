# Decisions — ayan

Format: `| ID | Decision | Reason |` rows; IDs `<INITIAL>-NN`.

| ID | Decision | Reason |
|---|---|---|
| A-01 | `ENGINEERING_EXECUTOR=antigravity` | S6 passed live (Antigravity sandbox ran `echo hello`, 22.8 s). The executor falls back to local per ticket when the venture has no repo, and globally (`kv['executor.override']='local'`) after 3 consecutive Antigravity errors. Sandbox pushes need `GITHUB_SANDBOX_TOKEN`; the credential is created lazily on first use (Credentials API, bearer token) |
| A-02 | Audio input works → Karthik can set `STT_PRIMARY=gemini` | S5 passed: `gemini-3.5-transcribe` transcribed a Gemini-TTS WAV correctly. TTS (`gemini-3.8-flash-tts`) returns `audio/wav` in `LLMResult.audio` |
| A-03 | System prompts use the top-level `system_instruction`; async client `client.aio.interactions` | Verified in the SDK and live (V1, V9) — cleaner than prepending `### SYSTEM` and avoids threads |
| A-04 | The one-pass long decode sends a **text brief** of the reference images | Live: background calls run on `gemini-4-argon-agent`, which rejects image input (400). A normal Argon call writes the brief (cached by image hash in `kernel/data/worldgen/assets/reference-brief.md`); single-building regeneration (not background) attaches the images |
| A-05 | New jobs in `models.py`: `worldgen_critic_fast`, `worldgen_patch_fast` (Argon medium), `sign` (Nano Banana, 4:1), `sign_check` (Flash), `antigravity` (accounting label for managed-agent runs); `Job.modality` / `Job.aspect_ratio` | The live round's "fast → thinking medium" (05-world/13 §2) and the image/audio response settings stay in the one model file (ADR-014) |
| A-06 | Critic gets screenshots as JPEG (q85, ≤ 1280 px) and videos as webm parts; on a 400/413/415/422 for the video call it retries with the 8 frames per video that `capture.ts` sampled during `playPath`, and records which it used (`critic/iter-n/<dept>.json → inputs.video_input`) | Keeps the request small and makes G-06 auditable |
| A-07 | `capture.ts` records with Playwright `recordVideo` and trims the page-load lead-in with ffmpeg (encoder auto-detected: Playwright's ffmpeg builds ship VP8 *or* VP9); if trimming is impossible the raw video is kept and `video_lead_in_s` tells the critic to ignore the first seconds | The spec asks for `recordVideo` + `playPath`; untrimmed recordings start with a blank page |
| A-08 | The loop patches each building's **best** version so far (not the latest), only when it has a failed probe or a high-severity issue (10 §5); unchanged buildings are not re-rendered — their scores carry forward (`captured_iteration`) | No regressions compound; saves capture time; scores stay comparable per iteration |
| A-09 | Stop rules exactly as 10 §6, plus "nothing left to patch" when no building has failed probes or high issues | Avoids an empty iteration |
| A-10 | Founder art direction (Union Square reference screenshots, 2026-10-25) lives in `worldgen/art_direction.md` and is added to the generation, critic and patch prompts after DESIGN.md; images dropped into `kernel/data/worldgen/assets/art-reference/` are attached as extra references | `docs/DESIGN.md` is frozen; DESIGN.md and the photoreal bar still win on conflicts |
| A-11 | Prompts clarify two spec inconsistencies (CR-A6): `interiorShell` is a module field; P7 budgets are 250k/400k | Frozen kit API and 12-photoreal-look.md win |
| A-12 | Live round: before = `source=generated` (current module), after = `source=staging` (candidate); the Antigravity world-architect patch only runs when ≥ 45 s of the 150 s budget remain after reserving 70 s for validate + re-capture + scoring, else a direct Argon patch; local static + tsc validation always runs, with one repair | G-07 timing; the agent's output is never trusted without our own validation |
| A-13 | A live round left non-terminal by a kernel restart is reported as `failed` ("kernel restarted") when read | Same rule as run recovery; never show a stuck "capturing" round |
| A-14 | Signs: Nano Banana `sign` job with `image_config.aspect_ratio="4:1"`, center-cropped/resized to 1536×384 PNG, accepted only when Flash reads the building name back (≤ 2 retries; else the world's canvas sign) | 07-nano-banana-assets.md §3 + ADR-018 realistic prompt |
| A-15 | Engineering fix chain (from the engineering build): every review/QA-triggered fix gets its own `eng.fix → eng.review → qa.verify`; the superseded `qa.verify` is cancelled; ≤ 3 fixes per task, then `#incidents` + Kai | One merge gate per task; bounded loops |
| A-16 | Merge-gate payload = spec fields + `build_ticket_id`, `task_key`, `visual_qa` | Re-entry needs to find the workspace; visual QA result is shown, skipped when no computer (never faked) |
| A-17 | `get_executor(settings, llm, db)` is async (reads `kv['executor.override']`) | Only the engineering handler calls it |
| A-18 | GitHub connect returns `{redirect_url|null, approval_id, status}` (CR-A3) | The connect itself is gated (`integration`) |
| A-19 | Worldgen paths are fixed under `kernel/data/worldgen/` (not `DATA_DIR`) | The spec commits these records as evidence; `DATA_DIR` is gitignored |

| A-20 | Fake runs cannot publish, and promotion binds SHA-256 to complete passing real critical-probe evidence | A valid but subsequently edited module must not inherit another module's render scores |
| A-21 | Capture/TypeScript subprocess groups are cancellable; live rounds persist deadline/cancellation failure | The 150-second demo budget must not freeze the kernel or leave orphaned browsers |
| A-22 | Live local host execution fails closed unless explicitly opted into unsafe development mode; requested Docker never silently falls back | Stripping environment variables does not isolate host filesystem or network |
| A-23 | Existing local Spaces only, through `CUA_SPACE_ID`; no cloud provisioning, paid accounts or funding | Exact pinned SDK APIs were inspected; local attachment is distinct from unverified cloud provisioning |
| A-24 | `/computers` UI is the explicit user-requested ownership exception (CR-A8) | The Ayan branch needs a usable computer viewer; integration preserves Tanush's full route implementation |
