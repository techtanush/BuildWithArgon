# 05 — Risk Register and Fallbacks

Every external dependency has a fallback that keeps the product working. Drill each fallback once
in phase 10.

| # | Risk | Likelihood | Impact | Detection | Fallback (already designed in) |
|---|---|---|---|---|---|
| R1 | Gemini key/quota problems at kickoff | M | Critical | S1 fails | Ask the Google team immediately; build with `LLM_MODE=fake`; switch to live when fixed |
| R2 | Interactions API shapes differ from this spec (system prompt, images, audio, usage) | H | M | S1–S5 | All isolated in `llm/client.py`; record in VERIFIED_API_SHAPES.md |
| R3 | Long decode slow (tens of minutes) | H | M | S3 timing | Start worldgen + evals in the background early (plan has slots); per-building generation fallback; cap `max_output_tokens` |
| R4 | Antigravity unavailable or credentials API unclear | M | M | S6 | `LocalLoopExecutor` (`ENGINEERING_EXECUTOR=local`), automatic override after 3 failures |
| R5 | Composio tool execution endpoint/slugs differ | M | M | phase 1 probe | Fix in `composio.py`; else No-GitHub mode (local builds + local merge gate) |
| R6 | ElevenLabs quota/latency | M | M | TTS errors / latency panel | Gemini TTS → browser `speechSynthesis`; mouth driven by amplitude/boundary |
| R7 | STT unreliable in a noisy room | H | M | S5, manual | Web Speech API; typing (Enter) always available |
| R8 | Generated building modules fail validation | M | L | probes | Fallback archetypes per building (must pass all probes) |
| R9 | Headless capture fails (no WebGL) | M | M | capture script error | SwiftShader flags; else run capture headed on the laptop; else critique on probe JSON only |
| R10 | Frame rate too low on the demo laptop | M | M | FPS overlay | Auto quality; Medium/Low tiers; reduce trees; disable GTAO |
| R11 | Checker false negatives (marks good answers unsupported) | M | L | grounding eval agreement | Deterministic stage only (`CHECKER_MODEL_CHECK=false`) and show "partly verified" instead of red |
| R12 | Plan JSON invalid | M | M | validation | Repair once; skeleton DAG |
| R13 | Budget burn (long decodes are expensive) | M | M | ledger | Venture budget + spend gate; worldgen/eval budgets printed before running (`--dry-run` estimates) |
| R14 | Model writes unsafe paths / secrets in code | L | H | fileblocks validation, redact | Reject unsafe paths; redact; secret patterns blocked from publishing |
| R15 | Kernel crash mid-run | L | M | process exits | Startup recovery; SQLite durability; world works offline |
| R16 | Scope overrun | H | H | checkpoints late | Follow the phase order; each phase leaves a working product; MAY items only after acceptance |
| R17 | Cua setup (gVisor on the host, Spaces login, SDK input methods) takes too long | M | M | phase 9 smoke | xdotool-over-shell fallback; else `CUA_MODE=off` (Antigravity web / Deep Research / Playwright fallbacks) |
| R18 | Computer-use agent wanders or loops | M | L | step count, repeated screenshots | 30-step cap; Argon re-plan every 6 steps; stop on 3 identical screenshots |
| R19 | Agent chatter floods channels | L | L | message rate | Typed coordination only; per-run limits; standup cadence ≥ 30 min |
| R20 | Photoreal assets too heavy (load time, memory, fps) | M | H | W-01/W-09 checks | Texture tiers (1k on Medium/Low), LODs, impostors, auto quality; trim the lock file |
| R21 | An asset source is down or an asset id changed | M | M | `pnpm assets:fetch` errors | Backup source (ambientCG) per texture; cached raw downloads; procedural PBR fallbacks in the kit |
| R22 | Rocketbox avatars missing blendshapes / animations | M | M | `build.ts` inspection report | Jaw-bone lip-sync + procedural bone animation; procedural character fallback |
| R23 | Live World Lab round overruns or fails on stage | M | H | G-07 drills | `fast` mode (medium thinking), pre-pick a building with a known issue, show the last stored live round and say so |
| R24 | Video input to the critic unsupported | L | M | VERIFY in smoke tests | 8 evenly spaced frames per video as images |

## Offline / degraded behaviour summary

| Down | Dashboard | World | Engineering |
|---|---|---|---|
| Gemini | Shows data; new work pauses; System strip warns | Walkable; conversations say "I can't think right now — the company's brain is offline" (browser speech) | Paused |
| Antigravity | Normal | Normal | Local executor |
| Composio | Normal; GitHub card shows error | Normal | Local builds, local merge |
| ElevenLabs | Normal | Gemini/browser voices | Normal |
| Kernel | Error banner, retry | Fallback manifest, "conversations unavailable" | — |
