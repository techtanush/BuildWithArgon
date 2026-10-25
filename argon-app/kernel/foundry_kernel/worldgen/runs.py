# OWNER: ayan
"""Run records for worldgen (05-world/09 §CLI, 10 §7): files under kernel/data/worldgen/runs/<run_id>/,
rows in worldgen_runs / worldgen_iterations, and `worldgen.progress` events (global: venture_id NULL).
Also the readers the World Lab API uses to turn a run directory into contracts.WorldgenRun."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .. import bus
from ..config import Settings
from ..contracts import (
    CaptureSet,
    WorldgenBuildingHistory,
    WorldgenIterationScore,
    WorldgenIterationView,
    WorldgenRun,
    WorldgenRunSummary,
)
from ..db import Database
from ..ids import utc_now
from . import paths

FILES_URL = "/v1/world/worldgen/files/"


def rel(path: Path) -> str:
    """Path relative to kernel/data/worldgen/ (what the files endpoint serves)."""
    return path.resolve().relative_to(paths.WORLDGEN_DATA.resolve()).as_posix()


def file_url(path: Path | str) -> str:
    return FILES_URL + (path if isinstance(path, str) else rel(path))


def write_json(path: Path, data: Any) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, default=str) + "\n")
    return path


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


class Recorder:
    """DB + SSE side of a worldgen run or live round. Every method is best-effort when db is None (tests, dry runs)."""

    def __init__(self, db: Database | None) -> None:
        self.db = db

    async def progress(self, *, step: str, status: str, department_id: str | None = None, run_id: str | None = None,
                       round_id: str | None = None, iteration: int | None = None, score: float | None = None,
                       note: str = "") -> None:
        data: dict[str, Any] = {"department_id": department_id, "step": step, "status": status}
        for k, v in (("run_id", run_id), ("round_id", round_id), ("iteration", iteration), ("score", score), ("note", note)):
            if v not in (None, ""):
                data[k] = v
        print(f"[worldgen] {run_id or round_id or ''} {department_id or '*'} {step}: {status}"
              + (f" score={score:.3f}" if isinstance(score, float) else "") + (f" — {note}" if note else ""), flush=True)
        if not self.db:
            return
        async with self.db.tx() as tx:
            await bus.emit(tx, venture_id=None, type="worldgen.progress", entity_kind="worldgen",
                           entity_id=run_id or round_id, data=data, level="error" if status == "failed" else "info")

    async def start_run(self, run_id: str, data_path: Path) -> None:
        if not self.db:
            return
        async with self.db.tx() as tx:
            await tx.execute("INSERT INTO worldgen_runs (id, status, iterations, data_path, started_at) VALUES (?,?,?,?,?) "
                             "ON CONFLICT(id) DO UPDATE SET status='running'",
                             (run_id, "running", 0, str(data_path), utc_now()))

    async def finish_run(self, run_id: str, *, status: str, iterations: int, final_score: float | None) -> None:
        if not self.db:
            return
        async with self.db.tx() as tx:
            await tx.execute("UPDATE worldgen_runs SET status=?, iterations=?, final_score=?, finished_at=? WHERE id=?",
                             (status, iterations, final_score, utc_now(), run_id))

    async def iteration(self, run_id: str, n: int, dept: str, probe: dict[str, Any], critic: dict[str, Any], score: float) -> None:
        if not self.db:
            return
        async with self.db.tx() as tx:
            await tx.execute("DELETE FROM worldgen_iterations WHERE run_id=? AND iteration=? AND building_id=?", (run_id, n, dept))
            await tx.execute("INSERT INTO worldgen_iterations (run_id, iteration, building_id, probe_json, critic_json, score, created_at) "
                             "VALUES (?,?,?,?,?,?,?)", (run_id, n, dept, json.dumps(probe, default=str),
                                                        json.dumps(critic, default=str), score, utc_now()))


async def open_db(settings: Settings) -> Database | None:
    """The kernel DB for CLI runs (WAL allows the kernel to run at the same time). None if it cannot open."""
    try:
        db = Database(settings.db_path)
        await db.connect()
        return db
    except Exception as exc:  # noqa: BLE001 — the CLI still writes its files without a DB
        print(f"[worldgen] warning: database unavailable ({exc}); writing files only", flush=True)
        return None


# ------------------------------------------------------------------ readers (World Lab API)


def run_dirs() -> list[Path]:
    if not paths.RUNS_DIR.exists():
        return []
    dirs = [d for d in paths.RUNS_DIR.iterdir() if d.is_dir() and d.name.startswith("wgr_")]
    return sorted(dirs, key=lambda d: d.name, reverse=True)  # ULIDs sort by time


def capture_set(captures_dir: Path) -> CaptureSet:
    shots: dict[str, str] = {}
    videos: dict[str, str] = {}
    if captures_dir.exists():
        for cam in paths.CAMERAS:
            p = captures_dir / f"{cam}.png"
            if p.exists():
                shots[cam] = file_url(p)
        for v in ("ext", "int"):
            p = captures_dir / f"{v}.webm"
            if p.exists():
                videos[v] = file_url(p)
    return CaptureSet(screenshots=shots, videos=videos)


def summary(run_dir: Path) -> WorldgenRunSummary:
    meta = read_json(run_dir / "run.json", {}) or {}
    scores = read_json(run_dir / "scores.json", {}) or {}
    iters = [WorldgenIterationScore(n=i["n"], world_score=i.get("world_score", 0.0), visual_score=i.get("visual_score"),
                                    realism=i.get("realism")) for i in scores.get("iterations", [])]
    final = scores.get("final", {})
    return WorldgenRunSummary(run_id=run_dir.name, created_at=meta.get("created_at", ""), status=meta.get("status", "unknown"),
                              iterations=iters, final_world_score=final.get("world_score"),
                              final_visual_score=final.get("visual_score"), final_realism=final.get("realism"),
                              generated=int(final.get("generated", 0)), fallback=int(final.get("fallback", 0)))


def full_run(run_dir: Path) -> WorldgenRun:
    base = summary(run_dir)
    scores = read_json(run_dir / "scores.json", {}) or {}
    registry = scores.get("registry", {})
    buildings: list[WorldgenBuildingHistory] = []
    for dept in paths.department_ids():
        views: list[WorldgenIterationView] = []
        for it in scores.get("iterations", []):
            b = it.get("by_building", {}).get(dept)
            if b is None:
                continue
            n = it["n"]
            critic = read_json(run_dir / "critic" / f"iter-{n}" / f"{dept}.json", {}) or {}
            cap_iter = b.get("captured_iteration", n)
            views.append(WorldgenIterationView(n=n, probe_score=b.get("probe", 0.0), visual_score=b.get("visual"),
                                               realism=b.get("realism"), failed_probes=b.get("failed", []),
                                               issues=critic.get("issues", []), keep=critic.get("keep", []),
                                               captures=capture_set(run_dir / "captures" / f"iter-{cap_iter}" / dept)))
        reg = registry.get(dept, {})
        if views or reg:
            buildings.append(WorldgenBuildingHistory(department_id=dept,
                                                     status="generated" if reg.get("status") == "generated" else "fallback",
                                                     best_iteration=reg.get("iteration"), iterations=views))
    return WorldgenRun(**base.model_dump(), buildings=buildings)
