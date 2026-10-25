# Karthik + Mahin + Tanush integration handoff

Observed 25 October 2026. Branch: `integration/karthik-mahin-tanush`.

## Scope and source history

This is a genuine Git-history-preserving integration, not the earlier assembled archive snapshot.

- Tanush: `d8277b8f8adc2fb4ac1420e716d30344c87bc16b` (base).
- Mahin actual world implementation: `9d6b77896662adca6ec40dfab7fe408f109ac472` (`mahin-world-integration`, PR 3).
- Karthik: `a425502a4dc051fa0f3c9af87ec8660eb00eb983`.
- Common main source: `f0384e90db2fe2c99a116a539badcf6b283f654c`. Main was not merged or updated.
- Ayan is being debugged separately and is deliberately NOT included yet. The old docs-only observation is superseded by Ayan's actual implementation; do not describe that lane as unpublished.

## Verified combined checks

- Genuine integrated checkout: **504 backend tests passed**, one upstream Starlette deprecation warning.
- Final combined frontend: **372 tests passed**.
- TypeScript `tsc --noEmit` and Vite production build passed.
- OpenAPI types regenerated from the running combined backend.
- Browser: live dashboard loaded; world opened with 13 departments and all 29 directory agents. A single local world observation was 40-53 FPS, not a formal performance acceptance benchmark.
- Mocked lifecycle tests cover startup, mute/end, late callbacks, captured venture/NPC scope, bounded history, sources/checker/routes, and established-call teardown when typing or switching to PTT.

## Applied integration fixes

- One default server-side Vite proxy targets the kernel and injects backend authorization without exposing the token in browser configuration. Legacy dev config delegates to it.
- Shared status/tool unions aligned with the live backend.
- Existing ElevenLabs agent setup requires an exact hash- and venture-scoped approval. It reads the exact agent before writes, registers/reuses a standalone `ask_company` tool, updates only that agent, and performs readback verification. Original agent name and TTS configuration are preserved.
- Authenticated voice sessions use venture-scoped database personas, neutral name/title greetings, selected voice overrides, and company-grounding rules.
- World C-key/Call/End/Mute controls use the selected venture and NPC. Live transcripts stay separate from grounded company answers. Close/switch/route/PTT/typing dispose the call and lip-sync, including delayed startup handles.
- Follow-up tool requests carry only the bounded six-turn grounded history.
- Production portrait capture fetches runtime FaceSpecs before rendering. Missing/invalid/duplicate identities fail clearly. Synthetic identities are allowed only for an explicit fallback/mock preview.
- Generated department sign PNGs are optionally consumed with an immediate canvas fallback, bounded settling, and safe late-load disposal. Capture waits for them before readiness.

## Real provider verification

- Ignored local configuration is live, authenticated and wallet payments disabled. Credentials were kept private; no new paid plans, credits, wallet transactions or services were activated.
- A real Gemini 3.8 Flash request completed.
- Existing ElevenLabs agent update succeeded through its approved exact configuration, including tool create, agent PATCH and GET readback. No new agent was created.
- Voice catalog assignment verified all 29 agents, using 21 distinct catalog voices.
- Real WebRTC session-token issuance returned the correct venture/agent scope and overrides; session end succeeded. Tokens were neither logged nor committed.
- Separately, Ayan's pending adapter passed tiny real native-JSON and image-input compatibility probes. These do NOT mean Ayan's source has been merged here.

## Argon face work, honestly scoped

The user requested Argon rather than GPT for face asset design. An actual `gemini-4-argon` multimodal review of a real 3D portrait generated `web/src/world/npc/argon-head-profile.json`, with source-image hash and explicit `photorealistic: false`. It cost an accounted estimate of $0.00965 within the shared approved Gemini budget.

The renderer mechanically applies Argon's continuous 48x48 head, tapered jaw, smaller recessed eyes and higher hairline. Before/after renders confirm the intersecting jaw seam is removed and protruding eyes/hair coverage are reduced. This is a cleaner procedural fallback, NOT a realistic human asset. No GPT image generation was used.

## Remaining acceptance blockers

- **[blocked] Photorealistic faces/characters:** the published character/vehicle library is still empty. Proper sculpted, textured, rigged human assets with skin albedo/normal/roughness and validated facial animation are still required. FaceSpec/profile changes do not satisfy that requirement. Do not label the current mannequins photorealistic.
- **[blocked] Actual voice conversation:** the account reports pay-as-you-go. Existing-agent setup and token issuance passed, but no billed speech/call, live microphone round-trip, interruption or live latency acceptance was performed. This needs explicit voice-credit permission and a real microphone conversation.
- **[blocked] Complete four-lane integration:** merge Ayan's final reviewed/debugged SHA later, resolve shared contracts, then rerun the entire combined suite and live paths. Do not enable autonomous live spending from this three-lane snapshot.
- Ayan's separate Argon visual verification completed 8 of 13 critiques before its 180-second deadline; five remained pending. Do not substitute passing geometric probes for a photoreal visual acceptance. Its separate live-round result is recorded in that lane.

## Reproduction

Use the repository's normal Python/pnpm setup and run `cd argon-app/web && pnpm assets` after checkout, since compiled asset binaries are ignored. Run `cd argon-app/kernel && python -m pytest -q tests`; run `cd argon-app/web && pnpm test && pnpm build`. Tests use fake providers, not production calls. Do not force wallet runtime overrides into wallet fixtures.

Securely configure the existing ignored `.env`; never commit credentials. Regenerate API types against the running kernel using `openapi-typescript <local-kernel>/openapi.json -o src/api/schema.d.ts`. Vite proxy uses KERNEL_PORT/KERNEL_TOKEN only on the server. When development worktrees share node_modules, give each Vite process its own cacheDir; a shared optimized-dependency cache caused 504 imports and was fixed by runtime cache isolation.

No main merge is authorized by this handoff. Rotate any credentials that were pasted into chat.
