# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.

"""THE ONLY module importing google.genai. Seed = minimal working client based on the patterns in
architecture-files/reference/gemini-4-argon-builder-guide.md. Ayan hardens it per
02-models-and-integrations/02-gemini-interactions-api.md (retries, accounting, multimodal, VERIFY items)."""
from __future__ import annotations

import asyncio
import time
from typing import Any

from pydantic import BaseModel

from ..config import Settings
from ..contracts import LLMResult, Part, ProgressFn
from ..models import ARGON
from ..models import job as get_job
from .costs import estimate
from .fake import FakeLLM
from .jsonout import parse_model


class LLMClient:
    def __init__(self, settings: Settings, db: Any = None) -> None:
        self.settings = settings
        self.db = db
        self._client: Any = None

    def _genai(self) -> Any:
        if self._client is None:
            from google import genai

            key = self.settings.gemini_api_key.get_secret_value() if self.settings.gemini_api_key else None
            self._client = genai.Client(api_key=key) if key else genai.Client()
        return self._client

    @staticmethod
    def _compose(prompt: str | list[Part], system: str | None) -> Any:
        # VERIFY V1/V2: system-instruction field and multimodal part format.
        if isinstance(prompt, str):
            return f"### SYSTEM\n{system}\n\n### TASK\n{prompt}" if system else prompt
        parts: list[dict[str, Any]] = []
        if system:
            parts.append({"type": "text", "text": f"### SYSTEM\n{system}"})
        for p in prompt:
            if p.kind == "text":
                parts.append({"type": "text", "text": p.text or ""})
            else:
                import base64

                parts.append({"type": p.kind, "mime_type": p.mime, "data": base64.b64encode(p.data or b"").decode()})
        return parts

    async def _poll(self, interaction: Any, on_progress: ProgressFn | None) -> Any:
        started = time.monotonic()
        last_note = started
        while getattr(interaction, "status", None) in ("in_progress", "queued"):
            if time.monotonic() - started > self.settings.long_decode_max_minutes * 60:
                raise TimeoutError("long decode exceeded LONG_DECODE_MAX_MINUTES")
            await asyncio.sleep(self.settings.long_decode_poll_seconds)
            interaction = await asyncio.to_thread(self._genai().interactions.get, id=interaction.id)
            if on_progress and time.monotonic() - last_note > 30:
                last_note = time.monotonic()
                await on_progress(f"long decode running {int(last_note - started)}s")
        return interaction

    def _result(self, interaction: Any, model: str, started: float) -> LLMResult:
        usage = getattr(interaction, "usage", None)  # VERIFY V4
        text = getattr(interaction, "output_text", "") or ""
        t_in = int(getattr(usage, "input_tokens", 0) or 0)
        t_out = int(getattr(usage, "output_tokens", 0) or 0) or len(text) // 4
        cached = int(getattr(usage, "cached_tokens", 0) or 0)
        cost, est = estimate(model, t_in, t_out, cached)
        return LLMResult(text=text, interaction_id=getattr(interaction, "id", None), model=model, tokens_in=t_in,
                         tokens_out=t_out, cached_in=cached, cost_usd=cost, estimated_cost=est,
                         latency_ms=int((time.monotonic() - started) * 1000),
                         raw_status=str(getattr(interaction, "status", "completed")))

    async def generate(self, job: str, prompt: str | list[Part], *, system: str | None = None,
                       previous_interaction_id: str | None = None, run_id: str | None = None,
                       venture_id: str | None = None, agent_id: str | None = None,
                       department_id: str | None = None, on_progress: ProgressFn | None = None) -> LLMResult:
        j = get_job(job)
        cfg: dict[str, Any] = {}
        if j.model == ARGON and j.thinking_level:
            cfg["thinking_level"] = j.thinking_level
        if j.max_output_tokens:
            cfg["max_output_tokens"] = j.max_output_tokens
        kwargs: dict[str, Any] = {"model": j.model, "input": self._compose(prompt, system)}
        if cfg:
            kwargs["generation_config"] = cfg
        if previous_interaction_id:
            kwargs["previous_interaction_id"] = previous_interaction_id  # VERIFY V7
        started = time.monotonic()
        client = self._genai()
        if j.background:
            kwargs["background"] = True
            interaction = await asyncio.to_thread(client.interactions.create, **kwargs)
            interaction = await self._poll(interaction, on_progress)
        else:
            interaction = await asyncio.wait_for(asyncio.to_thread(client.interactions.create, **kwargs), timeout=j.timeout_s)
        return self._result(interaction, j.model, started)

    async def generate_json(self, job: str, prompt: str | list[Part], schema: type[BaseModel], **kw: Any) -> tuple[BaseModel, LLMResult]:
        res = await self.generate(job, prompt, **kw)
        try:
            return parse_model(res.text, schema), res
        except Exception:  # noqa: BLE001 - any parse failure triggers one repair
            fix = (f"Your previous output was not valid JSON for this schema: {schema.model_json_schema()}. "
                   "Return ONLY the corrected JSON.")
            res2 = await self.generate(job, fix, previous_interaction_id=res.interaction_id,
                                       **{k: v for k, v in kw.items() if k != "previous_interaction_id"})
            return parse_model(res2.text, schema), res2

    async def run_agent(self, *, agent: str, agent_config: dict[str, Any], prompt: str,
                        environment: str | dict[str, Any], run_id: str | None = None,
                        venture_id: str | None = None, background: bool = True,
                        on_progress: ProgressFn | None = None) -> LLMResult:
        started = time.monotonic()
        kwargs: dict[str, Any] = {"agent": agent, "agent_config": agent_config, "input": prompt, "environment": environment}
        if background:
            kwargs["background"] = True  # VERIFY V5
        interaction = await asyncio.to_thread(self._genai().interactions.create, **kwargs)
        if background:
            interaction = await self._poll(interaction, on_progress)
        return self._result(interaction, str(agent_config.get("model", agent)), started)

    async def generate_images(self, job: str, prompt: str, n: int = 1, reference_images: list[Part] | None = None) -> LLMResult:
        raise NotImplementedError("ayan: implement per 02-models-and-integrations/07-nano-banana-assets.md (VERIFY V6)")


def build_llm_client(settings: Settings, db: Any = None) -> LLMClient | FakeLLM:
    return FakeLLM() if settings.llm_mode == "fake" else LLMClient(settings, db)
