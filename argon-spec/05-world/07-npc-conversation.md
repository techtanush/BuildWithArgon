# 07 — Talking to Agents in the World

## State machine (`conversation/ConversationController.ts`)

```
idle ──(near NPC: prompt shown)──► approachable
approachable ──E or V──► engaging ──(camera ease 400 ms, greeting if first time)──► engaged
engaged ──V down──► listening ──V up──► transcribing ──► thinking ──► speaking ──► engaged
engaged ──Enter──► typing ──submit──► thinking ──► speaking ──► engaged
speaking ──V down (barge-in)──► listening  (audio stops immediately)
any ──Esc / E / WASD / distance > 3.5 m──► idle   (audio stops)
```

- **engaging:** player movement locked; camera FOV eases 70 → 55 and yaw/pitch ease to look at the
  NPC's head (y 1.6·height); mouse look limited to ±25° around that.
- **greeting:** first engagement per session plays `roster.greeting` via cached TTS; repeat
  engagements play "Hi again." (also cached).
- **listening:** mic level meter + interim transcript (Web Speech) or "Listening…" (Gemini STT).
- **transcribing → thinking:** HUD shows "Zara is thinking…" with 3 animated dots; NPC "thinking"
  animation.
- **speaking:** audio playing; mouth animates; the agent's line types out in sync with the alignment
  timing (or at 18 chars/s without alignment).

## Requests

1. Transcript text → `POST /v1/ventures/{vid}/agents/{agent_id}/talk` (or `/concierge/ask` for
   the Concierge) with `history` = last 6 turns of this conversation (kept client-side per agent).
2. Response: `{answer_id, text, citations, check, suggested_agent|route_card, latency_ms}`.
3. Immediately request `POST /v1/voice/tts {agent_id, text}`; meanwhile render text + source
   cards with status from `check`.
4. Play audio (`new Audio(audio_url)`, routed through an `AudioContext` + `AnalyserNode` for the
   amplitude fallback). Drive `LipSync` from alignment.
5. Subscribe to SSE `answer.checked` for this `answer_id` → update card statuses.

Errors: talk request fails → the agent says (browser speech, no network needed) "Sorry, I lost my
train of thought — can you ask again?" and the HUD shows the error in small text. TTS fails → show
text only with a "voice unavailable" chip and use the browser fallback if enabled.

## Conversation panel (`hud/ConversationPanel.tsx`)

Bottom-center, 760 px wide (max 92 vw), glass card (`rgba(255,253,248,0.92)`, blur 8 px,
radius 16, shadow).

```
┌──────────────────────────────────────────────────────────────────────────┐
│ (portrait 72px, ring in dept color)  Zara · Builder                       │
│                                       Engineering & Build · The Foundry Works │
│──────────────────────────────────────────────────────────────────────────│
│ You: what are you working on right now?                                   │
│ Zara: I'm building the pantry search — iteration 2 of 6, and 41 of 42     │
│       tests pass. The last failure is in the empty-state check.  ✓ Verified│
│   [🎫 Ticket · Search UI  "status=in_progress…"]  [▶ Run · iteration 2 …]  │
│──────────────────────────────────────────────────────────────────────────│
│ 🎙 Hold V to talk · Enter to type · Esc to leave        [Open in dashboard]│
└──────────────────────────────────────────────────────────────────────────┘
```

- Transcript shows the last 6 turns, scrollable.
- **Source cards** (`hud/SourceCard.tsx`): icon by kind (ticket 🎫, run ▶, artifact 📄, approval ⚖,
  message 💬, file 📎), label, quote (2 lines, ellipsis), status chip. Click → opens the dashboard
  detail in a new tab (`/tickets/:id`, `/runs/:id`, `/artifacts/:id`, `/approvals?id=`,
  `/chat?message=`).
- **Answer status chip:** ✓ Verified / ◐ Partly verified / ⚠ Unverified / … Checking, with a
  tooltip giving the checker's reason.
- **Suggested agent** (from `/talk`): a compact route card ("Priya knows more about this — Race
  there · Take me there").
- "Open in dashboard" → the agent's detail page.

## Audio

- One `AudioContext` created on the first user gesture (click to enter pointer lock).
- Agent speech volume 1.0; plaza music (if enabled) ducks to 0.03 while speaking.
- Spatialization: none for speech (always clear); footsteps/car sounds MAY use `PannerNode`.

## Latency instrumentation

The HUD records `t_release_v`, `t_transcript`, `t_answer`, `t_tts`, `t_audio_start` and posts
them (batched every 30 s) to `POST /v1/telemetry/latency` (kernel stores in `kv` rolling list;
Metrics page shows p50/p90). Add this endpoint to the API (`api/metrics.py`):
body `{"samples":[{"agent_id","stt_ms","answer_ms","tts_ms","total_ms"}]}`.
