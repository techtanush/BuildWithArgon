# Verified API shapes — ayan

Format: item, confirmed shape (code block), date, source.

Sources: **SDK** = the installed `google-genai` 2.33.0 type definitions (`google/genai/_gaos/types/interactions/*`,
`credentials.py`); **LIVE** = a real call with the team key on 2026-10-25 (`foundry_kernel.llm.smoke`).

## Gemini Interactions API (`llm/client.py` is the only importer)

### V1 — system instruction — LIVE (S1, S2)
```python
await client.aio.interactions.create(model="gemini-4-argon", input="...", system_instruction="...",
                                     generation_config={"thinking_level": "medium"}, timeout=120)
```
Top-level `system_instruction: str` (not a prepended `### SYSTEM` block). The async client is `client.aio.interactions`
(V9: async exists; we use it, no `to_thread`). Per-call `timeout=` (seconds) is accepted (HTTP timeout, item 4).

### V2 / V12 / video — multimodal input — LIVE (S4 image, S5 audio, SV video)
```python
input=[{"type": "text", "text": "..."},
       {"type": "image", "mime_type": "image/png", "data": "<base64>"},
       {"type": "audio", "mime_type": "audio/wav", "data": "<base64>"},
       {"type": "video", "mime_type": "video/webm", "data": "<base64>"}]
```
Video mime types allowed by the SDK: mp4, mpeg, mpg, mov, avi, x-flv, **webm**, wmv, 3gpp. A 3 s VP8/VP9 webm of a
moving ball: Argon answered "left-to-right" correctly → the critic really watches walkthrough videos (G-06).
Audio input works for `gemini-3.5-transcribe` (S5: Gemini TTS → WAV → transcript "the foundry ships on Tuesday").

**Limitation (LIVE, 2026-10-25):** `background=True` calls run on `models/gemini-4-argon-agent`, which rejects image
input: `400 Image input modality is not enabled for models/gemini-4-argon-agent`. Non-background Argon calls accept
images and video. → the one-pass long decode sends a text brief of the reference images (`worldgen/generate.py
reference_brief`); single-building regeneration (non-background) attaches the images directly.

### V3 — structured output
SDK offers `response_format` (JSON schema) + `response_mime_type`. Not used (prompted JSON + `jsonout.py` + one repair
via `previous_interaction_id`), as the spec assumed.

### V4 — usage — SDK + LIVE
```python
interaction.usage.total_input_tokens, .total_output_tokens, .total_thought_tokens, .total_cached_tokens, .total_tokens
```
(not `input_tokens`/`output_tokens`). Thought tokens are added to `tokens_out` for cost.

### V5 — background + agents — LIVE (S6)
`interactions.create(agent=..., agent_config=..., environment="remote", background=True)` then poll
`interactions.get(id=...)`: works. Statuses: `queued`, `in_progress`, `completed`, `failed`, `cancelled`,
`incomplete`, `budget_exceeded`, `requires_action`.

### V6 — image output — SDK + LIVE (S7)
`response_modalities=["image"]`, optional `generation_config={"image_config": {"aspect_ratio": "4:1", "image_size": "1K"|"2K"|"4K"}}`.
Images arrive as content items `{type: "image", mime_type, data: base64}` in `model_output` steps (also
`interaction.output_image`). Nano Banana returned **image/jpeg** 1024×1024 by default → converted to PNG. Aspect
ratios: 1:1 2:3 3:2 3:4 4:3 4:5 5:4 9:16 16:9 21:9 1:8 8:1 1:4 4:1. Audio output (TTS) arrives the same way with
`type: "audio"` (`audio/wav` from `gemini-3.8-flash-tts`).

### V7 — `previous_interaction_id` — SDK + LIVE (S2 repair path uses it)
Top-level kwarg on `interactions.create`.

### V8 — Credentials API + network allowlist — SDK (not yet called live: no `GITHUB_SANDBOX_TOKEN`)
```python
client.credentials.create(request={"type": "bearer_token", "id": "foundry-github", "token": "<PAT>",
                                   "header_name": "Authorization", "prefix": "Bearer"})
# other variants: {"type": "environment_variable", "id", "value", "injection_location", "trusted_domains"}, oauth2
environment = {"type": "remote", "network": {"allowlist": [{"domain": "github.com", "credential": "foundry-github"},
                                                           {"domain": "registry.npmjs.org"}]}}
```
Allowlist entries are objects `{domain, credential?, transform?}`, not strings. `network` may also be `"disabled"`.

### V10 — thinking levels — SDK
`ThinkingLevel = "minimal" | "low" | "medium" | "high"`. We send it only for `gemini-4-argon` (Flash/Flash-Lite calls
in S1 without it worked).

### V11 — Deep Research
`agent="deep-research-preview-04-2026"`, `agent_config={"type": "deep-research"}` (SDK variant `DeepResearchAgentConfig`).
Smoke `deep` exists; not run yet (slow; Tanush's lane uses it).

### Antigravity agent config — SDK + LIVE (S6)
`agent_config={"type": "antigravity", "model": "gemini-4-argon", "max_total_tokens"?: int}`. S6: `echo hello` in the
sandbox → "hello", 22.8 s, 11.3k tokens in.

### Errors — SDK
HTTP errors carry `.status_code` (`GenAiError` and the compat `BadRequestError`); the client retries 429/5xx and
connection errors (2, 4, 8, 16 s ±20%), never 4xx.

## Smoke results (2026-10-25, `uv run python -m foundry_kernel.llm.smoke <name>`)

| ID | Result | Notes |
|---|---|---|
| S1 basic | PASS | Argon "OK" in 3.5 s; Flash "OK" |
| S2 json | PASS | 2.7 s |
| S3 long | see build log | background mode works; Argon itself declined synthetic 70k+-token lists ("exceeds my output capacity") — see `docs/build-logs/ayan.md` |
| S4 image | PASS | "It is a red circle." |
| S5 audio | PASS | TTS → WAV → transcribe; `STT_PRIMARY=gemini` is viable (for Karthik) |
| S6 agent | PASS | Antigravity sandbox, 22.8 s |
| S7 banana | PASS | 1024×1024 image/jpeg, 13 s |
| SV video | PASS | webm video part understood (direction of motion) |

## Composio (`integrations/composio.py`) — NOT verified (no `COMPOSIO_API_KEY`)
Assumed per spec: `GET v3.1/auth_configs`, `POST v3/auth_configs`, `POST v3/connected_accounts/link`,
`GET v3.1/connected_accounts`, `POST v3/tools/execute/{slug}` with `{"user_id","arguments"}` →
`{"data","successful","error"}` (`_unwrap` also accepts `response_data` nesting). Slugs in `TOOL_SLUGS`; two are
guesses (`GITHUB_LIST_PULL_REQUESTS_FILES`, the disabled Slack slug). Probe: `uv run python -m
foundry_kernel.integrations.composio probe` prints the response shape (keys/types only).

## Cua (`computers/cua_client.py`) — NOT verified (Cua not installed here)
Assumed: `cua_sandbox.Sandbox.ephemeral(Image.linux(), local=True)`; `sb.shell.run(cmd)` result fields
`returncode|exit_code`, `stdout`, `stderr`; SDK-native screenshot/click/type/hotkey looked up at runtime, else the
xdotool + ImageMagick fallback. `spaces` mode raises `CuaUnavailable` (task → skipped).

## Playwright / ffmpeg (capture)
`@playwright/test` 1.64 needs `chromium_headless_shell-1248` (`pnpm exec playwright install --only-shell chromium`).
Its bundled ffmpeg changed between builds: `ffmpeg-1010` had `libvpx` (VP8); `ffmpeg-1013` only `libvpx-vp9` —
`capture.ts` and `worldgen/media.py` detect the available webm encoder.
