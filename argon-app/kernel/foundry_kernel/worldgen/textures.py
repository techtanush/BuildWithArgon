# OWNER: ayan
"""Nano Banana image assets (02-models-and-integrations/07-nano-banana-assets.md, as changed by ADR-018):
- realistic building signs -> web/public/generated/signs/<dept>.png (1536×384, legibility-checked by Flash);
- optional portrait polish of avatar renders (12-photoreal-look.md §8: identity unchanged).
Tileable textures are no longer generated (scanned CC0 PBR sets come from Karthik's asset pipeline).
Every call is recorded in kernel/data/worldgen/assets/<timestamp>/manifest.json."""
from __future__ import annotations

import io
import re
from pathlib import Path
from typing import Any

from PIL import Image

from ..contracts import Part
from ..ids import utc_now
from . import paths
from .runs import write_json

SIGN_SIZE = (1536, 384)
PORTRAIT_SIZE = (768, 768)
COLOR_NAMES = {"#E07A3F": "warm orange", "#C9A227": "antique gold", "#3E7CB1": "steel blue", "#4FA3A5": "teal",
               "#5FA35F": "leaf green", "#8E6CC4": "lavender purple", "#D0573F": "brick red-orange",
               "#E3B341": "sunflower yellow", "#6B7FA8": "slate blue", "#C2477A": "magenta rose",
               "#2F8F6B": "emerald green", "#38A3C9": "sky blue", "#6C7A99": "slate grey-blue"}

SIGN_PROMPT = ("A real painted wooden shop sign for a building in a prosperous town, photographed straight-on in natural "
               "daylight, subtle real-world wear. The words \"{building}\" in large, perfectly spelled, legible serif "
               "lettering, and a small subtitle \"{department}\" below. Warm cream painted background with a thin "
               "{color} border, real wood grain and a carved frame, front-on with no perspective, filling the whole "
               "wide 4:1 frame. No other text, no logos, no watermark, no wall or surroundings.")
POLISH_PROMPT = ("Photographic studio headshot of this exact person: same face, hair, skin tone, clothing and accessories. "
                 "Do not change identity. Head and shoulders, 3/4 view, soft three-point studio light, neutral "
                 "background in {color}, natural skin texture, 85 mm lens look. No text, no watermark.")


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def to_png(data: bytes, size: tuple[int, int]) -> bytes:
    """Center-crop to the target aspect, resize, PNG (Nano Banana returns JPEG)."""
    img = Image.open(io.BytesIO(data)).convert("RGB")
    tw, th = size
    target = tw / th
    w, h = img.size
    if w / h > target:
        nw = int(h * target)
        img = img.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = int(w / target)
        img = img.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    img = img.resize(size, Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()


async def legible(llm: Any, png: bytes, expected: str) -> tuple[bool, str]:
    res = await llm.generate("sign_check", [Part(kind="image", data=png, mime="image/png"),
                                            Part(kind="text", text="What text is on this sign? Reply with the text only.")])
    seen = _norm(res.text)
    return _norm(expected) in seen, res.text.strip()[:200]


async def make_signs(llm: Any, *, only: list[str] | None = None, retries: int = 2, out_dir: Path | None = None) -> dict[str, Any]:
    out_dir = out_dir or paths.PUBLIC_GENERATED / "signs"
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = utc_now().replace(":", "").replace("-", "").split(".")[0]
    log: dict[str, Any] = {"at": utc_now(), "job": "sign", "signs": {}}
    for d in paths.departments():
        if only and d.id not in only:
            continue
        prompt = SIGN_PROMPT.format(building=d.building_name, department=d.name, color=COLOR_NAMES.get(d.color.upper(), d.color))
        attempts: list[dict[str, Any]] = []
        written = False
        for attempt in range(retries + 1):
            try:
                res = await llm.generate_images("sign", prompt)
            except Exception as exc:  # noqa: BLE001 — record; the world falls back to a canvas sign
                attempts.append({"attempt": attempt, "error": str(exc)[:300]})
                continue
            if not res.images:
                attempts.append({"attempt": attempt, "error": "no image returned"})
                continue
            png = to_png(res.images[0][0], SIGN_SIZE)
            ok, seen = await legible(llm, png, d.building_name)
            attempts.append({"attempt": attempt, "mime": res.images[0][1], "legible": ok, "read_as": seen,
                             "interaction_id": res.interaction_id})
            if ok or attempt == retries:
                if ok:
                    (out_dir / f"{d.id}.png").write_bytes(png)
                    written = True
                break
        log["signs"][d.id] = {"prompt": prompt, "written": written, "attempts": attempts}
        print(f"[worldgen] sign {d.id}: {'ok' if written else 'FAILED (canvas fallback)'}", flush=True)
    write_json(paths.ASSETS_DIR / stamp / "manifest.json", log)
    return log


async def polish_portraits(llm: Any, *, portraits_dir: Path | None = None, only: list[str] | None = None) -> dict[str, Any]:
    """Optional Nano Banana polish of rendered portraits, keeping the raw render as <id>.render.png."""
    portraits_dir = portraits_dir or paths.PUBLIC_GENERATED / "portraits"
    roster = paths.roster()
    colors = {d["id"]: d["color"] for d in roster["departments"]}
    log: dict[str, Any] = {"at": utc_now(), "job": "portrait", "portraits": {}}
    for a in roster["agents"]:
        if only and a["id"] not in only:
            continue
        src = portraits_dir / f"{a['id']}.png"
        if not src.exists():
            continue
        raw = portraits_dir / f"{a['id']}.render.png"
        if not raw.exists():
            raw.write_bytes(src.read_bytes())
        try:
            res = await llm.generate_images("portrait", POLISH_PROMPT.format(color=COLOR_NAMES.get(colors[a["department_id"]].upper(), "soft grey")),
                                            reference_images=[Part(kind="image", data=raw.read_bytes(), mime="image/png")])
        except Exception as exc:  # noqa: BLE001
            log["portraits"][a["id"]] = {"ok": False, "error": str(exc)[:300]}
            continue
        if res.images:
            src.write_bytes(to_png(res.images[0][0], PORTRAIT_SIZE))
        log["portraits"][a["id"]] = {"ok": bool(res.images), "interaction_id": res.interaction_id}
    stamp = utc_now().replace(":", "").replace("-", "").split(".")[0]
    write_json(paths.ASSETS_DIR / stamp / "portraits.json", log)
    return log
