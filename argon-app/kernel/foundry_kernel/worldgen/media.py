# OWNER: ayan
"""Small image/video helpers shared by worldgen and the smoke tests (Pillow + an ffmpeg binary).
ffmpeg: $FFMPEG, then PATH, then the copy Playwright downloads (~/Library/Caches/ms-playwright/ffmpeg-*)."""
from __future__ import annotations

import io
import os
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageStat


def find_ffmpeg() -> str | None:
    env = os.environ.get("FFMPEG")
    if env and Path(env).exists():
        return env
    found = shutil.which("ffmpeg")
    if found:
        return found
    for root in (Path.home() / "Library" / "Caches" / "ms-playwright", Path.home() / ".cache" / "ms-playwright"):
        for cand in sorted(root.glob("ffmpeg-*/ffmpeg*"), reverse=True):
            if cand.is_file() and os.access(cand, os.X_OK):
                return str(cand)
    return None


def webm_encoder(ffmpeg: str) -> str | None:
    """Playwright's ffmpeg builds differ (libvpx = VP8 in older builds, libvpx-vp9 in newer ones)."""
    out = subprocess.run([ffmpeg, "-hide_banner", "-encoders"], capture_output=True, text=True, check=False).stdout
    names = {line.split()[1] for line in out.splitlines() if len(line.split()) > 1}
    return next((e for e in ("libvpx-vp9", "libvpx", "vp8", "vp9") if e in names), None)


def frames_to_webm(frames: list[Image.Image], out: Path, fps: int = 10) -> bool:
    """Encode PIL frames to a webm (VP9 or VP8). Returns False when no ffmpeg is available."""
    ffmpeg = find_ffmpeg()
    encoder = webm_encoder(ffmpeg) if ffmpeg else None
    if not ffmpeg or not encoder or not frames:
        return False
    out.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen([ffmpeg, "-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", str(fps),
                             "-i", "pipe:0", "-c:v", encoder, "-b:v", "800k", str(out)], stdin=subprocess.PIPE)
    assert proc.stdin is not None
    for f in frames:
        buf = io.BytesIO()
        f.convert("RGB").save(buf, "JPEG", quality=90)
        proc.stdin.write(buf.getvalue())
    proc.stdin.close()
    return proc.wait(timeout=120) == 0 and out.exists()


def webp_to_png(src: Path, dst: Path, max_side: int = 1536) -> Path:
    img = Image.open(src).convert("RGB")
    img.thumbnail((max_side, max_side))
    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(dst, "PNG")
    return dst


def nonblank(png: bytes | Path) -> tuple[bool, str]:
    """P9: luminance std-dev > 12 and no single color > 90% of pixels."""
    img = Image.open(io.BytesIO(png) if isinstance(png, bytes) else png).convert("RGB")
    small = img.resize((min(320, img.width), min(180, img.height)))
    std = ImageStat.Stat(small.convert("L")).stddev[0]
    colors = small.getcolors(maxcolors=small.width * small.height) or []
    top = max((c for c, _ in colors), default=0) / max(1, small.width * small.height)
    ok = std > 12 and top <= 0.9
    return ok, f"luminance std {std:.1f}, top color {top:.0%}"


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()
