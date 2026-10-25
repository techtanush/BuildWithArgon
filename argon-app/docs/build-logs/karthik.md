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

## 2026-10-25: expanded asset and final API checkpoint

- Expanded A1: **129 exact SHA256-pinned sources, 144,238,320 bytes**, producing **128 binaries, 181,162,466 bytes**. 13 scanned PBR sets at real 1024/2048 sizes, 34 material bindings, 16 licensed models (13 prop kinds and 3 street-furniture kinds), two real Radiance HDRIs. Credits and manifest are committed; binaries remain gitignored/rebuildable.
- Production package entrypoints `npm run assets:fetch` and `npm run assets:build` passed. A real uncached glTF download passed, plus 128 verified cache hits. An unchanged rebuild produced byte-identical binary files and manifest. Download time was network-throttled with retries/resumption; no unsupported clean-download timing promise. Exact output hashes and budgets are in `web/assets-pipeline/evidence/validation.json`.
- All 16 actual models reviewed from +Z. Book stack rotation is checked in decoded output and real browser render; native-height backed bench remains street furniture instead of squashing into a backless prop footprint. Strict triangle budgets were met using supported seam-collapse simplification, not weakened tests.
- Final API polish: owned typed TTS/STT/session envelopes exposed in OpenAPI; sanitized schema-error envelopes, no submitted key/content echo. No frozen/shared app edits.
- Final checks: **60 web tests**, **54 kernel tests**, TypeScript and production build green. One existing backend TestClient/httpx deprecation warning. Earlier isolated canonical-contract compatibility snapshot: 211 world+voice tests and production build green. Current main `f0384e90db2fe2c99a116a539badcf6b283f654c` frozen contracts/config/schema/security/db/LLM client/package manifests were independently compared and are byte-identical to this branch's canonical surfaces.

## Handoff

**Published implementation:** browser push-to-talk/STT/speech/lip-sync, timestamp TTS/cache/fallback, transcription/media routes, grounded live-call adapters/session routes, gated setup/voice-assignment CLIs, voice lab, reproducible licensed asset pipeline and expanded manifest. No PR opened and no main changes.

**Review after checkout:** install the repository dependencies, run `cd argon-app/web && pnpm assets` BEFORE asset tests (binaries are deliberately not committed), then `pnpm typecheck && pnpm test && pnpm build`. Run `cd ../kernel && uv run pytest -q`. No new package/config dependencies were added. The optional compiler launcher requires Node 22.18+; standard package scripts use the declared tsx dependency.

**Explicit remaining / blocked:**

1. **[blocked] A2 avatars:** zero production avatars and no car in manifest. Native FBX converter still fails on this host; Rosetta install/execution was not verified. One actual licensed WASM smoke retained a weighted jaw rig but corrupted facial morph data and has no visual/runtime approval. No batch or fake rig metadata. Need a working validated converter, one visually/runtime-approved avatar, then a budgeted source-selection and 35-avatar inspection strategy. One complete source sample alone was 107 MB.
2. **[blocked] Live voice acceptance:** no provider keys/mapping/base-agent provisioning. `voices.json` is not generated/committed; no ELEVENLABS_AGENT_ID to set yet. Account-supported setup model/overrides, microphone permission, audible playback, Safari recording, interruption and S5 latency/WER remain to test. Browser no-audio/unavailable fallback was observed honestly.
3. **[blocked when KERNEL_TOKEN is enabled]** Apply the documented frozen Vite server-proxy bearer injection in contract-requests; never expose the token to browser code.
4. Remaining A1 fidelity/coverage: physical `metal_light` instead of verified brushed aluminium; 38-degree exterior HDRI rather than 25-degree golden-hour match; independent alternate-source texture backups/archive extraction unfinished. Sixteen prop kinds and street bin/bollard/bike rack are explicitly procedural. Shared oak/plaster bindings, empty bookshelf and other source caveats are documented in pipeline README. No full-photoreal-completion claim.
5. Merge-owner wiring: world C key/dashboard Call buttons, current frozen voice-session types, Ayan LLM audio extraction for live Gemini fallback, and full-inventory renderer/performance checks. Existing Mahin preview can consume this server's assets read-only; renderer files remain untouched here.

**Setup commands when credentials are supplied:** preview `python -m foundry_kernel.voice.assign_voices`, then `--write` after review; preview `python -m foundry_kernel.voice.agents_setup`, verify account model, then `--apply --approval-id <approved-new_capability-id>`. Keep STT_PRIMARY=browser until real S5 passes.
