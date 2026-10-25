# 11 — Services Catalog (everything Foundry uses)

One table per layer: what the service is, which part of Foundry uses it, which agents, the key it
needs, and what happens without it.

## AI models and agents (Google)

| Service | ID | Used for | Used by | Without it |
|---|---|---|---|---|
| Gemini 4 Argon | `gemini-4-argon` | Planning, decisions, specs, architecture, builds (long decode), fixes, reviews, QA analysis, world generation, world critique, computer-use planning, agent design | `cos.orchestrator`, `cos.improvement`, `intake.spec-writer`, `pv.decision-analyst`, `eng.*`, worldgen | Nothing works live → `LLM_MODE=fake` |
| Antigravity managed agent | `antigravity-preview-09-2026` | Engineering in Google-hosted sandboxes; web research | `eng.builder`, `eng.qa`, `mr.competitor-analyst`, `li.lead-researcher` | Local executor; Flash research |
| Gemini 3.8 Flash | `gemini-3.8-flash` | Department documents, persona panel, conversation, computer-use steps, sign legibility check | most department agents, all NPC conversation | — (required) |
| Gemini 3.5 Flash-Lite | `gemini-3.5-flash-lite` | Triage, routing, citation checks, computer-action guard, summaries | `su.triager`, Concierge routing, checker | Keyword routing; deterministic checks only |
| Deep Research | `deep-research-preview-04-2026` | Cited market research | `mr.research-lead` | Flash report labelled "no live web research" |
| Gemini 3.5 Transcribe | `gemini-3.5-transcribe` | Push-to-talk transcription | world conversation | Browser Web Speech API |
| Gemini 3.8 Flash TTS | `gemini-3.8-flash-tts` | Fallback agent voice | world conversation | Browser `speechSynthesis` |
| Nano Banana 2.1 | `gemini-nano-banana-2.1` | Building signs (realistic); optional polish of avatar-rendered portraits | worldgen | Canvas signs; raw rendered portraits |
| Lyria 3 clip | `lyria-3-clip-preview` | Plaza ambient music (MAY) | world | Silence |
| Gemini 3.8 Live | `gemini-3.8-live` | Optional real-time Concierge voice mode (MAY) | world | Push-to-talk path |

## Tools and infrastructure

| Service | What for | Used by | Key / setup | Without it |
|---|---|---|---|---|
| **Composio** | GitHub OAuth + GitHub actions (repo, branch, files, PR, issues, comments, merge). Optional Slack mirror of group chats | `eng.*`, `su.*`, kernel | `COMPOSIO_API_KEY` | No-GitHub mode (local builds/merges); no Slack mirror |
| **GitHub** | Each venture's product repo, PRs, issues | engineering, support | Connected via Composio; `GITHUB_SANDBOX_TOKEN` for sandboxes | Local `data/products/` |
| **Cua** (SDK, sandboxes, Spaces) | Cloud computers: desktop + browser for agents; founder watch/take-over | Leo, Ines, Ben, Yuki | Cua CLI/SDK; Spaces app + login for `spaces` mode | Antigravity web / Deep Research / Playwright fallbacks |
| **Google Cloud** (via Cua Spaces) | Where Spaces run in `spaces` mode (our own project) | Cua | GCP project + Spaces config (VERIFY) | Spaces on the demo Mac, or `sandbox` mode |
| **ElevenLabs** | Agent voices + per-character timings for lip-sync | world conversation, standup playback | `ELEVENLABS_API_KEY` | Gemini TTS → browser voice |
| **Playwright + Chromium** | Worldgen capture/probes; e2e tests; headless QA fallback | worldgen, tests, `eng.qa` | none | Headed capture on the laptop |
| **SQLite** (aiosqlite, WAL) | The company's memory: everything | kernel | none | — |
| **SSE** | Live updates to dashboard and world | web | none | Polling every 5 s |
| **Three.js** | The 3D world (photoreal: PBR, HDRI IBL, CSM shadows, GTAO, SMAA, AgX) | web | none | — |
| **Poly Haven** (CC0) | Scanned PBR texture sets, HDRIs, real prop/furniture/street models | asset pipeline → world | none (public API — VERIFY) | ambientCG backup; procedural PBR |
| **ambientCG** (CC0) | Backup PBR texture sets | asset pipeline | none | procedural PBR |
| **Microsoft Rocketbox** (MIT) | Realistic rigged human avatars for the 29 agents | asset pipeline → characters | none (GitHub) | procedural characters |
| **EZ-Tree** (MIT, npm `@dgreenheck/ez-tree`) | Procedural realistic trees | world | none | simple PBR trees |
| **glTF-Transform, meshoptimizer, sharp, fbx2gltf** | Optimize models/textures, LODs, compression, FBX → glTF | asset pipeline | none | — |
| **Vite / React** | Dashboard and HUD | web | none | — |
| **Node + npm** | Product workspaces (build/test generated apps) | engineering | template cache | — |
| **Docker** (optional) | Network-less sandbox for local product tests | `LocalLoopExecutor` | Docker installed | `subprocess` sandbox |

## Optional / later (interfaces only in this build)

| Service | Purpose | Stub |
|---|---|---|
| Slack (via Composio) | One-way mirror of `#all-hands`/`#exec` to the founder's Slack | `integrations/slack_mirror.py` (MAY; connect is gated `integration`) |
| Gmail (via Composio) | Outreach sending after `outreach` approval | not built; approval marks "approved — sending disabled in this build" |
| Higgsfield / Gemini Omni Flash | Marketing video | `integrations/marketing.py` stub |
| Vercel | Public preview deploys | not built; previews are served by the kernel |

## Keys checklist (day of)

`GEMINI_API_KEY` (required) · `COMPOSIO_API_KEY` · `GITHUB_SANDBOX_TOKEN` · `ELEVENLABS_API_KEY` ·
Cua CLI installed (+ `cua auth login` for Spaces) · optional GCP project for Spaces.
