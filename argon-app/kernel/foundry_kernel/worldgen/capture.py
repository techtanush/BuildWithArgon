# OWNER: ayan
"""Runs web/scripts/capture.ts (05-world/10 §2) and reads back the BuildingProbeReports it writes under
<root>/probes/<iter-label>/<dept>.json. Exit code != 0 means an infrastructure failure (browser/server)."""
from __future__ import annotations

import asyncio
import json
import os
import signal
from pathlib import Path
from typing import Any

from . import paths


class CaptureError(Exception):
    """The capture script could not run (browser or dev server did not start, or it timed out)."""



async def _terminate_process(proc: asyncio.subprocess.Process) -> None:
    """Kill the isolated process group, including browser/Vite descendants, then reap it."""
    try:
        if os.name == "posix" and isinstance(proc.pid, int):
            os.killpg(proc.pid, signal.SIGKILL)
        else:
            proc.kill()
    except ProcessLookupError:
        pass
    await proc.communicate()


def iter_label(it: int | str) -> str:
    return f"iter-{it}" if isinstance(it, int) or str(it).isdigit() else str(it)


def _cmd() -> list[str]:
    tsx = paths.WEB_DIR / "node_modules" / ".bin" / "tsx"
    if not tsx.exists():
        raise CaptureError("tsx not installed — run `pnpm install` in argon-app/web")
    return [str(tsx), "scripts/capture.ts"]


async def run_capture(*, root: Path, iteration: int | str, depts: list[str], source: str = "staging", url: str | None = None,
                      fake: bool = False, fast: bool = False, fail: list[str] | None = None, video: bool = True,
                      gpu: bool = False, timeout_s: int = 1800) -> dict[str, dict[str, Any]]:
    root = root.resolve()
    for dept in depts:
        (root / "probes" / iter_label(iteration) / f"{dept}.json").unlink(missing_ok=True)
    args = [*_cmd(), "--out", str(root), "--iter", str(iteration), "--source", source, "--only", ",".join(depts)]
    if url:
        args += ["--url", url]
    if fake:
        args.append("--fake")
    if fast:
        args.append("--fast")
    if fail:
        args += ["--fail", ",".join(fail)]
    if not video:
        args.append("--no-video")
    if gpu:
        args.append("--gpu")
    proc = await asyncio.create_subprocess_exec(*args, cwd=paths.WEB_DIR, stdout=asyncio.subprocess.PIPE,
                                                stderr=asyncio.subprocess.STDOUT, start_new_session=True)
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
    except TimeoutError as exc:
        await _terminate_process(proc)
        raise CaptureError(f"capture timed out after {timeout_s}s") from exc
    except asyncio.CancelledError:
        await asyncio.shield(_terminate_process(proc))
        raise
    log = out.decode(errors="replace")
    (root / "logs").mkdir(parents=True, exist_ok=True)
    (root / "logs" / f"capture-{iter_label(iteration)}.log").write_text(log)
    if proc.returncode != 0:
        raise CaptureError(log.strip().splitlines()[-1] if log.strip() else f"capture exited {proc.returncode}")
    reports: dict[str, dict[str, Any]] = {}
    for dept in depts:
        f = root / "probes" / iter_label(iteration) / f"{dept}.json"
        if not f.exists():
            raise CaptureError(f"capture produced no report for {dept}")
        reports[dept] = json.loads(f.read_text())
        if reports[dept].get("building") != dept:
            raise CaptureError(f"capture report building mismatch for {dept}")
    return reports


async def run_portraits(*, out_dir: Path, agents: list[str] | None = None, url: str | None = None, fake: bool = False,
                        timeout_s: int = 1800) -> dict[str, Any]:
    out_dir = out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    summary = out_dir / ".portraits-summary.json"
    summary.unlink(missing_ok=True)
    args = [*_cmd(), "--portraits", "--out-portraits", str(out_dir), "--summary", str(summary)]
    if agents:
        args += ["--agents", ",".join(agents)]
    if url:
        args += ["--url", url]
    if fake:
        args.append("--fake")
    proc = await asyncio.create_subprocess_exec(*args, cwd=paths.WEB_DIR, stdout=asyncio.subprocess.PIPE,
                                                stderr=asyncio.subprocess.STDOUT, start_new_session=True)
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
    except TimeoutError as exc:
        await _terminate_process(proc)
        raise CaptureError(f"portrait capture timed out after {timeout_s}s") from exc
    except asyncio.CancelledError:
        await asyncio.shield(_terminate_process(proc))
        raise
    if proc.returncode != 0:
        raise CaptureError(out.decode(errors="replace").strip()[-500:])
    if not summary.exists():
        raise CaptureError("portrait capture produced no summary")
    data = json.loads(summary.read_text())
    summary.unlink(missing_ok=True)
    return data
