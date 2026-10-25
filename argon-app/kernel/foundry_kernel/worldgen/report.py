# OWNER: ayan
"""`foundry-worldgen report` (05-world/09 §CLI; 06-execution/04-evals.md §3): reads the latest run's scores.json,
prints the score table and writes evals/results/world-<UTC ts>.json — iteration 0 (single-pass baseline) vs final
world / visual / realism, the per-building table, and every live round's before → after — plus eval_results rows."""
from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ..ids import new_id, utc_now
from . import paths
from .runs import read_json, run_dirs, write_json


def latest_scored_run() -> Path | None:
    for d in run_dirs():
        s = read_json(d / "scores.json", {}) or {}
        if s.get("iterations") and s.get("final"):
            return d
    return None


def live_rounds() -> list[dict[str, Any]]:
    out = []
    if paths.LIVE_DIR.exists():
        for d in sorted(paths.LIVE_DIR.iterdir(), reverse=True):
            r = read_json(d / "round.json")
            if r:
                out.append({"id": r["id"], "department_id": r["department_id"], "status": r["status"],
                            "elapsed_s": r.get("elapsed_s"), "promoted": r.get("promoted"),
                            "used_managed_agent": r.get("used_managed_agent"),
                            "before": {k: (r.get("before") or {}).get(k) for k in ("probe_score", "visual_score", "realism")},
                            "after": {k: (r.get("after") or {}).get(k) for k in ("probe_score", "visual_score", "realism")}})
    return out


def build_report(run_dir: Path) -> dict[str, Any]:
    scores = read_json(run_dir / "scores.json", {})
    its = scores["iterations"]
    first, final = its[0], scores["final"]
    per_building = {}
    for dept in paths.department_ids():
        b0 = first["by_building"].get(dept, {})
        reg = scores.get("registry", {}).get(dept, {})
        per_building[dept] = {"iteration_0": {"probe": b0.get("probe"), "visual": b0.get("visual"), "realism": b0.get("realism"),
                                              "failed": b0.get("failed", [])},
                              "final": {"status": reg.get("status"), "iteration": reg.get("iteration"),
                                        "probe": reg.get("probe_score"), "visual": reg.get("visual_score"),
                                        "realism": reg.get("realism"), "reason": reg.get("reason")}}

    def delta(a: Any, b: Any) -> float | None:
        return round(b - a, 4) if isinstance(a, (int, float)) and isinstance(b, (int, float)) else None

    return {"suite": "world", "run_id": scores["run_id"], "created_at": utc_now(),
            "iteration_0": {"world_score": first["world_score"], "visual_score": first.get("visual_score"), "realism": first.get("realism")},
            "final": final,
            "loop_value": {"world_score": delta(first["world_score"], final.get("world_score")),
                           "visual_score": delta(first.get("visual_score"), final.get("visual_score")),
                           "realism": delta(first.get("realism"), final.get("realism"))},
            "iterations": [{k: it.get(k) for k in ("n", "world_score", "visual_score", "realism")} for it in its],
            "per_building": per_building, "live_rounds": live_rounds(), "stop_reason": scores.get("stop_reason"),
            "tokens": scores.get("tokens"), "cost_usd": scores.get("cost_usd"), "wall_minutes": scores.get("wall_minutes")}


def print_table(report: dict[str, Any]) -> None:
    print(f"run {report['run_id']}  stop: {report.get('stop_reason')}")
    print(f"{'iter':>4} {'world':>7} {'visual':>7} {'realism':>8}")
    for it in report["iterations"]:
        f = lambda v: f"{v:.3f}" if isinstance(v, (int, float)) else "  -  "
        print(f"{it['n']:>4} {f(it['world_score']):>7} {f(it['visual_score']):>7} {f(it['realism']):>8}")
    print(f"{'building':<22} {'status':<10} {'probe':>6} {'visual':>7} {'realism':>8}  note")
    for dept, b in report["per_building"].items():
        fin = b["final"]
        f = lambda v: f"{v:.2f}" if isinstance(v, (int, float)) else "-"
        print(f"{dept:<22} {fin['status']!s:<10} {f(fin['probe']):>6} {f(fin['visual']):>7} {f(fin['realism']):>8}  {fin.get('reason') or ''}")


async def write_report(db: Any) -> Path | None:
    run_dir = latest_scored_run()
    if run_dir is None:
        print("no completed worldgen run with scores.json yet (run `foundry-worldgen loop`)")
        return None
    report = build_report(run_dir)
    print_table(report)
    ts = datetime.now(UTC).strftime("%Y%m%dT%H%MZ")
    out = write_json(paths.EVAL_RESULTS / f"world-{ts}.json", report)
    if db is not None:
        async with db.tx() as tx:
            for cond, data in (("baseline", report["iteration_0"]), ("loop", report["final"])):
                await tx.execute("INSERT INTO eval_results (id, suite, case_id, condition, metrics_json, created_at) VALUES (?,?,?,?,?,?)",
                                 (new_id("evr"), "world", report["run_id"], cond, json.dumps(data), utc_now()))
    print(f"wrote {out}")
    return out
