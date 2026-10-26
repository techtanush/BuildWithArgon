import {useEffect, useState, type ComponentProps} from "react";
import {WorkplacePanel} from "./WorkplacePanel";
import {poll, safeWorldLink} from "../activity/network";
import type {StarterRecord} from "../../dashboard/components/StarterStatus";
import {scopeActivity, type Activity} from "../activity/workplace";
export function runningDepartmentAgents(activity: Activity | null, department: string) {
  if (!activity) return [];
  const scoped = scopeActivity(activity, department);
  return scoped.runs.filter(r => r.status === "running" && r.job !== "starter_tutor" && scoped.agents.some(a => a.id === r.agent_id));
}
export function DepartmentGroupChat(props: ComponentProps<typeof WorkplacePanel>) {
  const [starter,setStarter] = useState<StarterRecord|null>(null);
  const [error,setError] = useState<string|null>(null);
  useEffect(() => {
    setStarter(null); setError(null);
    if (!props.ventureId || props.mock) return;
    return poll(async signal => {
      const response = await fetch(`/v1/ventures/${encodeURIComponent(props.ventureId!)}/starter`, {method:"GET", signal});
      if (!response.ok) throw new Error(`Build status unavailable (${response.status})`);
      return (await response.json()).data as StarterRecord;
    }, value => {setStarter(value);setError(null);}, e => setError(e.message), 5000);
  }, [props.ventureId, props.mock]);
  const running = props.mock || props.activityError ? [] : runningDepartmentAgents(props.activity, props.departmentId);
  const preview = safeWorldLink(starter?.preview_url);
  const pdfs = props.activity ? scopeActivity(props.activity, props.departmentId).artifacts.filter(a=>/\.pdf(?:$|\?)/i.test(a.uri || "")) : [];
  const names=[...new Set(running.map(r=>props.activity?.agents.find(a=>a.id===r.agent_id)?.display_name || "Unknown agent"))];
  return <WorkplacePanel {...props} groupChat extra={<section className="workplace-live" aria-label="Live agent status and completion">
    {(starter?.status === "ready" || pdfs.length > 0) && <div className="workplace-completion"><div><span className="workplace-completion-label">PINNED · DELIVERABLES</span><strong>{starter?.status === "ready" ? "Build ready to review" : "Recorded documents"}</strong></div><div className="workplace-completion-links">{starter?.status === "ready" && preview && <a href={preview} target="_blank" rel="noopener noreferrer">Open built app ↗</a>}{pdfs.map(a=>{const href=safeWorldLink(a.uri);return href ? <a key={a.id} href={href} target="_blank" rel="noopener noreferrer">PDF · {a.title}</a> : null;})}</div></div>}
    {names.length > 0 && <div className="workplace-typing" role="status"><span className="workplace-typing-dots" aria-hidden="true"><i/><i/><i/></span><span>{names.join(", ")} {names.length===1 ? "is" : "are"} working <small>· recorded running jobs</small></span></div>}
    {props.activityError && <p className="workplace-alert" role="status">Live status unavailable. Typing cannot be confirmed.</p>}
    {error && <p className="workplace-alert" role="alert">{error}</p>}
    {starter && starter.status !== "ready" && <p className="workplace-build-status">Build status: {starter.status}</p>}
  </section>} />;
}
