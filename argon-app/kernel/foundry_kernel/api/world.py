# OWNER: tanush
"""The deterministic, status-free city manifest, including approved venture hires."""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Request

from ..api_models import Envelope
from ..config import APP_DIR, KERNEL_DIR
from ..contracts import Manifest
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


@router.get('/v1/world/manifest', response_model=Envelope[Manifest])
async def manifest(request: Request, venture: str | None = None):
    db = request.app.state.db
    extras = []
    faces = optional_json(KERNEL_DIR / 'data' / 'faces.json')
    voices = optional_json(KERNEL_DIR / 'data' / 'voices.json')
    if venture:
        await get_row(db, 'ventures', venture)
        extras = await db.fetch_all('SELECT * FROM agents WHERE venture_id=? AND generated=1 ORDER BY id', (venture,))
        for agent in extras:
            face = json_loads(agent.get('face_json'), None)
            if face:
                faces[agent['id']] = face
            if agent.get('voice_id'):
                voices[agent['id']] = agent['voice_id']
    registry = optional_json(APP_DIR / 'web' / 'src' / 'world' / 'buildings' / 'generated' / 'registry.json')
    return {'data': build_manifest(load_roster(), registry=registry, faces=faces, voices=voices, extra_agents=extras)}
