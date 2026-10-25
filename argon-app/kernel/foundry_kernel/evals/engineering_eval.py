# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.

"""`foundry-eval engineering` — 06-execution/04-evals.md §1 (optional, P2).
5 briefs × {baseline: one `eval_baseline` call applied once, loop: LocalLoopExecutor exactly as in production}, then the
hidden tests (never shown to the model) run in tests/hidden/. Writes evals/results/engineering-<UTC ts>.json and
eval_results rows. Refuses LLM_MODE=fake unless --allow-fake (those numbers would be fake; the file says so)."""
from __future__ import annotations

import argparse
import asyncio
import json
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

from ..config import APP_DIR, Settings, get_settings
from ..contracts import ExecutorInput, LLMResult
from ..ids import new_id, utc_now
from ..models import job as get_job

BRIEFS_DIR = APP_DIR / "evals" / "briefs"
RESULTS_DIR = APP_DIR / "evals" / "results"


class _EvalLLM:
    """Eval calls belong to no venture (ledger.venture_id is a FK); runs are real `kind='eval'` rows."""

    def __init__(self, llm: Any) -> None:
        self.llm = llm

    async def generate(self, job: str, prompt: Any, **kw: Any) -> LLMResult:
        kw["venture_id"] = None
        return await self.llm.generate(job, prompt, **kw)


def load_briefs(only: str | None = None) -> list[dict[str, Any]]:
    briefs = [yaml.safe_load(p.read_text("utf-8")) for p in sorted(BRIEFS_DIR.glob("*.yaml"))]
    return [b for b in briefs if only in (None, b["id"])]


def brief_input(brief: dict[str, Any], ticket_id: str, run_id: str, max_iterations: int) -> ExecutorInput:
    api = brief.get("api") or {}
    body = (f"{brief['brief'].strip()}\n\nPUBLIC API — implement exactly this module and these exports:\n"
            f"module: {api.get('module')}\n{api.get('exports', '')}")
    return ExecutorInput(venture_id="eval", ticket_id=ticket_id, run_id=run_id, title=brief["title"], body=body,
                         acceptance_criteria=[{"id": a["id"], "text": a["text"]} for a in brief["acceptance_criteria"]],
                         max_iterations=max_iterations)


async def _new_run(db: Any, job: str) -> str:
    rid = new_id("run")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO runs (id, kind, job, model, status, created_at, started_at) VALUES (?,?,?,?,?,?,?)",
                         (rid, "eval", job, get_job(job).model, "running", utc_now(), utc_now()))
    return rid


async def _finish_run(db: Any, rid: str, ok: bool) -> None:
    async with db.tx() as tx:
        await tx.execute("UPDATE runs SET status = ?, completed_at = ? WHERE id = ?",
                         ("succeeded" if ok else "failed", utc_now(), rid))


async def hidden_tests(executor: Any, ws: Path, brief: dict[str, Any], timeout: int) -> dict[str, Any]:
    from ..executors.local_loop import parse_vitest

    hidden = ws / "tests" / "hidden" / f"{brief['id']}.test.ts"
    hidden.parent.mkdir(parents=True, exist_ok=True)
    hidden.write_text(brief["hidden_tests"], "utf-8")
    out = ws / ".foundry" / "hidden.json"
    out.parent.mkdir(exist_ok=True)
    if out.exists():
        out.unlink()
    await executor.runner(["npx", "vitest", "run", "tests/hidden", "--reporter=json", "--outputFile=.foundry/hidden.json"],
                          ws, timeout)
    v = parse_vitest(out, ws)
    total = v.passed + v.failed
    return {"hidden_passed": v.passed, "hidden_total": total, "all_hidden_pass": v.ran and total > 0 and v.failed == 0}


async def run_case(settings: Settings, llm: Any, db: Any, brief: dict[str, Any], condition: str, rep: int,
                   runner: Any = None) -> dict[str, Any]:
    from ..executors import fileblocks, workspace
    from ..executors.local_loop import BUILDER_SYSTEM, LocalLoopExecutor

    job = "eval_baseline" if condition == "baseline" else "engineering_build"
    rid = await _new_run(db, job)
    tid = f"eval-{brief['id']}-{condition}-{rep}-{int(time.time())}"
    inp = brief_input(brief, tid, rid, settings.max_build_iterations)
    executor = LocalLoopExecutor(settings, _EvalLLM(llm), runner=runner, agent_id=None, department_id=None)
    logs: list[str] = []

    async def log(level: str, msg: str) -> None:
        logs.append(f"{level}: {msg}")

    started = time.monotonic()
    if condition == "loop":
        res = await executor.run(inp, log)
        ws = Path(res.workspace_path or "")
        metrics: dict[str, Any] = {"iterations": res.iterations, "first_pass_passed": res.first_pass_passed,
                                   "tokens_in": res.tokens_in, "tokens_out": res.tokens_out, "cost_usd": res.cost_usd,
                                   "files_changed": len(res.files_changed), "builder_tests_passed": res.tests_passed,
                                   "builder_tests_failed": res.tests_failed}
    else:
        ws = workspace.create_workspace(settings, "eval", tid)
        await executor._ensure_install(ws, log)
        out = await executor.llm.generate(job, executor.build_prompt(inp, ws), system=BUILDER_SYSTEM, run_id=rid)
        await executor.apply(ws, fileblocks.parse(out.text), log)
        metrics = {"iterations": 1, "first_pass_passed": None, "tokens_in": out.tokens_in, "tokens_out": out.tokens_out,
                   "cost_usd": out.cost_usd, "files_changed": len(workspace.changed_files(ws))}
    metrics.update(await hidden_tests(executor, ws, brief, settings.local_test_timeout_seconds))
    metrics["wall_seconds"] = round(time.monotonic() - started, 2)
    await _finish_run(db, rid, bool(metrics["all_hidden_pass"]))
    async with db.tx() as tx:
        await tx.execute("INSERT INTO eval_results (id, suite, case_id, condition, metrics_json, created_at) VALUES (?,?,?,?,?,?)",
                         (new_id("evr"), "engineering", brief["id"], condition, json.dumps({**metrics, "repeat": rep}),
                          utc_now()))
    return {"brief": brief["id"], "condition": condition, "repeat": rep, "run_id": rid, **metrics}


def summarize(cases: list[dict[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for cond in sorted({c["condition"] for c in cases}):
        rows = [c for c in cases if c["condition"] == cond]
        ratios = [c["hidden_passed"] / c["hidden_total"] if c["hidden_total"] else 0.0 for c in rows]
        out[cond] = {"n": len(rows), "all_pass": sum(bool(c["all_hidden_pass"]) for c in rows),
                     "mean_hidden_pass_ratio": round(sum(ratios) / len(ratios), 4) if ratios else 0.0,
                     "mean_iterations": round(sum(c["iterations"] for c in rows) / len(rows), 2),
                     "cost_usd": round(sum(c["cost_usd"] for c in rows), 4),
                     "wall_seconds": round(sum(c["wall_seconds"] for c in rows), 1)}
    return out


async def run_eval(settings: Settings, *, brief: str | None, condition: str, repeats: int, llm: Any = None,
                   runner: Any = None, results_dir: Path = RESULTS_DIR) -> Path:
    from ..db import Database
    from ..llm.client import build_llm_client

    db = Database(settings.db_path)
    await db.connect()
    try:
        llm = llm or build_llm_client(settings, db)
        conds = ["baseline", "loop"] if condition == "both" else [condition]
        cases = []
        for b in load_briefs(brief):
            for rep in range(1, repeats + 1):
                for cond in conds:
                    print(f"engineering eval: {b['id']} × {cond} (repeat {rep})", flush=True)
                    cases.append(await run_case(settings, llm, db, b, cond, rep, runner))
    finally:
        await db.close()
    results_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(UTC).strftime("%Y%m%dT%H%MZ")
    path = results_dir / f"engineering-{ts}.json"
    path.write_text(json.dumps({"suite": "engineering", "created_at": utc_now(), "fake": settings.llm_mode == "fake",
                                "summary": summarize(cases), "cases": cases}, indent=2) + "\n")
    return path


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser(prog="foundry-eval engineering")
    ap.add_argument("--brief")
    ap.add_argument("--condition", choices=["baseline", "loop", "both"], default="both")
    ap.add_argument("--repeats", type=int, default=1)
    ap.add_argument("--allow-fake", action="store_true", help="run in LLM_MODE=fake (results are marked fake)")
    args = ap.parse_args(argv)
    settings = get_settings()
    if settings.llm_mode == "fake" and not args.allow_fake:
        print("refusing to run the engineering eval in LLM_MODE=fake: the numbers would be fake. "
              "Set LLM_MODE=live (or pass --allow-fake for a plumbing check).")
        raise SystemExit(2)
    path = asyncio.run(run_eval(settings, brief=args.brief, condition=args.condition, repeats=args.repeats))
    print(f"wrote {path}")
    print(json.dumps(json.loads(path.read_text())["summary"], indent=2))
