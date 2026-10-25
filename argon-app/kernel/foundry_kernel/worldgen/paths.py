# OWNER: ayan
"""Locations and department metadata shared by the worldgen pipeline (05-world/09, 10, 13)."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from ..config import APP_DIR, KERNEL_DIR

REPO_DIR = APP_DIR.parent
SPEC_DIR = REPO_DIR / "architecture-files"
WEB_DIR = APP_DIR / "web"
WORLD_DIR = WEB_DIR / "src" / "world"
KIT_TYPES = WORLD_DIR / "kit" / "types.ts"
PROPS_CONTRACT = WORLD_DIR / "kit" / "props.contract.ts"
EXAMPLE_MODULE = WORLD_DIR / "buildings" / "example" / "house.example.ts"
FALLBACK_ARCHETYPES = WORLD_DIR / "buildings" / "fallback" / "archetypes.ts"
GENERATED_DIR = WORLD_DIR / "buildings" / "generated"
STAGING_DIR = WORLD_DIR / "buildings" / "staging"
PUBLIC_GENERATED = WEB_DIR / "public" / "generated"
DESIGN_MD = APP_DIR / "docs" / "DESIGN.md"
BUILDINGS_MD = SPEC_DIR / "05-world" / "04-buildings.md"
PHOTOREAL_MD = SPEC_DIR / "05-world" / "12-photoreal-look.md"
REFERENCE_WEBP = SPEC_DIR / "assets" / "reference-bedroom.webp"
KIT_CONTRACT_MD = Path(__file__).with_name("kit_contract.md")

WORLDGEN_DATA = KERNEL_DIR / "data" / "worldgen"
RUNS_DIR = WORLDGEN_DATA / "runs"
LIVE_DIR = WORLDGEN_DATA / "live"
ASSETS_DIR = WORLDGEN_DATA / "assets"
FACES_JSON = KERNEL_DIR / "data" / "faces.json"
ROSTER_JSON = KERNEL_DIR / "data" / "roster.json"
EVAL_RESULTS = APP_DIR / "evals" / "results"

GENERATED_PATH_PREFIX = "web/src/world/buildings/generated/"
EXTERIOR_CAMERAS = ["ext-1", "ext-2", "ext-3"]
INTERIOR_CAMERAS = ["int-1", "int-2", "int-3"]
CAMERAS = EXTERIOR_CAMERAS + INTERIOR_CAMERAS
PROBES = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"]
CRITICAL_PROBES = ["P1", "P2", "P3", "P4", "P5"]


@dataclass(frozen=True)
class Department:
    id: str
    code: str
    name: str
    mission: str
    building_name: str
    color: str
    sort_order: int
    brief_exterior: str = ""
    brief_interior: str = ""


@lru_cache
def roster() -> dict:
    return json.loads(ROSTER_JSON.read_text())


def _brief_rows() -> dict[str, tuple[str, str]]:
    """Rows of the 'Building design briefs' table in 04-buildings.md: dept -> (exterior, interior)."""
    if not BUILDINGS_MD.exists():
        return {}
    rows: dict[str, tuple[str, str]] = {}
    for line in BUILDINGS_MD.read_text().splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) == 4 and re.fullmatch(r"[a-z-]+", cells[0]) and cells[0] != "dept":
            rows[cells[0]] = (cells[2], cells[3])
    return rows


@lru_cache
def departments() -> list[Department]:
    briefs = _brief_rows()
    out = []
    for d in sorted(roster()["departments"], key=lambda d: d["sort_order"]):
        ext, inner = briefs.get(d["id"], ("", ""))
        out.append(Department(id=d["id"], code=d["code"], name=d["name"], mission=d["mission"],
                              building_name=d["building_name"], color=d["color"], sort_order=d["sort_order"],
                              brief_exterior=ext, brief_interior=inner))
    return out


def department_ids() -> list[str]:
    return [d.id for d in departments()]


def department(dept_id: str) -> Department:
    for d in departments():
        if d.id == dept_id:
            return d
    raise KeyError(dept_id)


def module_path(dept_id: str) -> str:
    return f"{GENERATED_PATH_PREFIX}{dept_id}.ts"


def ident(dept_id: str) -> str:
    """A TS identifier for a department id ('market-research' -> 'marketResearch')."""
    head, *rest = dept_id.split("-")
    return head + "".join(p.capitalize() for p in rest)
