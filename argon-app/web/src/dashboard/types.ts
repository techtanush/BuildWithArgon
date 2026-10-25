// OWNER: tanush
import type {
  Agent,
  Approval,
  Artifact,
  Department,
  Run,
  Ticket,
} from "../shared/contracts";
import manifest from "../world/data/manifest.fallback.json";
export interface SystemStatus {
  mode?: "fake" | "live";
  providers: Record<
    string,
    { configured: boolean; last_ok_at?: string | null }
  >;
  executor: string;
  worldgen: { last_run_id: string | null; final_score: number | null };
}
export interface AgentDetail extends Agent {
  recent_runs: Run[];
  current_ticket: Ticket | null;
}
export interface DepartmentDetail extends Department {
  recent_tickets: Ticket[];
  recent_artifacts: Artifact[];
  channel_id: string;
  paused?: boolean;
}
export interface TicketDetail extends Ticket {
  runs: Run[];
  artifacts: Artifact[];
  approvals: Approval[];
  children: Ticket[];
}
export interface SettingsData {
  founder_name: string;
  budget_usd: number;
  autopilot_next: boolean;
  quality_default: string;
  executor: string;
  approval_id?: string | null;
}
export interface Budget {
  budget_usd: number;
  spent_usd: number;
  by_department: { department_id: string | null; cost_usd: number }[];
  by_model: { model: string | null; cost_usd: number }[];
}
export const currency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
export const percent = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? "Not scored"
    : `${(value * 100).toFixed(1)}%`;
export const titleCase = (value: string) =>
  value
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
// The frozen fallback manifest is generated from the roster, including department colors.
export const colors: Record<string, string> = Object.fromEntries(
  manifest.buildings.map((building) => [
    building.department_id,
    building.color,
  ]),
);
const originalAgents=new Set(manifest.npcs.map(agent=>agent.agent_id));
export const generatedHire=(id:string)=>!originalAgents.has(id);
export function safeUrl(value: string | null | undefined): string | undefined {
  if (!value) return;
  try {
    const parsed = new URL(value, "https://foundry.local");
    if (
      /^https?:\/\//i.test(value) &&
      ["http:", "https:"].includes(parsed.protocol)
    )
      return value;
    if (
      value.startsWith("/") &&
      !value.startsWith("//") &&
      parsed.origin === "https://foundry.local"
    )
      return value;
  } catch {
    /* Invalid links are rendered as text. */
  }
}
export function entityLink(kind: string, id: string): string {
  const route: Record<string, string> = {
    ticket: "tickets",
    artifact: "artifacts",
    run: "runs",
    agent: "agents",
    department: "departments",
    approval: "approvals",
    message: "chat",
    computer_task: "computer-tasks",
  };
  if (kind === "approval") return `/approvals?id=${encodeURIComponent(id)}`;
  return route[kind] ? `/${route[kind]}/${encodeURIComponent(id)}` : "/";
}
