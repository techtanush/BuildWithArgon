# OWNER: ayan
"""Runs web/scripts/capture.ts (05-world/10 §2) and reads back the BuildingProbeReports it writes under
<root>/probes/<iter-label>/<dept>.json. Exit code != 0 means an infrastructure failure (browser/server)."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from . import paths


class CaptureError(Exception):
    """The capture script could not run (browser or dev server did not start, or it timed out)."""


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
                                                stderr=asyncio.subprocess.STDOUT)
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
    except TimeoutError as exc:
        proc.kill()
        raise CaptureError(f"capture timed out after {timeout_s}s") from exc
    log = out.decode(errors="replace")
    (root / "logs").mkdir(parents=True, exist_ok=True)
    (root / "logs" / f"capture-{iter_label(iteration)}.log").write_text(log)
    if proc.returncode != 0:
        raise CaptureError(log.strip().splitlines()[-1] if log.strip() else f"capture exited {proc.returncode}")
    reports: dict[str, dict[str, Any]] = {}
    for dept in depts:
        f = root / "probes" / iter_label(iteration) / f"{dept}.json"
        if f.exists():
            reports[dept] = json.loads(f.read_text())
    return reports


async def run_portraits(*, out_dir: Path, agents: list[str] | None = None, url: str | None = None, fake: bool = False,
                        timeout_s: int = 1800) -> dict[str, Any]:
    summary = out_dir / ".portraits-summary.json"
    args = [*_cmd(), "--portraits", "--out-portraits", str(out_dir), "--summary", str(summary)]
    if agents:
        args += ["--agents", ",".join(agents)]
    if url:
        args += ["--url", url]
    if fake:
        args.append("--fake")
    proc = await asyncio.create_subprocess_exec(*args, cwd=paths.WEB_DIR, stdout=asyncio.subprocess.PIPE,
                                                stderr=asyncio.subprocess.STDOUT)
    out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
    if proc.returncode != 0:
        raise CaptureError(out.decode(errors="replace").strip()[-500:])
    data = json.loads(summary.read_text()) if summary.exists() else {}
    summary.unlink(missing_ok=True)
    return data
