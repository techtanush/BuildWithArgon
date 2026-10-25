# OWNER: ayan
"""World Lab live round state machine + API (05-world/13 §2–3; G-07 shape) with a fake capture and FakeLLM."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from foundry_kernel.errors import ConflictError, DependencyError, NotFoundError
from foundry_kernel.llm.fake import FakeLLM
from foundry_kernel.worldgen import live, paths, score
from foundry_kernel.worldgen.validate import validate
from tests.ayan.conftest import FakeCapture, critic_json, file_block, module


@pytest.fixture
def fake_env(wg_paths: Path, monkeypatch: pytest.MonkeyPatch) -> FakeCapture:
    monkeypatch.setattr(paths, "STAGING_DIR", wg_paths / "live-staging")
    def fake_validate(mods: dict[str, str], **kw: Any) -> Any:
        res = validate(mods, typecheck=False)
        for v in res.values():
            v.tsc_ok = v.static_ok
        return res

    cap = FakeCapture(fail={"engineering": [["P6"], []]})
    monkeypatch.setattr(live, "run_capture", cap)
    async def fake_validate_async(mods: dict[str, str], **kw: Any) -> Any:
        return fake_validate(mods)
    async def reachable(url: str) -> bool:
        return url != "http://127.0.0.1:9"
    monkeypatch.setattr(live, "validate", fake_validate)
    monkeypatch.setattr(live, "validate_async", fake_validate_async)
    monkeypatch.setattr(live, "web_reachable", reachable)
    score.write_outputs("wgr_SEED", {d: None for d in paths.department_ids()})
    (paths.GENERATED_DIR / "engineering.ts").write_text(module("engineering"))
    return cap


async def test_round_completes_with_managed_agent_patch_then_promotes(fake_env: FakeCapture, settings: Any, db: Any) -> None:
    llm = FakeLLM()
    llm.script("worldgen_critic", [critic_json(realism=5, high=True), critic_json(realism=8)])
    llm.script("antigravity", [file_block("engineering", module("engineering", "/* architect */ ")) +
                               '\nWORLD_ARCHITECT_RESULT {"tsc_ok": true, "validator_ok": true, "iterations": 2, "summary": "ok"}'])
    lr = await live.start_round(settings=settings.model_copy(update={"llm_mode": "live"}), db=db, llm=llm, department_id="engineering", fake_capture=False, wait=True)
    assert lr.status == "done", lr.error
    assert [s.status for s in lr.steps] == ["done"] * 6 and lr.used_managed_agent is True
    assert lr.before.probe_score == 0.9 and lr.after and lr.after.probe_score == 1.0
    assert lr.before.realism == 0.5 and lr.after.realism == 0.8 and lr.issues
    assert set(lr.before.captures.screenshots) == set(paths.CAMERAS) and lr.before.captures.screenshots["ext-1"].startswith("/v1/world/worldgen/files/live/")
    assert [c["iteration"] for c in fake_env.calls] == ["before", "after"] and fake_env.calls[0]["source"] == "generated"
    row = await db.fetch_one("SELECT status, promoted FROM worldgen_live_rounds WHERE id = ?", (lr.id,))
    assert row["status"] == "done" and row["promoted"] == 0
    assert all(k.get("thinking_level") == "medium" for k in llm.call_kwargs if k["job"] == "worldgen_critic")  # fast round
    agent_call = next(k for k in llm.call_kwargs if k["job"] == "antigravity")
    assert agent_call["agent_config"] == {"type": "antigravity", "model": "gemini-4-argon"}

    promoted = await live.promote(db=db, round_id=lr.id)
    assert promoted.promoted and "/* architect */" in (paths.GENERATED_DIR / "engineering.ts").read_text()
    reg = json.loads((paths.GENERATED_DIR / "registry.json").read_text())
    assert reg["modules"]["engineering"]["iteration"] == f"live:{lr.id}"
    assert "import engineering from './engineering';" in (paths.GENERATED_DIR / "index.ts").read_text()
    steps = [json.loads(e["data_json"])["step"] for e in await db.fetch_all(
        "SELECT data_json FROM events WHERE type = 'worldgen.progress' AND venture_id IS NULL ORDER BY id")]
    assert steps[0] == "round" and "capture_before" in steps and steps[-1] == "promote"


async def test_round_falls_back_to_argon_patch_when_agent_output_is_unusable(fake_env: FakeCapture, settings: Any) -> None:
    llm = FakeLLM()
    llm.script("worldgen_critic", [critic_json(high=True), critic_json()])
    llm.script("antigravity", ["I could not finish."])
    llm.script("worldgen_patch", [file_block("engineering", module("engineering", "/* argon */ "))])
    lr = await live.start_round(settings=settings, db=None, llm=llm, department_id="engineering", fake_capture=True, wait=True)
    assert lr.status == "done" and lr.used_managed_agent is False
    assert "Argon patch" in next(s.note for s in lr.steps if s.name == "patch")


async def test_round_failure_is_reported_and_not_promotable(fake_env: FakeCapture, settings: Any) -> None:
    llm = FakeLLM()
    llm.script("worldgen_critic", [critic_json(high=True)])
    llm.script("antigravity", ["nothing"])
    llm.script("worldgen_patch", ["no block", "no block either"])
    lr = await live.start_round(settings=settings, db=None, llm=llm, department_id="engineering", fake_capture=True, wait=True)
    assert lr.status == "failed" and "patch" in (lr.error or "")
    assert [s.status for s in lr.steps] == ["done", "done", "failed", "skipped", "skipped", "skipped"]
    with pytest.raises(ConflictError):
        await live.promote(db=None, round_id=lr.id)


async def test_one_round_at_a_time_and_preconditions(fake_env: FakeCapture, settings: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    gate = asyncio.Event()
    orig = fake_env.__call__

    async def slow_capture(**kw: Any) -> Any:
        await gate.wait()
        return await orig(**kw)

    monkeypatch.setattr(live, "run_capture", slow_capture)
    llm = FakeLLM()
    first = await live.start_round(settings=settings, db=None, llm=llm, department_id="engineering", fake_capture=True)
    assert first.status == "queued"
    with pytest.raises(ConflictError):
        await live.start_round(settings=settings, db=None, llm=llm, department_id="engineering", fake_capture=True)
    gate.set()
    await live._ACTIVE  # type: ignore[misc]
    with pytest.raises(NotFoundError):
        await live.start_round(settings=settings, db=None, llm=llm, department_id="nope", fake_capture=True)
    with pytest.raises(ConflictError, match="no generated module"):
        await live.start_round(settings=settings, db=None, llm=llm, department_id="pivot", fake_capture=True)
    unreachable = settings.model_copy(update={"web_url": "http://127.0.0.1:9"})
    with pytest.raises(DependencyError) as e:
        await live.start_round(settings=unreachable, db=None, llm=llm, department_id="engineering")
    assert e.value.status_code == 503


def test_api_history_files_and_live_round_errors(fake_env: FakeCapture, client: Any) -> None:
    assert client.get("/v1/world/worldgen/latest").json() == {"data": None}
    run_dir = paths.RUNS_DIR / "wgr_01HZZZZZZZZZZZZZZZZZZZZZZZ"
    cap = run_dir / "captures" / "iter-0" / "engineering"
    cap.mkdir(parents=True)
    (cap / "ext-1.png").write_bytes(b"\x89PNG\r\n\x1a\nfake")
    (run_dir / "run.json").write_text(json.dumps({"run_id": run_dir.name, "created_at": "2026-10-26T01:00:00.000Z", "status": "succeeded"}))
    (run_dir / "critic" / "iter-0").mkdir(parents=True)
    (run_dir / "critic" / "iter-0" / "engineering.json").write_text(json.dumps({"issues": [{"severity": "high", "description": "x"}], "keep": ["k"]}))
    (run_dir / "scores.json").write_text(json.dumps({
        "run_id": run_dir.name, "final": {"world_score": 1.0, "visual_score": 0.8, "realism": 0.7, "generated": 1, "fallback": 12},
        "iterations": [{"n": 0, "world_score": 0.9, "visual_score": 0.6, "realism": 0.5,
                        "by_building": {"engineering": {"probe": 0.9, "visual": 0.6, "realism": 0.5, "failed": ["P6"]}}}],
        "registry": {"engineering": {"status": "generated", "iteration": 0}}}))
    latest = client.get("/v1/world/worldgen/latest").json()["data"]
    assert latest["run_id"] == run_dir.name and latest["final_world_score"] == 1.0 and latest["generated"] == 1
    assert client.get("/v1/world/worldgen/runs").json()["data"]["items"][0]["run_id"] == run_dir.name
    full = client.get(f"/v1/world/worldgen/runs/{run_dir.name}").json()["data"]
    eng = next(b for b in full["buildings"] if b["department_id"] == "engineering")
    assert eng["status"] == "generated" and eng["iterations"][0]["failed_probes"] == ["P6"] and eng["iterations"][0]["issues"]
    url = eng["iterations"][0]["captures"]["screenshots"]["ext-1"]
    r = client.get(url)
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    resp = client.get("/v1/world/worldgen/files/../../../.env")  # normalised by the client to /.env: never served
    assert resp.status_code == 404 and "GEMINI" not in resp.text
    for bad in ("/v1/world/worldgen/files/runs/%2e%2e/%2e%2e/x.png", "/v1/world/worldgen/files/runs/..%2F..%2Frun.json",
                "/v1/world/worldgen/files/runs/nope.png", f"/v1/world/worldgen/files/runs/{run_dir.name}/run.exe"):
        resp = client.get(bad)
        assert resp.status_code == 404 and resp.json()["error"]["code"] == "not_found", bad
    assert client.get("/v1/world/worldgen/runs/wgr_missing").status_code == 404
    r = client.post("/v1/world/worldgen/live-rounds", json={"department_id": "pivot"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    assert client.post("/v1/world/worldgen/live-rounds", json={"department_id": "nope"}).status_code == 404
    assert client.get("/v1/world/worldgen/live-rounds").json() == {"data": {"items": []}}
    assert client.get("/v1/world/worldgen/live-rounds/wlr_bad").status_code == 404
    assert client.post("/v1/world/worldgen/live-rounds/wlr_01HZZZZZZZZZZZZZZZZZZZZZZZ/promote").status_code == 404


async def test_orphaned_round_is_reported_failed(fake_env: FakeCapture) -> None:
    rid = "wlr_01HZZZZZZZZZZZZZZZZZZZZZZZ"
    d = paths.LIVE_DIR / rid
    d.mkdir(parents=True)
    (d / "round.json").write_text(json.dumps({"id": rid, "department_id": "engineering", "status": "capturing",
                                              "created_at": "2026-10-26T01:00:00.000Z",
                                              "steps": [{"name": "capture_before", "status": "running"}, {"name": "critique", "status": "pending"}]}))
    lr = live.load_round(rid)
    assert lr.status == "failed" and "restarted" in (lr.error or "") and [s.status for s in lr.steps] == ["failed", "skipped"]


async def test_round_deadline_persists_failure(fake_env: FakeCapture, settings: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    async def stuck_capture(**kw: Any) -> Any:
        await asyncio.Event().wait()
    monkeypatch.setattr(live, "run_capture", stuck_capture)
    monkeypatch.setattr(live, "TARGET_S", 0.02)
    lr = await live.start_round(settings=settings, db=None, llm=FakeLLM(), department_id="engineering", fake_capture=True, wait=True)
    assert lr.status == "failed" and "time budget" in lr.error
    assert lr.steps[0].status == "failed"
    assert not live.is_running()


async def test_round_cancellation_persists_failure(fake_env: FakeCapture, settings: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    started = asyncio.Event()
    async def stuck_capture(**kw: Any) -> Any:
        started.set()
        await asyncio.Event().wait()
    monkeypatch.setattr(live, "run_capture", stuck_capture)
    lr = await live.start_round(settings=settings, db=None, llm=FakeLLM(), department_id="engineering", fake_capture=True)
    await started.wait()
    live._ACTIVE.cancel()
    with pytest.raises(asyncio.CancelledError):
        await live._ACTIVE
    saved = live.load_round(lr.id)
    assert saved.status == "failed" and "cancelled" in saved.error


async def test_critical_probe_failure_cannot_be_promoted(fake_env: FakeCapture, settings: Any) -> None:
    fake_env.fail = {"engineering": [[], ["P2"]]}
    llm = FakeLLM()
    llm.script("worldgen_critic", [critic_json(high=True)])
    llm.script("antigravity", [file_block("engineering", module("engineering"))])
    lr = await live.start_round(settings=settings, db=None, llm=llm, department_id="engineering", fake_capture=True, wait=True)
    assert lr.status == "failed" and "critical probes: P2" in lr.error
    with pytest.raises(ConflictError):
        await live.promote(db=None, round_id=lr.id)


async def test_promote_revalidates_module(fake_env: FakeCapture, settings: Any) -> None:
    llm = FakeLLM()
    llm.script("worldgen_critic", [critic_json(high=True), critic_json()])
    llm.script("antigravity", [file_block("engineering", module("engineering"))])
    lr = await live.start_round(settings=settings.model_copy(update={"llm_mode": "live"}), db=None, llm=llm, department_id="engineering", fake_capture=False, wait=True)
    assert lr.status == "done", lr.error
    (live.round_dir(lr.id) / "module.after.ts").write_text("export default {}; window.fetch('bad');")
    with pytest.raises(ConflictError, match="changed since capture"):
        await live.promote(db=None, round_id=lr.id)


async def test_drill_round_cannot_publish(fake_env: FakeCapture, settings: Any) -> None:
    llm = FakeLLM()
    llm.script("worldgen_critic", [critic_json(high=True), critic_json()])
    llm.script("antigravity", [file_block("engineering", module("engineering"))])
    lr = await live.start_round(settings=settings, db=None, llm=llm, department_id="engineering", fake_capture=True, wait=True)
    assert lr.status == "done", lr.error
    with pytest.raises(ConflictError, match="drill captures"):
        await live.promote(db=None, round_id=lr.id)


async def test_valid_edit_cannot_inherit_old_capture_scores(fake_env: FakeCapture, settings: Any) -> None:
    llm = FakeLLM()
    llm.script("worldgen_critic", [critic_json(high=True), critic_json()])
    llm.script("antigravity", [file_block("engineering", module("engineering"))])
    lr = await live.start_round(settings=settings.model_copy(update={"llm_mode": "live"}), db=None, llm=llm, department_id="engineering", fake_capture=False, wait=True)
    assert lr.status == "done", lr.error
    (live.round_dir(lr.id) / "module.after.ts").write_text(module("engineering", "/* valid but unprobed */ "))
    with pytest.raises(ConflictError, match="changed since capture"):
        await live.promote(db=None, round_id=lr.id)
