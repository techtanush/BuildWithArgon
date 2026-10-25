# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.

"""`foundry-worldgen` — 05-world/09-worldgen-pipeline.md §CLI.

  foundry-worldgen faces                          FaceSpecs (Argon) -> kernel/data/faces.json
  foundry-worldgen signs [--only a,b]             Nano Banana realistic signs -> web/public/generated/signs/
  foundry-worldgen portraits --from-renders [--polish] [--url URL]
                                                  avatar headshots from the capture page -> web/public/generated/portraits/
  foundry-worldgen buildings [--only a,b]         one-pass generation of 13 modules (iteration 0)
  foundry-worldgen loop [--max-iter 4] [--url URL] [--run wgr_..] [--fake-capture] [--fast] [--no-video] [--gpu]
                                                  render -> probe -> critique -> patch, keeps best per building
  foundry-worldgen fallbacks [--url URL]          capture the hand-written fallbacks once (--source fallback; G-04)
  foundry-worldgen all | --all                    faces, signs, buildings, loop, portraits (in that order)
  foundry-worldgen report                         score table of the latest run -> evals/results/world-<ts>.json

The loop captures from a running web dev server: --url (e.g. http://localhost:5173), else capture.ts starts vite
on :5199. LLM_MODE=fake uses FakeLLM fixtures; --fake-capture renders against scripts/fixtures/fake-capture.html."""
from __future__ import annotations

import argparse
import asyncio
import sys
from typing import Any

from ..config import get_settings
from ..ids import new_id
from ..llm.client import build_llm_client
from . import paths
from .runs import open_db


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="foundry-worldgen", description="Argon world generation + render/critique loop")
    p.add_argument("--all", action="store_true", help="alias for `all`")
    sub = p.add_subparsers(dest="cmd")
    sub.add_parser("faces")
    s = sub.add_parser("signs")
    s.add_argument("--only", default="")
    s = sub.add_parser("portraits")
    s.add_argument("--from-renders", action="store_true", required=True)
    s.add_argument("--polish", action="store_true", help="Nano Banana polish with the render as reference")
    s.add_argument("--url")
    s.add_argument("--agents", default="")
    s.add_argument("--fake-capture", action="store_true")
    s = sub.add_parser("buildings")
    s.add_argument("--only", default="")
    for name in ("loop", "all"):
        s = sub.add_parser(name)
        s.add_argument("--max-iter", type=int, default=4)
        s.add_argument("--url")
        s.add_argument("--run")
        s.add_argument("--only", default="")
        s.add_argument("--fake-capture", action="store_true")
        s.add_argument("--fast", action="store_true")
        s.add_argument("--no-video", action="store_true")
        s.add_argument("--gpu", action="store_true")
        s.add_argument("--concurrency", type=int, default=4)
    s = sub.add_parser("fallbacks")
    s.add_argument("--url")
    s.add_argument("--fake-capture", action="store_true")
    sub.add_parser("report")
    return p


def _only(v: str) -> list[str] | None:
    items = [x.strip() for x in (v or "").split(",") if x.strip()]
    unknown = [x for x in items if x not in paths.department_ids()]
    if unknown:
        raise SystemExit(f"unknown department id(s): {', '.join(unknown)}")
    return items or None


async def _faces(llm: Any) -> None:
    from .faces import generate_faces

    out = await generate_faces(llm)
    print(f"faces.json: {len(out['faces'])} specs, fallback for {len(out['fallback'])}: {out['fallback']}; "
          f"variety warnings: {len(out['variety_warnings'])}")


async def _signs(llm: Any, only: list[str] | None) -> None:
    from .textures import make_signs

    log = await make_signs(llm, only=only)
    ok = sum(1 for s in log["signs"].values() if s["written"])
    print(f"signs: {ok}/{len(log['signs'])} written")


async def _portraits(llm: Any, a: argparse.Namespace) -> None:
    from .capture import run_portraits
    from .textures import polish_portraits

    agents = [x for x in (a.agents or "").split(",") if x]
    res = await run_portraits(out_dir=paths.PUBLIC_GENERATED / "portraits", agents=agents or None, url=a.url, fake=a.fake_capture)
    ok = sum(1 for v in res.values() if v.get("ok"))
    print(f"portraits: {ok}/{len(res)} rendered")
    if a.polish and ok:
        log = await polish_portraits(llm, only=[k for k, v in res.items() if v.get("ok")])
        print(f"portraits polished: {sum(1 for v in log['portraits'].values() if v.get('ok'))}")


async def _loop(settings: Any, llm: Any, db: Any, a: argparse.Namespace) -> None:
    from .loop import LoopOptions, run_loop

    run_dir = None
    if a.run:
        run_dir = paths.RUNS_DIR / a.run
        if not run_dir.exists():
            raise SystemExit(f"no such run: {a.run}")
    opts = LoopOptions(max_iter=a.max_iter, url=a.url, fake_capture=a.fake_capture, fast=a.fast, video=not a.no_video,
                       gpu=a.gpu, concurrency=a.concurrency, only=_only(a.only))
    scores = await run_loop(settings, llm, db, opts, run_dir=run_dir)
    f = scores["final"]
    print(f"loop done: run {scores['run_id']} world={f['world_score']} visual={f['visual_score']} realism={f['realism']} "
          f"generated={f['generated']} fallback={f['fallback']} ({scores['stop_reason']})")


async def _fallbacks(a: argparse.Namespace) -> None:
    from .capture import run_capture

    root = paths.WORLDGEN_DATA / "fallback" / new_id("wgf")
    reports = await run_capture(root=root, iteration=0, depts=paths.department_ids(), source="fallback", url=a.url,
                                fake=a.fake_capture)
    for d, r in reports.items():
        print(f"{d:<22} probe={r['probe_score']} critical={r['critical_pass']}")
    print(f"fallback captures in {root}")


async def amain(argv: list[str]) -> int:
    a = _parser().parse_args(argv)
    cmd = "all" if a.all and not a.cmd else a.cmd
    if not cmd:
        _parser().print_help()
        return 2
    settings = get_settings()
    db = await open_db(settings)
    llm = build_llm_client(settings, db)
    try:
        if cmd == "faces":
            await _faces(llm)
        elif cmd == "signs":
            await _signs(llm, _only(a.only))
        elif cmd == "portraits":
            await _portraits(llm, a)
        elif cmd == "buildings":
            from .loop import buildings

            run_id = await buildings(settings, llm, db, only=_only(a.only))
            print(f"one-pass run: {run_id} ({paths.RUNS_DIR / run_id})")
        elif cmd == "loop":
            await _loop(settings, llm, db, a)
        elif cmd == "fallbacks":
            await _fallbacks(a)
        elif cmd == "report":
            from .report import write_report

            await write_report(db)
        elif cmd == "all":
            if not hasattr(a, "max_iter"):
                a = _parser().parse_args(["all"])
            await _faces(llm)
            await _signs(llm, None)
            from .loop import buildings

            a.run = await buildings(settings, llm, db, only=_only(a.only))
            await _loop(settings, llm, db, a)
            await _portraits(llm, argparse.Namespace(agents="", url=a.url, fake_capture=a.fake_capture, polish=False))
            from .report import write_report

            await write_report(db)
    finally:
        if db is not None:
            await db.close()
    return 0


def main() -> None:
    sys.exit(asyncio.run(amain(sys.argv[1:])))


if __name__ == "__main__":
    main()
