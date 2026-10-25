# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.
"""The World Lab live round: capture → critique (video + screenshots) → patch (Antigravity "world architect"
when available) → validate → re-capture → score, for ONE building (05-world/13 §2; acceptance G-07).

One round at a time (409). 503 when WEB_URL is unreachable. Every step writes a timestamped record under
kernel/data/worldgen/live/<round_id>/ (round.json, captures/{before,after}/<dept>/, probes/, critic-*.json,
patch.json, module.before.ts, module.after.ts), a worldgen_live_rounds row, and SSE `worldgen.progress`
(global event). Promote is a separate, explicit action (`promote`)."""
from __future__ import annotations

import asyncio
import json
import re
import time
from pathlib import Path
from typing import Any

import httpx

from ..contracts import LiveRound, LiveRoundSide, LiveRoundStep
from ..errors import ConflictError, DependencyError, NotFoundError
from ..ids import new_id, utc_now
from ..models import ARGON
from . import paths, prompts
from .capture import CaptureError, run_capture
from .critique import critique, extract_module, needs_patch, patch
from .runs import Recorder, capture_set, read_json, write_json
from .score import promote_module
from .validate import FORBIDDEN, static_check, validate

STEPS = ["capture_before", "critique", "patch", "validate", "capture_after", "score"]
STATUS_FOR_STEP = {"capture_before": "capturing", "critique": "critiquing", "patch": "patching", "validate": "validating",
                   "capture_after": "recapturing", "score": "scoring"}
TARGET_S = 150
AFTER_RESERVE_S = 70  # validate + capture_after + scoring critique
ARCHITECT_MIN_S = 45
ARCHITECT_ALLOWLIST = ["registry.npmjs.org"]

_ACTIVE: asyncio.Task[Any] | None = None
_LOCK = asyncio.Lock()


def round_dir(round_id: str) -> Path:
    if not re.fullmatch(r"wlr_[0-9A-Z]{26}", round_id):
        raise NotFoundError("live round", round_id)
    return paths.LIVE_DIR / round_id


def load_round(round_id: str) -> LiveRound:
    data = read_json(round_dir(round_id) / "round.json")
    if not data:
        raise NotFoundError("live round", round_id)
    return LiveRound.model_validate({k: v for k, v in data.items() if k in LiveRound.model_fields})


def list_rounds() -> list[LiveRound]:
    if not paths.LIVE_DIR.exists():
        return []
    out = []
    for d in sorted(paths.LIVE_DIR.iterdir(), key=lambda p: p.name, reverse=True):
        data = read_json(d / "round.json")
        if data:
            out.append(LiveRound.model_validate({k: v for k, v in data.items() if k in LiveRound.model_fields}))
    return out


def is_running() -> bool:
    return _ACTIVE is not None and not _ACTIVE.done()


async def web_reachable(url: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=3.0) as c:
            r = await c.get(url)
            return r.status_code < 500
    except httpx.HTTPError:
        return False


class _Round:
    """Mutable state of one round + persistence (files, DB row, SSE)."""

    def __init__(self, lr: LiveRound, db: Any, extra: dict[str, Any]) -> None:
        self.lr = lr
        self.db = db
        self.rec = Recorder(db)
        self.dir = paths.LIVE_DIR / lr.id
        self.extra = extra
        self.t0 = time.monotonic()

    @property
    def elapsed(self) -> float:
        return round(time.monotonic() - self.t0, 1)

    async def save(self) -> None:
        self.lr.elapsed_s = self.elapsed if self.lr.finished_at is None else self.lr.elapsed_s
        data = {**self.lr.model_dump(), **self.extra}
        write_json(self.dir / "round.json", data)
        if self.db:
            async with self.db.tx() as tx:
                await tx.execute(
                    "INSERT INTO worldgen_live_rounds (id, department_id, status, fast, promoted, data_path, round_json, created_at, finished_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, promoted=excluded.promoted, "
                    "round_json=excluded.round_json, finished_at=excluded.finished_at",
                    (self.lr.id, self.lr.department_id, self.lr.status, 1 if self.lr.fast else 0, 1 if self.lr.promoted else 0,
                     str(self.dir), json.dumps(data, default=str), self.lr.created_at, self.lr.finished_at))

    def step(self, name: str) -> LiveRoundStep:
        return next(s for s in self.lr.steps if s.name == name)

    async def begin(self, name: str) -> None:
        s = self.step(name)
        s.status, s.started_at = "running", utc_now()
        self.lr.status = STATUS_FOR_STEP[name]  # type: ignore[assignment]
        await self.save()
        await self.rec.progress(step=name, status="running", department_id=self.lr.department_id, round_id=self.lr.id)

    async def end(self, name: str, *, status: str = "done", note: str = "", score: float | None = None) -> None:
        s = self.step(name)
        s.status, s.finished_at, s.note = status, utc_now(), note[:500]  # type: ignore[assignment]
        await self.save()
        await self.rec.progress(step=name, status=status, department_id=self.lr.department_id, round_id=self.lr.id,
                                score=score, note=note[:200])

    async def fail(self, error: str) -> None:
        for s in self.lr.steps:
            if s.status == "running":
                s.status, s.finished_at, s.note = "failed", utc_now(), error[:500]
            elif s.status == "pending":
                s.status = "skipped"
        self.lr.status, self.lr.error = "failed", error[:1000]
        self.lr.elapsed_s = self.elapsed
        self.lr.finished_at = utc_now()
        await self.save()
        await self.rec.progress(step="round", status="failed", department_id=self.lr.department_id, round_id=self.lr.id, note=error[:200])


def _side(report: dict[str, Any], critic: dict[str, Any] | None, captures: Path) -> LiveRoundSide:
    return LiveRoundSide(captures=capture_set(captures), probe_score=report.get("probe_score"),
                         visual_score=(critic or {}).get("visual_score"), realism=(critic or {}).get("realism"))


VALIDATOR_PY = '''import re, sys
FORBIDDEN = {forbidden}
src = open(sys.argv[1]).read(); dept = sys.argv[2]; errors = []
if len(src.encode()) > 60 * 1024: errors.append("module larger than 60 KB")
ok = re.findall(r"^import\\s+type\\s*\\{{[^}}]*\\}}\\s*from\\s*'\\.\\./\\.\\./kit/types';?\\s*$", src, re.M)
anyimp = re.findall(r"^\\s*import\\b|\\brequire\\s*\\(", src, re.M)
if len(ok) != 1 or len(anyimp) != 1: errors.append("exactly one `import type {{...}} from '../../kit/types'` and no other import")
errors += ["forbidden token " + t for t in FORBIDDEN if t in src]
if not re.search(r"\\bid\\s*:\\s*['\\"]" + re.escape(dept) + r"['\\"]", src): errors.append("missing id: '" + dept + "'")
if "export default" not in src: errors.append("missing export default")
print("\\n".join(errors) or "OK"); sys.exit(1 if errors else 0)
'''

ARCHITECT_PROMPT = """You are the World Architect for Foundry's 3D town, working alone in a Linux sandbox. Fix ONE building
module so it addresses every issue below, keeps what works, and passes the type checker and the static rules.
Verify your own output before you answer.

SETUP (create these files exactly):
- world/kit/types.ts  — the KIT API (below, verbatim)
- world/kit/props.contract.ts — the props contract (below, verbatim)
- world/buildings/staging/{dept}.ts — the CURRENT SOURCE (below); edit this file
- world/validate.py — the static validator (below, verbatim)
- world/tsconfig.json — {{"compilerOptions":{{"target":"ES2022","lib":["ES2022"],"module":"ESNext","moduleResolution":"bundler","strict":true,"skipLibCheck":true,"noEmit":true,"isolatedModules":true,"types":[]}},"include":["kit/types.ts","buildings/staging/**/*.ts"]}}

LOOP until both pass (at most 4 times): `cd world && python3 validate.py buildings/staging/{dept}.ts {dept}` and
`npx -y -p typescript@5.7.2 tsc -p tsconfig.json`. Read the failures, fix the module, rerun.

ISSUES (from the art director, who watched the walkthrough videos):
{issues}
KEEP: {keep}
PROBE FAILURES: {probes}

RULES AND DESIGN (follow exactly):
{rules}

### KIT API (world/kit/types.ts)
```ts
{kit}
```
### PROPS CONTRACT (world/kit/props.contract.ts)
```ts
{props}
```
### VALIDATOR (world/validate.py)
```python
{validator}
```
### CURRENT SOURCE (world/buildings/staging/{dept}.ts)
```ts
{source}
```

FINISH with the complete final module as exactly one block:
<<<FILE path="web/src/world/buildings/generated/{dept}.ts">>>
...entire file...
<<<END FILE>>>
then one line: WORLD_ARCHITECT_RESULT {{"tsc_ok": true|false, "validator_ok": true|false, "iterations": <int>, "summary": "<=300 chars"}}"""


async def architect_patch(llm: Any, settings: Any, dept: str, *, source: str, critic: dict[str, Any], report: dict[str, Any],
                          timeout_s: float, out_file: Path) -> dict[str, Any]:
    """Patch as an Antigravity managed agent. Returns {"source" | None, "used": bool, ...}; never raises."""
    d = paths.department(dept)
    failed = [p for p in report.get("probes", []) if not p.get("pass")]
    rules = "\n\n".join([prompts.building_rules(), prompts.NOTES, prompts.art_direction(), prompts.building_entry(d)])
    text = ARCHITECT_PROMPT.format(dept=dept, issues=json.dumps(critic.get("issues", []), indent=1),
                                   keep=json.dumps(critic.get("keep", [])), probes=json.dumps(failed, indent=1), rules=rules,
                                   kit=prompts.kit_api().strip(), props=paths.PROPS_CONTRACT.read_text().strip(),
                                   validator=VALIDATOR_PY.format(forbidden=json.dumps(FORBIDDEN)).strip(), source=source.strip())
    env = {"type": "remote", "network": {"allowlist": [{"domain": dom} for dom in ARCHITECT_ALLOWLIST]}}
    rec: dict[str, Any] = {"agent": settings.antigravity_agent, "timeout_s": round(timeout_s, 1), "used": False}
    started = time.monotonic()
    try:
        res = await asyncio.wait_for(llm.run_agent(agent=settings.antigravity_agent,
                                                   agent_config={"type": "antigravity", "model": ARGON},
                                                   prompt=text, environment=env, background=True), timeout=timeout_s)
    except Exception as exc:  # noqa: BLE001 — any agent failure falls back to the plain Argon patch
        rec.update({"error": f"{type(exc).__name__}: {str(exc)[:300]}", "seconds": round(time.monotonic() - started, 1)})
        write_json(out_file, rec)
        return {**rec, "source": None}
    m = re.search(r"^WORLD_ARCHITECT_RESULT (\{.*\})\s*$", res.text, re.M)
    try:
        result = json.loads(m.group(1)) if m else {}
    except ValueError:
        result = {}
    src = extract_module(res.text, dept)
    errors = static_check(dept, src) if src else ["no FILE block in the agent output"]
    rec.update({"interaction_id": res.interaction_id, "result": result, "static_errors": errors,
                "seconds": round(time.monotonic() - started, 1), "tokens": {"in": res.tokens_in, "out": res.tokens_out},
                "cost_usd": res.cost_usd, "used": not errors})
    write_json(out_file, rec)
    return {**rec, "source": src if not errors else None}


async def _run(state: _Round, settings: Any, llm: Any, *, source: str, url: str | None, fake_capture: bool) -> None:
    lr, dept, root = state.lr, state.lr.department_id, state.dir
    d = paths.department(dept)
    critic_job = "worldgen_critic_fast" if lr.fast else "worldgen_critic"
    patch_job = "worldgen_patch_fast" if lr.fast else "worldgen_patch"
    try:
        # 1. capture "before" (the current generated module)
        await state.begin("capture_before")
        before = (await run_capture(root=root, iteration="before", depts=[dept], source="generated", url=url,
                                    fake=fake_capture, fast=fake_capture)).get(dept)
        if not before:
            raise CaptureError("no probe report for the 'before' capture")
        await state.end("capture_before", note=f"probe score {before['probe_score']}", score=before["probe_score"])
        # 2. critique
        await state.begin("critique")
        c_before = await critique(llm, d, report=before, root=root, source=source, job=critic_job, out_file=root / "critic-before.json")
        lr.issues = c_before["issues"]
        lr.before = _side(before, c_before, root / "captures" / "before" / dept)
        await state.end("critique", note=f"{len(lr.issues)} issues; video input: {c_before['inputs']['video_input']}",
                        score=c_before["visual_score"])
        # 3. patch (world architect, else plain Argon)
        await state.begin("patch")
        if not needs_patch(before, c_before):
            note_extra = "no failed probes or high issues — patching medium issues anyway"
        else:
            note_extra = ""
        budget = TARGET_S - state.elapsed - AFTER_RESERVE_S
        new_src: str | None = None
        if budget >= ARCHITECT_MIN_S:
            arch = await architect_patch(llm, settings, dept, source=source, critic=c_before, report=before,
                                         timeout_s=budget, out_file=root / "architect.json")
            if arch.get("source"):
                new_src, lr.used_managed_agent = arch["source"], True
            how = "world architect (Antigravity)" if new_src else f"world architect unavailable ({arch.get('error') or arch.get('static_errors')})"
        else:
            how = f"skipped world architect (only {budget:.0f}s left)"
            write_json(root / "architect.json", {"used": False, "skipped": how})
        if new_src is None:
            p = await patch(llm, d, source=source, critic=c_before, report=before, job=patch_job, out_file=root / "patch.json")
            new_src = p.get("source")
            how += "; Argon patch" if new_src else f"; Argon patch failed: {p.get('static_errors')}"
        if new_src is None:
            raise RuntimeError(f"patch produced no valid module ({how})")
        (root / "module.after.ts").write_text(new_src)
        await state.end("patch", note=f"{how}{'; ' + note_extra if note_extra else ''}")
        # 4. validate (static + tsc), one repair
        await state.begin("validate")
        v = validate({dept: new_src})[dept]
        repaired = False
        if not v.ok:
            fix = {**c_before, "issues": [*c_before["issues"], {"severity": "high", "where": "", "camera": "",
                                                                "description": "module failed validation: " + "; ".join(v.errors) + (" tsc: " + v.tsc_errors if v.tsc_errors else ""),
                                                                "fix": "make the module pass the static rules and tsc"}]}
            p2 = await patch(llm, d, source=new_src, critic=fix, report=before, tsc_errors=v.tsc_errors, job=patch_job,
                             out_file=root / "patch-repair.json")
            if p2.get("source"):
                new_src, repaired = p2["source"], True
                (root / "module.after.ts").write_text(new_src)
                v = validate({dept: new_src})[dept]
        write_json(root / "validation.json", {**v.__dict__, "repaired": repaired})
        if not v.ok:
            raise RuntimeError("patched module failed validation: " + "; ".join(v.errors or [v.tsc_errors[:500]]))
        await state.end("validate", note="static rules + tsc pass" + (" after one repair" if repaired else ""))
        # 5. capture "after" (staging/<dept>.ts = the candidate)
        await state.begin("capture_after")
        after = (await run_capture(root=root, iteration="after", depts=[dept], source="staging", url=url,
                                   fake=fake_capture, fast=fake_capture)).get(dept)
        if not after:
            raise CaptureError("no probe report for the 'after' capture")
        await state.end("capture_after", note=f"probe score {after['probe_score']}", score=after["probe_score"])
        # 6. score (critique "after" for scores only)
        await state.begin("score")
        c_after = await critique(llm, d, report=after, root=root, source=new_src, job=critic_job, out_file=root / "critic-after.json")
        lr.after = _side(after, c_after, root / "captures" / "after" / dept)
        await state.end("score", note=f"visual {lr.before.visual_score} → {lr.after.visual_score}; realism "
                                      f"{lr.before.realism} → {lr.after.realism}", score=c_after["visual_score"])
        lr.status, lr.finished_at = "done", utc_now()
        lr.elapsed_s = state.elapsed
        await state.save()
        await state.rec.progress(step="round", status="done", department_id=dept, round_id=lr.id, score=c_after["visual_score"],
                                 note=f"{lr.elapsed_s}s")
    except Exception as exc:  # noqa: BLE001 — every failure is reported on the round, never hidden
        await state.fail(f"{type(exc).__name__}: {exc}")


async def start_round(*, settings: Any, db: Any, llm: Any, department_id: str, fast: bool = True,
                      fake_capture: bool = False, wait: bool = False) -> LiveRound:
    """Queue a live round for one building and run it in a background task. 409 if one is running; 503 if WEB_URL is
    unreachable (unless fake_capture, used by tests/drills against scripts/fixtures/fake-capture.html)."""
    global _ACTIVE
    if department_id not in paths.department_ids():
        raise NotFoundError("department", department_id)
    async with _LOCK:
        if is_running():
            raise ConflictError("a live round is already running", {"round_id": getattr(_ACTIVE, "round_id", None)})
        src_file = paths.GENERATED_DIR / f"{department_id}.ts"
        if not src_file.exists():
            raise ConflictError(f"no generated module for {department_id} yet — run `foundry-worldgen loop` first "
                                "(the building uses its fallback archetype)", {"department_id": department_id})
        url = None if fake_capture else settings.web_url
        if url and not await web_reachable(url):
            raise DependencyError("web", f"the web dev server is not reachable at {url} (start `make dev`)", unavailable=True)
        rid = new_id("wlr")
        lr = LiveRound(id=rid, department_id=department_id, status="queued", fast=fast, created_at=utc_now(),
                       steps=[LiveRoundStep(name=s, status="pending") for s in STEPS])
        state = _Round(lr, db, {"fake_capture": fake_capture, "web_url": url})
        state.dir.mkdir(parents=True, exist_ok=True)
        source = src_file.read_text()
        (state.dir / "module.before.ts").write_text(source)
        await state.save()
        await state.rec.progress(step="round", status="queued", department_id=department_id, round_id=rid)
        task = asyncio.create_task(_run(state, settings, llm, source=source, url=url, fake_capture=fake_capture))
        task.round_id = rid  # type: ignore[attr-defined]
        _ACTIVE = task
    if wait:
        await task
        return load_round(rid)
    return lr


async def promote(*, db: Any, round_id: str) -> LiveRound:
    """Write the round's module to generated/<dept>.ts and update registry.json + index.ts. 409 unless done."""
    data = read_json(round_dir(round_id) / "round.json")
    if not data:
        raise NotFoundError("live round", round_id)
    if data.get("status") != "done":
        raise ConflictError(f"live round {round_id} is {data.get('status')}; only a finished round can be promoted")
    src_file = round_dir(round_id) / "module.after.ts"
    if not src_file.exists():
        raise ConflictError(f"live round {round_id} has no patched module")
    after = data.get("after") or {}
    promote_module(data["department_id"], src_file.read_text(),
                   {"iteration": f"live:{round_id}", "probe_score": after.get("probe_score"),
                    "visual_score": after.get("visual_score"), "realism": after.get("realism"), "promoted_at": utc_now()})
    data["promoted"] = True
    data["promoted_at"] = utc_now()
    write_json(round_dir(round_id) / "round.json", data)
    if db:
        async with db.tx() as tx:
            await tx.execute("UPDATE worldgen_live_rounds SET promoted=1, round_json=? WHERE id=?",
                             (json.dumps(data, default=str), round_id))
        await Recorder(db).progress(step="promote", status="done", department_id=data["department_id"], round_id=round_id)
    return load_round(round_id)
