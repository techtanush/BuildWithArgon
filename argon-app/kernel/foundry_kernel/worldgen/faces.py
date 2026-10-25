# OWNER: ayan
"""FaceSpecs for all agents (05-world/05 §Generation; job face_spec, Argon medium) -> kernel/data/faces.json.
Validation: enums, palette membership, hex format, numeric ranges, every roster agent exactly once. One repair
call; anything still invalid falls back per agent to a deterministic spec from mulberry32(face_seed)."""
from __future__ import annotations

import json
import re
from typing import Any

from pydantic import BaseModel, ValidationError

from ..contracts import FaceSpec
from ..ids import utc_now
from . import paths
from .runs import write_json

SKIN = ["#F6D7C3", "#EDC1A0", "#D9A37E", "#B97A56", "#8D5A3B", "#5E3A26"]
SKIN_NAMES = ["fair porcelain", "light", "warm medium", "tan", "brown", "deep brown"]
HAIR_COLORS = ["#1E1B18", "#3B2A20", "#6B4226", "#A0612E", "#D9B26A", "#B7B7B7", "#7A3B6E", "#2F5D8A"]
HAIR_NAMES = ["black", "dark brown", "chestnut brown", "auburn", "blonde", "silver grey", "plum", "deep blue"]
EYE_COLORS = ["#3B2A20", "#5B7A3A", "#3E6C9E", "#6B4F2A", "#2B2B2B"]
EYE_NAMES = ["dark brown", "green", "blue", "hazel", "near-black"]
HAIR_STYLES = ["short", "buzz", "bob", "long", "bun", "curly", "ponytail", "bald", "mohawk", "waves"]
BROWS = ["straight", "arched", "thick"]
NOSES = ["button", "round", "long"]
ACCESSORIES = ["none", "glasses_round", "glasses_square", "headset", "hard_hat", "beanie", "earrings", "scarf", "visor", "bowtie"]
OUTFITS = ["hoodie", "blazer", "overalls", "sweater", "vest", "jacket", "apron", "lab_coat"]
PANTS = ["#2E3440", "#3B4252", "#4C566A", "#5A4636", "#2F3E46", "#6B5B4B", "#1F2933", "#7A6F5D"]
HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")

RULES = """Rules:
- Variety: within a building (department), no two agents share hair_style+hair_color; across the town, each hair_style
  is used at least 2 times; skin tones spread across all 6 values.
- Role hints: engineering builder may wear hard_hat or apron; QA glasses_square; support headset; finance blazer;
  research glasses_round or lab_coat; concierge scarf or bowtie with outfit_color in the #F5D90A family.
- outfit_color is the department color or a darker/lighter variant of it; pants_color is a muted realistic hex.
- skin must be one of SKIN; hair_color one of HAIR_COLORS; eye_color one of EYE_COLORS (exact hex strings).
- height 0.92–1.08, build 0.90–1.10. `names` are plain-English descriptions for portrait prompts
  (skin, hair e.g. "short dark brown", eyes, outfit e.g. "teal blazer", accessory e.g. "round glasses" or "none").
- Output ONLY a JSON array of FaceSpec objects, one per agent, in roster order."""


class _List(BaseModel):
    items: list[dict[str, Any]]


def mulberry32(seed: int):
    """Same PRNG as the web side (05-world/05)."""
    state = seed & 0xFFFFFFFF

    def rnd() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        t = state
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return rnd


def fallback_face(agent: dict[str, Any], dept_color: str) -> dict[str, Any]:
    r = mulberry32(int(agent.get("face_seed", 1)))
    pick = lambda seq: seq[int(r() * len(seq)) % len(seq)]
    skin_i = int(r() * len(SKIN)) % len(SKIN)
    hair_i = int(r() * len(HAIR_COLORS)) % len(HAIR_COLORS)
    eye_i = int(r() * len(EYE_COLORS)) % len(EYE_COLORS)
    style = pick(HAIR_STYLES)
    brow, nose, accessory, outfit = pick(BROWS), pick(NOSES), pick(ACCESSORIES), pick(OUTFITS)
    face = {"agent_id": agent["id"], "skin": SKIN[skin_i], "hair_style": style, "hair_color": HAIR_COLORS[hair_i],
            "eye_color": EYE_COLORS[eye_i], "brow": brow, "nose": nose, "accessory": accessory, "outfit": outfit,
            "outfit_color": dept_color.upper(), "pants_color": pick(PANTS),
            "height": round(0.92 + r() * 0.16, 3), "build": round(0.90 + r() * 0.20, 3)}
    face["names"] = {"skin": SKIN_NAMES[skin_i], "hair": "bald" if style == "bald" else f"{style} {HAIR_NAMES[hair_i]}",
                     "eyes": EYE_NAMES[eye_i], "outfit": f"{outfit.replace('_', ' ')}",
                     "accessory": accessory.replace("_", " ") if accessory != "none" else "none"}
    return face


def check_face(raw: dict[str, Any], agent_id: str) -> tuple[dict[str, Any] | None, list[str]]:
    errors: list[str] = []
    try:
        face = FaceSpec.model_validate(raw).model_dump()
    except ValidationError as exc:
        return None, [f"{agent_id}: {e['loc']}: {e['msg']}" for e in exc.errors()[:6]]
    if face["agent_id"] != agent_id:
        errors.append(f"{agent_id}: agent_id mismatch ({face['agent_id']})")
    if face["skin"].upper() not in SKIN:
        errors.append(f"{agent_id}: skin {face['skin']} not in SKIN")
    if face["hair_color"].upper() not in HAIR_COLORS:
        errors.append(f"{agent_id}: hair_color {face['hair_color']} not in HAIR_COLORS")
    if face["eye_color"].upper() not in EYE_COLORS:
        errors.append(f"{agent_id}: eye_color {face['eye_color']} not in EYE_COLORS")
    for k in ("outfit_color", "pants_color"):
        if not HEX.match(face[k]):
            errors.append(f"{agent_id}: {k} {face[k]} is not #RRGGBB")
    for k in ("skin", "hair_color", "eye_color", "outfit_color", "pants_color"):
        face[k] = face[k].upper()
    return (None, errors) if errors else (face, [])


def variety_warnings(faces: list[dict[str, Any]], agents: dict[str, dict[str, Any]]) -> list[str]:
    warn: list[str] = []
    seen: dict[tuple[str, str, str], str] = {}
    for f in faces:
        key = (agents[f["agent_id"]]["department_id"], f["hair_style"], f["hair_color"])
        if key in seen:
            warn.append(f"{f['agent_id']} and {seen[key]} share hair in {key[0]}")
        seen[key] = f["agent_id"]
    styles = [f["hair_style"] for f in faces]
    warn += [f"hair_style {s} used {styles.count(s)}x" for s in HAIR_STYLES if 0 < styles.count(s) < 2]
    missing_skin = [s for s in SKIN if s not in {f["skin"] for f in faces}]
    if missing_skin:
        warn.append(f"skin tones unused: {missing_skin}")
    return warn


def prompt(agents: list[dict[str, Any]], colors: dict[str, str]) -> str:
    enums = {"SKIN": SKIN, "HAIR_COLORS": HAIR_COLORS, "EYE_COLORS": EYE_COLORS, "hair_style": HAIR_STYLES, "brow": BROWS,
             "nose": NOSES, "accessory": ACCESSORIES, "outfit": OUTFITS}
    rows = [{"agent_id": a["id"], "name": a["display_name"], "title": a["title"], "department": a["department_id"],
             "department_color": colors[a["department_id"]], "persona": a["persona"]} for a in agents]
    schema = {"agent_id": "str", "skin": "hex from SKIN", "hair_style": "enum", "hair_color": "hex", "eye_color": "hex",
              "brow": "enum", "nose": "enum", "accessory": "enum", "outfit": "enum", "outfit_color": "#RRGGBB",
              "pants_color": "#RRGGBB", "height": "0.92-1.08", "build": "0.90-1.10",
              "names": {"skin": "str", "hair": "str", "eyes": "str", "outfit": "str", "accessory": "str"}}
    return ("Design a realistic, varied appearance (FaceSpec) for each agent of the Foundry company town.\n\n"
            f"ENUMS:\n{json.dumps(enums, indent=1)}\n\nFACESPEC SHAPE:\n{json.dumps(schema, indent=1)}\n\n{RULES}\n\n"
            f"AGENTS ({len(rows)}):\n{json.dumps(rows, indent=1)}")


async def generate_faces(llm: Any, *, write: bool = True) -> dict[str, Any]:
    roster = paths.roster()
    agents = roster["agents"]
    by_id = {a["id"]: a for a in agents}
    colors = {d["id"]: d["color"] for d in roster["departments"]}
    text = prompt(agents, colors)
    log: dict[str, Any] = {"at": utc_now(), "calls": [], "fallback": [], "errors": []}

    def collect(items: list[Any]) -> tuple[dict[str, dict[str, Any]], list[str]]:
        good: dict[str, dict[str, Any]] = {}
        errs: list[str] = []
        for raw in items:
            if not isinstance(raw, dict) or raw.get("agent_id") not in by_id:
                errs.append(f"unknown or missing agent_id: {str(raw)[:80]}")
                continue
            face, e = check_face(raw, raw["agent_id"])
            if face and raw["agent_id"] not in good:
                good[raw["agent_id"]] = face
            errs += e
        errs += [f"{a}: missing" for a in by_id if a not in good]
        return good, errs

    def as_list(t: str) -> list[Any]:
        from ..llm.jsonout import extract_json

        data = extract_json(t)
        return data if isinstance(data, list) else data.get("items", []) if isinstance(data, dict) else []

    res = await llm.generate("face_spec", text)
    log["calls"].append({"interaction_id": res.interaction_id, "tokens": [res.tokens_in, res.tokens_out]})
    try:
        good, errs = collect(as_list(res.text))
    except ValueError as exc:
        good, errs = {}, [f"output is not JSON: {exc}"]
    if errs:
        fix = ("Some FaceSpecs are invalid or missing:\n" + "\n".join(errs[:60]) +
               "\nReturn ONLY the complete corrected JSON array for ALL agents.")
        res2 = await llm.generate("face_spec", fix, previous_interaction_id=res.interaction_id)
        log["calls"].append({"interaction_id": res2.interaction_id, "tokens": [res2.tokens_in, res2.tokens_out], "repair": True})
        try:
            good2, errs = collect(as_list(res2.text))
            good = {**good, **good2}
            errs = [e for e in errs if e.split(":")[0] not in good]
        except ValueError as exc:
            errs = [f"repair output is not JSON: {exc}"]
    faces = []
    for a in agents:
        if a["id"] in good:
            faces.append(good[a["id"]])
        else:
            faces.append(fallback_face(a, colors[a["department_id"]]))
            log["fallback"].append(a["id"])
    log["errors"] = errs
    log["variety_warnings"] = variety_warnings(faces, by_id)
    if write:
        paths.FACES_JSON.write_text(json.dumps(faces, indent=2) + "\n")
        write_json(paths.ASSETS_DIR / "faces-log.json", log)
    return {"faces": faces, **log}
