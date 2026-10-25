"""Face asset loading at the world-manifest boundary."""
from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest

from foundry_kernel.api import world
from foundry_kernel.config import KERNEL_DIR


def _face(agent_id: str) -> dict:
    return next(face for face in json.loads((KERNEL_DIR / "data" / "faces.json").read_text()) if face["agent_id"] == agent_id)


def _manifest_faces(client) -> dict[str, dict | None]:
    return {npc["agent_id"]: npc["face"] for npc in client.get("/v1/world/manifest").json()["data"]["npcs"]}


def test_manifest_loads_real_generated_face_list(client):
    faces = _manifest_faces(client)
    assert len(faces) == 29
    assert all(face is not None for face in faces.values())
    assert faces["concierge"]["agent_id"] == "concierge"


@pytest.mark.parametrize("document", ["list", "legacy-map"])
def test_manifest_accepts_list_and_legacy_face_documents(client, monkeypatch, tmp_path: Path, document: str):
    face = _face("concierge")
    payload = [face] if document == "list" else {"concierge": face}
    (tmp_path / "data").mkdir(exist_ok=True)
    (tmp_path / "data" / "faces.json").write_text(json.dumps(payload))
    monkeypatch.setattr(world, "KERNEL_DIR", tmp_path)

    faces = _manifest_faces(client)
    assert faces["concierge"] == face
    assert faces["eng.builder"] is None


def test_manifest_rejects_malformed_duplicate_and_mismatched_face_identities(client, monkeypatch, tmp_path: Path):
    concierge = _face("concierge")
    mismatch = deepcopy(_face("eng.builder"))
    mismatch["agent_id"] = "eng.qa"
    duplicate = deepcopy(concierge)
    malformed = {"agent_id": "intake.brief-lead", "hair_style": "not-a-style"}
    (tmp_path / "data").mkdir(exist_ok=True)
    faces_path = tmp_path / "data" / "faces.json"
    faces_path.write_text(json.dumps([concierge, duplicate, malformed, "not-a-face"]))
    monkeypatch.setattr(world, "KERNEL_DIR", tmp_path)

    faces = _manifest_faces(client)
    assert faces["concierge"] is None  # duplicate list identity is never arbitrarily selected
    assert faces["intake.brief-lead"] is None

    faces_path.write_text(json.dumps({"eng.builder": mismatch}))
    faces = _manifest_faces(client)
    assert faces["eng.builder"] is None  # keyed documents cannot bind a face to another NPC
    assert faces["eng.qa"] is None
