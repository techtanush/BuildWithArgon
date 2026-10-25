# OWNER: ayan
"""One-pass generation of the 13 building modules (05-world/09 §Generation prompt; acceptance G-01).
Job worldgen_buildings (Argon high, long decode, 524k output). Missing, truncated or statically invalid
buildings are regenerated one at a time with job worldgen_building, given the other buildings' exterior
sections as consistency context. Everything is recorded under runs/<run_id>/ (prompt.md, output.txt,
modules/iter-0/<dept>.ts, generation.json)."""
from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Any

from ..contracts import Part
from . import paths, prompts
from .assets import reference_part
from .runs import Recorder, write_json
from .validate import parse_file_blocks, static_check


def exterior_section(source: str) -> str:
    """The buildExterior(...) body of a module (consistency context for single-building regeneration)."""
    m = re.search(r"buildExterior\s*\(\s*k[^)]*\)\s*\{", source)
    if not m:
        return ""
    depth, i = 1, m.end()
    while i < len(source) and depth:
        depth += {"{": 1, "}": -1}.get(source[i], 0)
        i += 1
    return source[m.start():i]


def _refs() -> list[Part]:
    return [p for p in [reference_part(), *prompts.art_reference_images()] if p is not None]


def _parts(task: str) -> str | list[Part]:
    refs = _refs()
    return [Part(kind="text", text=task), *refs] if refs else task


DESCRIBE = ("These images are the visual references for a photoreal 3D company town (the first is a composition "
            "reference for interiors: layout and coziness only; any others are the founder's art-direction references for "
            "exteriors). Write a precise brief (<= 400 words) a 3D environment artist could follow without seeing them: "
            "composition, layout density, architecture (massing, façade rhythm, materials, details), street furniture, "
            "vegetation, light and color. Bullet points, no preamble.")


async def reference_brief(llm: Any) -> str:
    """Background (long-decode) calls run on gemini-4-argon-agent, which rejects image input (verified 2026-10-25),
    so the one-pass prompt carries a text brief of the reference images written by a normal Argon call. Cached in
    assets/reference-brief.md keyed by the images' hash."""
    import hashlib

    refs = _refs()
    if not refs:
        return ""
    key = hashlib.sha256(b"".join(p.data or b"" for p in refs)).hexdigest()[:16]
    cache = paths.ASSETS_DIR / "reference-brief.md"
    if cache.exists() and cache.read_text().startswith(f"<!-- {key} -->"):
        return cache.read_text().split("\n", 1)[1]
    res = await llm.generate("worldgen_building", [Part(kind="text", text=DESCRIBE), *refs])  # world architect's job
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(f"<!-- {key} -->\n{res.text.strip()}\n")
    return res.text.strip()


async def generate_all(llm: Any, run_dir: Path, recorder: Recorder, *, run_id: str,
                       only: list[str] | None = None) -> dict[str, Any]:
    """Iteration 0. Returns {"modules": {dept: src}, "regenerated": [...], "missing": [...], tokens/cost}."""
    depts = [d for d in paths.departments() if not only or d.id in only]
    system, task = prompts.generation_prompt(depts)
    (run_dir / "prompt.md").write_text(f"### SYSTEM\n{system}\n\n### TASK\n{task}\n")
    started = time.monotonic()
    tokens = {"in": 0, "out": 0}
    cost = 0.0
    await recorder.progress(step="generate", status="running", run_id=run_id, note=f"{len(depts)} buildings, one pass")

    async def note(msg: str) -> None:
        await recorder.progress(step="generate", status="running", run_id=run_id, note=msg)

    job = "worldgen_buildings" if len(depts) > 1 else "worldgen_building"
    if job == "worldgen_buildings":  # long decode: text-only input
        brief = await reference_brief(llm)
        if brief:
            task = task.replace("(attached: reference-bedroom.png;", "(described below — the long-decode model takes text only;")
            task += "\n\n### REFERENCE IMAGES — DESCRIBED\n" + brief
            (run_dir / "prompt.md").write_text(f"### SYSTEM\n{system}\n\n### TASK\n{task}\n")
        res = await llm.generate(job, task, system=system, on_progress=note)
    else:
        res = await llm.generate(job, _parts(task), system=system, on_progress=note)
    (run_dir / "output.txt").write_text(res.text)
    tokens["in"] += res.tokens_in
    tokens["out"] += res.tokens_out
    cost += res.cost_usd
    parsed = parse_file_blocks(res.text)
    modules = {d.id: parsed.modules[d.id] for d in depts if d.id in parsed.modules}
    regen = [d for d in depts if d.id not in modules or static_check(d.id, modules[d.id])]
    record: dict[str, Any] = {"job": job, "interaction_id": res.interaction_id, "model": res.model,
                              "one_pass": sorted(modules), "truncated": parsed.truncated, "stray_paths": parsed.stray,
                              "static_errors_one_pass": {d: static_check(d, s) for d, s in modules.items() if static_check(d, s)},
                              "regenerated": {}}
    await recorder.progress(step="generate", status="done", run_id=run_id,
                            note=f"one pass produced {len(modules)}/{len(depts)}; regenerating {len(regen)}")

    for d in regen:
        context = {k: exterior_section(v) for k, v in modules.items() if k != d.id}
        sys1, task1 = prompts.generation_prompt([d], consistency=context)
        await recorder.progress(step="generate_one", status="running", department_id=d.id, run_id=run_id)
        try:
            r1 = await llm.generate("worldgen_building", _parts(task1), system=sys1)
        except Exception as exc:  # noqa: BLE001 — record and keep going; the building falls back
            record["regenerated"][d.id] = {"ok": False, "error": str(exc)[:500]}
            await recorder.progress(step="generate_one", status="failed", department_id=d.id, run_id=run_id, note=str(exc)[:200])
            continue
        tokens["in"] += r1.tokens_in
        tokens["out"] += r1.tokens_out
        cost += r1.cost_usd
        (run_dir / "regenerate").mkdir(exist_ok=True)
        (run_dir / "regenerate" / f"{d.id}.txt").write_text(r1.text)
        p1 = parse_file_blocks(r1.text)
        src = p1.modules.get(d.id) or (next(iter(p1.modules.values())) if len(p1.modules) == 1 else None)
        if src:
            modules[d.id] = src
        record["regenerated"][d.id] = {"ok": bool(src), "interaction_id": r1.interaction_id,
                                       "static_errors": static_check(d.id, src) if src else ["no FILE block"]}
        await recorder.progress(step="generate_one", status="done" if src else "failed", department_id=d.id, run_id=run_id)

    out_dir = run_dir / "modules" / "iter-0"
    out_dir.mkdir(parents=True, exist_ok=True)
    for dept, src in modules.items():
        (out_dir / f"{dept}.ts").write_text(src)
    record.update({"generated": sorted(modules), "missing": sorted(d.id for d in depts if d.id not in modules),
                   "tokens": tokens, "cost_usd": round(cost, 4), "wall_seconds": round(time.monotonic() - started, 1)})
    write_json(run_dir / "generation.json", record)
    return {"modules": modules, **record}
