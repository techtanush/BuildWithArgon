# OWNER: frozen contract (change only via docs/contract-requests/<you>.md, applied in the merge session)

"""Test doubles shared by all branches."""
from __future__ import annotations

from typing import Any

from foundry_kernel.contracts import AnswerCheck, AskAnswer, ComputerTaskResult
from foundry_kernel.llm.fake import FakeLLM


class FakeHandlerContext:
    """A HandlerContext for unit-testing handlers without the scheduler."""

    def __init__(self, settings: Any, *, ticket_agent: dict[str, Any] | None = None, db: Any = None,
                 venture: dict[str, Any] | None = None, approval_result: dict[str, Any] | None = None) -> None:
        self.settings = settings
        self.llm = FakeLLM()
        self.db = db
        self.venture = venture or {"id": "ven_TEST", "name": "Test", "idea": "A test idea", "founder_name": "Alex"}
        self.agent = ticket_agent or {"id": "eng.builder", "department_id": "engineering", "display_name": "Zara"}
        self.run_id = "run_TEST"
        self.approval_result = approval_result
        self.logs: list[tuple[str, str]] = []
        self.posts: list[dict[str, Any]] = []
        self.asks: list[tuple[str, str]] = []
        self.requests: list[dict[str, Any]] = []

    async def log(self, level: str, message: str) -> None:
        self.logs.append((level, message))

    async def context_for(self, kinds: list[str]) -> str:
        return ""

    async def ask_agent(self, agent_id: str, question: str) -> AskAnswer:
        self.asks.append((agent_id, question))
        return AskAnswer(agent_id=agent_id, text="I don't know (fake).", check=AnswerCheck(status="verified"))

    async def request(self, department_id: str, need: str, why: str = "", context_refs: list[dict[str, Any]] | None = None) -> str:
        self.requests.append({"department_id": department_id, "need": need})
        return "tkt_FAKE_REQUEST"

    async def post(self, channel_slug: str, body: str, refs: list[dict[str, Any]] | None = None,
                   kind: str = "status", thread_root_id: str | None = None) -> str:
        self.posts.append({"channel_slug": channel_slug, "body": body, "kind": kind})
        return "msg_FAKE"

    async def use_computer(self, goal: str, allowed_domains: list[str], start_url: str, max_steps: int = 30) -> ComputerTaskResult:
        return ComputerTaskResult(status="skipped", reason="fake context")
