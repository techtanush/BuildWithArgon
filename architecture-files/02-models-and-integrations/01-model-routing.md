# 01 — Model Routing (which model does which job)

**Rule:** `foundry_kernel/models.py` is the only file that contains model ID strings. Every model
call names a **job**; the job decides model, thinking level and output budget.

## Available models (from Google's builder guide)

| Model / agent ID | Use it for |
|---|---|
| `gemini-4-argon` | Frontier reasoning, long-horizon coding, multi-file generation, 3D/Three.js generation, security fixes, agentic video/visual analysis, orchestration. 1M shared window. `thinking_level` low/medium/high. Long decode via `background=True`. |
| `antigravity-preview-09-2026` | Managed agent: Google-hosted Linux sandbox where Argon plans, writes code, runs tests, manages files, calls MCP tools, searches the web — in one API call. |
| `gemini-3.8-flash` | Fast parallel subagents, codebase exploration, boilerplate tests, low-latency tool calls. |
| `gemini-3.5-flash-lite` | Lowest-latency classification, routing, guardrails. |
| `deep-research-preview-04-2026` | Multi-step background web research returning a cited report. |
| `gemini-3.8-live` / `gemini-3.8-live-extended-thinking` | Real-time two-way voice/vision (optional path; see 08). |
| `gemini-3.5-transcribe`, `gemini-3.5-transcribe-live` | Speech-to-text (recorded / streaming). |
| `gemini-3.5-live-translate-preview` | Speech-to-speech translation (not used). |
| `gemini-3.8-flash-tts`, `gemini-3.8-flash-lite-tts` | Text-to-speech (fallback voice). |
| `gemini-nano-banana-2.1` | High-consistency images: portraits, textures, signage. `gemini-3.1-flash-lite-image` for sub-second drafts. |
| `gemini-omni-1.1-flash` | Video generation with audio (not used). |
| `lyria-3.5`, `lyria-3-clip-preview` | Music; 30-second loops (optional plaza ambience). |
| `gemma-4-31b-it` | Open weights (not used). |

## Job table (`models.py`)

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Job:
    model: str
    thinking_level: str | None = None   # only sent for gemini-4-argon (VERIFY for others)
    max_output_tokens: int | None = None
    background: bool = False            # long decode (Argon only)
    timeout_s: int = 120                # HTTP timeout for non-background calls

ARGON = "gemini-4-argon"
FLASH = "gemini-3.8-flash"
LITE = "gemini-3.5-flash-lite"

JOBS: dict[str, Job] = {
    # --- company brain ---
    "orchestrate_plan":   Job(ARGON, "high",   65_536,  timeout_s=1200),
    "decision_review":    Job(ARGON, "high",   32_768,  timeout_s=1200),
    "capability_design":  Job(ARGON, "high",   32_768,  timeout_s=1200),
    "cos_report":         Job(ARGON, "medium", 16_384,  timeout_s=600),
    "spec_write":         Job(ARGON, "high",   32_768,  timeout_s=1200),
    # --- engineering ---
    "engineering_design": Job(ARGON, "high",   65_536,  timeout_s=1200),
    "engineering_build":  Job(ARGON, "high",   262_144, background=True),
    "engineering_fix":    Job(ARGON, "high",   131_072, background=True),
    "engineering_review": Job(ARGON, "medium", 32_768,  timeout_s=900),
    "qa_analyze":         Job(ARGON, "medium", 16_384,  timeout_s=600),
    "eval_baseline":      Job(ARGON, "medium", 262_144, background=True),  # single pass, no loop
    # --- departments (artifacts) ---
    "dept_artifact":      Job(FLASH, None, 16_384, timeout_s=180),
    "panel_simulation":   Job(FLASH, None, 16_384, timeout_s=180),
    "deep_research":      Job("deep-research-preview-04-2026", None, None, timeout_s=1800),
    # --- conversation ---
    "talk":               Job(FLASH, None, 1_024, timeout_s=30),
    "concierge":          Job(FLASH, None, 1_024, timeout_s=30),
    "route_rank":         Job(LITE,  None, 512,   timeout_s=15),
    "check_citation":     Job(LITE,  None, 512,   timeout_s=15),
    "triage":             Job(LITE,  None, 1_024, timeout_s=30),
    "summarize":          Job(LITE,  None, 1_024, timeout_s=30),
    # --- voice ---
    "transcribe":         Job("gemini-3.5-transcribe", None, None, timeout_s=20),
    "tts_fallback":       Job("gemini-3.8-flash-tts", None, None, timeout_s=20),
    # --- world generation (offline) ---
    "worldgen_buildings": Job(ARGON, "high",   524_288, background=True),
    "worldgen_building":  Job(ARGON, "high",   65_536,  timeout_s=1200),   # single-building regen
    "worldgen_critic":    Job(ARGON, "high",   16_384,  timeout_s=1200),
    "worldgen_patch":     Job(ARGON, "high",   65_536,  timeout_s=1200),
    "face_spec":          Job(ARGON, "medium", 32_768,  timeout_s=600),
    "portrait":           Job("gemini-nano-banana-2.1"),
    "texture":            Job("gemini-nano-banana-2.1"),
    "music_loop":         Job("lyria-3-clip-preview"),
    # --- cloud computers (Cua) ---
    "computer_step":      Job(FLASH, None, 1_024, timeout_s=30),
    "computer_plan":      Job(ARGON, "high", 8_192, timeout_s=600),
    "computer_guard":     Job(LITE,  None, 256,   timeout_s=10),
    # --- coordination ---
    "standup_update":     Job(FLASH, None, 512,   timeout_s=60),
    "agent_request":      Job(FLASH, None, 4_096, timeout_s=120),
}

def job(name: str) -> Job:
    return JOBS[name]
```

Agents in `roster.json` reference a `model_job` (e.g. `dept_artifact`, `engineering_build`). The
NPC conversation always uses `talk` (Flash) regardless of the agent's working model — speed matters
in conversation; the *work* is done by the agent's own job model.

## Why this split

- **Argon** wherever the quality of reasoning or long coherent output decides the result: plans,
  decisions, builds, fixes, reviews, world generation, critique.
- **Flash** for many parallel, bounded, latency-sensitive tasks: department documents, persona
  simulations, conversation.
- **Flash-Lite** for classifiers and checkers that must be cheap and fast.
- **Specialised models** where Google provides a purpose-built one: Deep Research, transcription,
  TTS, images, music.

## Prices (for the ledger)

`llm/costs.py` holds a price table. Only Argon's price is published in the guide; other prices
default to `None` → cost recorded as `0.0` with `estimated=1` and the UI shows "price n/a".
Prices can be set via env (`PRICE_<MODEL_ID_UPPER_SNAKE>_IN` / `_OUT`, USD per 1M tokens).

```python
PRICES_PER_M = {
    "gemini-4-argon": (2.00, 10.00),   # intro pricing through 2026-11-30 (guide)
}
CACHED_INPUT_DISCOUNT = 0.95           # implicit caching on Argon (guide)
```

## Parameters NEVER to send to Argon (guide §"Clean up legacy parameters")

`thinking_budget`, `temperature`, `top_p`, `top_k`, `cached_content`. The client strips them.
