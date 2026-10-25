// OWNER: frozen contract (change only via docs/contract-requests/<you>.md, applied in the merge session)

// TypeScript mirror of the API objects in architecture-files/01-architecture/04-api-contract.md and
// kernel/foundry_kernel/contracts.py. After the merge, src/api/schema.d.ts (openapi-typescript) is
// generated too; these hand-written types stay as the stable names both halves of the web import.
import type { FaceSpec } from '../world/npc/FaceSpec';

export type Envelope<T> = { data: T };
export type ApiErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };
export type ListPage<T> = { items: T[]; next_cursor?: string | null };

export type VentureStatus = 'draft' | 'running' | 'paused' | 'done' | 'failed';
export interface Venture {
  id: string; name: string; slug: string; idea: string; founder_name: string; status: VentureStatus;
  budget_usd: number; spent_usd: number; repo_full_name: string | null; repo_url: string | null;
  created_at: string; updated_at: string;
  stats?: { tickets: Record<string, number>; approvals_pending: number; artifacts: number };
}

export interface TicketCounts { open: number; in_progress: number; waiting_approval: number; done: number; failed: number }
export interface Department {
  id: string; code: string; name: string; mission: string; building_id: string; building_name: string;
  color?: string; counts?: TicketCounts; agents: string[];
}

export interface AgentState { status: string; current_ticket_id: string | null; last_active_at: string | null }
export interface Agent {
  id: string; department_id: string; display_name: string; title: string; role_summary: string; model: string;
  tools: string[]; persona: string; voice_id: string | null; portrait_url: string | null; face: FaceSpec | null;
  npc_slot: string | null; is_lead: boolean; state?: AgentState;
}

export type TicketStatus = 'open' | 'in_progress' | 'waiting_approval' | 'blocked' | 'done' | 'failed' | 'cancelled';
export interface Ticket {
  id: string; type: string; department_id: string; assigned_agent_id: string | null; title: string; body: string;
  status: TicketStatus; priority: number; payload: Record<string, unknown>; result: Record<string, unknown> | null;
  depends_on: string[]; parent_ticket_id: string | null; generation: number; attempts: number; max_attempts: number;
  created_by: string; created_at: string; updated_at: string; completed_at: string | null;
}

export interface Run {
  id: string; ticket_id: string | null; agent_id: string | null; kind: string; job: string; model: string;
  status: string; tokens_in: number; tokens_out: number; cost_usd: number; interaction_id: string | null;
  created_at: string; started_at: string | null; completed_at: string | null; output_text?: string | null; error: string | null;
}
export interface RunLog { id: number; ts: string; level: string; message: string }

export interface Artifact {
  id: string; kind: string; title: string; summary: string; content_md?: string; uri: string | null;
  department_id: string | null; agent_id: string | null; ticket_id: string | null; meta: Record<string, unknown>; created_at: string;
}

export type GateType = 'merge' | 'public_post' | 'send' | 'spend' | 'new_capability' | 'integration' | 'clarification' | 'pivot' | 'computer_action';
export interface Approval {
  id: string; gate_type: GateType | string; status: 'pending' | 'approved' | 'rejected' | 'expired'; title: string;
  summary: string; payload: Record<string, unknown>; requested_by_agent_id: string | null; ticket_id: string | null;
  created_at: string; decided_at: string | null; decided_by: string | null; decision_note: string | null;
}

export interface Ref { kind: string; id: string }
export interface Channel { id: string; slug: string; name: string; kind: string; department_id: string | null; last_message_at: string | null; unread: number }
export interface Message {
  id: string; channel_id: string; author_kind: 'agent' | 'human' | 'system'; author_id: string | null; body: string;
  refs: Ref[]; kind: string; thread_root_id: string | null; reply_count: number; created_at: string;
}

// ---- conversation
export type CheckStatus = 'pending' | 'verified' | 'partial' | 'unsupported' | 'error';
export interface Citation { kind: string; id: string; quote: string; label: string }
export interface AnswerCheck { status: CheckStatus; per_citation: { index: number; status: CheckStatus; reason: string }[]; reason: string }
export interface ChatTurn { role: 'user' | 'agent'; text: string }
export interface TalkRequest { text: string; history?: ChatTurn[] }
export interface RouteCard {
  agent_id: string; agent_name: string; agent_title: string; department_id: string; building_id: string;
  building_name: string; reason: string; citations: Citation[];
}
export interface TalkResponse {
  answer_id: string; text: string; citations: Citation[]; check: AnswerCheck;
  suggested_agent: { agent_id: string; reason: string } | null; latency_ms: number;
}
export interface ConciergeResponse {
  answer_id: string; text: string; citations: Citation[]; check: AnswerCheck; route_card: RouteCard | null; latency_ms: number;
}

// ---- voice
export interface Alignment { chars: string[]; starts: number[]; ends: number[] }
export interface TtsResponse {
  audio_url: string | null; mime: string | null; alignment: Alignment | null;
  provider: 'elevenlabs' | 'gemini' | 'browser'; latency_ms: number;
}
export interface SttResponse { text: string; provider: 'gemini' | 'none'; latency_ms: number }
export interface LatencySample { agent_id: string; stt_ms: number; answer_ms: number; tts_ms: number; total_ms: number }

// ---- coordination
export interface StandupUpdate { agent_id: string; text: string; refs: Ref[] }
export interface StandupLatest {
  root_message_id: string | null; created_at: string | null; updates: StandupUpdate[];
  decisions: StandupUpdate | null; audio: { agent_id: string; audio_url: string | null; alignment: Alignment | null }[];
}

// ---- computers
export interface ComputerAction { step: number; action: Record<string, unknown>; reason: string; guard: 'allow' | 'gate' | 'block'; screenshot_url: string | null; created_at: string }
export interface Computer {
  id: string; agent_id: string; provider: string; status: string; watch_url: string | null;
  current_task: { id: string; goal: string; steps: number; status: string } | null;
}

// ---- world manifest (05-world/03-city-layout.md §Manifest)
export type XZ = [number, number];
export interface RoadNode { id: string; pos: XZ }
export interface ManifestBuilding {
  index: number; department_id: string; code: string; building_id: string; name: string; department_name: string;
  color: string; theta: number; plot_center: XZ; rotation_y: number; footprint: XZ; door_node: string;
  sign_url: string; module: 'generated' | 'fallback';
}
export interface ManifestNpc {
  agent_id: string; building_id: string; slot: string; display_name: string; title: string; department_id: string;
  portrait_url: string | null; face: FaceSpec | null; voice_ready: boolean; is_lead: boolean; generated: boolean;
}
export interface Manifest {
  version: number; seed: number;
  plaza: {
    radius: number; fountain: { pos: [number, number, number]; radius: number };
    concierge: { agent_id: string; pos: [number, number, number]; facing_y: number };
    spawn: { pos: [number, number, number]; yaw: number }; car: { pos: [number, number, number]; heading: number };
  };
  roads: { ring: { radius: number; width: number }; spoke_width: number; driveway_width: number; nodes: RoadNode[]; edges: [string, string][] };
  buildings: ManifestBuilding[];
  npcs: ManifestNpc[];
}

// ---- SSE (04-api-contract.md §SSE catalogue)
export type SseEventType =
  | 'venture.updated' | 'ticket.created' | 'ticket.updated' | 'run.started' | 'run.finished' | 'run.log'
  | 'artifact.created' | 'approval.requested' | 'approval.decided' | 'message.posted' | 'agent.status'
  | 'answer.checked' | 'ledger.updated' | 'system.warning' | 'worldgen.progress' | 'computer.updated'
  | 'computer.action' | 'standup.posted';
export interface SseEvent<T = unknown> {
  id: number; type: SseEventType | string; entity_kind: string | null; entity_id: string | null;
  level: string; created_at: string; data: T;
}
