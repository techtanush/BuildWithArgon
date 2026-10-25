# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.

"""THE ONLY module importing google.genai. Gemini Interactions API client per
02-models-and-integrations/02-gemini-interactions-api.md: thinking_level, background long decode + polling,
previous_interaction_id, multimodal parts (image/audio/video), media outputs (images/audio), retries with
backoff, ledger + run accounting, run_logs, redaction, provider health in kv, managed agents (Antigravity,
Deep Research) and Nano Banana images. Shapes confirmed against google-genai 2.33.0 (docs/verified/ayan.md)."""
from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
import random
import time
from typing import Any

from pydantic import BaseModel

from ..config import Settings
from ..contracts import LLMResult, Part, ProgressFn
from ..ids import utc_now
from ..models import ARGON, Job
from ..models import job as get_job
from ..security import redact
from .costs import estimate
from .fake import FakeLLM
from .jsonout import LLMOutputError, parse_model

RETRY_STATUSES = {429, 500, 502, 503, 504}
BACKOFF_S = (2, 4, 8, 16)
RUNNING = ("in_progress", "queued")
FAILED = ("failed", "cancelled", "budget_exceeded")  # "incomplete" (output cap hit) returns the partial text, raw_status="incomplete"
DEPRECATED = ("thinking_budget", "temperature", "top_p", "top_k", "cached_content")  # guide §3 — never sent
log = logging.getLogger(__name__)
LEDGER_KIND = {"image": "image", "transcribe": "stt", "tts_fallback": "tts"}


class LLMCallError(Exception):
    """A model/agent call failed after retries (status_code is the HTTP status when known)."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


def video_part(data: bytes, mime: str = "video/webm") -> Part:
    """A video input part. contracts.Part.kind lacks "video" (contract request filed); the client also
    treats any Part whose mime starts with video/ as video."""
    return Part(kind="video", data=data, mime=mime)  # type: ignore[arg-type]


def _part_dict(p: Part) -> dict[str, Any]:
    if p.kind == "text":
        return {"type": "text", "text": p.text or ""}
    mime = p.mime or ""
    kind = "video" if (p.kind == "video" or mime.startswith("video/")) else p.kind  # type: ignore[comparison-overlap]
    return {"type": kind, "mime_type": mime, "data": base64.b64encode(p.data or b"").decode()}


def compose_input(prompt: str | list[Part]) -> str | list[dict[str, Any]]:
    """VERIFIED V2: input is a string or a list of content dicts ({type, text} / {type, mime_type, data(b64)})."""
    if isinstance(prompt, str):
        return prompt
    return [_part_dict(p) for p in prompt]


def generation_config(j: Job, thinking_level: str | None = None) -> dict[str, Any]:
    """thinking_level only for Argon (V10) — the job's, or a per-call override (e.g. a fast live round);
    max_output_tokens when set; never deprecated params."""
    cfg: dict[str, Any] = {}
    if j.model == ARGON and (thinking_level or j.thinking_level):
        cfg["thinking_level"] = thinking_level or j.thinking_level
    if j.max_output_tokens:
        cfg["max_output_tokens"] = j.max_output_tokens
    if j.aspect_ratio:
        cfg["image_config"] = {"aspect_ratio": j.aspect_ratio}  # VERIFIED: ImageConfig.aspect_ratio
    for k in DEPRECATED:
        cfg.pop(k, None)
    return cfg


def _chars(prompt: str | list[Part]) -> int:
    if isinstance(prompt, str):
        return len(prompt)
    return sum(len(p.text or "") + len(p.data or b"") for p in prompt)


def _usage(interaction: Any, text: str) -> tuple[int, int, int]:
    """VERIFIED V4: usage.total_input_tokens / total_output_tokens / total_thought_tokens / total_cached_tokens.
    Thought tokens are billed as output. Missing usage -> estimate chars/4 (marked estimated by costs)."""
    usage = getattr(interaction, "usage", None)
    t_in = int(getattr(usage, "total_input_tokens", 0) or 0)
    t_out = int(getattr(usage, "total_output_tokens", 0) or 0) + int(getattr(usage, "total_thought_tokens", 0) or 0)
    cached = int(getattr(usage, "total_cached_tokens", 0) or 0)
    if not t_out:
        t_out = len(text) // 4
    return t_in, t_out, cached


def extract_media(interaction: Any) -> tuple[list[tuple[bytes, str]], list[tuple[bytes, str]]]:
    """VERIFIED V6: media outputs are content items (type image/audio, mime_type, base64 data) in the
    trailing model_output steps; output_image/output_audio hold the last one."""
    images: list[tuple[bytes, str]] = []
    audio: list[tuple[bytes, str]] = []
    for step in getattr(interaction, "steps", None) or []:
        if getattr(step, "type", None) != "model_output":
            continue
        for item in getattr(step, "content", None) or []:
            kind = getattr(item, "type", None)
            data = getattr(item, "data", None)
            if kind not in ("image", "audio") or not data:
                continue
            raw = data if isinstance(data, bytes) else base64.b64decode(data)
            (images if kind == "image" else audio).append((raw, str(getattr(item, "mime_type", None) or "")))
    if not images and getattr(interaction, "output_image", None) is not None and interaction.output_image.data:
        d = interaction.output_image.data
        images.append((d if isinstance(d, bytes) else base64.b64decode(d), str(interaction.output_image.mime_type or "image/png")))
    if not audio and getattr(interaction, "output_audio", None) is not None and interaction.output_audio.data:
        d = interaction.output_audio.data
        audio.append((d if isinstance(d, bytes) else base64.b64decode(d), str(interaction.output_audio.mime_type or "audio/wav")))
    return images, audio


def _status_code(exc: BaseException) -> int | None:
    code = getattr(exc, "status_code", None)
    return int(code) if isinstance(code, int) else None


def _retryable(exc: BaseException) -> bool:
    code = _status_code(exc)
    if code is not None:
        return code in RETRY_STATUSES
    import httpx

    return isinstance(exc, (httpx.TransportError, asyncio.TimeoutError, ConnectionError))


class LLMClient:
    def __init__(self, settings: Settings, db: Any = None, fake: FakeLLM | None = None) -> None:
        self.settings = settings
        self.db = db
        self.fake = fake
        self._client: Any = None

    # ------------------------------------------------------------------ SDK plumbing

    def _genai(self) -> Any:
        if self._client is None:
            from google import genai

            key = self.settings.gemini_api_key.get_secret_value() if self.settings.gemini_api_key else None
            self._client = genai.Client(api_key=key) if key else genai.Client()
        return self._client

    async def _with_retries(self, label: str, fn: Any, run_id: str | None) -> Any:
        for attempt in range(len(BACKOFF_S) + 1):
            try:
                return await fn()
            except Exception as exc:
                if attempt >= len(BACKOFF_S) or not _retryable(exc):
                    raise LLMCallError(f"{label}: {redact(str(exc))[:500]}", _status_code(exc)) from exc
                delay = BACKOFF_S[attempt] * random.uniform(0.8, 1.2)
                await self._log(run_id, "warn", f"{label} retry {attempt + 1}/{len(BACKOFF_S)} in {delay:.1f}s "
                                                f"({_status_code(exc) or type(exc).__name__})")
                await asyncio.sleep(delay)
        raise AssertionError("unreachable")

    async def _create(self, kwargs: dict[str, Any], timeout_s: float, run_id: str | None, label: str) -> Any:
        aio = self._genai().aio.interactions

        async def call() -> Any:
            return await asyncio.wait_for(aio.create(timeout=timeout_s, **kwargs), timeout=timeout_s + 30)

        return await self._with_retries(label, call, run_id)

    async def _poll(self, interaction: Any, on_progress: ProgressFn | None, run_id: str | None, label: str) -> Any:
        """Background long decode: poll every LONG_DECODE_POLL_SECONDS; progress every 30 s; abort after
        LONG_DECODE_MAX_MINUTES (best-effort cancel)."""
        aio = self._genai().aio.interactions
        started = time.monotonic()
        last_note = started
        while getattr(interaction, "status", None) in RUNNING:
            elapsed = time.monotonic() - started
            if elapsed > self.settings.long_decode_max_minutes * 60:
                with contextlib.suppress(Exception):  # cancel is best-effort
                    await aio.cancel(id=interaction.id)
                raise LLMCallError(f"{label}: timeout — long decode exceeded {self.settings.long_decode_max_minutes} min")
            await asyncio.sleep(self.settings.long_decode_poll_seconds)
            iid = interaction.id

            async def get(iid: str = iid) -> Any:
                return await aio.get(id=iid, timeout=60)

            interaction = await self._with_retries(f"{label} poll", get, run_id)
            if time.monotonic() - last_note >= 30:
                last_note = time.monotonic()
                note = f"long decode running {int(last_note - started)}s status={interaction.status}"
                await self._log(run_id, "info", note)
                if on_progress:
                    await on_progress(note)
        return interaction

    # ------------------------------------------------------------------ accounting / logging / health

    async def _log(self, run_id: str | None, level: str, message: str) -> None:
        if not (self.db and run_id):
            return
        try:
            from .. import bus

            async with self.db.tx() as tx:
                row = await tx.fetch_one("SELECT venture_id FROM runs WHERE id = ?", (run_id,))
                if row is None:
                    return
                msg = redact(message, self.settings)
                await tx.execute("INSERT INTO run_logs (run_id, ts, level, message) VALUES (?,?,?,?)",
                                 (run_id, utc_now(), level, msg))
                await bus.emit(tx, venture_id=row["venture_id"], type="run.log", entity_kind="run",
                               entity_id=run_id, data={"run_id": run_id, "level": level, "message": msg}, level=level)
        except Exception:  # logging must never break a model call
            log.debug("run_logs write failed", exc_info=True)

    async def _kv(self, key: str, value: Any) -> None:
        if not self.db:
            return
        try:
            async with self.db.tx() as tx:
                await tx.execute("INSERT INTO kv (key, value_json, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE "
                                 "SET value_json=excluded.value_json, updated_at=excluded.updated_at",
                                 (key, json.dumps(value), utc_now()))
        except Exception:  # health bookkeeping is best-effort
            log.debug("kv write failed", exc_info=True)

    async def _account(self, res: LLMResult, *, job: str, run_id: str | None, venture_id: str | None,
                       agent_id: str | None, department_id: str | None, previous_interaction_id: str | None) -> None:
        """Ledger row (kind model|image|tts|stt), run token/cost columns, ventures.spent_usd (via ledger)."""
        if not self.db:
            return
        try:
            from .. import ledger

            kind = "image" if get_job(job).modality == "image" else LEDGER_KIND.get(job, "model")
            async with self.db.tx() as tx:
                run = await tx.fetch_one("SELECT id, venture_id FROM runs WHERE id = ?", (run_id,)) if run_id else None
                vid = venture_id or (run["venture_id"] if run else None)
                if vid and not await tx.fetch_one("SELECT id FROM ventures WHERE id = ?", (vid,)):
                    vid = None
                if agent_id and not await tx.fetch_one("SELECT id FROM agents WHERE id = ?", (agent_id,)):
                    agent_id = None
                if department_id and not await tx.fetch_one("SELECT id FROM departments WHERE id = ?", (department_id,)):
                    department_id = None
                await ledger.record(tx, venture_id=vid, kind=kind, cost_usd=res.cost_usd, model=res.model,
                                    run_id=run_id if run else None, department_id=department_id, agent_id=agent_id,
                                    units_in=res.tokens_in, units_out=res.tokens_out, estimated=res.estimated_cost)
                if run:
                    await tx.execute(
                        "UPDATE runs SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ?, cost_usd = cost_usd + ?, "
                        "interaction_id = ?, previous_interaction_id = COALESCE(?, previous_interaction_id), model = ? WHERE id = ?",
                        (res.tokens_in, res.tokens_out, res.cost_usd, res.interaction_id, previous_interaction_id,
                         res.model, run_id))
        except Exception:  # accounting must never lose a model result
            log.warning("ledger/run accounting failed for %s", job, exc_info=True)

    async def _finish(self, interaction: Any, *, job: str, model: str, started: float, run_id: str | None,
                      venture_id: str | None, agent_id: str | None, department_id: str | None,
                      previous_interaction_id: str | None) -> LLMResult:
        status = str(getattr(interaction, "status", "completed"))
        if status in FAILED:
            errs = getattr(interaction, "errors", None) or []
            detail = "; ".join(redact(str(getattr(e, "message", e)))[:300] for e in errs) or status
            await self._kv("provider.gemini.last_error", {"at": utc_now(), "job": job, "error": detail[:500]})
            raise LLMCallError(f"{job}: interaction {status}: {detail}")
        text = redact(getattr(interaction, "output_text", "") or "", self.settings)
        images, audio = extract_media(interaction)
        t_in, t_out, cached = _usage(interaction, text)
        cost, est = estimate(model, t_in, t_out, cached)
        res = LLMResult(text=text, interaction_id=getattr(interaction, "id", None) or None, model=model, tokens_in=t_in,
                        tokens_out=t_out, cached_in=cached, cost_usd=cost, estimated_cost=est,
                        latency_ms=int((time.monotonic() - started) * 1000), raw_status=status, images=images, audio=audio)
        await self._account(res, job=job, run_id=run_id, venture_id=venture_id, agent_id=agent_id,
                            department_id=department_id, previous_interaction_id=previous_interaction_id)
        await self._log(run_id, "info", f"← {job} tokens_in={t_in} tokens_out={t_out} {res.latency_ms}ms")
        await self._kv("provider.gemini.last_ok_at", utc_now())
        return res

    async def _failed(self, job: str, exc: BaseException) -> None:
        await self._kv("provider.gemini.last_error", {"at": utc_now(), "job": job, "error": redact(str(exc))[:500]})

    # ------------------------------------------------------------------ public API (contracts.LLMClientProtocol)

    async def generate(self, job: str, prompt: str | list[Part], *, system: str | None = None,
                       previous_interaction_id: str | None = None, run_id: str | None = None,
                       venture_id: str | None = None, agent_id: str | None = None,
                       department_id: str | None = None, on_progress: ProgressFn | None = None,
                       thinking_level: str | None = None) -> LLMResult:
        """Routes to a normal call or a background long decode (Job.background). `thinking_level` overrides the
        job's level for this call only (03-company-kernel/10 §3: worldgen jobs run "medium in a fast live round")."""
        if self.fake is not None:
            return await self.fake.generate(job, prompt, system=system)
        j = get_job(job)
        kwargs: dict[str, Any] = {"model": j.model, "input": compose_input(prompt)}
        if system:
            kwargs["system_instruction"] = system  # VERIFIED V1
        cfg = generation_config(j, thinking_level)
        if cfg:
            kwargs["generation_config"] = cfg
        if j.modality:
            kwargs["response_modalities"] = [j.modality]
        if previous_interaction_id:
            kwargs["previous_interaction_id"] = previous_interaction_id  # VERIFIED V7
        await self._log(run_id, "info", f"→ {job} model={j.model} thinking={cfg.get('thinking_level', '-')} chars_in={_chars(prompt)}")
        started = time.monotonic()
        try:
            if j.background:
                kwargs["background"] = True
                interaction = await self._create(kwargs, 120, run_id, job)
                interaction = await self._poll(interaction, on_progress, run_id, job)
            else:
                timeout = 1200 if cfg.get("thinking_level") == "high" else j.timeout_s
                interaction = await self._create(kwargs, timeout, run_id, job)
        except Exception as exc:
            await self._failed(job, exc)
            await self._log(run_id, "error", f"✗ {job} {redact(str(exc))[:300]}")
            raise
        return await self._finish(interaction, job=job, model=j.model, started=started, run_id=run_id,
                                  venture_id=venture_id, agent_id=agent_id, department_id=department_id,
                                  previous_interaction_id=previous_interaction_id)

    async def generate_json(self, job: str, prompt: str | list[Part], schema: type[BaseModel],
                            **kw: Any) -> tuple[BaseModel, LLMResult]:
        """generate(); parse with jsonout.parse_model. On failure one repair call (server-side context via
        previous_interaction_id); second failure -> LLMOutputError."""
        res = await self.generate(job, prompt, **kw)
        try:
            return parse_model(res.text, schema), res
        except Exception as first:  # noqa: BLE001 — any parse/validation failure triggers one repair
            fix = (f"Your previous output was not valid JSON for this schema: {json.dumps(schema.model_json_schema())}. "
                   f"Error: {str(first)[:400]}. Return ONLY the corrected JSON.")
            rest = {k: v for k, v in kw.items() if k != "previous_interaction_id"}
            if res.interaction_id:
                res2 = await self.generate(job, fix, previous_interaction_id=res.interaction_id, **rest)
            else:
                text = prompt if isinstance(prompt, str) else "(see attached parts)"
                res2 = await self.generate(job, f"{text}\n\n{fix}\nPrevious output:\n{res.text[:20000]}", **rest)
            try:
                return parse_model(res2.text, schema), res2
            except Exception as second:
                raise LLMOutputError(f"{job}: output is not valid {schema.__name__} after one repair: {second}") from second

    async def run_agent(self, *, agent: str, agent_config: dict[str, Any], prompt: str,
                        environment: str | dict[str, Any], run_id: str | None = None,
                        venture_id: str | None = None, background: bool = True,
                        on_progress: ProgressFn | None = None) -> LLMResult:
        """Managed agents (Antigravity, Deep Research). VERIFIED shape: interactions.create(agent=..., agent_config=
        {"type": ...}, environment="remote" | {"type": "remote", "network": {"allowlist": [{"domain", "credential"?}]}},
        background=True) then poll interactions.get."""
        if self.fake is not None:
            return await self.fake.run_agent(agent=agent, agent_config=agent_config, prompt=prompt, environment=environment)
        kwargs: dict[str, Any] = {"agent": agent, "input": prompt}
        if agent_config:
            kwargs["agent_config"] = agent_config
        if environment:
            kwargs["environment"] = environment
        if background:
            kwargs["background"] = True  # V5
        await self._log(run_id, "info", f"→ agent {agent} config={agent_config.get('type', '-')} chars_in={len(prompt)}")
        started = time.monotonic()
        label = f"agent {agent}"
        try:
            interaction = await self._create(kwargs, 3600 if not background else 120, run_id, label)
            if background:
                interaction = await self._poll(interaction, on_progress, run_id, label)
        except Exception as exc:
            await self._failed("antigravity", exc)
            await self._log(run_id, "error", f"✗ {label} {redact(str(exc))[:300]}")
            raise
        model = str(agent_config.get("model") or agent)
        return await self._finish(interaction, job="antigravity", model=model, started=started, run_id=run_id,
                                  venture_id=venture_id, agent_id=None, department_id=None, previous_interaction_id=None)

    async def generate_images(self, job: str, prompt: str, n: int = 1,
                              reference_images: list[Part] | None = None) -> LLMResult:
        """Nano Banana (VERIFIED V6): response_modalities=["image"]; reference images go in the input parts.
        n > 1 -> n calls; results concatenated."""
        if self.fake is not None:
            return await self.fake.generate_images(job, prompt, n, reference_images)
        parts: list[Part] = [*(reference_images or []), Part(kind="text", text=prompt)]
        total: LLMResult | None = None
        for _ in range(max(1, n)):
            res = await self.generate(job, parts if reference_images else prompt)
            if total is None:
                total = res
            else:
                total.images.extend(res.images)
                total.tokens_in += res.tokens_in
                total.tokens_out += res.tokens_out
                total.cost_usd += res.cost_usd
                total.latency_ms += res.latency_ms
        assert total is not None
        return total


def build_llm_client(settings: Settings, db: Any = None) -> LLMClient | FakeLLM:
    return FakeLLM() if settings.llm_mode == "fake" else LLMClient(settings, db)
