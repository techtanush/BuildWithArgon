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
