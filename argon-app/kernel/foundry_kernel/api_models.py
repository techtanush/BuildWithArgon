# OWNER: tanush
"""Public response schemas shared by the owned API routers."""
from __future__ import annotations

from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel

from .contracts import AgentRuntime, ArtifactKind, FaceSpec, GateType, TicketStatus

T = TypeVar("T")


class Envelope(BaseModel, Generic[T]):
    data: T


class Page(BaseModel, Generic[T]):
    items: list[T]
    next_cursor: str | None = None


class VentureStats(BaseModel):
    tickets: dict[str, int]
    approvals_pending: int
    artifacts: int


class Venture(BaseModel):
    id: str
    name: str
    slug: str
    idea: str
    founder_name: str
    status: Literal["draft", "running", "paused", "archived"]
    budget_usd: float
    spent_usd: float
    repo_full_name: str | None
    repo_url: str | None
    created_at: str
    updated_at: str


class VentureDetail(Venture):
    stats: VentureStats


class TicketCounts(BaseModel):
    open: int = 0
    in_progress: int = 0
    waiting_approval: int = 0
    done: int = 0
    failed: int = 0


class Department(BaseModel):
    id: str
    code: str
    name: str
    mission: str
    building_id: str
    building_name: str
    counts: TicketCounts
    agents: list[str]


class AgentState(BaseModel):
    status: Literal["idle", "working", "waiting", "blocked"] = "idle"
    current_ticket_id: str | None = None
    last_active_at: str | None = None


class Agent(BaseModel):
    id: str
    department_id: str
    display_name: str
    title: str
    role_summary: str
    model: str
    tools: list[str]
    persona: str
    voice_id: str | None
    portrait_url: str | None
    face: FaceSpec | None
    npc_slot: str | None
    is_lead: bool
    state: AgentState
    runtime: AgentRuntime


class Ticket(BaseModel):
    id: str
    type: str
    department_id: str
    assigned_agent_id: str | None
    title: str
    body: str
    status: TicketStatus
    priority: int
    payload: dict[str, Any]
    result: dict[str, Any] | None
    depends_on: list[str]
    parent_ticket_id: str | None
    generation: int
    attempts: int
    max_attempts: int
    created_by: str
    created_at: str
    updated_at: str
    completed_at: str | None


class Run(BaseModel):
    id: str
    ticket_id: str | None
    agent_id: str | None
    kind: str
    job: str
    model: str
    status: Literal["queued", "running", "succeeded", "failed", "cancelled"]
    tokens_in: int
    tokens_out: int
    cost_usd: float
    interaction_id: str | None
    created_at: str
    started_at: str | None
    completed_at: str | None
    output_text: str | None = None
    error: str | None


class RunLog(BaseModel):
    id: int
    ts: str
    level: str
    message: str


class Artifact(BaseModel):
    id: str
    kind: ArtifactKind
    title: str
    summary: str
    content_md: str
    uri: str | None
    department_id: str
    agent_id: str | None
    ticket_id: str | None
    meta: dict[str, Any]
    created_at: str


class Approval(BaseModel):
    id: str
    gate_type: GateType
    status: Literal["pending", "approved", "rejected", "expired"]
    title: str
    summary: str
    payload: dict[str, Any]
    requested_by_agent_id: str | None
    ticket_id: str | None
    created_at: str
    decided_at: str | None
    decided_by: str | None
    decision_note: str | None


class Ref(BaseModel):
    kind: str
    id: str


class Message(BaseModel):
    id: str
    channel_id: str
    author_kind: Literal["agent", "human", "system"]
    author_id: str
    body: str
    refs: list[Ref]
    kind: str
    thread_root_id: str | None
    reply_count: int = 0
    created_at: str


class Channel(BaseModel):
    id: str
    slug: str
    name: str
    kind: str
    department_id: str | None
    last_message_at: str | None
    unread: int = 0


class Event(BaseModel):
    id: int
    type: str
    entity_kind: str | None
    entity_id: str | None
    level: str
    created_at: str
    data: dict[str, Any]


class TicketDetail(Ticket):
    runs: list[Run]
    artifacts: list[Artifact]
    approvals: list[Approval]
    children: list[Ticket]


class AgentDetail(Agent):
    recent_runs: list[Run]
    current_ticket: Ticket | None


class DepartmentDetail(Department):
    recent_tickets: list[Ticket]
    recent_artifacts: list[Artifact]
    channel_id: str
