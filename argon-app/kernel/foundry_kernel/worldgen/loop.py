# OWNER: ayan
"""The render → watch → critique → fix loop (05-world/10; acceptance G-01…G-03, G-05, G-06).

iteration 0 = the one-pass modules (generate.py). For n = 0..max_iter: validate + stage changed modules (static +
tsc), capture them headlessly (6 screenshots + 2 walkthrough videos + probes), critique (videos, screenshots, probes,
source), record, keep the best version per building, stop when every building is good / nothing improved /
max_iter, else patch every building with failed probes or high issues (patching its best version so far).
Unchanged buildings carry their scores forward (captured_iteration says which renders the scores came from)."""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..config import Settings
from ..ids import new_id, utc_now
from . import paths
from .capture import CaptureError, run_capture
from .critique import critique, needs_patch, patch
from .generate import generate_all
from .runs import Recorder, read_json, run_dirs, write_json
from .score import Version, better, invalid_report, iteration_entry, mean, write_outputs
from .validate import Validation, validate


@dataclass
class LoopOptions:
    max_iter: int = 4
    url: str | None = None
    fake_capture: bool = False
    fast: bool = False
    fail: list[str] = field(default_factory=list)  # fake capture page only
    video: bool = True
    gpu: bool = False
    concurrency: int = 4
    only: list[str] | None = None


class Totals:
    def __init__(self) -> None:
        self.tokens_in = 0
        self.tokens_out = 0
        self.cost = 0.0

    def add(self, rec: dict[str, Any] | None) -> None:
        if not rec:
            return
        t = rec.get("tokens") or {}
        self.tokens_in += int(t.get("in", 0))
        self.tokens_out += int(t.get("out", 0))
        self.cost += float(rec.get("cost_usd", 0.0) or 0.0)


def _meta(run_dir: Path, **update: Any) -> dict[str, Any]:
    meta = read_json(run_dir / "run.json", {}) or {}
    meta.update(update)
    write_json(run_dir / "run.json", meta)
    return meta


def new_run() -> tuple[str, Path]:
    run_id = new_id("wgr")
    run_dir = paths.RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    _meta(run_dir, run_id=run_id, created_at=utc_now(), status="running")
    return run_id, run_dir


def latest_generated_run() -> Path | None:
    for d in run_dirs():
        if (d / "modules" / "iter-0").exists() and any((d / "modules" / "iter-0").glob("*.ts")):
            return d
    return None


async def buildings(settings: Settings, llm: Any, db: Any, *, only: list[str] | None = None) -> str:
    """`foundry-worldgen buildings`: one-pass generation (iteration 0) + static validation + tsc, recorded."""
    rec = Recorder(db)
    run_id, run_dir = new_run()
    await rec.start_run(run_id, run_dir)
    started = time.monotonic()
    try:
        gen = await generate_all(llm, run_dir, rec, run_id=run_id, only=only)
        results = validate(gen["modules"])
        write_json(run_dir / "validation" / "iter-0.json", {d: v.__dict__ for d, v in results.items()})
        ok = sorted(d for d, v in results.items() if v.ok)
        await rec.progress(step="validate", status="done", run_id=run_id, iteration=0,
                           note=f"{len(ok)}/{len(results)} modules pass static rules + tsc")
        _meta(run_dir, status="generated", stage="iteration-0", generated=gen["generated"], missing=gen["missing"],
              valid=ok, tokens=gen["tokens"], cost_usd=gen["cost_usd"], wall_minutes=round((time.monotonic() - started) / 60, 2))
        await rec.finish_run(run_id, status="succeeded", iterations=0, final_score=None)
    except Exception as exc:
        _meta(run_dir, status="failed", error=str(exc)[:500])
        await rec.finish_run(run_id, status="failed", iterations=0, final_score=None)
        await rec.progress(step="generate", status="failed", run_id=run_id, note=str(exc)[:300])
        raise
    return run_id


async def run_loop(settings: Settings, llm: Any, db: Any, opts: LoopOptions, *, run_dir: Path | None = None) -> dict[str, Any]:
    """`foundry-worldgen loop`: continues the latest one-pass run (or generates one first)."""
    rec = Recorder(db)
    if run_dir is None:
        run_dir = latest_generated_run()
    if run_dir is None:
        run_id = await buildings(settings, llm, db, only=opts.only)
        run_dir = paths.RUNS_DIR / run_id
    run_id = run_dir.name
    await rec.start_run(run_id, run_dir)
    meta = _meta(run_dir, status="running", stage="loop", loop_started_at=utc_now(), max_iter=opts.max_iter)
    started = time.monotonic()
    totals = Totals()
    totals.tokens_in = int((meta.get("tokens") or {}).get("in", 0))
    totals.tokens_out = int((meta.get("tokens") or {}).get("out", 0))
    totals.cost = float(meta.get("cost_usd", 0.0) or 0.0)

    wanted = opts.only or paths.department_ids()
    current = {d: (run_dir / "modules" / "iter-0" / f"{d}.ts").read_text()
               for d in wanted if (run_dir / "modules" / "iter-0" / f"{d}.ts").exists()}
    best: dict[str, Version | None] = {d: None for d in wanted}
    last: dict[str, Version] = {}
    iterations: list[dict[str, Any]] = []
    changed = set(current)
    sem = asyncio.Semaphore(max(1, opts.concurrency))
    stop_reason = ""
    n = 0
    try:
        for n in range(opts.max_iter + 1):
            mod_dir = run_dir / "modules" / f"iter-{n}"
            mod_dir.mkdir(parents=True, exist_ok=True)
            for d in changed:
                (mod_dir / f"{d}.ts").write_text(current[d])
            for f in paths.STAGING_DIR.glob("*.ts") if paths.STAGING_DIR.exists() else []:
                if f.stem in changed:
                    f.unlink()
            await rec.progress(step="validate", status="running", run_id=run_id, iteration=n, note=f"{len(changed)} modules")
            vals: dict[str, Validation] = validate({d: current[d] for d in changed}) if changed else {}
            write_json(run_dir / "validation" / f"iter-{n}.json", {d: v.__dict__ for d, v in vals.items()})
            valid = sorted(d for d, v in vals.items() if v.ok)
            reports: dict[str, dict[str, Any]] = {}
            if valid:
                await rec.progress(step="capture", status="running", run_id=run_id, iteration=n, note=f"{len(valid)} buildings")
                try:
                    reports = await run_capture(root=run_dir, iteration=n, depts=valid, source="staging", url=opts.url,
                                                fake=opts.fake_capture, fast=opts.fast, fail=opts.fail, video=opts.video, gpu=opts.gpu)
                except CaptureError as exc:
                    stop_reason = f"capture infrastructure failure: {exc}"
                    await rec.progress(step="capture", status="failed", run_id=run_id, iteration=n, note=str(exc)[:300])
                    if n == 0:
                        raise
                    break
                await rec.progress(step="capture", status="done", run_id=run_id, iteration=n)

            async def judge(d: str, n: int = n, vals: dict[str, Validation] = vals,
                            reports: dict[str, dict[str, Any]] = reports) -> Version:
                v = vals[d]
                report = reports.get(d) if v.ok else None
                if report is None:
                    errs = (v.errors or ["tsc failed"]) if not v.ok else ["capture produced no report for this building"]
                    report = invalid_report(d, "staging", errs, v.tsc_errors)
                    write_json(run_dir / "probes" / f"iter-{n}" / f"{d}.json", report)
                    critic = {"issues": [{"severity": "high", "where": "", "camera": "", "description": e, "fix": "Fix the module so it passes validation."}
                                         for e in [*errs, *([v.tsc_errors] if v.tsc_errors else [])]], "keep": [],
                              "interaction_id": None, "scores": None, "visual_score": None, "realism": None}
                    write_json(run_dir / "critic" / f"iter-{n}" / f"{d}.json", critic)
                    return Version(d, n, current[d], report, critic, captured_iteration=n)
                async with sem:
                    await rec.progress(step="critique", status="running", department_id=d, run_id=run_id, iteration=n)
                    try:
                        c = await critique(llm, paths.department(d), report=report, root=run_dir, source=current[d],
                                           tsc_errors=v.tsc_errors, out_file=run_dir / "critic" / f"iter-{n}" / f"{d}.json")
                        totals.add(c)
                    except Exception as exc:  # noqa: BLE001 — a failed critique is recorded, the building keeps its probe score
                        c = {"error": str(exc)[:500], "issues": [], "keep": [], "interaction_id": None,
                             "visual_score": None, "realism": None}
                        write_json(run_dir / "critic" / f"iter-{n}" / f"{d}.json", c)
                    await rec.progress(step="critique", status="done" if "error" not in c else "failed", department_id=d,
                                       run_id=run_id, iteration=n, score=c.get("visual_score"))
                return Version(d, n, current[d], report, c, captured_iteration=n)

            judged = await asyncio.gather(*(judge(d) for d in sorted(changed)))
            versions = {v.dept: v for v in judged}
            for d, prev in last.items():
                if d not in versions:
                    versions[d] = Version(d, n, prev.source, prev.report, prev.critic, captured_iteration=prev.captured_iteration)
            improved = False
            for d, v in versions.items():
                if better(v, best.get(d)):
                    improved = improved or best.get(d) is not None or n == 0
                    best[d] = v
                await rec.iteration(run_id, n, d, v.report, v.critic or {}, v.probe)
            last = versions
            entry = iteration_entry(n, versions)
            iterations.append(entry)
            write_json(run_dir / "scores.json", {"run_id": run_id, "iterations": iterations, "final": {}, "in_progress": True})
            await rec.progress(step="iteration", status="done", run_id=run_id, iteration=n, score=entry["world_score"],
                               note=f"visual={entry['visual_score']} realism={entry['realism']}")
            if all(b is not None and b.good() for b in best.values()):
                stop_reason = "every building passes all probes with visual >= 0.75 and realism >= 0.7"
                break
            if n > 0 and not improved:
                stop_reason = "an iteration improved nothing"
                break
            if n == opts.max_iter:
                stop_reason = f"reached --max-iter {opts.max_iter}"
                break
            todo = [d for d, b in best.items() if b is not None and needs_patch(b.report, b.critic)]
            if not todo:
                stop_reason = "nothing left to patch (no failed probes or high-severity issues)"
                break
            changed = set()

            async def fix(d: str, n: int = n, vals: dict[str, Validation] = vals, changed: set[str] = changed) -> None:
                b = best[d]
                assert b is not None
                async with sem:
                    await rec.progress(step="patch", status="running", department_id=d, run_id=run_id, iteration=n)
                    try:
                        tsc = vals[d].tsc_errors if d in vals else ""
                        p = await patch(llm, paths.department(d), source=b.source, critic=b.critic or {}, report=b.report,
                                        tsc_errors=tsc, out_file=run_dir / "patch" / f"iter-{n}" / f"{d}.json")
                        totals.add(p)
                    except Exception as exc:  # noqa: BLE001
                        p = {"source": None, "static_errors": [str(exc)[:300]]}
                        write_json(run_dir / "patch" / f"iter-{n}" / f"{d}.json", p)
                    if p.get("source"):
                        current[d] = p["source"]
                        changed.add(d)
                    await rec.progress(step="patch", status="done" if p.get("source") else "failed", department_id=d,
                                       run_id=run_id, iteration=n)

            await asyncio.gather(*(fix(d) for d in todo))
            if not changed:
                stop_reason = "no building could be patched"
                break
    except Exception as exc:
        _meta(run_dir, status="failed", error=str(exc)[:500])
        await rec.finish_run(run_id, status="failed", iterations=len(iterations), final_score=None)
        raise

    registry = write_outputs(run_id, best, reason_suffix=f" after {len(iterations)} iteration(s)")
    final_versions = [b for b in best.values() if b is not None]
    final = {"world_score": mean([b.probe for b in final_versions]) or 0.0,
             "visual_score": mean([b.visual for b in final_versions if b.visual is not None]),
             "realism": mean([b.realism for b in final_versions if b.realism is not None]),
             "generated": sum(1 for e in registry["modules"].values() if e["status"] == "generated"),
             "fallback": sum(1 for e in registry["modules"].values() if e["status"] != "generated")}
    wall = round((time.monotonic() - started) / 60 + float(meta.get("wall_minutes", 0.0) or 0.0), 2)
    scores = {"run_id": run_id, "iterations": iterations, "final": final, "registry": registry["modules"],
              "stop_reason": stop_reason, "tokens": {"in": totals.tokens_in, "out": totals.tokens_out},
              "cost_usd": round(totals.cost, 4), "wall_minutes": wall}
    write_json(run_dir / "scores.json", scores)
    _meta(run_dir, status="succeeded", stage="done", finished_at=utc_now(), stop_reason=stop_reason,
          tokens=scores["tokens"], cost_usd=scores["cost_usd"], wall_minutes=wall)
    await rec.finish_run(run_id, status="succeeded", iterations=len(iterations), final_score=final["world_score"])
    await rec.progress(step="loop", status="done", run_id=run_id, iteration=n, score=final["world_score"], note=stop_reason)
    return scores
