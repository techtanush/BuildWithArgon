# Verified API shapes — karthik

Format: item, confirmed shape (code block), date, source.

## 2026-10-25: backend and browser voice

**Verification boundary:** public schema documentation + installed SDK types + mocked tests; no live authenticated provider success or latency claim.

- Official sources: https://api.elevenlabs.io/openapi.json , https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps , https://elevenlabs.io/docs/api-reference/conversations/get-webrtc-token . The initial OpenAPI download was incomplete, but the complete `paths` object and referenced early schemas were parsed. Later nested schemas/runtime model availability remain to account-verify.
- `POST /v1/text-to-speech/{voice_id}/with-timestamps`: `xi-api-key` header; `output_format` query; JSON `text`, `model_id`, `voice_settings`; response `audio_base64`, `alignment` / `normalized_alignment` with `characters`, `character_start_times_seconds`, `character_end_times_seconds`. Adapter validates lengths/timing and exposes frozen `Alignment` names.
- `GET /v1/voices`: real account `voices[]`. Assignment is preview-only by default; `--write` commits no fake IDs and requires a live key.
- `GET /v1/convai/conversation/token`: `agent_id` query, response `token`, `conversation_id`. Only short-lived token reaches browser; no credentials stored in metrics. WebSocket signed-url endpoint exists in public schema but backend issuance currently uses WebRTC only.
- `POST /v1/convai/agents/create` and `PATCH /v1/convai/agents/{agent_id}`: `conversation_config`, optional `name`, `platform_settings`; client tool has `type=client`, `name`, `description`, JSON-schema `parameters`, `expects_response`, `response_timeout_secs`. Overrides use `platform_settings.overrides.conversation_config_override`. Nested prompt/voice override live acceptance and configurable default model availability remain unverified.
- Installed `@elevenlabs/client@1.26.0` TypeScript interfaces checked: `Conversation.startSession`, connection token/type, nested overrides, dynamic variables, client tools, callbacks, `getOutputVolume`, `setMicMuted`, `endSession`.
- Browser STT defaults to Web Speech. Server mode captures browser fallback concurrently. Supported server containers: bounded WAV, unlaced Opus WebM (including unknown-size/durationless clusters), audio-only MP4 including fragmented timing. Unsupported formats fail closed. Real Safari recording not checked.
- Lip-sync alignment, analyser, boundaries and live volume are deterministic-tested; `started` rejects when no audio began rather than emitting a bogus latency sample.
- Local HTTP smoke: `/health` healthy; proxy `/v1/voice/tts` returned `provider=browser` with null audio without keys; invalid audio SHA returned 404. Voice lab showed explicit unavailable in fake mode. Browser speech did not start in this browser, and no audible/microphone success is claimed.
- SDK-owned preliminary microphone acquisition cannot be forcibly stopped before its startup promise resolves. Our handle is immediately cancellable, callbacks are guarded, startup waits bounded, and late SDK connections are disposed. Live interruption and permission-dialog behavior remain to verify with provider credentials.

## 2026-10-25: real asset sources

- Poly Haven: `GET https://api.polyhaven.com/assets?t=textures` (also models/hdris) returns an ID-keyed catalog. `GET https://api.polyhaven.com/files/{id}` returns map -> resolution -> format -> `{url,size,md5,include?}`. glTF `include` keys are relative resources with their own URL/size/MD5. Catalog dimensions are millimetres; texture tile metres use first dimension / 1000. Exact downloaded SHA256/bytes/URLs are committed in `web/assets-pipeline/assets.lock.json`.
- Poly Haven CC0 terms: https://polyhaven.com/license . Every published source has credits; transformed outputs retain provenance. Expanded lock: 129 files, 144,238,320 bytes, 13 scans, 16 models, two HDRIs. Final generated counts/hashes and test evidence are in `assets-pipeline/evidence/validation.json`; no asset binaries are committed.
- ambientCG: `https://ambientcg.com/api/v2/full_json?include=downloadData&limit=1` returned `foundAssets[].downloadFolders.default.downloadFiletypeCategories.zip.downloads[]` with `fullDownloadPath`, `fileName`, `size`, `attribute`, `zipContent`. CC0 terms: https://docs.ambientcg.com/license/ . Different-source replacement/archive extraction is NOT implemented or claimed; same-bytes mirror support is not a verified ambientCG backup catalog.

## 2026-10-25: one actual Rocketbox WASM experiment, not shipped

Official source: https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/Avatars/Adults/Female_Adult_01/Export/Female_Adult_01_facial.fbx . Official MIT license: https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/LICENSE.md . Copyright (c) 2020 Microsoft. Full report and temporary experiment remain under this task's `tmp/avatar-smoke/`; no experimental avatar is in the manifest.

- Actual FBX 2,226,864 bytes, SHA256 `2e6ba71fb83a6899e3d4dd35da07fb5b078eef0c4d593f73d70cfc05dc4644cb`. Eight complete official TGA textures plus FBX total 107,084,816 bytes. This one source set shows that blindly scaling to 35 avatars would exceed the 600 MB download target; source selection/budget strategy needs revision, not a fabricated inventory.
- `assimpjs@0.0.10` (MIT, pure WASM) actually converted to glb2 and assjson in temporary storage. 8,732 triangles; 80 skin joints; exact connected `Bip01 Spine -> Bip01 Spine1 -> Bip01 Spine2 -> Bip01 Neck -> Bip01 Head -> Bip01 MJaw`. A CPU jaw-rotation test moved 1,606 exported vertices, proving retained weights, not calibrated mouth motion.
- Source contains 175 named shapes. Raw exporter morph POSITION counts 2960/1921/680 mismatch base counts 13890/10302/2004; target names are absent, and assjson omits animmeshes. This output must not ship. No guessed viseme mapping was attached.
- A temporary jaw-only candidate removed defective shapes and embedded verified textures, with independent NodeIO structural checks. It remains **unapproved**: visual appearance, jaw axis/range, metre/floor/front normalization and normal-map orientation were not validated. No batch, no production character assets.
- Rosetta installation from this session was blocked by macOS sandbox. User reported manual installation, but subsequent actual Intel OS binary execution still returned `Bad CPU type`, and `pkgutil` found no Rosetta receipt. Do not report installation or native-converter success without a new verified execution.
