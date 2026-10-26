# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.

"""THE ONLY file with model ID strings (plus agent ids like Deep Research). Everyone else names a job.
Spec: architecture-files/02-models-and-integrations/01-model-routing.md. Job names are a frozen contract."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Job:
    model: str
    thinking_level: str | None = None  # only sent for gemini-4-argon
    max_output_tokens: int | None = None
    background: bool = False  # long decode (Argon only)
    timeout_s: int = 120
    modality: str | None = None  # response modality for media jobs: "image" | "audio" (text otherwise)
    aspect_ratio: str | None = None  # image jobs: generation_config.image_config.aspect_ratio (e.g. "4:1")


OPENAI_TUTOR = "gpt-4o-mini"
ARGON = "gemini-4-argon"
FLASH = "gemini-3.8-flash"
LITE = "gemini-3.5-flash-lite"

JOBS: dict[str, Job] = {
    # company brain
    "orchestrate_plan": Job(ARGON, "high", 65_536, timeout_s=1200),
    "decision_review": Job(ARGON, "high", 32_768, timeout_s=1200),
    "capability_design": Job(ARGON, "high", 32_768, timeout_s=1200),
    "cos_report": Job(ARGON, "medium", 16_384, timeout_s=600),
    "spec_write": Job(ARGON, "high", 32_768, timeout_s=1200),
    # Opt-in typed landing starter only; existing planning jobs remain untouched.
    "starter_tutor": Job(ARGON, "low", 1024, timeout_s=45),
    "starter_content": Job(ARGON, "medium", 4096, timeout_s=120),
    # engineering
    "engineering_design": Job(ARGON, "high", 65_536, timeout_s=1200),
    "engineering_build": Job(ARGON, "high", 262_144, background=True),
    "engineering_fix": Job(ARGON, "high", 131_072, background=True),
    "engineering_review": Job(ARGON, "medium", 32_768, timeout_s=900),
    "qa_analyze": Job(ARGON, "medium", 16_384, timeout_s=600),
    "eval_baseline": Job(ARGON, "medium", 262_144, background=True),
    # departments
    "dept_artifact": Job(FLASH, None, 16_384, timeout_s=180),
    "panel_simulation": Job(FLASH, None, 16_384, timeout_s=180),
    "deep_research": Job("deep-research-preview-04-2026", None, None, timeout_s=1800),
    # conversation
    # Grounded conversation JSON can exceed 1,024 tokens (answer + citations/route); keep it bounded.
    "talk": Job(FLASH, None, 4_096, timeout_s=30),
    "concierge": Job(FLASH, None, 4_096, timeout_s=30),
    "route_rank": Job(LITE, None, 1_024, timeout_s=15),
    "check_citation": Job(LITE, None, 512, timeout_s=15),
    "triage": Job(LITE, None, 1_024, timeout_s=30),
    "summarize": Job(LITE, None, 1_024, timeout_s=30),
    # voice
    "transcribe": Job("gemini-3.5-transcribe", None, None, timeout_s=20),
    "tts_fallback": Job("gemini-3.8-flash-tts", None, None, timeout_s=20, modality="audio"),
    # world generation (offline)
    "worldgen_buildings": Job(ARGON, "high", 524_288, background=True),
    "worldgen_building": Job(ARGON, "high", 65_536, timeout_s=1200),
    "worldgen_critic": Job(ARGON, "high", 16_384, timeout_s=1200),
    "worldgen_patch": Job(ARGON, "high", 65_536, timeout_s=1200),
    "face_spec": Job(ARGON, "medium", 32_768, timeout_s=600),
    "avatar_personalize": Job(ARGON, "medium", 2048, timeout_s=25),
    "portrait": Job("gemini-nano-banana-2.1", timeout_s=180, modality="image", aspect_ratio="1:1"),
    "texture": Job("gemini-nano-banana-2.1", timeout_s=180, modality="image", aspect_ratio="4:1"),  # building signs (ADR-018: no textures)
    "sign_check": Job(FLASH, None, 256, timeout_s=60),  # sign legibility read-back (07 §3); CR-A7
    "music_loop": Job("lyria-3-clip-preview", timeout_s=300, modality="audio"),
    # cloud computers (cua)
    "computer_step": Job(FLASH, None, 1_024, timeout_s=30),
    "computer_plan": Job(ARGON, "high", 8_192, timeout_s=600),
    "computer_guard": Job(LITE, None, 256, timeout_s=10),
    # managed agents (llm.client.run_agent accounting label; the agent id comes from settings); CR-A7
    "antigravity": Job(ARGON, None, None, background=True, timeout_s=3600),
    # coordination
    "standup_update": Job(FLASH, None, 512, timeout_s=60),
    "agent_request": Job(FLASH, None, 4_096, timeout_s=120),
}


def job(name: str) -> Job:
    return JOBS[name]


def effective_job(name: str, settings: object) -> Job:
    """User-approved conversation override; frozen registry and Argon jobs remain intact."""
    from dataclasses import replace
    spec = job(name)
    model = getattr(settings, "conversation_model", None)
    if name in ("talk", "concierge") and model:
        if model not in (FLASH, LITE):
            raise ValueError("Unsupported conversation model")
        return replace(spec, model=model)
    return spec
