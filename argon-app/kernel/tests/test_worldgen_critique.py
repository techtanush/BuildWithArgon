# OWNER: ayan
"""Critic parsing, probe failures forced into high issues, video parts vs the 8-frame fallback (G-06), patch + repair."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from foundry_kernel.contracts import LLMResult
from foundry_kernel.llm.client import LLMCallError
from foundry_kernel.llm.fake import FakeLLM
from foundry_kernel.worldgen import paths
from foundry_kernel.worldgen.critique import (
    critique,
    media_parts,
    needs_patch,
    patch,
    visual_score,
)
from tests.ayan.conftest import critic_json, file_block, module, png


def report(root: Path, failing: list[str], video: bool = True) -> dict[str, Any]:
    shots = {}
    for cam in paths.CAMERAS:
        png(root / "cap" / f"{cam}.png")
        shots[cam] = f"cap/{cam}.png"
    frames = []
    for i in range(8):
        png(root / "cap" / "frames" / f"ext-{i}.png")
        frames.append(f"cap/frames/ext-{i}.png")
    videos = {}
    if video:
        (root / "cap" / "ext.webm").write_bytes(b"\x1aE\xdf\xa3fakewebm")
        videos = {"ext": "cap/ext.webm"}
    probes = [{"id": p, "pass": p not in failing, "details": f"{p} broke" if p in failing else ""} for p in paths.PROBES]
    return {"probes": probes, "probe_score": 0.9, "screenshots": shots, "videos": videos, "frames": frames,
            "video_lead_in_s": {"ext": 2.5}}


def test_media_parts_video_and_fallback(tmp_path: Path) -> None:
    parts, rec = media_parts(report(tmp_path, []), tmp_path, use_video=True)
    kinds = [p.kind for p in parts]
    assert kinds.count("image") == 6 and kinds.count("video") == 1 and rec["video_input"] is True
    assert any("page loading" in (p.text or "") for p in parts)
    parts, rec = media_parts(report(tmp_path, []), tmp_path, use_video=False)
    assert [p.kind for p in parts].count("image") == 14 and rec["video_input"] is False and len(rec["frames"]) == 8


async def test_critique_scores_and_probe_issues(tmp_path: Path) -> None:
    llm = FakeLLM()
    llm.script("worldgen_critic", [critic_json(realism=6, score=8)])
    out = await critique(llm, paths.department("pivot"), report=report(tmp_path, ["P5"]), root=tmp_path, source=module("pivot"),
                         out_file=tmp_path / "critic.json")
    assert out["visual_score"] == visual_score(out["scores"]) == round((6 + 8 * 4) / 50, 4) and out["realism"] == 0.6
    assert any(i["severity"] == "high" and "P5" in i["description"] for i in out["issues"])  # forced in
    assert out["inputs"]["video_input"] is True and (tmp_path / "critic.json").exists()
    assert llm.call_kwargs[0]["parts"].count("video") == 1


class VideoRejectingLLM(FakeLLM):
    async def generate(self, job: str, prompt: Any, **kw: Any) -> LLMResult:
        if not isinstance(prompt, str) and any(p.kind == "video" for p in prompt):
            raise LLMCallError("video input not supported", 400)
        return await super().generate(job, prompt, **kw)


async def test_critique_falls_back_to_frames_on_400(tmp_path: Path) -> None:
    llm = VideoRejectingLLM()
    llm.script("worldgen_critic", [critic_json()])
    out = await critique(llm, paths.department("pivot"), report=report(tmp_path, []), root=tmp_path, source=module("pivot"))
    assert out["inputs"]["video_input"] is False and len(out["inputs"]["frames"]) == 8 and "video_error" in out["inputs"]


async def test_patch_uses_critic_interaction_and_repairs_once(tmp_path: Path) -> None:
    llm = FakeLLM()
    bad = module("pivot").replace("k.entrance(", "window.alert(1); k.entrance(")
    llm.script("worldgen_patch", [file_block("pivot", bad), file_block("pivot", module("pivot", "/* fixed */ "))])
    critic = {**critic_json(high=True), "interaction_id": "int_critic"}
    out = await patch(llm, paths.department("pivot"), source=module("pivot"), critic=critic, report=report(tmp_path, ["P5"]),
                      out_file=tmp_path / "patch.json")
    assert out["repaired"] is True and out["source"] and "/* fixed */" in out["source"] and out["static_errors"] == []
    assert llm.call_kwargs[0]["previous_interaction_id"] == "int_critic"
    assert llm.call_kwargs[1]["previous_interaction_id"] == "fake-1"


async def test_patch_gives_up_after_one_repair(tmp_path: Path) -> None:
    llm = FakeLLM()
    llm.script("worldgen_patch", ["no file here", "still nothing"])
    out = await patch(llm, paths.department("pivot"), source=module("pivot"), critic=critic_json(high=True), report=report(tmp_path, []))
    assert out["source"] is None and out["static_errors"]


def test_needs_patch() -> None:
    ok = {"probes": [{"id": "P1", "pass": True}]}
    assert not needs_patch(ok, critic_json(high=False))
    assert needs_patch(ok, critic_json(high=True))
    assert needs_patch({"probes": [{"id": "P5", "pass": False}]}, None)


def test_low_realism_needs_patch_without_high_issue() -> None:
    from foundry_kernel.worldgen.critique import needs_patch
    report = {'probes': [{'id': 'P1', 'pass': True}]}
    assert needs_patch(report, {'realism': 0.6, 'visual_score': 0.9, 'issues': []})
    assert needs_patch(report, {'realism': 0.9, 'visual_score': 0.7, 'issues': []})
    assert not needs_patch(report, {'realism': 0.8, 'visual_score': 0.8, 'issues': []})


def test_p10_issue_does_not_cover_failed_p1() -> None:
    from foundry_kernel.worldgen.critique import CriticOut, ensure_probe_issues
    out = CriticOut.model_validate({'scores': {k: 8 for k in ('realism', 'department_identity', 'composition', 'readability', 'craft')},
                                   'issues': [{'severity': 'high', 'description': 'P10 sign unreadable'}]})
    ensure_probe_issues(out, {'probes': [{'id': 'P1', 'pass': False, 'details': 'load failure'}]})
    assert any(i.description.startswith('P1 failed:') for i in out.issues)
