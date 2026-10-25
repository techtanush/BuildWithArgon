# OWNER: ayan
"""FaceSpec generation: validation, one repair, deterministic per-agent fallback (05-world/05 §Generation)."""
from __future__ import annotations

from pathlib import Path

from foundry_kernel.contracts import FaceSpec
from foundry_kernel.llm.fake import FakeLLM
from foundry_kernel.worldgen import paths
from foundry_kernel.worldgen.faces import (
    check_face,
    fallback_face,
    generate_faces,
    mulberry32,
)


def test_mulberry32_matches_reference_sequence() -> None:
    r = mulberry32(1)  # values from the canonical JS implementation (node, Math.imul)
    assert [round(r(), 6) for _ in range(4)] == [0.627074, 0.002736, 0.527447, 0.981051]


def test_fallback_is_deterministic_and_valid() -> None:
    agent = next(a for a in paths.roster()["agents"] if a["id"] == "eng.builder")
    a, b = fallback_face(agent, "#D0573F"), fallback_face(agent, "#D0573F")
    assert a == b
    face, errors = check_face(a, "eng.builder")
    assert errors == [] and FaceSpec.model_validate(face)


def test_check_face_rejects_off_palette_and_bad_hex() -> None:
    agent = next(a for a in paths.roster()["agents"] if a["id"] == "concierge")
    raw = fallback_face(agent, "#6C7A99") | {"skin": "#123456", "pants_color": "blue"}
    face, errors = check_face(raw, "concierge")
    assert face is None and any("skin" in e for e in errors) and any("pants_color" in e for e in errors)


async def test_generate_repairs_then_falls_back(wg_paths: Path) -> None:
    roster = paths.roster()
    colors = {d["id"]: d["color"] for d in roster["departments"]}
    good = [fallback_face(a, colors[a["department_id"]]) for a in roster["agents"]]
    first = [dict(f) for f in good[:-2]]  # two agents missing
    first[0]["hair_style"] = "dreadlocks"  # invalid enum
    repaired = [good[0], good[-2]]  # repair fixes one of the missing + the invalid one
    llm = FakeLLM()
    llm.script("face_spec", [first, repaired])
    out = await generate_faces(llm, write=True)
    assert len(out["faces"]) == len(roster["agents"]) and out["fallback"] == [roster["agents"][-1]["id"]]
    assert llm.call_kwargs[1]["previous_interaction_id"] == "fake-1"
    assert paths.FACES_JSON.exists()
