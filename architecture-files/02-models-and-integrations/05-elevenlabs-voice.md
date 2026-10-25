# 05 — ElevenLabs Voice (text-to-speech with timestamps)

Every agent speaks with its own ElevenLabs voice. The timestamps ElevenLabs returns drive lip-sync.
Implementation: `foundry_kernel/voice/tts.py` (REST via `httpx`).

## Configuration

| Env var | Required | Default |
|---|---|---|
| `ELEVENLABS_API_KEY` | for agent voices | — |
| `ELEVENLABS_MODEL_ID` | no | `eleven_flash_v2_5` (low latency) — VERIFY availability on your plan |
| `ELEVENLABS_OUTPUT_FORMAT` | no | `mp3_44100_128` |
| `TTS_MAX_CHARS` | no | `600` |

## Request — VERIFY exact shape against current ElevenLabs docs

```
POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128
Headers: xi-api-key: <ELEVENLABS_API_KEY>, Content-Type: application/json
Body:
{
  "text": "<answer text, ≤ 600 chars>",
  "model_id": "eleven_flash_v2_5",
  "voice_settings": {"stability": 0.45, "similarity_boost": 0.8, "style": 0.15, "use_speaker_boost": true}
}
```

Expected response (assumed):

```json
{
  "audio_base64": "<mp3 bytes base64>",
  "alignment": {
    "characters": ["H","i"," ",...],
    "character_start_times_seconds": [0.0, 0.07, ...],
    "character_end_times_seconds": [0.07, 0.12, ...]
  },
  "normalized_alignment": { ... same shape ... }
}
```

Kernel converts to the API's `alignment` object: `{"chars": characters, "starts": [...], "ends": [...]}`
(prefer `alignment`; fall back to `normalized_alignment`).

## Caching

- Key: `sha256(voice_id + "|" + model_id + "|" + text)`.
- Store audio at `data/audio-cache/<sha>.mp3` and alignment at `data/audio-cache/<sha>.json`.
- Serve audio at `GET /media/audio/<sha>.mp3`. Cache hits return in < 20 ms.
- Pre-warm: on kernel start, synthesize each agent's greeting line (from `roster.json`
  `greeting`) in the background so the first interaction is instant.

## Voice assignment (setup step, T+3)

`uv run python -m foundry_kernel.voice.assign_voices`:
1. `GET https://api.elevenlabs.io/v1/voices` (header `xi-api-key`) → list of voices with
   `voice_id`, `name`, `labels` (e.g. accent, age, gender, use case). VERIFY response shape.
2. For each agent in `roster.json`, choose the voice whose labels best match the agent's
   `voice_hint` (`roster.json`), never reusing a voice for two agents in the same building, and
   preferring distinct voices overall (29 agents; reuse across buildings is allowed if the account
   has fewer voices).
3. Write `kernel/data/voices.json` `{agent_id: voice_id}` and print a table. Commit it.

## Text preparation

Before TTS: strip markdown, citation markers like `[1]`, URLs (replace with "the link"), code
(replace with "a code snippet"); collapse whitespace; truncate at the last sentence boundary before
`TTS_MAX_CHARS`. The **display text** in the conversation panel stays complete; only speech is
shortened.

## Fallback chain (`voice/tts.py`)

1. ElevenLabs (above).
2. Gemini TTS `gemini-3.8-flash-tts` via `LLMClient` (VERIFY audio output shape). No timestamps →
   `alignment: null`; the web drives the mouth from audio amplitude.
3. `provider: "browser"` → the web uses `window.speechSynthesis` with a voice chosen by agent index;
   mouth driven by `boundary` events + a 9 Hz open/close oscillation while speaking.

Each failure emits `system.warning` once per 5 minutes per provider.

## Latency budget (release V → first audio ≤ 2.5 s)

| Step | Budget |
|---|---|
| STT | 0.6 s |
| `/talk` (context pack 50 ms + Flash 0.8 s + deterministic checks) | 1.0 s |
| `/voice/tts` (ElevenLabs flash model) | 0.6 s |
| Audio decode + start | 0.1 s |

If p50 > 2.5 s after T+9, enable the MAY item: `/voice/tts/stream` using ElevenLabs'
streaming-with-timestamps endpoint (VERIFY) and play chunks as they arrive.
