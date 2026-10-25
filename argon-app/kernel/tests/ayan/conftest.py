# OWNER: ayan
"""Fixtures for ayan's tests: worldgen paths redirected into tmp (staging stays the real, gitignored web dir so tsc
can run), and a fake capture that writes probe reports without a browser."""
from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from PIL import Image

from foundry_kernel.worldgen import live, paths


@pytest.fixture
def wg_paths(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    data = tmp_path / "worldgen"
    gen = tmp_path / "generated"
    gen.mkdir(parents=True)
    for name, value in {"WORLDGEN_DATA": data, "RUNS_DIR": data / "runs", "LIVE_DIR": data / "live", "ASSETS_DIR": data / "assets",
                        "GENERATED_DIR": gen, "PUBLIC_GENERATED": tmp_path / "public-generated",
                        "FACES_JSON": tmp_path / "faces.json", "EVAL_RESULTS": tmp_path / "evals"}.items():
        monkeypatch.setattr(paths, name, value)
    monkeypatch.setattr(live, "_ACTIVE", None)
    yield tmp_path


def png(path: Path, color: tuple[int, int, int] = (90, 120, 160)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (64, 36), color)
    for x in range(0, 64, 8):
        for y in range(36):
            img.putpixel((x, y), (240, 230, 200))
    img.save(path)


class FakeCapture:
    """Stands in for worldgen.capture.run_capture: writes screenshots + a BuildingProbeReport per building.
    `fail` maps department id -> list of probe ids that fail (consumed per call, last value repeats)."""

    def __init__(self, fail: dict[str, list[list[str]]] | None = None, infra_error: str | None = None) -> None:
        self.fail = fail or {}
        self.calls: list[dict[str, Any]] = []
        self.infra_error = infra_error

    async def __call__(self, *, root: Path, iteration: Any, depts: list[str], source: str = "staging", **kw: Any) -> dict[str, Any]:
        from foundry_kernel.worldgen.capture import CaptureError, iter_label

        self.calls.append({"iteration": iteration, "depts": list(depts), "source": source})
        if self.infra_error:
            raise CaptureError(self.infra_error)
        out = {}
        for d in depts:
            seq = self.fail.get(d, [[]])
            failing = seq.pop(0) if len(seq) > 1 else seq[0]
            cap = root / "captures" / iter_label(iteration) / d
            shots = {}
            for cam in paths.CAMERAS:
                png(cap / f"{cam}.png")
                shots[cam] = (cap / f"{cam}.png").relative_to(root).as_posix()
            probes = [{"id": p, "pass": p not in failing, "details": f"fake {p} failure" if p in failing else ""} for p in paths.PROBES]
            report = {"building": d, "source": source, "probes": probes,
                      "probe_score": sum(p["pass"] for p in probes) / 10,
                      "critical_pass": all(p["pass"] for p in probes if p["id"] in paths.CRITICAL_PROBES),
                      "screenshots": shots, "videos": {}, "frames": [], "stats": {}, "consoleErrors": []}
            f = root / "probes" / iter_label(iteration) / f"{d}.json"
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps(report))
            out[d] = report
        return out


def module(dept: str, extra: str = "") -> str:
    """A valid module: the frozen house example with this department's id."""
    src = paths.EXAMPLE_MODULE.read_text()
    src = src[src.index("import type"):].replace("id: 'example-house'", f"id: '{dept}'")
    return src.replace("k.light({ kind: 'point', pos: [0, 4.2, 7]", f"{extra}k.light({{ kind: 'point', pos: [0, 4.2, 7]")


def file_block(dept: str, src: str) -> str:
    return f'<<<FILE path="web/src/world/buildings/generated/{dept}.ts">>>\n{src.rstrip()}\n<<<END FILE>>>'


def critic_json(realism: int = 8, high: bool = False, score: int = 8) -> dict[str, Any]:
    issues = [{"severity": "high" if high else "low", "where": "exterior", "camera": "ext-1", "description": "d", "fix": "f"}]
    return {"scores": {"realism": realism, "department_identity": score, "composition": score, "readability": score, "craft": score},
            "issues": issues, "keep": ["sign"]}
