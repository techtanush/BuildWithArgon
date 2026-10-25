# OWNER: ayan
"""Bounded live-only verification. No CLI/env loading; caller supplies Settings.

Budget is an estimate, not a provider billing guarantee. Unknown/failed calls retain
full reservations. No SDK retries or managed agents are permitted by this helper.
"""
from __future__ import annotations

import asyncio
from dataclasses import replace
import json
import math
from pathlib import Path
import time
from typing import Any

from ..llm.client import LLMClient
from ..models import ARGON, JOBS
from ..security import redact
from . import paths
from .critique import critique

RUN_ID = "wgr_01M5T6VWB2SFMJSPB1KCK8CGYY"
_REGISTRY_LOCK = asyncio.Lock()


class BudgetBlocked(RuntimeError):
    pass


def input_estimate(prompt: Any, system: str | None = None) -> int:
    chars = len(system or "")
    media = 0
    if isinstance(prompt, str):
        chars += len(prompt)
    else:
        for part in prompt:
            chars += len(part.text or "")
            if part.kind == "image":
                media += 4096
            elif part.kind == "video" or (part.mime or "").startswith("video/"):
                media += 8192
            elif part.kind != "text":
                raise BudgetBlocked("unsupported_media")
    return math.ceil(chars / 2) + media


def argon_cost(tokens_in: int, tokens_out: int) -> float:
    return (tokens_in * 2 + tokens_out * 10) / 1_000_000


class BudgetLLM(LLMClient):
    """Inherited generate_json dispatches ALL repair calls through generate.

    Serial only. Known interaction contexts include their input plus capped output;
    unknown previous_interaction_id is blocked rather than under-reserved.
    Receipts contain only allowlisted metadata, never prompts or raw errors.
    """

    def __init__(self, settings: Any, *, limit_usd: float = 2.0,
                 receipt_path: Path, deadline: float | None = None) -> None:
        if settings.llm_mode != "live":
            raise ValueError("live mode required")
        if not math.isfinite(limit_usd) or not 0 <= limit_usd <= 2:
            raise ValueError("limit_usd must be between 0 and 2")
        super().__init__(settings)
        self.limit_usd = limit_usd
        self.receipt_path = Path(receipt_path)
        self.deadline = deadline or time.monotonic() + 180
        self.calls: list[dict[str, Any]] = []
        self.contexts: dict[str, int] = {}
        self._active: dict[str, Any] | None = None
        self._serial = asyncio.Lock()
        if self.receipt_path.exists():
            previous = json.loads(self.receipt_path.read_text())
            # Never silently reset a prior run's spending. Context IDs intentionally
            # aren't persisted, so cross-process continuations remain blocked.
            self.calls = previous["calls"]
        self.persist("ready")

    @property
    def spent(self) -> float:
        return sum(c["charged_usd"] for c in self.calls)

    def persist(self, status: str) -> dict[str, Any]:
        result = {"status": status, "model": ARGON, "limit_usd": self.limit_usd,
                  "price_usd_per_million": {"input": 2, "output": 10},
                  "calls": self.calls, "generate_calls": len(self.calls),
                  "actual_usage_calls": sum(c.get("usage_actual", False) for c in self.calls),
                  "actual_usage_spend_usd": sum(c.get("actual_cost_usd", 0) for c in self.calls),
                  "estimated_spend_usd": self.spent}
        self.receipt_path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.receipt_path.with_suffix(".tmp")
        temp.write_text(redact(json.dumps(result, indent=2), self.settings))
        temp.replace(self.receipt_path)
        return result

    async def _with_retries(self, label: str, fn: Any, run_id: Any) -> Any:
        # One provider create per reservation. Caller may explicitly retry via generate.
        return await fn()

    async def _account(self, res: Any, **kw: Any) -> None:
        # Called even for provider failed statuses, before base _finish raises.
        if self._active is not None:
            row = self._active
            row.update(tokens_in=res.tokens_in, tokens_out=res.tokens_out,
                       usage_actual=not res.estimated_cost)
            if not res.estimated_cost:
                cost = argon_cost(res.tokens_in, res.tokens_out)
                row.update(actual_cost_usd=cost, charged_usd=cost)
            row["status"] = "completed" if res.raw_status == "completed" else "provider_incomplete"
            self.persist("running")

    async def generate(self, job: str, prompt: Any, **kw: Any) -> Any:
        async with self._serial:
            if self.fake is not None or self.settings.llm_mode != "live":
                raise BudgetBlocked("live_required")
            if job not in ("worldgen_critic", "worldgen_patch") or JOBS[job].model != ARGON:
                raise BudgetBlocked("only_actual_argon_critic_or_patch_allowed")
            if time.monotonic() >= self.deadline:
                raise BudgetBlocked("wall_timeout")
            out_cap = 2048 if job == "worldgen_critic" else 16384
            tokens_in = input_estimate(prompt, kw.get("system"))
            # Include schema text plus a safety allowance for protocol framing.
            tokens_in += math.ceil(len(json.dumps(kw.get("response_schema") or {})) / 2) + 1024
            prev = kw.get("previous_interaction_id")
            if prev:
                if prev not in self.contexts:
                    raise BudgetBlocked("unknown_context_upper_bound")
                tokens_in += self.contexts[prev]
            reserve = argon_cost(tokens_in, out_cap)
            if self.spent + reserve > self.limit_usd:
                self.persist("budget_blocked")
                raise BudgetBlocked("estimated_budget_exhausted")
            row = {"number": len(self.calls) + 1, "job": job, "status": "reserved",
                   "reserved_usd": reserve, "charged_usd": reserve,
                   "input_upper_estimate": tokens_in, "output_cap": out_cap}
            self.calls.append(row)
            self.persist("running")  # durable before the provider can be called
            self._active = row
            try:
                async with _REGISTRY_LOCK:
                    original = JOBS[job]
                    JOBS[job] = replace(original, thinking_level="medium", max_output_tokens=out_cap,
                                        background=False, timeout_s=120)
                    try:
                        remaining = self.deadline - time.monotonic()
                        if remaining <= 0:
                            raise TimeoutError()
                        res = await asyncio.wait_for(super().generate(job, prompt, **kw), remaining)
                    finally:
                        JOBS[job] = original
                if res.interaction_id:
                    self.contexts[res.interaction_id] = tokens_in + max(out_cap, res.tokens_out)
                return res
            except BaseException:
                if row["status"] == "reserved":
                    row["status"] = "uncertain_reserved"
                raise
            finally:
                self._active = None
                self.persist("running")

    async def run_agent(self, **kw: Any) -> Any:
        # No enforced provider-side upper bound exists for managed-agent tool work.
        raise BudgetBlocked("managed_agent_upper_bound_unknown")

    async def generate_images(self, *args: Any, **kw: Any) -> Any:
        raise BudgetBlocked("image_output_upper_bound_unknown")


def _ready(root: Path, dept: str) -> tuple[dict[str, Any], str] | None:
    try:
        report = json.loads((root / "probes" / "iter-1" / f"{dept}.json").read_text())
        source = (root / "modules" / "iter-1" / f"{dept}.ts").read_text()
        # Require six actual screenshots and both walkthroughs, no frame substitution.
        refs = [report.get("screenshots", {}).get(cam) for cam in paths.CAMERAS]
        refs += [report.get("videos", {}).get(k) for k in ("ext", "int")]
        if any(not r or not (root / r).is_file() or (root / r).stat().st_size == 0 for r in refs):
            return None
        return report, source
    except (OSError, ValueError, TypeError):
        return None


async def verify_captures(settings: Any, limit_usd: float = 2.0) -> dict[str, Any]:
    """13 serial critiques, <=120s total report waiting, <=180s total wall.

    Must run in an isolated caller process: the bounded Job override is global
    while each generate awaits, and is always restored. No patch/live bridge.
    """
    start = time.monotonic()
    deadline = start + 180
    root = paths.RUNS_DIR / RUN_ID
    llm = BudgetLLM(settings, limit_usd=limit_usd, receipt_path=root / "verify-receipt.json", deadline=deadline)
    pending = list(paths.departments())
    if len(pending) != 13:
        raise ValueError("expected 13 departments")
    counts = {"completed": 0, "failed": 0, "pending": 13}
    waited = 0.0
    status = "completed"
    try:
        async with asyncio.timeout(180):
            while pending:
                ready = next(((d, _ready(root, d.id)) for d in pending if _ready(root, d.id)), None)
                if ready is None:
                    if waited >= 120:
                        status = "reports_timeout"
                        break
                    before = time.monotonic()
                    await asyncio.sleep(min(1, 120 - waited))
                    waited += time.monotonic() - before
                    continue
                d, inputs = ready
                report, source = inputs
                try:
                    out = await critique(llm, d, report=report, root=root, source=source,
                                         thinking_level="medium", out_file=None)
                    # Redact all persisted generated content; include all repair usage.
                    out["budget_cumulative_spend_usd"] = llm.spent
                    target = root / "critic" / "iter-1" / f"{d.id}.json"
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text(redact(json.dumps(out, indent=2), settings))
                    counts["completed"] += 1
                except BudgetBlocked:
                    status = "budget_blocked"
                    break
                except TimeoutError:
                    status = "wall_timeout"
                    break
                except Exception:
                    # Raw provider errors must never enter the receipt or stdout.
                    counts["failed"] += 1
                pending.remove(d)
                counts["pending"] = len(pending)
    except TimeoutError:
        status = "wall_timeout"
    finally:
        result = llm.persist(status)
    return {**result, "counts": counts, "elapsed_s": round(time.monotonic() - start, 3)}
