# OWNER: ayan
"""Reference image for the generation prompt (05-world/09: convert reference-bedroom.webp to PNG with Pillow)."""
from __future__ import annotations

from pathlib import Path

from ..contracts import Part
from . import paths
from .media import webp_to_png

REFERENCE_PNG = paths.ASSETS_DIR / "reference-bedroom.png"


def reference_png() -> Path | None:
    if REFERENCE_PNG.exists():
        return REFERENCE_PNG
    if not paths.REFERENCE_WEBP.exists():
        return None
    return webp_to_png(paths.REFERENCE_WEBP, REFERENCE_PNG)


def reference_part() -> Part | None:
    png = reference_png()
    return Part(kind="image", data=png.read_bytes(), mime="image/png") if png else None
