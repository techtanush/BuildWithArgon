import {useEffect, useState, type ComponentProps} from "react";
import {WorkplacePanel, roomPoll} from "./WorkplacePanel";
import {poll, safeWorldLink} from "../activity/network";
import type {StarterRecord} from "../../dashboard/components/StarterStatus";
import {scopeActivity, type Activity} from "../activity/workplace";
export function runningDepartmentAgents(activity: Activity | null, department: string) {
  if (!activity) return [];
  const scoped = scopeActivity(activity, department);
  return scoped.runs.filter(r => r.status === "running" && r.job !== "starter_tutor" && scoped.agents.some(a => a.id === r.agent_id));
}
export interface MarketingArtifact { id: string; title: string; uri: string | null; model?: string | null; created_at?: string; meta_json?: string | null; meta?: Record<string, unknown>; }
export interface MarketingWorkspace { tasks: {id: string; title: string; status: string}[]; artifacts: MarketingArtifact[]; venture_status?: string; }
export function marketingMetadata(artifact: MarketingArtifact): Record<string, unknown> {
  if (artifact.meta && typeof artifact.meta === "object") return artifact.meta;
  try { const value: unknown = JSON.parse(artifact.meta_json || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; } catch { return {}; }
}
export function marketingPdf(uri: unknown, ventureId: string): string | null {
  if (typeof uri !== "string") return null;
  const prefix = "/v1/ventures/" + encodeURIComponent(ventureId) + "/marketing/";
  return uri.startsWith(prefix) && /^[a-f0-9]{64}\.pdf$/.test(uri.slice(prefix.length)) ? uri : null;
}
export function marketingActive(workspace: MarketingWorkspace | null) {
  return !!workspace?.tasks.some(t => ["open", "in_progress", "waiting_approval", "approved", "blocked", "queued", "running"].includes(t.status));
}
export function DepartmentGroupChat(props: ComponentProps<typeof WorkplacePanel>) {
  const marketing = props.departmentId === "growth";
  const [workspace,setWorkspace] = useState<MarketingWorkspace|null>(null);
  const [submitting,setSubmitting] = useState(false);
  const [notice,setNotice] = useState<string|null>(null);
  const [revision,setRevision] = useState(0);
  const [starter,setStarter] = useState<StarterRecord|null>(null);
  const [error,setError] = useState<string|null>(null);
  useEffect(() => {
    setStarter(null); setError(null);
    if (!props.ventureId || props.mock || props.departmentId !== "engineering") return;
    return poll(async signal => {
      const response = await fetch(`/v1/ventures/${encodeURIComponent(props.ventureId!)}/starter`, {method:"GET", signal});
      if (!response.ok) throw new Error(`Build status unavailable (${response.status})`);
      return (await response.json()).data as StarterRecord;
    }, value => {setStarter(value);setError(null);}, e => setError(e.message), 5000);
  }, [props.ventureId, props.mock, props.departmentId]);
  const active = submitting || marketingActive(workspace);
  useEffect(() => {
    setWorkspace(null); setNotice(null);
  }, [props.ventureId, props.departmentId]);
  useEffect(() => {
    if (!marketing || !props.ventureId || props.mock) return;
    return roomPoll(async signal => {
      const response = await fetch(`/v1/ventures/${encodeURIComponent(props.ventureId!)}/marketing/workspace`, {signal});
      if (!response.ok) throw new Error(`Marketing workspace unavailable (${response.status})`);
      const body = await response.json();
      if (!Array.isArray(body?.data?.tasks) || !Array.isArray(body?.data?.artifacts)) throw new Error("Unreadable marketing workspace");
      return body.data as MarketingWorkspace;
    }, value => {setWorkspace(value);setError(null);}, e => setError(e.message), active ? 2500 : 10000);
  }, [marketing, props.ventureId, props.mock, active, revision]);
  async function generate() {
    if (!marketing || !props.ventureId || props.mock || active || !workspace || error) return;
    setSubmitting(true); setNotice(null);
    try {
      const response = await fetch(`/v1/ventures/${encodeURIComponent(props.ventureId)}/marketing/generate`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({})});
      if (!response.ok) throw new Error(`Research could not be queued (${response.status})`);
      const {data} = await response.json();
      if (!data?.ticket_id || typeof data.status !== "string") throw new Error("Unreadable research response");
      setWorkspace(w => w ? {...w, tasks:[{id:data.ticket_id,title:"Market research & launch plan",status:data.status},...w.tasks.filter(t=>t.id!==data.ticket_id)]} : w);
      setNotice(typeof data.message === "string" ? data.message : "Research task queued.");
      setRevision(r=>r+1);
    } catch (e) {setError(e instanceof Error ? e.message : "Research could not be queued");}
    finally {setSubmitting(false);}
  }
  const running = props.mock || props.activityError ? [] : runningDepartmentAgents(props.activity, props.departmentId);
  const preview = safeWorldLink(props.departmentId === "engineering" ? starter?.preview_url : null);
  const pdfs = props.activity ? scopeActivity(props.activity, props.departmentId).artifacts.filter(a=>/\.pdf(?:$|\?)/i.test(a.uri || "")) : [];
  const names=[...new Set(running.map(r=>props.activity?.agents.find(a=>a.id===r.agent_id)?.display_name || "Unknown agent"))];
  return <WorkplacePanel {...props} pollInterval={marketing && active ? 2500 : 10000} groupChat extra={<section className="workplace-live" aria-label="Live agent status and completion">
    {marketing && <section className="workplace-completion" aria-label="Market research & launch plan"><div><span className="workplace-completion-label">MARKETING WORKSPACE</span><h3>Market research &amp; launch plan</h3><p>Research uses up to $0.25 in existing Gemini credits within this venture’s budget. No wallet top-up. No public posting.</p><button onClick={generate} disabled={props.mock || !props.ventureId || !workspace || !!error || active}>Research market &amp; create PDF</button>{notice && <p role="status">{notice}</p>}{workspace && <><p>Company: {workspace.venture_status || "Status not reported"}</p>{workspace.tasks.map(t=><p key={t.id}>{t.title}: {t.status}</p>)}{workspace.artifacts.map(a=>{const uri=props.ventureId && marketingPdf(a.uri,props.ventureId); if (!uri) return null; const meta=marketingMetadata(a); const sources = Array.isArray(meta.source_refs) ? meta.source_refs.slice(0,50) : Array.isArray(meta.sources) ? meta.sources.slice(0,50) : []; const count=sources.length ? sources.length : typeof meta.source_count === "number" ? meta.source_count : null; return <div key={a.id}><strong>{meta.research_mode === "brief_based" ? "Launch-plan draft ready" : "Research PDF ready"}</strong><p>{a.title}{a.model && <> · Model: {a.model}</>}{a.created_at && <> · {a.created_at}</>}{count !== null && <> · Sources: {count}</>}</p><a href={uri} download target="_blank" rel="noopener noreferrer">{meta.research_mode === "brief_based" ? "Download plan draft PDF" : "Download researched PDF"}</a>{meta.research_mode === "brief_based" && <p>Based on your brief. External market evidence still needs validation.</p>}{sources.length > 0 && <ul>{sources.map((source,i)=>{const raw=typeof source === "string" ? source : source && typeof source === "object" && "url" in source ? String(source.url) : null; const href=raw && safeWorldLink(raw); return href?.startsWith("https://") ? <li key={i}><a href={href} target="_blank" rel="noopener noreferrer">{raw}</a></li> : null;})}</ul>}</div>;})}{!workspace.artifacts.some(a=>props.ventureId && marketingPdf(a.uri,props.ventureId)) && <p>No researched PDF recorded yet.</p>}</>}</div></section>}
    {!marketing && (starter?.status === "ready" || pdfs.length > 0) && <div className="workplace-completion"><div><span className="workplace-completion-label">PINNED · DELIVERABLES</span><strong>{starter?.status === "ready" ? "Build ready to review" : "Recorded documents"}</strong></div><div className="workplace-completion-links">{starter?.status === "ready" && preview && <a href={preview} target="_blank" rel="noopener noreferrer">Open built app ↗</a>}{pdfs.map(a=>{const href=safeWorldLink(a.uri);return href ? <a key={a.id} href={href} target="_blank" rel="noopener noreferrer">PDF · {a.title}</a> : null;})}</div></div>}
    {names.length > 0 && <div className="workplace-typing" role="status"><span className="workplace-typing-dots" aria-hidden="true"><i/><i/><i/></span><span>{names.join(", ")} {names.length===1 ? "is" : "are"} working <small>· recorded running jobs</small></span></div>}
    {props.activityError && <p className="workplace-alert" role="status">Live status unavailable. Typing cannot be confirmed.</p>}
    {error && <p className="workplace-alert" role="alert">{error}</p>}
    {!marketing && starter && starter.status !== "ready" && <p className="workplace-build-status">Build status: {starter.status}</p>}
  </section>} />;
}
