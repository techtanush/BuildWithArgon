# OWNER: ayan
"""Critique and patch (05-world/10 §4–5, 13 §5; acceptance G-06). The critic (job worldgen_critic, Argon high —
or worldgen_critic_fast in the live round) watches the two walkthrough videos as video parts (fallback: the 8
frames per video that capture.ts samples), looks at the 6 screenshots, the probe report, tsc errors and the
module source, and returns scores + issues + keep. The patch (job worldgen_patch / worldgen_patch_fast) continues
from the critic's interaction (previous_interaction_id) and returns one FILE block."""
from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any, Literal

from PIL import Image
from pydantic import BaseModel, Field, field_validator

from ..contracts import Part
from ..llm.client import LLMCallError, video_part
from . import paths, prompts
from .paths import Department
from .runs import write_json
from .validate import parse_file_blocks, static_check

SCORE_KEYS = ("realism", "department_identity", "composition", "readability", "craft")


class CriticScores(BaseModel):
    realism: float = Field(ge=1, le=10)
    department_identity: float = Field(ge=1, le=10)
    composition: float = Field(ge=1, le=10)
    readability: float = Field(ge=1, le=10)
    craft: float = Field(ge=1, le=10)


class CriticIssue(BaseModel):
    severity: Literal["high", "medium", "low"] = "medium"
    where: str = ""
    camera: str = ""
    description: str
    fix: str = ""

    @field_validator("severity", mode="before")
    @classmethod
    def _sev(cls, v: Any) -> str:
        v = str(v or "medium").lower()
        return v if v in ("high", "medium", "low") else "medium"


class CriticOut(BaseModel):
    scores: CriticScores
    issues: list[CriticIssue] = Field(default_factory=list)
    keep: list[str] = Field(default_factory=list)


def _think(level: str | None) -> dict[str, Any]:
    return {"thinking_level": level} if level else {}


def visual_score(scores: dict[str, float]) -> float:
    return round(sum(float(scores[k]) for k in SCORE_KEYS) / len(SCORE_KEYS) / 10, 4)


def _jpeg(path: Path, max_side: int = 1280) -> bytes:
    img = Image.open(path).convert("RGB")
    img.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)
    return buf.getvalue()


def media_parts(report: dict[str, Any], root: Path, *, use_video: bool) -> tuple[list[Part], dict[str, Any]]:
    """Screenshots (JPEG) + videos (webm parts) or the 8 sampled frames per video; returns (parts, inputs record)."""
    parts: list[Part] = []
    rec: dict[str, Any] = {"screenshots": [], "videos": [], "frames": [], "video_input": False}
    for cam in paths.CAMERAS:
        rel = (report.get("screenshots") or {}).get(cam)
        if rel and (root / rel).exists():
            parts += [Part(kind="text", text=f"Screenshot {cam}:"), Part(kind="image", data=_jpeg(root / rel), mime="image/jpeg")]
            rec["screenshots"].append(rel)
    videos = report.get("videos") or {}
    if use_video and videos:
        for key in ("ext", "int"):
            rel = videos.get(key)
            if rel and (root / rel).exists():
                lead = float((report.get("video_lead_in_s") or {}).get(key, 0) or 0)
                lead_note = f" The first {lead:.1f} s show the page loading; judge only what follows." if lead > 0.5 else ""
                parts += [Part(kind="text", text=f"Walkthrough video {key}-video ({'exterior orbit' if key == 'ext' else 'interior walk'}).{lead_note}"),
                          video_part((root / rel).read_bytes(), "video/webm")]
                rec["videos"].append(rel)
        rec["video_input"] = bool(rec["videos"])
    if not rec["video_input"]:
        for rel in report.get("frames") or []:
            if (root / rel).exists():
                parts += [Part(kind="text", text=f"Walkthrough frame {Path(rel).stem}:"),
                          Part(kind="image", data=_jpeg(root / rel, 960), mime="image/jpeg")]
                rec["frames"].append(rel)
    return parts, rec


def ensure_probe_issues(out: CriticOut, report: dict[str, Any]) -> CriticOut:
    """Every failed probe must appear as a high-severity issue (10 §4) — add one when the critic omitted it."""
    text = " ".join(f"{i.description} {i.fix}" for i in out.issues if i.severity == "high")
    for p in report.get("probes", []):
        if not p.get("pass") and p.get("id") not in text:
            where = "interior" if p["id"] in ("P4", "P5") else "exterior" if p["id"] in ("P3", "P10") else ""
            out.issues.append(CriticIssue(severity="high", where=where, camera="",
                                          description=f"{p['id']} failed: {p.get('details', '')}",
                                          fix=f"Change the kit calls so probe {p['id']} passes ({p.get('details', '')})."))
    return out


async def critique(llm: Any, d: Department, *, report: dict[str, Any], root: Path, source: str, tsc_errors: str = "",
                   job: str = "worldgen_critic", thinking_level: str | None = None,
                   out_file: Path | None = None) -> dict[str, Any]:
    """Returns {"scores", "issues", "keep", "visual_score", "realism", "interaction_id", "inputs"}; writes out_file."""
    parts, rec = media_parts(report, root, use_video=True)
    note = (f"{len(rec['screenshots'])} screenshots, " + (f"{len(rec['videos'])} walkthrough videos" if rec["video_input"]
            else f"{len(rec['frames'])} walkthrough frames (video fallback)"))
    system, task = prompts.critic_prompt(d, probe_report=report, source=source, tsc_errors=tsc_errors, media_note=note)
    try:
        out, res = await llm.generate_json(job, [Part(kind="text", text=task), *parts], CriticOut, system=system,
                                           **_think(thinking_level))
    except LLMCallError as exc:
        if not rec["video_input"] or exc.status_code not in (400, 413, 415, 422):
            raise
        parts, rec = media_parts(report, root, use_video=False)
        rec["video_error"] = str(exc)[:300]
        note = f"{len(rec['screenshots'])} screenshots, {len(rec['frames'])} walkthrough frames (video fallback)"
        system, task = prompts.critic_prompt(d, probe_report=report, source=source, tsc_errors=tsc_errors, media_note=note)
        out, res = await llm.generate_json(job, [Part(kind="text", text=task), *parts], CriticOut, system=system,
                                           **_think(thinking_level))
    out = ensure_probe_issues(out, report)
    scores = out.scores.model_dump()
    result = {"scores": scores, "issues": [i.model_dump() for i in out.issues], "keep": out.keep,
              "visual_score": visual_score(scores), "realism": round(scores["realism"] / 10, 4),
              "interaction_id": res.interaction_id, "model": res.model, "job": job, "thinking_level": thinking_level,
              "tokens": {"in": res.tokens_in, "out": res.tokens_out}, "cost_usd": res.cost_usd,
              "inputs": {**rec, "probe_score": report.get("probe_score"), "tsc_errors": bool(tsc_errors.strip())}}
    if out_file:
        write_json(out_file, result)
    return result


def needs_patch(report: dict[str, Any], critic: dict[str, Any] | None) -> bool:
    if any(not p.get("pass") for p in report.get("probes", [])):
        return True
    return any(i.get("severity") == "high" for i in (critic or {}).get("issues", []))


async def patch(llm: Any, d: Department, *, source: str, critic: dict[str, Any], report: dict[str, Any],
                tsc_errors: str = "", job: str = "worldgen_patch", thinking_level: str | None = None,
                out_file: Path | None = None) -> dict[str, Any]:
    """Returns {"source": str | None, "static_errors": [...], "interaction_id", "repaired": bool, ...}."""
    failed = [p for p in report.get("probes", []) if not p.get("pass")]
    prev = critic.get("interaction_id")
    system, task = prompts.patch_prompt(d, issues=critic.get("issues", []), keep=critic.get("keep", []),
                                        failed_probes=failed, tsc_errors=tsc_errors, source=source, with_context=bool(prev))
    try:
        res = await llm.generate(job, task, system=system, previous_interaction_id=prev, **_think(thinking_level))
    except LLMCallError:
        if not prev:
            raise
        system, task = prompts.patch_prompt(d, issues=critic.get("issues", []), keep=critic.get("keep", []),
                                            failed_probes=failed, tsc_errors=tsc_errors, source=source, with_context=False)
        res = await llm.generate(job, task, system=system, **_think(thinking_level))
    record: dict[str, Any] = {"job": job, "interaction_id": res.interaction_id, "previous_interaction_id": prev,
                              "tokens": {"in": res.tokens_in, "out": res.tokens_out}, "cost_usd": res.cost_usd, "repaired": False}
    new_src = extract_module(res.text, d.id)
    errors = static_check(d.id, new_src) if new_src else ["no FILE block in the patch output"]
    if errors:  # one repair, continuing the patch interaction
        fix = ("Your module breaks these rules: " + json.dumps(errors) + f". Output exactly one corrected FILE block for "
               f"{paths.module_path(d.id)} and nothing else.")
        res2 = await llm.generate(job, fix, system=system, previous_interaction_id=res.interaction_id, **_think(thinking_level))
        new_src = extract_module(res2.text, d.id)
        errors = static_check(d.id, new_src) if new_src else ["no FILE block in the repair output"]
        record.update({"repaired": True, "repair_interaction_id": res2.interaction_id})
        record["tokens"]["in"] += res2.tokens_in
        record["tokens"]["out"] += res2.tokens_out
        record["cost_usd"] += res2.cost_usd
    record.update({"source": new_src if not errors else None, "static_errors": errors})
    if out_file:
        write_json(out_file, {k: v for k, v in record.items() if k != "source"})
    return record


def extract_module(text: str, dept: str) -> str | None:
    parsed = parse_file_blocks(text)
    if dept in parsed.modules:
        return parsed.modules[dept]
    if len(parsed.modules) == 1:
        return next(iter(parsed.modules.values()))
    return None
