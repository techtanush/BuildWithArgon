# OWNER: frozen contract (change only via docs/contract-requests/<you>.md, applied in the merge session)
"""Deterministic city layout + manifest builder (architecture-files/05-world/03-city-layout.md).

Shared by tanush's `api/world.py` (GET /v1/world/manifest) and by the seed's
`web/src/world/data/manifest.fallback.json`. mahin's `web/src/world/city/layout.ts` must produce the
same numbers (a vitest compares it against the fallback JSON).

Regenerate the fallback:  uv run python -m foundry_kernel.world_layout > ../web/src/world/data/manifest.fallback.json
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

N = 13
PLOT_R, PLAZA_R, RING_R, DOOR_R = 132.0, 30.0, 92.0, 110.0


def _r(v: float) -> float:
    return round(v, 2) + 0.0  # +0.0 turns -0.0 into 0.0


def theta(i: int) -> float:
    return i * 2 * math.pi / N


def at(radius: float, angle: float) -> list[float]:
    """(x, z) at `radius` along direction (sin a, -cos a): angle 0 is north (-Z), clockwise from above."""
    return [_r(radius * math.sin(angle)), _r(-radius * math.cos(angle))]


def road_graph() -> dict[str, Any]:
    nodes: list[dict[str, Any]] = []
    edges: list[list[str]] = []
    for i in range(N):
        t = theta(i)
        nodes += [{"id": f"E{i}", "pos": at(PLAZA_R, t)}, {"id": f"R{i}", "pos": at(RING_R, t)},
                  {"id": f"M{i}", "pos": at(RING_R, t + math.pi / N)}, {"id": f"D{i}", "pos": at(DOOR_R, t)}]
    for i in range(N):
        j = (i + 1) % N
        edges += [[f"E{i}", f"R{i}"], [f"R{i}", f"D{i}"], [f"R{i}", f"M{i}"], [f"M{i}", f"R{j}"], [f"E{i}", f"E{j}"]]
    return {"ring": {"radius": RING_R, "width": 10}, "spoke_width": 8, "driveway_width": 6, "nodes": nodes, "edges": edges}


def buildings(departments: list[dict[str, Any]], registry: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    modules = (registry or {}).get("modules", {})
    out = []
    for d in sorted(departments, key=lambda d: d["sort_order"]):
        i = d["sort_order"] - 1
        t = theta(i)
        out.append({
            "index": i, "department_id": d["id"], "code": d["code"], "building_id": d["building_id"],
            "name": d["building_name"], "department_name": d["name"], "color": d["color"],
            "theta": round(t, 6), "plot_center": at(PLOT_R, t), "rotation_y": round(-t, 6) + 0.0,
            "footprint": [28, 28], "door_node": f"D{i}", "sign_url": f"/generated/signs/{d['id']}.png",
            "module": "generated" if modules.get(d["id"], {}).get("status") == "generated" else "fallback",
        })
    return out


def npcs(agents: list[dict[str, Any]], departments: list[dict[str, Any]], faces: dict[str, Any] | None = None,
         voices: dict[str, str] | None = None) -> list[dict[str, Any]]:
    """`agents` rows need: id, department_id, display_name, title, npc_slot, is_lead (and `generated` for venture agents)."""
    building_of = {d["id"]: d["building_id"] for d in departments}
    out = []
    for a in agents:
        slot_key = a.get("npc_slot") or ""
        concierge = slot_key == "plaza.concierge"
        out.append({
            "agent_id": a["id"], "building_id": "plaza" if concierge else building_of[a["department_id"]],
            "slot": "concierge" if concierge else slot_key.split(".")[-1],
            "display_name": a["display_name"], "title": a["title"], "department_id": a["department_id"],
            "portrait_url": f"/generated/portraits/{a['id']}.png", "face": (faces or {}).get(a["id"]),
            "voice_ready": bool((voices or {}).get(a["id"])), "is_lead": bool(a.get("is_lead")),
            "generated": bool(a.get("generated")),
        })
    return out


def build_manifest(roster: dict[str, Any], *, registry: dict[str, Any] | None = None, faces: dict[str, Any] | None = None,
                   voices: dict[str, str] | None = None, extra_agents: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    deps = roster["departments"]
    return {
        "version": 1,
        "seed": 1337,
        "plaza": {
            "radius": PLAZA_R,
            "fountain": {"pos": [0, 0, 0], "radius": 4.5},
            "concierge": {"agent_id": "concierge", "pos": [0, 0, 11.5], "facing_y": 0},
            "spawn": {"pos": [0, 1.65, 16], "yaw": 0},
            "car": {"pos": [6, 0, 18], "heading": 0},
        },
        "roads": road_graph(),
        "buildings": buildings(deps, registry),
        "npcs": npcs(roster["agents"] + (extra_agents or []), deps, faces, voices),
    }


if __name__ == "__main__":
    kernel_dir = Path(__file__).resolve().parents[1]
    print(json.dumps(build_manifest(json.loads((kernel_dir / "data" / "roster.json").read_text())), indent=2))
