# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.

"""Smoke tests S1–S7 + video input (02-models-and-integrations/02-gemini-interactions-api.md §Smoke tests).
Run: uv run python -m foundry_kernel.llm.smoke basic|json|long|image|audio|agent|banana|video|deep|all
Each prints PASS/FAIL, latency and tokens. Outputs (images/audio/video) go to data/smoke/."""
from __future__ import annotations

import asyncio
import re
import sys
import time
from collections.abc import Awaitable, Callable

from PIL import Image, ImageDraw
from pydantic import BaseModel

from ..config import get_settings
from ..contracts import LLMResult, Part
from ..models import ARGON
from ..worldgen.media import frames_to_webm, png_bytes
from .client import LLMClient, video_part

OUT = get_settings().data_dir / "smoke"


def _line(sid: str, ok: bool, res: LLMResult | None, note: str = "") -> bool:
    stats = f"{res.latency_ms}ms in={res.tokens_in} out={res.tokens_out} ${res.cost_usd:.4f}" if res else ""
    print(f"{sid} {'PASS' if ok else 'FAIL'} {stats} {note}".rstrip(), flush=True)
    return ok


def _client() -> LLMClient:
    return LLMClient(get_settings())


async def basic() -> bool:
    res = await _client().generate("talk", "Reply with exactly: OK")
    argon = await _client().generate("cos_report", "Reply with exactly: OK")
    ok = "OK" in res.text and "OK" in argon.text and argon.latency_ms < 30_000
    return _line("S1", ok, argon, f"argon={argon.text[:20]!r} flash={res.text[:20]!r}")


class _Ok(BaseModel):
    ok: bool


async def json_() -> bool:
    model, res = await _client().generate_json("triage", 'Return exactly this JSON object: {"ok": true}', _Ok)
    return _line("S2", bool(model.ok), res)  # type: ignore[attr-defined]


async def long() -> bool:
    started = time.monotonic()

    async def progress(msg: str) -> None:
        print("  ..", msg, flush=True)

    res = await _client().generate(
        "eval_baseline",
        "Write ONE complete TypeScript file `src/catalog.ts` containing 700 distinct, fully implemented exported "
        "utility functions for an inventory app, numbered in comments `// 1.` to `// 700.`. Each function has a JSDoc "
        "block (purpose, params, returns, one example) and a real 8-15 line implementation. Write all 700 — no "
        "placeholders, no ellipses, no 'and so on', no early stop. Output only the file.",
        system="Long decode is enabled for this request: your output budget is 262,144 tokens, far more than this task "
               "needs. Never shorten, batch or refuse because of length; produce the entire file in this response.",
        on_progress=progress)
    lines = len(re.findall(r"^\s*//\s*\d+\.", res.text, re.MULTILINE))
    minutes = (time.monotonic() - started) / 60
    return _line("S3", res.tokens_out >= 70_000, res, f"lines={lines} minutes={minutes:.1f} status={res.raw_status}")


async def image() -> bool:
    img = Image.new("RGB", (256, 256), "white")
    ImageDraw.Draw(img).ellipse([48, 48, 208, 208], fill=(220, 30, 30))
    res = await _client().generate("qa_analyze", [Part(kind="image", data=png_bytes(img), mime="image/png"),
                                                  Part(kind="text", text="What shape and color is in this image? Answer in 5 words.")])
    ok = "red" in res.text.lower() and ("circle" in res.text.lower() or "dot" in res.text.lower() or "round" in res.text.lower())
    return _line("S4", ok, res, repr(res.text[:80]))


async def audio() -> bool:
    phrase = "The foundry ships on Tuesday"
    tts = await _client().generate("tts_fallback", f"Say clearly: {phrase}")
    if not tts.audio:
        return _line("S5", False, tts, "TTS returned no audio (cannot build the fixture)")
    data, mime = tts.audio[0]
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "s5.audio").write_bytes(data)
    mime = mime.split(";")[0] if mime.startswith("audio/") and "l16" not in mime.lower() else mime
    if "l16" in mime.lower() or "pcm" in mime.lower():  # raw PCM -> wrap as WAV
        import io
        import wave

        rate = int(re.search(r"rate=(\d+)", mime).group(1)) if "rate=" in mime else 24000  # type: ignore[union-attr]
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(data)
        data, mime = buf.getvalue(), "audio/wav"
    res = await _client().generate("transcribe", [Part(kind="audio", data=data, mime=mime),
                                                  Part(kind="text", text="Transcribe this audio. Return only the words.")])
    words = set(re.findall(r"[a-z]+", res.text.lower()))
    ok = {"foundry", "tuesday"} <= words
    return _line("S5", ok, res, f"tts_mime={tts.audio[0][1]} transcript={res.text[:60]!r}")


async def agent() -> bool:
    s = get_settings()
    res = await _client().run_agent(agent=s.antigravity_agent, agent_config={"type": "antigravity", "model": ARGON},
                                    prompt="In your sandbox run the shell command `echo hello` and report its exact output on the last line.",
                                    environment="remote", background=True)
    return _line("S6", "hello" in res.text.lower(), res, f"interaction={res.interaction_id} tail={res.text[-80:]!r}")


async def banana() -> bool:
    res = await _client().generate_images("sign", "A small square photo of a red apple on a wooden table, 1:1.")
    if not res.images:
        return _line("S7", False, res, "no image parts in output")
    data, mime = res.images[0]
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / ("s7.png" if "png" in mime else "s7.img")
    path.write_bytes(data)
    import io

    w, h = Image.open(io.BytesIO(data)).size
    return _line("S7", True, res, f"{mime} {w}x{h} -> {path}")


async def video() -> bool:
    frames = []
    for i in range(30):
        im = Image.new("RGB", (480, 270), (25, 30, 60))
        ImageDraw.Draw(im).ellipse([20 + i * 14, 110, 70 + i * 14, 160], fill=(240, 80, 40))
        frames.append(im)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "s-video.webm"
    if not frames_to_webm(frames, path):
        print("SV FAIL no ffmpeg available to build the fixture")
        return False
    res = await _client().generate("worldgen_critic_fast", [video_part(path.read_bytes(), "video/webm"),
                                                            Part(kind="text", text="In this video, which direction does the orange ball move: left-to-right or right-to-left? Answer with one of those two phrases.")])
    return _line("SV", "left-to-right" in res.text.lower().replace(" to ", "-to-"), res, f"video input: {res.text[:60]!r}")


async def deep() -> bool:
    res = await _client().run_agent(agent="deep-research-preview-04-2026", agent_config={"type": "deep-research"},
                                    prompt="In 3 bullet points with source URLs: what is the Gemini Interactions API?",
                                    environment="", background=True)
    return _line("SD", "http" in res.text, res, f"chars={len(res.text)}")


TESTS: dict[str, Callable[[], Awaitable[bool]]] = {"basic": basic, "json": json_, "image": image, "audio": audio,
                                                   "banana": banana, "video": video, "agent": agent, "long": long, "deep": deep}
ALL = ["basic", "json", "image", "audio", "banana", "video", "agent", "long"]


async def run(names: list[str]) -> int:
    failed = 0
    for name in names:
        try:
            ok = await TESTS[name]()
        except Exception as exc:  # noqa: BLE001 — a smoke test reports, never crashes the batch
            print(f"{name} FAIL {type(exc).__name__}: {str(exc)[:300]}", flush=True)
            ok = False
        failed += 0 if ok else 1
    return failed


def main(argv: list[str]) -> int:
    arg = argv[0] if argv else "basic"
    names = ALL if arg == "all" else [arg]
    if any(n not in TESTS for n in names):
        print(f"usage: python -m foundry_kernel.llm.smoke {'|'.join([*TESTS, 'all'])}")
        return 2
    return 1 if asyncio.run(run(names)) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
