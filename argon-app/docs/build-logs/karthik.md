# Build log — karthik

Format: `T+hh:mm <step> — what works, what doesn't`.

## 2026-10-25: browser/kernel voice checkpoint

- B implemented: exact visemes, binary-search alignment, 40ms coarticulation, smoothing/rest easing, analyser/boundary/live-volume drivers.
- C implemented: bounded microphone capture and cleanup, browser-first transcription, explicit server fallback, real playback/browser speech, accurate first-sound timing, dev-only voice lab.
- D implemented: timestamp TTS/cache, text preparation, Gemini/browser fallback, transcription adapter, duration/mime/size validation, media routes, deterministic real-account voice assignment CLI.
- E implemented as adapters/harness: grounded `ask_company` live-call client, persona/voice overrides, session/end routes, secret-free rolling metrics, gated dry-run provider setup.
- Tests: 36 voice web tests + frozen seed tests passed; complete kernel **51 passed**, one dependency deprecation warning. Isolated compatibility copy using Mahin's captured world and current canonical frozen contracts: **211 tests passed**, TypeScript and production build passed. These are local test results, not live-provider acceptance.
- Review: independent pass found/fixed startup cancellation, WebM unknown-sized sibling duration undercount, MP4 mismatch, and missing protected-proxy integration. Re-review found no remaining high/medium issue in changed duration/cancellation paths; protected proxy change is documented in contract-requests, not made in frozen config.
- A1 asset expansion/build is still in progress and will have a separate checkpoint. A2 stays **[blocked]** pending compatible FBX conversion and per-avatar rig inspection. No avatar/car completion claimed.

### Voice setup and remaining gates

- Live checks **[blocked]**: missing ElevenLabs/Gemini credentials and configured base agent. No `voices.json` generated/committed and no `ELEVENLABS_AGENT_ID` provisioned.
- Keep `STT_PRIMARY=browser` until S5 real English-clip WER/latency test passes. Ayan's LLM adapter must populate `LLMResult.audio` for live Gemini TTS; current seed `_result` does not extract audio, so fallback remains browser until that integration lands.
- Run `python -m foundry_kernel.voice.assign_voices` to preview real mappings, then `--write` after review. Run `python -m foundry_kernel.voice.agents_setup` for offline config; `--apply --approval-id <approved-new_capability-id>` is required to create/update the provider agent. Verify account-supported `--llm` before applying.
- World C key/dashboard Call button remain integration-owner wiring. Voice lab: `http://127.0.0.1:5174/tests/voice-lab/index.html`; local backend preview uses an isolated fake-mode database, never company data. Set WEB_URL to match actual origin/port.
- Never push the synthetic local archive history. Authenticated browser commits publish only owned source files directly to `karthik`; no PR/main changes.
