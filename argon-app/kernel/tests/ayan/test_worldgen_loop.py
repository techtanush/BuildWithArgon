# OWNER: ayan
"""The render → critique → patch loop end to end in fake LLM mode with a fake capture (G-02 shape), plus
`buildings` (G-01) with the FakeLLM one-pass fixture."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from foundry_kernel.llm.fake import FakeLLM
from foundry_kernel.worldgen import loop, paths
from foundry_kernel.worldgen.capture import CaptureError
from foundry_kernel.worldgen.validate import validate
from tests.ayan.conftest import FakeCapture, critic_json, file_block, module


def no_tsc(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_validate(mods: dict[str, str], **kw: Any) -> Any:
        res = validate(mods, typecheck=False, suffix=".pytest")
        for v in res.values():
            v.tsc_ok = v.static_ok
        for d in mods:
            (paths.STAGING_DIR / f"{d}.pytest.ts").unlink(missing_ok=True)
        return res

    monkeypatch.setattr(loop, "validate", fake_validate)


def seed_run(depts: list[str]) -> Path:
    _, run_dir = loop.new_run()
    (run_dir / "modules" / "iter-0").mkdir(parents=True)
    for d in depts:
        (run_dir / "modules" / "iter-0" / f"{d}.ts").write_text(module(d))
    return run_dir


async def test_loop_patches_failing_building_and_stops_when_good(wg_paths: Path, monkeypatch: pytest.MonkeyPatch, settings: Any, db: Any) -> None:
    # Exercise the real publication branch with controlled test doubles.
    settings = settings.model_copy(update={"llm_mode": "live"})
    no_tsc(monkeypatch)
    cap = FakeCapture(fail={"pivot": [["P5"], []]})
    monkeypatch.setattr(loop, "run_capture", cap)
    run_dir = seed_run(["engineering", "pivot"])
    llm = FakeLLM()
    llm.script("worldgen_critic", [critic_json(), critic_json(realism=5, high=True), critic_json()])
    llm.script("worldgen_patch", [file_block("pivot", module("pivot", "/* patched */ "))])
    scores = await loop.run_loop(settings, llm, db, loop.LoopOptions(max_iter=4, only=["engineering", "pivot"]), run_dir=run_dir)

    assert [c["depts"] for c in cap.calls] == [["engineering", "pivot"], ["pivot"]]  # unchanged buildings are not re-rendered
    its = scores["iterations"]
    assert len(its) == 2 and its[0]["by_building"]["pivot"]["failed"] == ["P5"]
    assert its[1]["by_building"]["pivot"]["probe"] == 1.0 and its[1]["by_building"]["engineering"]["captured_iteration"] == 0
    assert scores["final"]["generated"] == 2 and "every building" in scores["stop_reason"]
    assert "/* patched */" in (paths.GENERATED_DIR / "pivot.ts").read_text()
    assert scores["registry"]["pivot"]["iteration"] == 1 and scores["registry"]["engineering"]["iteration"] == 0
    assert (run_dir / "modules" / "iter-1" / "pivot.ts").exists() and (run_dir / "critic" / "iter-0" / "pivot.json").exists()
    assert json.loads((run_dir / "run.json").read_text())["status"] == "succeeded"
    rows = await db.fetch_all("SELECT iteration, building_id, score FROM worldgen_iterations WHERE run_id = ? ORDER BY iteration, building_id",
                              (run_dir.name,))
    assert [(r["iteration"], r["building_id"]) for r in rows] == [(0, "engineering"), (0, "pivot"), (1, "engineering"), (1, "pivot")]
    events = await db.fetch_all("SELECT data_json FROM events WHERE type = 'worldgen.progress' AND venture_id IS NULL")
    assert any(json.loads(e["data_json"])["step"] == "critique" for e in events)


async def test_loop_keeps_best_and_falls_back_when_critical_never_passes(wg_paths: Path, monkeypatch: pytest.MonkeyPatch, settings: Any) -> None:
    settings = settings.model_copy(update={"llm_mode": "live"})
    no_tsc(monkeypatch)
    monkeypatch.setattr(loop, "run_capture", FakeCapture(fail={"support": [["P4"]]}))
    run_dir = seed_run(["support"])
    llm = FakeLLM()
    llm.script("worldgen_critic", [critic_json(high=True)] * 3)
    llm.script("worldgen_patch", [file_block("support", module("support", f"/* v{i} */ ")) for i in range(3)])
    scores = await loop.run_loop(settings, llm, None, loop.LoopOptions(max_iter=2, only=["support"]), run_dir=run_dir)
    assert len(scores["iterations"]) == 2  # iteration 1 improved nothing -> stop
    assert scores["registry"]["support"]["status"] == "fallback" and "P4" in scores["registry"]["support"]["reason"]
    assert not (paths.GENERATED_DIR / "support.ts").exists()


async def test_invalid_module_is_scored_zero_and_patched(wg_paths: Path, monkeypatch: pytest.MonkeyPatch, settings: Any) -> None:
    no_tsc(monkeypatch)
    cap = FakeCapture()
    monkeypatch.setattr(loop, "run_capture", cap)
    run_dir = seed_run([])
    (run_dir / "modules" / "iter-0" / "growth.ts").write_text(module("growth").replace("k.entrance(", "fetch('x'); k.entrance("))
    llm = FakeLLM()
    llm.script("worldgen_patch", [file_block("growth", module("growth"))])
    llm.script("worldgen_critic", [critic_json()])
    scores = await loop.run_loop(settings, llm, None, loop.LoopOptions(max_iter=3, only=["growth"]), run_dir=run_dir)
    assert scores["iterations"][0]["by_building"]["growth"]["probe"] == 0.0 and cap.calls[0]["depts"] == ["growth"]
    assert scores["iterations"][1]["by_building"]["growth"]["probe"] == 1.0
    probe0 = json.loads((run_dir / "probes" / "iter-0" / "growth.json").read_text())
    assert probe0["invalid"] and "fetch(" in probe0["probes"][0]["details"]


async def test_capture_infrastructure_failure_fails_the_run(wg_paths: Path, monkeypatch: pytest.MonkeyPatch, settings: Any) -> None:
    no_tsc(monkeypatch)
    monkeypatch.setattr(loop, "run_capture", FakeCapture(infra_error="browser did not start"))
    run_dir = seed_run(["intake"])
    with pytest.raises(CaptureError):
        await loop.run_loop(settings, FakeLLM(), None, loop.LoopOptions(only=["intake"]), run_dir=run_dir)
    assert json.loads((run_dir / "run.json").read_text())["status"] == "failed"


async def test_buildings_one_pass_with_fake_fixture(wg_paths: Path, monkeypatch: pytest.MonkeyPatch, settings: Any, db: Any) -> None:
    no_tsc(monkeypatch)
    run_id = await loop.buildings(settings, FakeLLM(), db)
    run_dir = paths.RUNS_DIR / run_id
    gen = json.loads((run_dir / "generation.json").read_text())
    assert len(gen["one_pass"]) == 13 and gen["missing"] == [] and gen["regenerated"] == {}
    assert len(list((run_dir / "modules" / "iter-0").glob("*.ts"))) == 13
    assert (run_dir / "prompt.md").read_text().count("### KIT API") == 1 and (run_dir / "output.txt").exists()
    meta = json.loads((run_dir / "run.json").read_text())
    assert meta["status"] == "generated" and len(meta["valid"]) == 13
    row = await db.fetch_one("SELECT status FROM worldgen_runs WHERE id = ?", (run_id,))
    assert row["status"] == "succeeded"


async def test_buildings_regenerates_missing_one(wg_paths: Path, monkeypatch: pytest.MonkeyPatch, settings: Any) -> None:
    no_tsc(monkeypatch)
    # Reference assets are optional local files; isolate this regeneration test from briefing calls.
    from foundry_kernel.worldgen import generate
    monkeypatch.setattr(generate, "_refs", lambda: [])
    depts = paths.department_ids()
    one_pass = "\n".join(file_block(d, module(d)) for d in depts[:-1]) + f'\n<<<FILE path="{paths.module_path(depts[-1])}">>>\nimport type'
    llm = FakeLLM()
    llm.script("worldgen_buildings", [one_pass])
    llm.script("worldgen_building", [file_block(depts[-1], module(depts[-1]))])
    run_id = await loop.buildings(settings, llm, None)
    gen = json.loads((paths.RUNS_DIR / run_id / "generation.json").read_text())
    assert gen["truncated"] == [depts[-1]] and gen["regenerated"][depts[-1]]["ok"] and gen["missing"] == []


@pytest.mark.parametrize("fake_capture,llm_mode", [(True, "live"), (False, "fake")])
async def test_drill_never_changes_production_outputs(wg_paths: Path, monkeypatch: pytest.MonkeyPatch,
                                                      settings: Any, fake_capture: bool, llm_mode: str) -> None:
    no_tsc(monkeypatch)
    monkeypatch.setattr(loop, "run_capture", FakeCapture())
    settings = settings.model_copy(update={"llm_mode": llm_mode})
    paths.GENERATED_DIR.mkdir(exist_ok=True)
    original = {"engineering.ts": "// production module", "index.ts": "// production registry", "registry.json": "{}"}
    for filename, text in original.items():
        (paths.GENERATED_DIR / filename).write_text(text)
    run_dir = seed_run(["engineering"])
    llm = FakeLLM()
    llm.script("worldgen_critic", [critic_json()])
    scores = await loop.run_loop(settings, llm, None,
                                 loop.LoopOptions(max_iter=0, only=["engineering"], fake_capture=fake_capture), run_dir=run_dir)
    assert scores["provenance"]["drill"] is True and scores["published"] is False
    assert json.loads((run_dir / "run.json").read_text())["published"] is False
    assert {p.name: p.read_text() for p in paths.GENERATED_DIR.iterdir()} == original
    assert (run_dir / "scores.json").exists()  # drill evidence is still retained
