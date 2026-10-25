# 06 — Speech-to-Text (talking to agents)

## Interaction model: push-to-talk

- Hold **V** to speak; release to send. A mic level meter shows in the conversation panel.
- Maximum 30 s per utterance (auto-stop). Minimum 0.3 s (shorter = ignored).
- The player can also type: pressing **Enter** in the conversation panel opens a text box
  (always available; required fallback).

## Two implementations; smoke test S5 decides the primary

### A. Gemini transcription (preferred if it passes S5)

1. Web records with `MediaRecorder` (`audio/webm;codecs=opus`, mono, 48 kHz) from
   `getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,channelCount:1}})`.
2. On release → `POST /v1/voice/transcribe` (multipart `audio`).
3. Kernel calls `LLMClient.generate("transcribe", [Part("audio", data=..., mime="audio/webm")],
   system="Transcribe the speech verbatim. Return only the transcript text.")` (VERIFY V12).
4. Returns `{"text", "provider":"gemini", "latency_ms"}`.

**S5 pass criteria:** a 4 s clip of clear English transcribes correctly (WER ≤ 10%) in ≤ 1.2 s
median over 5 tries.

### B. Browser Web Speech API (fallback, or primary if S5 fails)

- `const R = window.SpeechRecognition || window.webkitSpeechRecognition` (Chrome).
- `lang = 'en-US'`, `interimResults = true`, `continuous = true` while V is held; on release call
  `stop()` and use the final transcript. Show interim text live in the panel.
- If neither A nor B is available (e.g. Firefox), show the text box.

The web decides at runtime: `GET /v1/system/status` → `providers.stt.primary` (`"gemini"` or
`"browser"`), set by the kernel from `STT_PRIMARY` env (written after S5).

## Wake/Interrupt

- Pressing V while an agent is speaking stops the agent's audio immediately (barge-in) and starts
  recording.
- Leaving the interaction ring (> 3.5 m) ends the conversation and stops audio.
