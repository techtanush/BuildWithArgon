# OWNER: ayan
"""LocalLoopExecutor — 03-company-kernel/02-autonomous-engineering-loop.md §3b.
Argon long-decode writes whole files → apply safely → `npm test` + `npm run build` → repair with
`previous_interaction_id` until pass or MAX_BUILD_ITERATIONS, enforcing the no-weakening rule."""
from __future__ import annotations

import json
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..config import Settings
from ..contracts import ExecutorInput, ExecutorResult, LLMResult
from ..security import redact
from . import fileblocks, workspace

LogFn = Callable[[str, str], Awaitable[None]]

RUNTIME_DEPS = ["react", "react-dom", "zod", "date-fns", "clsx"]
DEV_DEPS = ["typescript", "vite", "@vitejs/plugin-react", "vitest", "jsdom", "@testing-library/react",
            "@testing-library/user-event", "@types/react", "@types/react-dom"]
ALLOWED_DEPS = set(RUNTIME_DEPS + DEV_DEPS)
ALLOWLIST_TEXT = ", ".join(RUNTIME_DEPS + DEV_DEPS[:7])

PROMPTS_DIR = Path(__file__).resolve().parents[1] / "departments" / "prompts"


def load_prompt(name: str) -> str:
    """departments/prompts/<name>.md without the OWNER comment line."""
    lines = (PROMPTS_DIR / f"{name}.md").read_text("utf-8").splitlines()
    return "\n".join(line for line in lines if not line.startswith("<!-- OWNER")).strip()


BUILDER_SYSTEM = load_prompt("eng.builder").replace("{allowlist}", ALLOWLIST_TEXT)

TEST_FILE_RE = re.compile(r"(^|/)tests?/.*\.(test|spec)\.(t|j)sx?$|\.(test|spec)\.(t|j)sx?$")
MAX_CONTINUATIONS = 2


@dataclass
class VerifyResult:
    ran: bool = False
    passed: int = 0
    failed: int = 0
    tests: dict[str, str] = field(default_factory=dict)  # fullName -> status
    test_files: dict[str, str] = field(default_factory=dict)  # fullName -> file (relative)
    failures: list[str] = field(default_factory=list)
    build_ok: bool = False
    build_tail: str = ""
    test_tail: str = ""

    @property
    def ok(self) -> bool:
        return self.ran and self.failed == 0 and self.passed > 0 and self.build_ok


def format_acs(acs: list[dict[str, str]]) -> str:
    return "\n".join(f"- {a.get('id', '')}: {a.get('text', '')}" for a in acs) or "(none given)"


def code_context(ws: Path) -> tuple[str, int]:
    files = workspace.text_files(ws)
    return "\n".join(fileblocks.emit(str(p.relative_to(ws)), p.read_text("utf-8").rstrip("\n")) for p in files), len(files)


def sanitize_package_json(new_text: str, base_text: str | None) -> tuple[str, list[str]]:
    """Strip dependencies outside the allowlist (keeping whatever the base package.json already had)."""
    try:
        new = json.loads(new_text)
    except ValueError:
        return new_text, []
    base = json.loads(base_text) if base_text else {}
    stripped: list[str] = []
    for key in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
        deps = new.get(key)
        if not isinstance(deps, dict):
            continue
        allowed_here = ALLOWED_DEPS | set((base.get(key) or {}).keys())
        for name in list(deps):
            if name not in allowed_here:
                stripped.append(name)
                del deps[name]
    return (json.dumps(new, indent=2) + "\n" if stripped else new_text), stripped


def count_expects(text: str) -> int:
    return text.count("expect(")


def parse_vitest(path: Path, ws: Path) -> VerifyResult:
    v = VerifyResult()
    if not path.exists():
        return v
    try:
        data = json.loads(path.read_text("utf-8"))
    except ValueError:
        return v
    v.ran = True
    v.passed = int(data.get("numPassedTests") or 0)
    v.failed = int(data.get("numFailedTests") or 0)
    for suite in data.get("testResults") or []:
        name = str(suite.get("name") or "")
        try:
            rel = str(Path(name).resolve().relative_to(ws.resolve()))
        except (ValueError, OSError):
            rel = name
        assertions = suite.get("assertionResults") or []
        if not assertions and suite.get("status") == "failed":  # suite failed to load (syntax/import error)
            v.failures.append(f"{rel}: {str(suite.get('message') or 'suite failed to run')[:1500]}")
            v.failed = max(v.failed, 1)
        for a in assertions:
            full = str(a.get("fullName") or a.get("title") or "")
            v.tests[full] = str(a.get("status"))
            v.test_files[full] = rel
            if a.get("status") == "failed":
                msgs = "\n".join(a.get("failureMessages") or [])
                v.failures.append(f"{full}: {msgs[:1500]}")
    return v


class LocalLoopExecutor:
    name = "local"

    def __init__(self, settings: Settings, llm: Any, *, runner: workspace.Runner | None = None,
                 build_job: str = "engineering_build", fix_job: str = "engineering_fix",
                 agent_id: str | None = "eng.builder", department_id: str | None = "engineering") -> None:
        self.settings = settings
        self.llm = llm
        if runner is not None:
            self.runner, self.install_runner, self._runner_warning = runner, runner, None
        else:
            self.runner, self._runner_warning = workspace.default_runner(settings)
            self.install_runner = (self.runner if settings.local_sandbox == "docker" or self.runner is workspace.unavailable_runner
                                   else workspace.subprocess_runner)
        self.build_job, self.fix_job = build_job, fix_job
        self.agent_id, self.department_id = agent_id, department_id
        self.iterations_detail: list[dict[str, Any]] = []
        self.workspace: Path | None = None

    # ------------------------------------------------------------------ prompts

    def build_prompt(self, inp: ExecutorInput, ws: Path) -> str:
        ctx, n = code_context(ws)
        fix = f"\nFIX CONTEXT (what must be fixed):\n{inp.fix_context}\n" if inp.mode == "fix" and inp.fix_context else ""
        return (f"TICKET {inp.ticket_id}: {inp.title}\n{inp.body}\n{fix}"
                f"ACCEPTANCE CRITERIA:\n{format_acs(inp.acceptance_criteria)}\n"
                f"ARCHITECTURE:\n{inp.architecture_md or '(none)'}\n"
                f"CURRENT CODEBASE ({n} files):\n{ctx}")

    @staticmethod
    def repair_prompt(i: int, max_i: int, v: VerifyResult, removed: list[str], weakened: list[str]) -> str:
        parts = []
        if removed or weakened:
            parts.append(f"You removed tests: {json.dumps(sorted(removed + weakened))}. Restore them; never delete or "
                         "weaken tests.")
        failures = "\n".join(v.failures[:30]) or ("(tests did not run — see output)\n" + v.test_tail[-4000:]
                                                  if not v.ran else "(none)")
        build_tail = v.build_tail[-4000:] if not v.build_ok else "(build passed)"
        parts.append(f"Verification failed (iteration {i}/{max_i}).\nTEST FAILURES:\n{failures}\nBUILD OUTPUT (tail):\n"
                     f"{build_tail}\nFix the root cause. Output ONLY the files you change, in the same FILE block format, "
                     "then a FOUNDRY_NOTES line. Never delete or weaken tests.")
        return "\n\n".join(parts)

    # ------------------------------------------------------------------ steps

    async def _call(self, job: str, prompt: str, inp: ExecutorInput, log: LogFn, *,
                    previous: str | None = None, system: str | None = BUILDER_SYSTEM) -> LLMResult:
        async def progress(msg: str) -> None:
            await log("info", msg)

        return await self.llm.generate(job, prompt, system=system, previous_interaction_id=previous,
                                       run_id=inp.run_id, venture_id=inp.venture_id, agent_id=self.agent_id,
                                       department_id=self.department_id, on_progress=progress)

    async def apply(self, ws: Path, parsed: fileblocks.ParseResult, log: LogFn) -> list[str]:
        written: list[str] = []
        for block in parsed.blocks:
            if not fileblocks.safe_path(block.path):
                await log("warn", f"rejected unsafe path from model: {block.path!r}")
                continue
            try:
                target = fileblocks.contained_path(ws, block.path)
            except ValueError:
                await log("warn", "rejected symlink or escaping generated path")
                continue
            if block.content is None:
                if target.is_file():
                    target.unlink()
                    written.append(block.path)
                continue
            content = redact(block.content)
            if block.path == "package.json":
                base = (ws / "package.json").read_text("utf-8") if (ws / "package.json").exists() else None
                content, stripped = sanitize_package_json(content, base)
                if stripped:
                    await log("warn", f"stripped dependencies outside the allowlist: {', '.join(stripped)}")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content if content.endswith("\n") else content + "\n", "utf-8")
            written.append(block.path)
        return written

    async def verify(self, ws: Path) -> VerifyResult:
        timeout = self.settings.local_test_timeout_seconds
        report = ws / ".foundry" / "vitest.json"
        report.parent.mkdir(exist_ok=True)
        if report.exists():
            report.unlink()
        code, out = await self.runner(["npm", "test", "--", "--reporter=json", "--outputFile=.foundry/vitest.json"],
                                      ws, timeout)
        v = parse_vitest(report, ws)
        v.test_tail = out[-4000:]
        if code != 0:
            v.failed = max(v.failed, 1)
            v.failures.append(f"npm test exited with status {code}")
        if not v.ran and code != 0:
            v.failures.append(f"npm test failed to run (exit {code}):\n{out[-1500:]}")
        bcode, bout = await self.runner(["npm", "run", "build"], ws, timeout)
        v.build_ok, v.build_tail = bcode == 0, bout[-4000:]
        return v

    async def _ensure_install(self, ws: Path, log: LogFn) -> None:
        if workspace.needs_install(ws):
            await log("info", "installing product dependencies (no template cache)")
            code, out = await self.install_runner(["npm", "install", "--no-audit", "--no-fund"], ws, 900)
            if code != 0:
                await log("warn", f"npm install failed (exit {code}): {out[-500:]}")

    # ------------------------------------------------------------------ run

    async def run(self, inp: ExecutorInput, log: LogFn, *, base: Path | None = None,
                  additional_bases: list[Path] | None = None) -> ExecutorResult:
        started = time.monotonic()
        if self._runner_warning:
            await log("warn", self._runner_warning)
        if self.runner is workspace.unavailable_runner:
            return ExecutorResult(status="failed", iterations=0, first_pass_passed=False,
                                  failures=[self._runner_warning or "required sandbox is unavailable"])
        self.iterations_detail = []
        ws = workspace.create_workspace(self.settings, inp.venture_id, inp.ticket_id, base=base)
        self.workspace = ws
        for source in additional_bases or []:
            try:
                workspace.overlay_changes(ws, source)
            except ValueError as exc:
                return self._result("failed", 0, False, VerifyResult(), ws, "", [str(exc)], 0, 0, 0.0, started)
        await self._ensure_install(ws, log)
        tokens_in = tokens_out = 0
        cost = 0.0
        known: dict[str, str] = {}  # test fullName -> file
        expects = {str(p.relative_to(ws)): count_expects(p.read_text("utf-8"))
                   for p in workspace.text_files(ws) if TEST_FILE_RE.search(str(p.relative_to(ws)))}
        summary, first_pass, last_v = "", False, VerifyResult()
        prompt, previous, job = self.build_prompt(inp, ws), None, self.build_job
        max_i = max(1, inp.max_iterations)
        removed: list[str] = []
        weakened: list[str] = []
        for i in range(1, max_i + 1):
            await log("info", f"iteration {i}/{max_i}: {'build' if i == 1 else 'repair'} call ({job})")
            try:
                res = await self._call(job, prompt, inp, log, previous=previous)
            except Exception as exc:
                if previous is None:
                    raise
                await log("warn", f"continuation failed ({type(exc).__name__}); resending the full prompt")
                res = await self._call(job, self.build_prompt(inp, ws) + "\n\n" + prompt, inp, log)
            tokens_in, tokens_out, cost = tokens_in + res.tokens_in, tokens_out + res.tokens_out, cost + res.cost_usd
            parsed = fileblocks.parse(res.text)
            await self.apply(ws, parsed, log)
            last_id = res.interaction_id
            for _ in range(MAX_CONTINUATIONS):
                if not parsed.truncated:
                    break
                await log("warn", f"output truncated inside {parsed.truncated_path}; asking Argon to continue")
                cont = (f"Your output was truncated inside {parsed.truncated_path}. Output the COMPLETE "
                        f"{parsed.truncated_path} and every remaining file in the same FILE block format, then the "
                        "FOUNDRY_NOTES line.")
                res = await self._call(self.fix_job, cont, inp, log, previous=last_id)
                tokens_in, tokens_out, cost = tokens_in + res.tokens_in, tokens_out + res.tokens_out, cost + res.cost_usd
                parsed = fileblocks.parse(res.text)
                await self.apply(ws, parsed, log)
                last_id = res.interaction_id
            if parsed.notes and parsed.notes.get("summary"):
                summary = str(parsed.notes["summary"])[:2000]
            # no-weakening, part 1: assertion counts per pre-existing test file must not drop
            weakened = []
            for rel, before in expects.items():
                path = ws / rel
                now = count_expects(path.read_text("utf-8")) if path.exists() else 0
                if now < before:
                    weakened.append(rel)
            v = await self.verify(ws)
            last_v = v
            # no-weakening, part 2: every known test name still present (or its file has a new test)
            new_by_file: dict[str, int] = {}
            for name, f in v.test_files.items():
                if name not in known:
                    new_by_file[f] = new_by_file.get(f, 0) + 1
            removed = [n for n, f in known.items() if n not in v.tests and not new_by_file.get(f)] if v.ran else []
            rejected = bool(weakened or removed)
            if parsed.truncated:
                v.failures.append("model output remains truncated after continuation limit")
            ok = v.ok and not rejected and not parsed.truncated
            self.iterations_detail.append({"iteration": i, "tests_passed": v.passed, "tests_failed": v.failed,
                                           "build_ok": v.build_ok, "rejected": rejected, "removed_tests": removed,
                                           "weakened_files": weakened, "passed": ok})
            await log("info" if ok else "warn",
                      f"Iteration {i}/{max_i}: {v.passed}/{v.passed + v.failed} passing, build "
                      f"{'ok' if v.build_ok else 'failed'}" + (" — REJECTED: tests removed/weakened" if rejected else ""))
            if v.ran and not rejected:
                known.update(v.test_files)
                for p in workspace.text_files(ws):
                    rel = str(p.relative_to(ws))
                    if TEST_FILE_RE.search(rel):
                        expects[rel] = max(expects.get(rel, 0), count_expects(p.read_text("utf-8")))
            if ok:
                first_pass = i == 1
                return self._result("passed", i, first_pass, v, ws, summary, [], tokens_in, tokens_out, cost, started)
            if i < max_i:
                prompt, previous, job = self.repair_prompt(i, max_i, v, removed, weakened), last_id, self.fix_job
        failures = list(last_v.failures[:20])
        if removed or weakened:
            failures.append(f"tests removed or weakened: {sorted(removed + weakened)}")
        if not last_v.build_ok:
            failures.append("build failed: " + last_v.build_tail[-1500:])
        return self._result("failed", max_i, False, last_v, ws, summary, failures, tokens_in, tokens_out, cost, started)

    @staticmethod
    def _result(status: str, iterations: int, first_pass: bool, v: VerifyResult, ws: Path, summary: str,
                failures: list[str], t_in: int, t_out: int, cost: float, started: float) -> ExecutorResult:
        dist = ws / "dist"
        return ExecutorResult(status=status, iterations=iterations, first_pass_passed=first_pass,  # type: ignore[arg-type]
                              tests_passed=v.passed, tests_failed=v.failed, build_ok=v.build_ok,
                              files_changed=workspace.changed_files(ws), summary=redact(summary),
                              failures=[redact(f) for f in failures], workspace_path=str(ws),
                              preview_path=str(dist) if dist.exists() else None, tokens_in=t_in, tokens_out=t_out,
                              cost_usd=cost, wall_seconds=round(time.monotonic() - started, 2))
