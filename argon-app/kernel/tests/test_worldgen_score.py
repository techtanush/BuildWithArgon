# OWNER: ayan
"""Score selection (10 §6) and the generated outputs (09 §Registry): generated/<dept>.ts, index.ts, registry.json."""
from __future__ import annotations

import json
from pathlib import Path

from foundry_kernel.worldgen import paths
from foundry_kernel.worldgen.score import Version, better, invalid_report, promote_module, write_outputs
from tests.ayan.conftest import module, wg_paths  # noqa: F401 — fixture


def rep(failing: list[str]) -> dict:
    probes = [{"id": p, "pass": p not in failing, "details": ""} for p in paths.PROBES]
    return {"probes": probes, "probe_score": sum(p["pass"] for p in probes) / 10,
            "critical_pass": all(p["pass"] for p in probes if p["id"] in paths.CRITICAL_PROBES)}


def test_selection_is_lexicographic_critical_probe_visual_realism() -> None:
    critical_fail = Version("pivot", 0, "a", rep(["P5"]), {"visual_score": 0.95, "realism": 0.9})
    probe_fail = Version("pivot", 1, "b", rep(["P7", "P10"]), {"visual_score": 0.5, "realism": 0.5})
    clean_low = Version("pivot", 2, "c", rep([]), {"visual_score": 0.6, "realism": 0.6})
    clean_high = Version("pivot", 3, "d", rep([]), {"visual_score": 0.8, "realism": 0.5})
    assert better(probe_fail, critical_fail) and better(clean_low, probe_fail) and better(clean_high, clean_low)
    assert not better(clean_low, clean_high)
    assert clean_high.good() is False  # realism < 0.7
    assert Version("pivot", 4, "e", rep([]), {"visual_score": 0.8, "realism": 0.7}).good()


def test_invalid_report_fails_everything() -> None:
    r = invalid_report("sales", "staging", ["forbidden token `fetch(`"], "line 1 TS2322")
    assert r["probe_score"] == 0.0 and not r["critical_pass"] and "fetch(" in r["probes"][0]["details"]


def test_write_outputs_index_registry_and_fallbacks(wg_paths: Path) -> None:
    stale = paths.GENERATED_DIR / "support.ts"
    stale.write_text("old")
    best = {d: None for d in paths.department_ids()}
    best["engineering"] = Version("engineering", 2, module("engineering"), rep([]), {"visual_score": 0.8, "realism": 0.75})
    best["market-research"] = Version("market-research", 1, module("market-research"), rep(["P6"]), {"visual_score": 0.7, "realism": 0.7})
    best["support"] = Version("support", 3, module("support"), rep(["P5"]), None)
    reg = write_outputs("wgr_TEST", best, reason_suffix=" after 4 iteration(s)")
    m = reg["modules"]
    assert m["engineering"] == {"status": "generated", "iteration": 2, "probe_score": 1.0, "visual_score": 0.8, "realism": 0.75}
    assert m["market-research"]["status"] == "generated"  # P6 is not critical
    assert m["support"]["status"] == "fallback" and "P5" in m["support"]["reason"] and not stale.exists()
    assert m["pivot"] == {"status": "fallback", "reason": "no module was generated"}
    index = (paths.GENERATED_DIR / "index.ts").read_text()
    assert "import engineering from './engineering';" in index and "import marketResearch from './market-research';" in index
    assert "export const generatedModules: Partial<Record<string, BuildingModule>> = { 'market-research': marketResearch, engineering };" in index  # roster order
    assert json.loads((paths.GENERATED_DIR / "registry.json").read_text())["run_id"] == "wgr_TEST"


def test_empty_index_keeps_seed_shape(wg_paths: Path) -> None:
    write_outputs("wgr_EMPTY", {d: None for d in paths.department_ids()})
    assert "= {};" in (paths.GENERATED_DIR / "index.ts").read_text()


def test_promote_updates_one_building(wg_paths: Path) -> None:
    write_outputs("wgr_X", {d: None for d in paths.department_ids()})
    promote_module("growth", module("growth"), {"iteration": "live:wlr_1", "probe_score": 1.0})
    reg = json.loads((paths.GENERATED_DIR / "registry.json").read_text())
    assert reg["modules"]["growth"]["status"] == "generated" and reg["modules"]["pivot"]["status"] == "fallback"
    assert "import growth from './growth';" in (paths.GENERATED_DIR / "index.ts").read_text()
