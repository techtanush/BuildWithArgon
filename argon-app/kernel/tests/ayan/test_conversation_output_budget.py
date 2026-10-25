# OWNER: ayan

"""Regression coverage for bounded grounded-conversation JSON output."""
from foundry_kernel.llm.client import generation_config
from foundry_kernel.models import ARGON, FLASH, LITE, effective_job, job


def test_grounded_conversation_jobs_have_json_safe_output_budgets() -> None:
    """User-approved fast conversations keep Argon in charge of orchestration."""
    assert job("talk").model == FLASH
    assert job("concierge").model == FLASH
    assert job("route_rank").model == LITE
    assert generation_config(job("talk")) == {"max_output_tokens": 4_096}
    assert generation_config(job("concierge")) == {"max_output_tokens": 4_096}
    assert generation_config(job("route_rank")) == {"max_output_tokens": 1_024}


def test_key_orchestrators_remain_argon() -> None:
    for name in ("orchestrate_plan", "decision_review", "capability_design", "engineering_design", "engineering_build", "face_spec", "avatar_personalize"):
        assert job(name).model == ARGON


def test_explicit_live_override_does_not_mutate_registry() -> None:
    from types import SimpleNamespace
    settings = SimpleNamespace(conversation_model=LITE)
    assert effective_job("talk", settings).model == LITE
    assert effective_job("concierge", settings).model == LITE
    assert effective_job("orchestrate_plan", settings).model == ARGON
    assert job("talk").model == FLASH
