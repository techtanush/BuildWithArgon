# 08 — Other Integrations (in scope, optional, and later)

## In scope

### Deep Research (`deep-research-preview-04-2026`)
- Used by `mr.research-lead` for `research.market`. Invocation (VERIFY V11):
  `LLMClient.run_agent(agent="deep-research-preview-04-2026", agent_config={...}, prompt=...,
  background=True)` or `interactions.create(agent=..., input=..., background=True)`.
- Prompt: the venture idea + spec summary + "Produce a cited market report: market size
  estimates with sources, target segments, top 5 competitors with pricing, risks. Every claim must
  have a source URL."
- Output stored as artifact `research` with `meta.sources = [urls]`. Timeout 30 min; fallback to
  `dept_artifact` (Flash) with a note "fallback: no live web research".

## Optional (MAY — only after acceptance criteria pass)

### Lyria ambient music in the plaza
- `lyria-3-clip-preview` generates one 30-second calm, warm, instrumental loop
  ("gentle acoustic town square ambience, light marimba and soft strings, 90 bpm, loopable").
- Saved to `web/public/generated/music/plaza.mp3`; played at volume 0.15 in the plaza, ducked to
  0.03 while an agent speaks. Mute toggle in the pause menu.

### Gemini Live (`gemini-3.8-live`) as an alternative conversation path
- A "Live mode" toggle for the Concierge only: a WebSocket session through the kernel (ephemeral
  token or server relay, never exposing the key) with interruptions. Lip-sync driven by audio
  amplitude (no timestamps). Only build if time remains; the push-to-talk path is the default.

### Gemini TTS
- Already the second fallback in [`05-elevenlabs-voice.md`](05-elevenlabs-voice.md).

## Later (do NOT build in the 12-hour window; keep the interfaces)

These are part of the long-term vision (marketing and computer-use departments). Create only the
stub modules so the architecture shows where they plug in:

| Capability | Stub | Notes |
|---|---|---|
| Marketing video (Higgsfield or Gemini Omni Flash) | `integrations/marketing.py` `class MarketingVideoProvider(Protocol)` | All outputs would be gated by `outreach` |
| Computer use / cloud computers for agents | **Now in scope** via Cua — see [`10-cua-cloud-computers.md`](10-cua-cloud-computers.md) | Human-gated for logins, sign-ups and contact forms |
| Additional Composio toolkits (Slack, Gmail, Linear) | `integrations/composio.py` `ALLOWED_TOOLKITS = {"github"}` | Expand the allowlist only with a recorded decision |
| MCP servers for agents | `executors/antigravity.py` `MCP_SERVERS: list[dict] = []` | Antigravity can call MCP tools (guide); none configured in this build |

Each stub raises `NotImplementedError("planned: see argon-spec/02-models-and-integrations/08")`.
