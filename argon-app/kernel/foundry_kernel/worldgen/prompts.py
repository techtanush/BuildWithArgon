# OWNER: ayan
"""Prompt builders for world generation, critique and patching (05-world/09 §Generation prompt, 10 §4–5, 13 §2).
Every section is read from its source of truth at call time (kit/types.ts, props.contract.ts, DESIGN.md,
04-buildings.md, 12-photoreal-look.md §1), so a spec edit flows straight into the prompts."""
from __future__ import annotations

import json
import re
from typing import Any

from . import paths
from .paths import Department

SYSTEM_GENERATE = """You are the world builder for Foundry, a company town with 13 department buildings. Write {n} TypeScript building
modules against the KIT API below. Output ONLY {n} FILE blocks:
<<<FILE path="web/src/world/buildings/generated/<department_id>.ts">>> ... <<<END FILE>>>
Each file must import only from '../../kit/types' and default-export a BuildingModule.
No other imports, no DOM, no network, no randomness except k.rand().
Follow DESIGN.md exactly. Make the 13 buildings consistent in style and clearly distinct in
silhouette. The town must look photoreal (quality bar below); the attached image is a composition
reference only."""

CRITIC = """You are the art director and QA lead for the Foundry town, which must look photoreal — like a
team of environment artists built it. Judge this building against DESIGN.md, the photoreal
quality bar and its brief. Watch the videos and look carefully at the screenshots: clipping,
floating objects, objects inside walls, flicker/z-fighting/popping in motion, empty or cluttered
rooms, unreadable sign, wrong scale, missing architectural detail, flat or stretched materials,
missing department identity, bad composition, anything that looks fake or toy-like.
Return ONLY JSON:
{"scores": {"realism": 1-10, "department_identity": 1-10, "composition": 1-10,
            "readability": 1-10, "craft": 1-10},
 "issues": [{"severity": "high"|"medium"|"low", "where": "exterior|interior",
             "camera": "ext-1|...|ext-video|int-video", "description": "...", "fix": "concrete change in kit calls"}],
 "keep": ["what works and must not be lost"]}
Every failed probe must appear as a high-severity issue with a concrete fix."""

PATCH = """Rewrite this building module to fix every issue below while keeping what works ("keep").
Same rules and KIT API as before (attached). Output exactly one FILE block for
web/src/world/buildings/generated/{dept}.ts."""

NOTES = """### NOTES (clarifications of the rules above — these win where they differ)
- `interiorShell` is a field of the BuildingModule object (see KIT API), not a separate export.
- Triangle budgets are checked by probe P7: exterior <= 250,000, interior <= 400,000 incl. prop models; draw calls <= 150.
- Every module is checked by these probes: P1 loads (no exception, no console errors), P2 bounds (exterior x,z in [-13,13],
  y in [0,30]; interior x in [-9,9], z in [-7,7], y in [0,4.2]; 0.05 m tolerance), P3 entrance (exactly one entrance with
  z in [6,11], no collider within 1.5 m of the door ring, exactly one sign with y in [3.2,6]), P4 slots (exactly s1..s6,
  pairwise >= 1.6 m, >= 0.8 m from walls, not inside any collider), P5 reachability (0.25 m nav grid, colliders inflated by
  0.35 m; BFS from the door (0, 5.4) reaches the point 1.2 m in front of every slot along its facing), P6 overlap (no two
  colliders overlap by > 0.01 m3), P7 budget, P8 lights (interior <= 3, exterior <= 1), P9 non-blank renders,
  P10 sign visible from the front camera (0, 1.7, 30) without occlusion.
- Department id, building name and accent color for each module are listed under BUILDINGS; use `k.colors.accent`
  rather than hard-coding colors (the kit tints the 'accent'/'accent_dark' materials)."""


def _read(path: Any, fallback: str = "") -> str:
    try:
        return path.read_text()
    except OSError:
        return fallback


def kit_api() -> str:
    """kit/types.ts verbatim (the frozen contract), falling back to the committed kit_contract.md copy."""
    text = _read(paths.KIT_TYPES)
    if text:
        return text
    md = _read(paths.KIT_CONTRACT_MD)
    m = re.search(r"```ts\n(.*?)```", md, re.DOTALL)
    return m.group(1) if m else md


def props_table() -> str:
    """PROPS LIBRARY table generated from props.contract.ts (PROP_FOOTPRINTS)."""
    src = _read(paths.PROPS_CONTRACT)
    rows = re.findall(r"^\s*(\w+):\s*\{\s*w:\s*([\d.]+),\s*d:\s*([\d.]+),\s*h:\s*([\d.]+),\s*note:\s*'([^']*)'\s*\}",
                      src, re.MULTILINE)
    lines = ["| kind | w × d × h (m) | note |", "|---|---|---|"]
    lines += [f"| {k} | {w} × {d} × {h} | {note} |" for k, w, d, h, note in rows]
    return "\n".join(lines)


def prop_kinds() -> set[str]:
    return set(re.findall(r"^\s*(\w+):\s*\{\s*w:", _read(paths.PROPS_CONTRACT), re.MULTILINE))


def building_rules() -> str:
    """The 'Rules that apply to every building' section of 04-buildings.md verbatim."""
    md = _read(paths.BUILDINGS_MD)
    m = re.search(r"## Rules that apply to every building\n(.*?)\n## ", md, re.DOTALL)
    return m.group(1).strip() if m else ""


def variety_rule() -> str:
    m = re.search(r"\*\*Variety rule:\*\*(.*?)\n\n", _read(paths.BUILDINGS_MD), re.DOTALL)
    return ("Variety rule:" + m.group(1)).strip() if m else ""


def quality_bar() -> str:
    """12-photoreal-look.md §1 verbatim."""
    md = _read(paths.PHOTOREAL_MD)
    m = re.search(r"## 1\. The quality bar[^\n]*\n(.*?)\n## 2\.", md, re.DOTALL)
    return m.group(1).strip() if m else ""


def design_md() -> str:
    return _read(paths.DESIGN_MD)


ART_DIRECTION_MD = paths.KIT_CONTRACT_MD.with_name("art_direction.md")
ART_REFERENCE_DIR = paths.ASSETS_DIR / "art-reference"


def art_direction() -> str:
    """The founder's art direction (art_direction.md without its HTML comment header)."""
    return re.sub(r"<!--.*?-->\s*", "", _read(ART_DIRECTION_MD), flags=re.DOTALL).strip()


def art_reference_images(limit: int = 3) -> list[Any]:
    """Optional extra reference images (png/jpg/webp) the founder dropped into assets/art-reference/."""
    from ..contracts import Part

    out: list[Any] = []
    if not ART_REFERENCE_DIR.exists():
        return out
    for f in sorted(ART_REFERENCE_DIR.iterdir())[:limit]:
        mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}.get(f.suffix.lower())
        if mime:
            out.append(Part(kind="image", data=f.read_bytes(), mime=mime))
    return out


def example_module() -> str:
    """fallback/archetypes.ts 'house' archetype when it exists (Mahin), else the frozen house example."""
    src = _read(paths.FALLBACK_ARCHETYPES)
    if src and "house" in src:
        return src
    return _read(paths.EXAMPLE_MODULE)


def building_entry(d: Department) -> str:
    return (f"- id: '{d.id}' | building: {d.building_name} | department: {d.name} ({d.code}) | color: {d.color}\n"
            f"  mission: {d.mission}\n  exterior: {d.brief_exterior}\n  interior: {d.brief_interior}")


def generation_prompt(depts: list[Department], *, consistency: dict[str, str] | None = None) -> tuple[str, str]:
    """(system, task) for job worldgen_buildings (all 13) or worldgen_building (one, with consistency context:
    the already-generated modules' exterior sections)."""
    system = SYSTEM_GENERATE.format(n=len(depts))
    if len(depts) == 1:
        system = system.replace("Make the 13 buildings consistent in style and clearly distinct in\nsilhouette.",
                                "Make this building consistent in style with the existing ones (below) and clearly "
                                "distinct in silhouette.")
    sections = [
        "### KIT API\n```ts\n" + kit_api().strip() + "\n```",
        "### PROPS LIBRARY (real 3D models; sizes, origin at floor center)\n" + props_table(),
        "### RULES\n" + building_rules() + "\n\n" + variety_rule(),
        NOTES,
        "### DESIGN.md\n" + design_md().strip(),
        art_direction(),
        "### BUILDINGS\n" + "\n".join(building_entry(d) for d in depts),
        "### EXAMPLE (style and API usage; do not copy the design)\n```ts\n" + example_module().strip() + "\n```",
        "### PHOTOREAL QUALITY BAR\n" + quality_bar(),
        ("### COMPOSITION REFERENCE (layout and coziness only — the render style is photoreal)\n(attached: reference-bedroom.png;"
         " any further attached images are the founder's art-direction references for exteriors)"),
    ]
    if consistency:
        ctx = "\n\n".join(f"// {k} (exterior)\n{v}" for k, v in sorted(consistency.items()))
        sections.append("### EXISTING BUILDINGS (exterior sections, for consistency)\n```ts\n" + ctx + "\n```")
    return system, "\n\n".join(sections)


def critic_prompt(d: Department, *, probe_report: dict[str, Any], source: str, tsc_errors: str = "",
                  media_note: str = "") -> tuple[str, str]:
    failed = [p for p in probe_report.get("probes", []) if not p.get("pass")]
    task = "\n\n".join([
        f"### BUILDING\n{building_entry(d)}",
        "### DESIGN.md\n" + design_md().strip(),
        art_direction(),
        "### PHOTOREAL QUALITY BAR\n" + quality_bar(),
        "### PROBE REPORT\n```json\n" + json.dumps({"probe_score": probe_report.get("probe_score"),
                                                    "failed": failed, "stats": probe_report.get("stats", {}),
                                                    "consoleErrors": probe_report.get("consoleErrors", [])[:20]},
                                                   indent=1) + "\n```",
        "### TSC ERRORS\n" + (tsc_errors.strip() or "none"),
        "### MODULE SOURCE\n```ts\n" + source.strip() + "\n```",
        "### ATTACHED MEDIA\n" + (media_note or "6 screenshots (ext-1, ext-2, ext-3, int-1, int-2, int-3) and 2 walkthrough videos (ext, int)."),
    ])
    return CRITIC, task


def patch_prompt(d: Department, *, issues: list[dict[str, Any]], keep: list[str], failed_probes: list[dict[str, Any]],
                 tsc_errors: str, source: str, with_context: bool) -> tuple[str, str]:
    """When the critic's interaction id is used (previous_interaction_id), the screenshots carry over, but the
    rules and KIT API are re-attached so the patch is self-contained either way."""
    body = [PATCH.format(dept=d.id),
            "ISSUES: " + json.dumps(issues, indent=1),
            "KEEP: " + json.dumps(keep),
            "PROBE FAILURES: " + json.dumps(failed_probes, indent=1),
            "TSC ERRORS: " + (tsc_errors.strip() or "none"),
            "CURRENT SOURCE:\n```ts\n" + source.strip() + "\n```"]
    rules = ["### KIT API\n```ts\n" + kit_api().strip() + "\n```",
             "### PROPS LIBRARY\n" + props_table(),
             "### RULES\n" + building_rules(), NOTES,
             art_direction(),
             "### BUILDING\n" + building_entry(d)]
    if not with_context:
        rules.append("### DESIGN.md\n" + design_md().strip())
    system = ("You are the world builder for Foundry. You fix one building module at a time. Output exactly one FILE "
              "block and nothing else. The module must import only from '../../kit/types' and default-export a "
              "BuildingModule. No DOM, no network, no randomness except k.rand().")
    return system, "\n\n".join(body + rules)
