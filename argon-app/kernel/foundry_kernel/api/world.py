# OWNER: tanush
"""The deterministic, status-free city manifest, including approved venture hires."""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Request

from ..api_models import Envelope
from ..config import APP_DIR, KERNEL_DIR
from ..contracts import FaceSpec, Manifest
from ..records import get_row, json_loads
from ..seed import load_roster
from ..world_layout import build_manifest

router = APIRouter(tags=['world'])


def optional_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def validated_face(agent_id: str, raw: object) -> dict | None:
    """Return a contract-valid FaceSpec only when it belongs to this agent."""
    if not isinstance(raw, dict) or raw.get("agent_id") != agent_id:
        return None
    try:
        return FaceSpec.model_validate(raw).model_dump()
    except ValueError:
        return None


def load_faces(path: Path) -> dict[str, dict]:
    """Load generated FaceSpecs without allowing a face to be bound to another NPC.

    World generation writes the documented list format; the keyed mapping remains
    supported for deployments that produced the earlier format.  Invalid entries
    are ignored so an optional asset file cannot break the manifest endpoint.
    """
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return {}

    if isinstance(data, list):
        entries = [(item.get("agent_id"), item) for item in data if isinstance(item, dict)]
        counts: dict[str, int] = {}
        for agent_id, _ in entries:
            if isinstance(agent_id, str):
                counts[agent_id] = counts.get(agent_id, 0) + 1
        duplicate_ids = {agent_id for agent_id, count in counts.items() if count > 1}
    elif isinstance(data, dict):
        entries = list(data.items())
        duplicate_ids = set()
    else:
        return {}

    faces: dict[str, dict] = {}
    for agent_id, raw in entries:
        if not isinstance(agent_id, str) or agent_id in duplicate_ids:
            continue
        face = validated_face(agent_id, raw)
        if face:
            faces[agent_id] = face
    return faces


@router.get('/v1/world/manifest', response_model=Envelope[Manifest])
async def manifest(request: Request, venture: str | None = None):
    db = request.app.state.db
    extras = []
    faces = load_faces(KERNEL_DIR / 'data' / 'faces.json')
    voices = optional_json(KERNEL_DIR / 'data' / 'voices.json')
    if venture:
        await get_row(db, 'ventures', venture)
        extras = await db.fetch_all('SELECT * FROM agents WHERE venture_id=? AND generated=1 ORDER BY id', (venture,))
        for agent in extras:
            face = validated_face(agent['id'], json_loads(agent.get('face_json'), None))
            if face:
                faces[agent['id']] = face
            if agent.get('voice_id'):
                voices[agent['id']] = agent['voice_id']
    registry = optional_json(APP_DIR / 'web' / 'src' / 'world' / 'buildings' / 'generated' / 'registry.json')
    return {'data': build_manifest(load_roster(), registry=registry, faces=faces, voices=voices, extra_agents=extras)}
