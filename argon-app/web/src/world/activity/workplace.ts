// OWNER: mahin
import {readPage} from "./network";
export interface Channel {id: string; slug: string; name: string; kind: string; department_id: string | null}
export interface Message {id: string; channel_id: string; author_id: string; author_kind: string; body: string; created_at: string; reply_count?: number}
export interface Agent {id: string; department_id: string; display_name: string; state: {status: string; current_ticket_id?: string | null}}
export interface Run {id: string; agent_id: string | null; ticket_id: string | null; status: string; kind: string; job: string; completed_at: string | null}
export interface Ticket {id: string; department_id: string; title: string; status: string}
export interface Artifact {id: string; department_id: string; title: string; kind: string; uri: string | null; created_at?: string; meta?: {preview_url?: unknown}}
export interface Activity {agents: Agent[]; runs: Run[]; tickets: Ticket[]; artifacts: Artifact[]}
export const venturePath = (id: string) => "/v1/ventures/" + encodeURIComponent(id);
export function departmentChannels(channels: Channel[], department: string) {
  return channels.filter(c => c.department_id === department || (department === "chief-of-staff" && c.kind === "exec"));
}
export async function loadCommunications(venture: string, department: string, selected: string | null, signal: AbortSignal) {
  const channels = departmentChannels(await readPage<Channel>(venturePath(venture) + "/channels", signal), department);
  const channel = channels.find(c => c.id === selected) ?? channels[0] ?? null;
  const messages = channel ? await readPage<Message>("/v1/channels/" + encodeURIComponent(channel.id) + "/messages?limit=50", signal) : [];
  return {channels, channel, messages: messages.filter(m => m.channel_id === channel?.id)};
}
export async function loadActivity(venture: string, signal: AbortSignal): Promise<Activity> {
  const base = venturePath(venture);
  const [agents,runs,tickets,artifacts] = await Promise.all([
    readPage<Agent>(base+"/agents", signal), readPage<Run>(base+"/runs?limit=100", signal),
    readPage<Ticket>(base+"/tickets?limit=100", signal), readPage<Artifact>(base+"/artifacts?limit=50", signal),
  ]);
  return {agents,runs,tickets,artifacts};
}
export function scopeActivity(data: Activity, department: string): Activity {
  const agents = data.agents.filter(a => a.department_id === department), tickets = data.tickets.filter(t => t.department_id === department);
  return {agents,tickets,artifacts:data.artifacts.filter(a=>a.department_id===department), runs:data.runs.filter(r=>agents.some(a=>a.id===r.agent_id)||tickets.some(t=>t.id===r.ticket_id))};
}
/** First read establishes a baseline, never announces existing history. */
export class CompletionTracker {
  private previous: Map<string,string> | null = null;
  private startedAt = Date.now();
  observe(runs: Run[]): Run[] {
    const finished = runs.filter(r => ["succeeded","failed","cancelled"].includes(r.status) && this.previous !== null && (
      (this.previous.has(r.id) && ["queued","running"].includes(this.previous.get(r.id)!)) ||
      (!this.previous.has(r.id) && !!r.completed_at && Date.parse(r.completed_at) > this.startedAt)
    ));
    const next = new Map(this.previous); for (const r of runs) next.set(r.id,r.status);
    while (next.size > 1000) next.delete(next.keys().next().value!);
    this.previous = next;
    return finished;
  }
}
export function chatLink(venture: string, channel: Channel) {
  return "/chat/" + encodeURIComponent(channel.slug) + "?venture=" + encodeURIComponent(venture) + "&channel=" + encodeURIComponent(channel.id);
}
