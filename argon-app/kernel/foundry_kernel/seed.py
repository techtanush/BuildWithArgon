# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.

"""Seeds departments and roster agents (idempotent). Spec: 01-architecture/03-data-model.md §Seed."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .config import KERNEL_DIR, Settings
from .db import Database, json_dumps
from .ids import utc_now

ROSTER = KERNEL_DIR / "data" / "roster.json"


def load_roster() -> dict[str, Any]:
    return json.loads(ROSTER.read_text())


async def seed_roster(db: Database, settings: Settings) -> None:
    roster = load_roster()
    faces_path = KERNEL_DIR / "data" / "faces.json"
    voices_path = KERNEL_DIR / "data" / "voices.json"
    raw_faces = json.loads(faces_path.read_text()) if faces_path.exists() else []
    if not isinstance(raw_faces, list) or any(not isinstance(f, dict) or not isinstance(f.get("agent_id"), str) for f in raw_faces):
        raise ValueError("faces.json must be a list of face objects with agent_id")
    faces = {f["agent_id"]: f for f in raw_faces}
    voices = json.loads(voices_path.read_text()) if voices_path.exists() else {}
    if not isinstance(voices, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in voices.items()):
        raise ValueError("voices.json must map agent ids to voice id strings")
    portraits = Path(settings.web_public_dir) / "generated" / "portraits"
    now = utc_now()
    async with db.tx() as tx:
        for d in roster["departments"]:
            await tx.execute(
                "INSERT INTO departments (id, code, name, mission, building_id, building_name, sort_order) VALUES (?,?,?,?,?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name, mission=excluded.mission, "
                "building_id=excluded.building_id, building_name=excluded.building_name, sort_order=excluded.sort_order",
                (d["id"], d["code"], d["name"], d["mission"], d["building_id"], d["building_name"], d["sort_order"]))
        for a in roster["agents"]:
            portrait = f"/generated/portraits/{a['id']}.png" if (portraits / f"{a['id']}.png").exists() else None
            face = json_dumps(faces[a["id"]], settings) if a["id"] in faces else None
            await tx.execute(
                "INSERT INTO agents (id, venture_id, department_id, display_name, title, role_summary, model_job, tools_json, persona, voice_id, face_json, portrait_path, npc_slot, is_lead, generated, created_at) "
                "VALUES (?, NULL, ?,?,?,?,?,?,?,?,?,?,?,?,0,?) "
                "ON CONFLICT(id) DO UPDATE SET venture_id=NULL, department_id=excluded.department_id, generated=0, "
                "display_name=excluded.display_name, title=excluded.title, role_summary=excluded.role_summary, "
                "model_job=excluded.model_job, tools_json=excluded.tools_json, persona=excluded.persona, voice_id=excluded.voice_id, "
                "face_json=excluded.face_json, portrait_path=excluded.portrait_path, npc_slot=excluded.npc_slot, is_lead=excluded.is_lead",
                (a["id"], a["department_id"], a["display_name"], a["title"], a["role_summary"], a["model_job"],
                 json_dumps(a["tools"], settings), a["persona"], voices.get(a["id"]), face, portrait, a["npc_slot"],
                 1 if a["is_lead"] else 0, now))


if __name__ == "__main__":
    import asyncio

    from .config import get_settings

    async def _main() -> None:
        s = get_settings()
        db = Database(s.db_path, s)
        await db.connect()
        await seed_roster(db, s)
        await db.close()
        print("seeded", s.db_path)

    asyncio.run(_main())
