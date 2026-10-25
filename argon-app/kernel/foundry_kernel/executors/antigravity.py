# OWNER: ayan
"""AntigravityExecutor — the managed-agent builder (02-models-and-integrations/03-antigravity-managed-agents.md).
One `run_agent` call: Argon inside a Google-hosted sandbox clones the venture repo, implements the ticket,
tests, commits and pushes a branch, and finishes with one `FOUNDRY_RESULT {...}` line."""
from __future__ import annotations

import asyncio
import json
import re
import time
from collections.abc import Awaitable, Callable
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from ..config import Settings
from ..contracts import ExecutorInput, ExecutorResult
from ..ids import utc_now
from ..models import ARGON
from ..security import redact

LogFn = Callable[[str, str], Awaitable[None]]

ALLOWLIST = ["github.com", "api.github.com", "codeload.github.com", "objects.githubusercontent.com",
             "registry.npmjs.org"]
CREDENTIAL_DOMAINS = {"github.com", "api.github.com", "codeload.github.com"}
CREDENTIAL_ID = "foundry-github"
KV_CREDENTIAL = "antigravity.github_credential_id"
KV_OVERRIDE = "executor.override"
KV_FAILS = "antigravity.consecutive_errors"
FAILS_BEFORE_OVERRIDE = 3
MCP_SERVERS: list[dict[str, Any]] = []  # planned: none configured in this build (02-models-and-integrations/08)

RESULT_RE = re.compile(r"^FOUNDRY_RESULT (\{.*\})\s*$", re.MULTILINE)

PROMPT = """You are {agent_name}, the Builder in Foundry's Engineering department. You work alone in a
Linux sandbox. Complete the ticket end to end and verify it yourself.

REPOSITORY: https://github.com/{repo_full_name}  (default branch: {base_branch})
BRANCH TO CREATE: {branch}
AUTH: git is pre-authenticated through the sandbox proxy. Never print or echo credentials.

TICKET {ticket_id}: {title}
{body}
{fix}
ACCEPTANCE CRITERIA (from the spec; all must pass):
{acceptance}

ARCHITECTURE NOTES (from eng.tech-lead):
{architecture}

RULES
1. Clone the repo, create the branch, implement the change across all files needed.
2. Write or update tests for every acceptance criterion. Tests must be runnable with `npm test`.
3. Run `npm ci` (or `npm install` if no lockfile) and `npm test` and `npm run build`.
4. If anything fails: read the failure, fix the cause, rerun. Repeat until all pass, at most
   {max_iterations} iterations. Never delete or weaken a test to make it pass.
5. Commit with message "foundry({ticket_id_short}): {title}" and push the branch.
6. Do not open a pull request (Foundry opens it). Do not push to main.
7. Finish with EXACTLY one line starting with FOUNDRY_RESULT followed by JSON:
FOUNDRY_RESULT {{"status":"passed"|"failed","branch":"...","commit":"<sha>",
 "iterations":<int>,"tests":{{"passed":<int>,"failed":<int>}},"build_ok":<bool>,
 "files_changed":["..."],"summary":"<=600 chars","failures":["..."]}}"""


class _Tests(BaseModel):
    passed: int = Field(default=0, ge=0)
    failed: int = Field(default=0, ge=0)


class AntigravityResult(BaseModel):
    status: Literal["passed", "failed"]
    branch: str | None = None
    commit: str | None = None
    iterations: int = Field(default=1, ge=1)
    tests: _Tests = Field(default_factory=_Tests)
    build_ok: bool = False
    files_changed: list[str] = Field(default_factory=list)
    summary: str = ""
    failures: list[str] = Field(default_factory=list)


def parse_result(text: str) -> AntigravityResult | None:
    """The LAST `FOUNDRY_RESULT {...}` line, validated; None when missing or invalid."""
    matches = RESULT_RE.findall(text or "")
    if not matches:
        return None
    try:
        return AntigravityResult.model_validate(json.loads(matches[-1]))
    except (ValueError, ValidationError):
        return None


def slugify(text: str, max_len: int = 32) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (slug[:max_len].rstrip("-")) or "change"


def branch_name(ticket_id: str, title: str, mode: str = "build") -> str:
    tid8 = ticket_id.split("_", 1)[-1][-8:].lower()
    return f"foundry/{tid8}-{'fix-' if mode == 'fix' else ''}{slugify(title)}"


def environment(credential_id: str | None) -> dict[str, Any]:
    """VERIFIED (google-genai 2.33 types): network.allowlist is a list of {domain, credential?}."""
    entries: list[dict[str, Any]] = []
    for d in ALLOWLIST:
        entry: dict[str, Any] = {"domain": d}
        if credential_id and d in CREDENTIAL_DOMAINS:
            entry["credential"] = credential_id
        entries.append(entry)
    return {"type": "remote", "network": {"allowlist": entries}}


async def kv_get(db: Any, key: str) -> Any:
    if db is None:
        return None
    row = await db.fetch_one("SELECT value_json FROM kv WHERE key = ?", (key,))
    if not row:
        return None
    try:
        return json.loads(row["value_json"])
    except ValueError:
        return row["value_json"]


async def kv_set(db: Any, key: str, value: Any) -> None:
    async with db.tx() as tx:
        await tx.execute("INSERT INTO kv (key, value_json, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET "
                         "value_json=excluded.value_json, updated_at=excluded.updated_at",
                         (key, json.dumps(value), utc_now()))


async def ensure_github_credential(settings: Settings, db: Any) -> str | None:
    """Register GITHUB_SANDBOX_TOKEN with the Credentials API so it is injected at the sandbox proxy and never
    enters model context. Returns the credential id, or None (never raises) when not configured or on error."""
    token = settings.github_sandbox_token.get_secret_value() if settings.github_sandbox_token else ""
    if not token or settings.llm_mode == "fake":
        return None
    existing = await kv_get(db, KV_CREDENTIAL)
    if existing:
        return str(existing)
    try:
        from ..llm.client import register_github_credential

        cred_id = await register_github_credential(settings, token, CREDENTIAL_ID)
    except Exception:  # noqa: BLE001 - optional capability; executor still runs (sandbox may lack push auth)
        return None
    if db is not None:
        await kv_set(db, KV_CREDENTIAL, cred_id)
    return cred_id


class AntigravityExecutor:
    name = "antigravity"

    def __init__(self, settings: Settings, llm: Any, db: Any = None, *, agent_name: str = "Zara") -> None:
        self.settings = settings
        self.llm = llm
        self.db = db
        self.agent_name = agent_name
        self.interaction_id: str | None = None

    def prompt(self, inp: ExecutorInput, branch: str) -> str:
        acs = "\n".join(f"{i}. {a.get('id', '')}: {a.get('text', '')}" for i, a in enumerate(inp.acceptance_criteria, 1))
        fix = f"\nWHAT TO FIX:\n{inp.fix_context}\n" if inp.mode == "fix" and inp.fix_context else ""
        return PROMPT.format(agent_name=self.agent_name, repo_full_name=inp.repo_full_name, base_branch=inp.base_branch,
                             branch=branch, ticket_id=inp.ticket_id, title=inp.title, body=inp.body, fix=fix,
                             acceptance=acs or "(none given)", architecture=inp.architecture_md or "(none)",
                             max_iterations=inp.max_iterations, ticket_id_short=inp.ticket_id.split("_", 1)[-1][-8:].lower())

    async def _record_error(self) -> None:
        if self.db is None:
            return
        fails = int(await kv_get(self.db, KV_FAILS) or 0) + 1
        await kv_set(self.db, KV_FAILS, fails)
        if fails >= FAILS_BEFORE_OVERRIDE:
            from .. import bus

            await kv_set(self.db, KV_OVERRIDE, "local")
            async with self.db.tx() as tx:
                await bus.emit(tx, venture_id=None, type="system.warning", level="warn",
                               data={"provider": "antigravity",
                                     "message": "Engineering executor: local (Antigravity unavailable)"})

    async def run(self, inp: ExecutorInput, log: LogFn) -> ExecutorResult:
        if not inp.repo_full_name:
            await log("info", "no GitHub repo for this venture — running this ticket with the local loop")
            from .local_loop import LocalLoopExecutor

            return await LocalLoopExecutor(self.settings, self.llm).run(inp, log)
        started = time.monotonic()
        branch = branch_name(inp.ticket_id, inp.title, inp.mode)
        cred = await kv_get(self.db, KV_CREDENTIAL) or await ensure_github_credential(self.settings, self.db)
        if not cred:
            await log("warn", "antigravity: no GitHub credential (GITHUB_SANDBOX_TOKEN unset or Credentials API failed) — "
                              "the sandbox cannot push the branch")

        async def progress(msg: str) -> None:
            await log("info", f"antigravity: {msg}")

        await log("info", f"antigravity: starting managed agent {self.settings.antigravity_agent} on {inp.repo_full_name} "
                          f"branch {branch}")
        try:
            res = await self.llm.run_agent(agent=self.settings.antigravity_agent,
                                           agent_config={"type": "antigravity", "model": ARGON},
                                           prompt=self.prompt(inp, branch), environment=environment(cred),
                                           run_id=inp.run_id, venture_id=inp.venture_id, background=True,
                                           on_progress=progress)
        except Exception as exc:  # noqa: BLE001 - provider failure is data: retry policy + override after 3
            await self._record_error()
            await log("error", f"antigravity error: {type(exc).__name__}: {redact(str(exc))[:500]}")
            return ExecutorResult(status="failed", iterations=0, first_pass_passed=False, branch=branch,
                                  failures=[f"antigravity error: {type(exc).__name__}"],
                                  wall_seconds=round(time.monotonic() - started, 2))
        if self.db is not None:
            await kv_set(self.db, KV_FAILS, 0)
        self.interaction_id = res.interaction_id
        await log("info", f"antigravity: interaction {res.interaction_id} finished ({res.raw_status})")
        parsed = parse_result(res.text)
        wall = round(time.monotonic() - started, 2)
        if parsed is None:
            tail = redact(res.text[-4000:])
            await log("error", f"antigravity: missing/invalid FOUNDRY_RESULT; output tail:\n{tail}")
            return ExecutorResult(status="failed", iterations=0, first_pass_passed=False, branch=branch,
                                  failures=["missing or invalid FOUNDRY_RESULT line"], tokens_in=res.tokens_in,
                                  tokens_out=res.tokens_out, cost_usd=res.cost_usd, wall_seconds=wall)
        if parsed.status == "passed" and (not parsed.build_ok or parsed.tests.failed or not parsed.tests.passed
                                           or parsed.failures or parsed.branch not in (None, branch)):
            parsed.status = "failed"
            parsed.failures.append("inconsistent managed-agent verification result")
        return ExecutorResult(status=parsed.status, iterations=parsed.iterations,
                              first_pass_passed=parsed.iterations == 1 and parsed.status == "passed",
                              branch=parsed.branch or branch, commit=parsed.commit, tests_passed=parsed.tests.passed,
                              tests_failed=parsed.tests.failed, build_ok=parsed.build_ok,
                              files_changed=parsed.files_changed, summary=redact(parsed.summary)[:600],
                              failures=[redact(f) for f in parsed.failures], tokens_in=res.tokens_in,
                              tokens_out=res.tokens_out, cost_usd=res.cost_usd, wall_seconds=wall)
