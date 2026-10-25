# OWNER: frozen contract (change only via docs/contract-requests/<you>.md, applied in the merge session)

"""Shared types every branch codes against. Mirrors the spec:
- handler contract: 01-architecture/05-event-bus-and-orchestration.md
- conversation/citations: 03-company-kernel/08-grounding-and-citations.md, 01-architecture/04-api-contract.md
- executors: 03-company-kernel/02-autonomous-engineering-loop.md
- computers: 02-models-and-integrations/10-cua-cloud-computers.md
- world: 05-world/03-city-layout.md (manifest), 05-world/05-characters-and-faces.md (FaceSpec)
TypeScript mirror: web/src/shared/contracts.ts."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal, Protocol

from pydantic import BaseModel, Field

if TYPE_CHECKING:  # avoid import cycles at runtime
    from .config import Settings

TicketStatus = Literal["open", "in_progress", "waiting_approval", "blocked", "done", "failed", "cancelled"]
GateType = Literal["clarification", "pivot", "spend", "outreach", "merge", "deploy", "integration", "new_capability", "computer_action"]
ArtifactKind = Literal["brief", "spec", "plan", "research", "report", "decision", "doc", "code", "pr", "build", "preview", "test_report", "budget", "dataset"]
MessageKind = Literal["status", "delegation", "handoff", "request", "ask", "answer", "standup_update", "decision", "gate", "announcement", "incident", "human", "reply"]
CitationKind = Literal["ticket", "run", "artifact", "approval", "message", "file", "agent", "department", "computer_task"]
CheckStatus = Literal["pending", "verified", "partial", "unsupported", "error"]

# ------------------------------------------------------------------ LLM (implemented by llm/client.py)


@dataclass
class Part:
    kind: Literal["text", "image", "audio"]
    text: str | None = None
    data: bytes | None = None
    mime: str | None = None


@dataclass
class LLMResult:
    text: str
    interaction_id: str | None
    model: str
    tokens_in: int = 0
    tokens_out: int = 0
    cached_in: int = 0
    cost_usd: float = 0.0
    estimated_cost: bool = True
    latency_ms: int = 0
    raw_status: str = "completed"
    images: list[tuple[bytes, str]] = field(default_factory=list)  # (bytes, mime) — Nano Banana
    audio: list[tuple[bytes, str]] = field(default_factory=list)  # (bytes, mime) — Gemini TTS (job tts_fallback)


ProgressFn = Callable[[str], Awaitable[None]]


class LLMClientProtocol(Protocol):
    async def generate(self, job: str, prompt: str | list[Part], *, system: str | None = None,
                       previous_interaction_id: str | None = None, run_id: str | None = None,
                       venture_id: str | None = None, agent_id: str | None = None,
                       department_id: str | None = None, on_progress: ProgressFn | None = None) -> LLMResult: ...

    async def generate_json(self, job: str, prompt: str | list[Part], schema: type[BaseModel],
                            **kw: Any) -> tuple[BaseModel, LLMResult]: ...

    async def run_agent(self, *, agent: str, agent_config: dict[str, Any], prompt: str,
                        environment: str | dict[str, Any], run_id: str | None = None,
                        venture_id: str | None = None, background: bool = True,
                        on_progress: ProgressFn | None = None) -> LLMResult: ...

    async def generate_images(self, job: str, prompt: str, n: int = 1,
                              reference_images: list[Part] | None = None) -> LLMResult: ...

# ------------------------------------------------------------------ conversation


class Citation(BaseModel):
    kind: CitationKind
    id: str
    quote: str = ""
    label: str = ""


class CitationCheck(BaseModel):
    index: int
    status: CheckStatus
    reason: str = ""


class AnswerCheck(BaseModel):
    status: CheckStatus
    per_citation: list[CitationCheck] = Field(default_factory=list)
    reason: str = ""


class ChatTurn(BaseModel):
    role: Literal["user", "agent"]
    text: str


class TalkRequest(BaseModel):
    text: str
    history: list[ChatTurn] = Field(default_factory=list)


class SuggestedAgent(BaseModel):
    agent_id: str
    reason: str


class RouteCard(BaseModel):
    agent_id: str
    agent_name: str
    agent_title: str
    department_id: str
    building_id: str
    building_name: str
    reason: str
    citations: list[Citation] = Field(default_factory=list)


class TalkResponse(BaseModel):
    answer_id: str
    text: str
    citations: list[Citation] = Field(default_factory=list)
    check: AnswerCheck
    suggested_agent: SuggestedAgent | None = None
    latency_ms: int = 0


class ConciergeResponse(BaseModel):
    answer_id: str
    text: str
    citations: list[Citation] = Field(default_factory=list)
    check: AnswerCheck
    route_card: RouteCard | None = None
    latency_ms: int = 0


class AskAnswer(BaseModel):
    agent_id: str
    text: str
    citations: list[Citation] = Field(default_factory=list)
    check: AnswerCheck

# ------------------------------------------------------------------ voice


class Alignment(BaseModel):
    chars: list[str]
    starts: list[float]
    ends: list[float]


class TtsRequest(BaseModel):
    agent_id: str
    text: str


class TtsResponse(BaseModel):
    audio_url: str | None = None
    mime: str | None = None
    alignment: Alignment | None = None
    provider: Literal["elevenlabs", "gemini", "browser"] = "browser"
    latency_ms: int = 0


class SttResponse(BaseModel):
    text: str
    provider: Literal["gemini", "none"] = "none"
    latency_ms: int = 0

# ------------------------------------------------------------------ handler contract


class NewArtifact(BaseModel):
    kind: ArtifactKind
    title: str
    summary: str = ""
    content_md: str = ""
    uri: str | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


class NewTicket(BaseModel):
    type: str
    title: str
    body: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)
    depends_on: list[str] = Field(default_factory=list)  # ticket ids or "ref:<key>"
    ref: str | None = None
    priority: int = 2
    assigned_agent_id: str | None = None


class NewApproval(BaseModel):
    gate_type: GateType
    title: str
    summary: str
    payload: dict[str, Any] = Field(default_factory=dict)


class NewMessage(BaseModel):
    channel_slug: str  # 'dept-engineering', 'exec', 'all-hands', 'incidents'
    body: str
    refs: list[dict[str, Any]] = Field(default_factory=list)
    kind: MessageKind = "status"
    thread_root_id: str | None = None


class CapabilityGap(BaseModel):
    capability: str
    description: str


class HandlerResult(BaseModel):
    outcome: Literal["done", "waiting_approval", "blocked", "failed", "retry"]
    note: str = ""
    result: dict[str, Any] = Field(default_factory=dict)
    artifacts: list[NewArtifact] = Field(default_factory=list)
    new_tickets: list[NewTicket] = Field(default_factory=list)
    approval: NewApproval | None = None
    messages: list[NewMessage] = Field(default_factory=list)
    capability_gap: CapabilityGap | None = None


class ComputerTaskResult(BaseModel):
    task_id: str | None = None
    status: Literal["succeeded", "failed", "waiting_approval", "stopped", "skipped"]
    steps: int = 0
    result: dict[str, Any] = Field(default_factory=dict)
    screenshots: list[str] = Field(default_factory=list)  # paths under data/computers/
    reason: str = ""


class HandlerContext(Protocol):
    """Implemented by the scheduler (tanush). Engineering/support handlers (ayan) use it."""
    venture: dict[str, Any]
    settings: Settings
    llm: LLMClientProtocol
    db: Any  # foundry_kernel.db.Database
    agent: dict[str, Any]
    run_id: str
    approval_result: dict[str, Any] | None

    async def log(self, level: str, message: str) -> None: ...
    async def context_for(self, kinds: list[str]) -> str: ...
    async def ask_agent(self, agent_id: str, question: str) -> AskAnswer: ...
    async def request(self, department_id: str, need: str, why: str = "",
                      context_refs: list[dict[str, Any]] | None = None) -> str: ...
    async def post(self, channel_slug: str, body: str, refs: list[dict[str, Any]] | None = None,
                   kind: MessageKind = "status", thread_root_id: str | None = None) -> str: ...
    async def use_computer(self, goal: str, allowed_domains: list[str], start_url: str,
                           max_steps: int = 30) -> ComputerTaskResult: ...


class Handler(Protocol):
    ticket_types: tuple[str, ...]

    async def handle(self, ticket: dict[str, Any], ctx: HandlerContext) -> HandlerResult: ...

# ------------------------------------------------------------------ executors (ayan)


class ExecutorInput(BaseModel):
    venture_id: str
    ticket_id: str
    run_id: str
    title: str
    body: str
    acceptance_criteria: list[dict[str, str]] = Field(default_factory=list)
    architecture_md: str = ""
    repo_full_name: str | None = None
    base_branch: str = "main"
    max_iterations: int = 6
    mode: Literal["build", "fix"] = "build"
    fix_context: str | None = None


class ExecutorResult(BaseModel):
    status: Literal["passed", "failed"]
    iterations: int
    first_pass_passed: bool
    branch: str | None = None
    commit: str | None = None
    tests_passed: int = 0
    tests_failed: int = 0
    build_ok: bool = False
    files_changed: list[str] = Field(default_factory=list)
    summary: str = ""
    failures: list[str] = Field(default_factory=list)
    workspace_path: str | None = None
    preview_path: str | None = None
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float = 0.0
    wall_seconds: float = 0.0


class Executor(Protocol):
    async def run(self, inp: ExecutorInput, log: Callable[[str, str], Awaitable[None]]) -> ExecutorResult: ...

# ------------------------------------------------------------------ world


class FaceNames(BaseModel):
    skin: str
    hair: str
    eyes: str
    outfit: str
    accessory: str


class FaceSpec(BaseModel):
    agent_id: str
    skin: str
    hair_style: Literal["short", "buzz", "bob", "long", "bun", "curly", "ponytail", "bald", "mohawk", "waves"]
    hair_color: str
    eye_color: str
    brow: Literal["straight", "arched", "thick"]
    nose: Literal["button", "round", "long"]
    accessory: Literal["none", "glasses_round", "glasses_square", "headset", "hard_hat", "beanie", "earrings", "scarf", "visor", "bowtie"]
    outfit: Literal["hoodie", "blazer", "overalls", "sweater", "vest", "jacket", "apron", "lab_coat"]
    outfit_color: str
    pants_color: str
    height: float = Field(ge=0.92, le=1.08)
    build: float = Field(ge=0.9, le=1.1)
    names: FaceNames


class RoadNode(BaseModel):
    id: str
    pos: tuple[float, float]


class ManifestBuilding(BaseModel):
    index: int
    department_id: str
    code: str
    building_id: str
    name: str
    department_name: str
    color: str
    theta: float
    plot_center: tuple[float, float]
    rotation_y: float
    footprint: tuple[float, float] = (28, 28)
    door_node: str
    sign_url: str
    module: Literal["generated", "fallback"] = "fallback"


class ManifestNpc(BaseModel):
    agent_id: str
    building_id: str  # 'plaza' for the concierge
    slot: str  # 's1'..'s6' or 'concierge'
    display_name: str
    title: str
    department_id: str
    portrait_url: str | None = None
    face: FaceSpec | None = None
    voice_ready: bool = False
    is_lead: bool = False
    generated: bool = False


class Manifest(BaseModel):
    version: int = 1
    seed: int = 1337
    plaza: dict[str, Any]
    roads: dict[str, Any]
    buildings: list[ManifestBuilding]
    npcs: list[ManifestNpc]


class StandupUpdate(BaseModel):
    agent_id: str
    text: str
    refs: list[dict[str, Any]] = Field(default_factory=list)


class StandupLatest(BaseModel):
    root_message_id: str | None
    created_at: str | None
    updates: list[StandupUpdate] = Field(default_factory=list)
    decisions: StandupUpdate | None = None

# ------------------------------------------------------------------ computers API (ayan) consumed by dashboard (tanush)


class ComputerAction(BaseModel):
    step: int
    action: dict[str, Any]
    reason: str = ""
    guard: Literal["allow", "gate", "block"]
    screenshot_url: str | None = None
    created_at: str


class ComputerTaskInfo(BaseModel):
    id: str
    goal: str
    steps: int
    status: str


class ComputerInfo(BaseModel):
    id: str
    agent_id: str
    provider: Literal["cua_sandbox", "cua_space"]
    status: str
    current_task: ComputerTaskInfo | None = None
    watch_url: str | None = None
