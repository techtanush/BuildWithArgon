# OWNER: ayan
"""No provider calls and no Settings/env loading."""
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from pydantic import BaseModel

from foundry_kernel.contracts import LLMResult, Part
from foundry_kernel.llm.client import LLMClient
from foundry_kernel.models import ARGON, JOBS
from foundry_kernel.worldgen.verify import BudgetBlocked, BudgetLLM, input_estimate


def settings():
    return SimpleNamespace(llm_mode="live")


def test_media_estimate():
    assert input_estimate([Part(kind="text", text="abc"), Part(kind="image"),
                           Part(kind="video", mime="video/webm")]) == 2 + 4096 + 8192


@pytest.mark.asyncio
async def test_every_json_repair_is_charged_and_job_restored(tmp_path):
    class Shape(BaseModel):
        ok: bool

    llm = BudgetLLM(settings(), receipt_path=tmp_path / "receipt.json")
    original = JOBS["worldgen_critic"]
    calls = []

    async def provider(self, job, prompt, **kw):
        calls.append(1)
        assert JOBS[job].model == ARGON
        assert JOBS[job].max_output_tokens == 2048
        result = LLMResult(text="bad" if len(calls) == 1 else '{"ok":true}',
                           model=ARGON, interaction_id=str(len(calls)), tokens_in=100,
                           tokens_out=20, estimated_cost=False)
        await self._account(result)
        return result

    with patch.object(LLMClient, "generate", provider):
        value, _ = await llm.generate_json("worldgen_critic", "hello", Shape)
    assert value.ok
    assert len(llm.calls) == 2
    assert llm.spent == pytest.approx(.0008)
    assert JOBS["worldgen_critic"] is original
    receipt = json.loads((tmp_path / "receipt.json").read_text())
    assert receipt["generate_calls"] == 2
    assert receipt["actual_usage_calls"] == 2


@pytest.mark.asyncio
async def test_budget_blocks_before_provider_and_unknown_agent(tmp_path):
    llm = BudgetLLM(settings(), limit_usd=0, receipt_path=tmp_path / "r.json")
    with patch.object(LLMClient, "generate") as provider:
        with pytest.raises(BudgetBlocked):
            await llm.generate("worldgen_critic", "hello")
        provider.assert_not_called()
    with pytest.raises(BudgetBlocked):
        await llm.run_agent(prompt="anything")
    assert llm.calls == []


@pytest.mark.asyncio
async def test_failure_retains_reservation_and_restores_registry(tmp_path):
    llm = BudgetLLM(settings(), receipt_path=tmp_path / "r.json")
    original = JOBS["worldgen_critic"]

    async def provider(*a, **kw):
        raise RuntimeError("DO NOT STORE RAW ERROR")

    with patch.object(LLMClient, "generate", provider):
        with pytest.raises(RuntimeError):
            await llm.generate("worldgen_critic", "private prompt")
    assert llm.spent > 0
    assert JOBS["worldgen_critic"] is original
    text = (tmp_path / "r.json").read_text()
    assert "private prompt" not in text and "RAW ERROR" not in text
    again = BudgetLLM(settings(), receipt_path=tmp_path / "r.json")
    assert again.spent == llm.spent


@pytest.mark.asyncio
async def test_failed_provider_actual_usage_charged(tmp_path):
    llm = BudgetLLM(settings(), receipt_path=tmp_path / "r.json")

    async def provider(self, *a, **kw):
        await self._account(LLMResult(text="", interaction_id=None, model=ARGON,
                                    tokens_in=200, tokens_out=10, estimated_cost=False,
                                    raw_status="failed"))
        raise RuntimeError("failed")

    with patch.object(LLMClient, "generate", provider):
        with pytest.raises(RuntimeError):
            await llm.generate("worldgen_critic", "test")
    assert llm.spent == pytest.approx(.0005)


def test_fake_rejected(tmp_path):
    with pytest.raises(ValueError):
        BudgetLLM(SimpleNamespace(llm_mode="fake"), receipt_path=tmp_path / "r.json")
