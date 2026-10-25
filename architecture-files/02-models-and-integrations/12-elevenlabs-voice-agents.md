# 12 — Live Voice Calls with Any Agent (ElevenLabs Agents)

> **Hackathon context.** Talking to the company is the moment judges remember. Besides push-to-talk
> (hold V → transcript → cited answer → voice, `05-world/07`), the founder can **call any of the 29
> agents** and just talk — full duplex, interruptible, in that agent's own voice — from the 3D world
> or from the dashboard. Every factual answer still comes from our grounded, cited `talk` pipeline,
> so the managed-agent company stays honest. ADR-021. Owner: **Karthik** (kernel + client module);
> wiring: Mahin (world) and Tanush (dashboard).

> Research date 2026-10-25. Client SDK verified from the installed package `@elevenlabs/client@1.26.0`
> (`Conversation.startSession`, `overrides.agent.prompt/firstMessage`, `overrides.tts.voiceId`,
> `clientTools`, `dynamicVariables`, `getOutputVolume()`, `onMessage`, `onModeChange`,
> `onStatusChange`, `onAudioAlignment`). REST endpoints below are **VERIFY** (record in
> `docs/verified/karthik.md`).

## 1. How a call works

```
Browser (world or dashboard)                    Kernel (Karthik)                    ElevenLabs
startVoiceCall({agentId, ventureId}) ──POST /v1/voice/sessions──► token/URL from     ─► Agents API (key stays here)
            ◄── VoiceSessionInfo (token, overrides: prompt, first message, voice_id) ──┘
Conversation.startSession({ conversationToken, overrides, clientTools: { ask_company } })
   founder speaks ⇄ agent speaks (ElevenLabs ASR + LLM + TTS, interruptible)
   agent needs a fact → client tool ask_company({question})
        └─► POST /v1/ventures/{vid}/agents/{agent}/talk  (or /concierge/ask for Nova)  [Tanush]
            ◄── TalkResponse {text, citations, check}  → returned to the agent to say;
                citations shown as source cards; check status updates via SSE answer.checked
   LipSync.start({ kind: 'level', level: () => conversation.getOutputVolume() })  → mouth moves
```

- **One base ElevenLabs agent** (`ELEVENLABS_AGENT_ID`) is created once by
  `python -m foundry_kernel.voice.agents_setup`: client tool `ask_company`
  (`{question: string}` → string), overrides enabled for prompt, first message and voice, a Gemini
  model as the agent's LLM if ElevenLabs offers one (VERIFY; record which), short turn timeout,
  English. Per-call **overrides** make it each specific agent: persona prompt (from the agent's
  system prompt, persona and the rules below), first message (the agent's greeting), voice
  (`kernel/data/voices.json`).
- **Prompt rules** (in every override): "You are {display_name}, {title} in {department} at
  {venture}. For any question about the company, its work, people, numbers, decisions or plans,
  call `ask_company` with the founder's question and answer **only** from what it returns — you may
  shorten it, never add facts. If it says it doesn't know, say so. Small talk and clarifying
  questions don't need the tool. Never agree to take gated actions (merge, send, spend, post, hire);
  point the founder to the dashboard approval."
- **Grounding:** the agent never answers company facts from its own LLM — only through
  `ask_company`, which is the same `talk`/`concierge` job (with citations and the checker) as
  push-to-talk. Every tool call creates an `answers` row, so citations, checks and latency are
  recorded exactly like other conversations.
- **Lip-sync:** the 3D character's mouth is driven by the call's output level (`getOutputVolume()`,
  smoothed by Karthik's `LipSync` `level` driver); `onAudioAlignment` MAY be used for character
  alignment when present.
- **Fallback:** no ElevenLabs key, no agent id, token request fails, or mic denied →
  `provider: "unavailable"` with a reason; the UI falls back to push-to-talk (or typing).

## 2. Kernel (`voice/agents_setup.py`, `voice/sessions.py`, `api/voice.py` — Karthik)

| Method | Path | Body | Response `data` |
|---|---|---|---|
| POST | `/v1/voice/sessions` | `VoiceSessionRequest` `{"agent_id","venture_id","surface":"world"\|"dashboard"}` | `VoiceSessionInfo` `{"session_id","provider":"elevenlabs"\|"unavailable","connection":"webrtc"\|"websocket","conversation_token"?,"signed_url"?,"overrides":{"prompt","first_message","voice_id"},"dynamic_variables":{..},"expires_at","reason"?}` |
| POST | `/v1/voice/sessions/{session_id}/end` | `{"conversation_id"?,"duration_s","answer_ids":[..],"turns":n}` | `{"stored":true}` — kept in `kv['voice.sessions']` (rolling 200) for Metrics |
| POST | `/v1/voice/llm/chat/completions` | OpenAI-compatible chat request | *(MAY, `VOICE_AGENT_MODE=custom_llm`)* streams the `talk` answer; requires a public tunnel (`PUBLIC_KERNEL_URL`) so ElevenLabs can reach the kernel |

- Token: `GET https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=…` (WebRTC) or
  `GET …/v1/convai/conversation/get-signed-url?agent_id=…` (WebSocket) with header `xi-api-key`
  (VERIFY both). The key never reaches the browser; tokens are short-lived.
- Setup: `POST https://api.elevenlabs.io/v1/convai/agents/create` / `PATCH …/agents/{id}` (VERIFY)
  — idempotent: reuse `ELEVENLABS_AGENT_ID` if set, print it otherwise.
- Settings (frozen `config.py`): `ELEVENLABS_AGENT_ID`, `VOICE_AGENT_MODE` (`client_tools` default |
  `custom_llm`), `PUBLIC_KERNEL_URL` (custom LLM mode only).

## 3. Client (`web/src/world/conversation/VoiceCall.ts` — Karthik)

```ts
startVoiceCall(opts: VoiceCallOptions): Promise<VoiceCallHandle>
// opts: { ventureId, agentId, surface: 'world' | 'dashboard', talk?, lipSync?, onStatus?, onTranscript?, onAnswer? }
// handle: { status, end(), setMuted(muted) }
// status: 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended' | 'unavailable' | 'error'
```

It requests the session from the kernel, starts `Conversation.startSession` with the token and
overrides, registers `ask_company` (calls `opts.talk` if given — mock mode — else `/talk` or
`/concierge/ask`), maps `onModeChange`/`onStatusChange` to `status`, `onMessage` to
`onTranscript`, each tool result to `onAnswer` (citations, check, route card), and drives
`opts.lipSync` with the output level. `end()` closes the session and posts the summary.

## 4. Where the founder uses it

- **World (Mahin):** while engaged with an agent, press **C** (or the HUD "Call" button) to switch
  from push-to-talk to a live call; the agent keeps facing you, mouth moving, captions and source
  cards in the conversation panel; **C** or walking away ends the call. With Nova, route cards from
  `ask_company` show as usual. Unavailable → a toast and push-to-talk.
- **Dashboard (Tanush):** Agent detail page and the Org page have a **Call** button: a call panel
  with the portrait, status, live transcript and source cards; **End call**.

## 5. Acceptance

C-10 (live call with any agent from world and dashboard: interruptible, the agent's own voice,
factual answers via `ask_company` with source cards, mouth moves) and C-11 (graceful fallback to
push-to-talk when unavailable) — `06-execution/02-acceptance-criteria.md`.
