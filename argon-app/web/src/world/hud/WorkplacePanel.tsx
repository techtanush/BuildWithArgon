// OWNER: mahin
import {useEffect, useRef, useState, type ReactNode} from "react";
import {safeWorldLink} from "../activity/network";
import {chatLink, loadCommunications, scopeActivity, type Activity} from "../activity/workplace";
export function roomPoll<T>(read: (signal: AbortSignal) => Promise<T>, accept: (value: T) => void, fail: (error: Error) => void, interval = 10000) {
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined;
  const tick = async () => {
    controller = new AbortController(); const timeout = setTimeout(() => controller?.abort(), 12000);
    try { const value = await read(controller.signal); if (!stopped) accept(value); }
    catch (e) { if (!stopped) fail(e instanceof Error ? e : new Error("Workspace unavailable")); }
    finally { clearTimeout(timeout); controller.abort(); if (!stopped) timer = setTimeout(tick, interval); }
  };
  void tick(); return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
}
export interface SourceAuthorContext { authorId: string; authorKind: string }
export function MessageBody({body, source}: {body: string; source: SourceAuthorContext}) {
  if (source.authorKind !== "agent") return <>{body}</>;
  return <>{body.split(/(https:\/\/[^\s<>"']+)/g).map((part, i) => {
    if (!part.startsWith("https://")) return part;
    const url = part.replace(/[.,;:!?)\]]+$/, ""), tail = part.slice(url.length);
    try { const parsed = new URL(url); if (parsed.protocol !== "https:" || parsed.username || parsed.password) return part; }
    catch { return part; }
    return <span key={i}><a href={url} target="_blank" rel="noopener noreferrer">{url}</a>{tail}</span>;
  })}</>;
}
type Communications = Awaited<ReturnType<typeof loadCommunications>>;
export function messageIdentity(authorId: string, kind: string, activity: Activity | null) {
  const agent = activity?.agents.find(a => a.id === authorId);
  const name = agent?.display_name || (kind === "human" || kind === "user" ? "Human" : "Unknown agent");
  return {name, known: !!agent?.display_name, human: kind === "human" || kind === "user", initials: name.split(/\s+/).map(s=>s[0]).slice(0,2).join("").toUpperCase(), color: [...authorId].reduce((n,c)=>n+c.charCodeAt(0),0)%5};
}
export function WorkplacePanel({ventureId, departmentId, name, mock, activity, activityError, onClose, groupChat = false, extra, pollInterval = 10000}: {
  groupChat?: boolean; extra?: ReactNode; pollInterval?: number; ventureId: string | null; departmentId: string; name: string; mock: boolean;
  activity: Activity | null; activityError: string | null; onClose: () => void;
}) {
  const [data,setData] = useState<Communications | null>(null), [error,setError] = useState<string | null>(null), [selected,setSelected] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { const previous=document.activeElement as HTMLElement|null; closeRef.current?.focus(); return () => previous?.focus(); }, []);
  useEffect(() => {
    setData(null); setError(null);
    if (!ventureId || mock) return;
    return roomPoll(signal => loadCommunications(ventureId, departmentId, selected, signal), value => {setData(value);setError(null);}, e => setError(e.message), pollInterval);
  }, [ventureId, departmentId, selected, mock, pollInterval]);
  const work = activity ? scopeActivity(activity,departmentId) : null;
  const messages = [...(data?.messages || [])].sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));
  const replyHref = ventureId && data?.channel ? chatLink(ventureId,data.channel) : `/departments/${encodeURIComponent(departmentId)}`;
  return <div className="modal-backdrop workplace-backdrop" onKeyDown={e => {
    if (e.key === "Escape") {e.stopPropagation();onClose();}
    if(e.key === "Tab") {
      const elements=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button,a[href],select,summary,[tabindex="0"]')).filter(el=>!el.hasAttribute("disabled") && el.getClientRects().length > 0);
      const first=elements[0],last=elements[elements.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
    e.stopPropagation();
  }} onKeyUp={e=>e.stopPropagation()}>
    <section className="world-modal workplace-panel" role="dialog" aria-modal="true" aria-labelledby="workplace-title">
      <header className="workplace-header"><span className="workplace-room-icon" aria-hidden="true">#</span><div className="workplace-heading"><h2 id="workplace-title">{name}</h2><p>{groupChat ? "Department group chat" : "Team conversations"}<span> · {work ? `${work.agents.length} members` : "Members loading"}</span></p></div><button ref={closeRef} onClick={onClose} aria-label="Close workplace">×<span className="workplace-sr"> Close · Esc</span></button></header>
      {data && data.channels.length > 1 && <label className="workplace-channel">Channel <select value={data.channel?.id??""} onChange={e=>setSelected(e.target.value)}>{data.channels.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      <div className="workplace-content">
        {extra}
        {mock ? <p className="workplace-empty">Local world preview. Live communications and activity are disabled.</p> : !ventureId ? <p className="workplace-empty">Select a venture in the dashboard to see real communications.</p> : <>
          {error && <p className="workplace-alert" role="alert">{error} {data && "Previously loaded messages may be out of date."}</p>}
          {!data && !error && <p className="workplace-empty" role="status">Loading recorded team conversations…</p>}
          {data && <>
            {data.channels.length === 0 && <p className="workplace-empty">No channel is recorded for this department.</p>}
            {data.channel && !messages.length && <p className="workplace-empty">No messages yet. Recorded team conversations will appear here.</p>}
            <ol className="workplace-messages" aria-label="Recorded messages">{messages.map((m,index)=>{
              const identity=messageIdentity(m.author_id,m.author_kind,activity);
              const date=new Date(m.created_at), previous=messages[index-1];
              const day=date.toLocaleDateString(undefined,{month:"long",day:"numeric",year:"numeric"});
              const newDay=!previous || new Date(previous.created_at).toDateString()!==date.toDateString();
              return <li key={m.id} className="workplace-message-item">{newDay && <div className="workplace-day"><span>{day}</span></div>}<article className={`workplace-message ${identity.human ? "is-human" : "is-agent"}`}><span className={`workplace-avatar tone-${identity.color}`} aria-hidden="true">{identity.initials}</span><div className="workplace-message-main"><div className="workplace-message-meta"><strong>{identity.name}</strong><span className="workplace-role">{identity.human ? "Human" : "Agent"}</span><time dateTime={m.created_at} title={date.toLocaleString()}>{date.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})}</time></div>{!identity.known && <small className="workplace-author-id">{m.author_id}</small>}<div className="workplace-bubble">{m.body.length > 1200 ? <><p className="workplace-message-preview">{<MessageBody body={m.body.slice(0,320)} source={{authorId:m.author_id,authorKind:m.author_kind}}/>}…</p><details className="workplace-full-message"><summary>Read full message</summary><div><MessageBody body={m.body} source={{authorId:m.author_id,authorKind:m.author_kind}}/></div></details></> : <MessageBody body={m.body} source={{authorId:m.author_id,authorKind:m.author_kind}}/>}</div>{!!m.reply_count && <a className="workplace-thread" href={replyHref}>{m.reply_count} replies · View thread</a>}</div></article></li>;
            })}</ol>
          </>}
        </>}
      </div>
      <details className="workplace-records"><summary>Tickets, models &amp; raw records <span>Read only</span></summary><div className="workplace-records-body">
        {activityError && <p role="alert">{activityError} Activity may be out of date.</p>}
        {!work ? <p>Activity has not loaded yet.</p> : <><h3>Team status</h3><ul>{work.agents.map(a=><li key={a.id}>{a.display_name}: {a.state.status}</li>)}</ul><h3>Tickets &amp; runs</h3>{!work.runs.length&&!work.tickets.length&&<p>No recent runs or tickets recorded.</p>}<ul>{work.tickets.slice(0,10).map(t=><li key={t.id}><a href={"/tickets/"+encodeURIComponent(t.id)}>{t.title}</a> · {t.status}</li>)}{work.runs.slice(0,10).map(r=><li key={r.id}><a href={"/runs/"+encodeURIComponent(r.id)}>{r.job || r.kind}</a> · {r.status}{r.model && <> · {r.model}</>}</li>)}</ul><h3>Artifacts</h3><ul>{work.artifacts.slice(0,10).map(a=><li key={a.id}><a href={"/artifacts/"+encodeURIComponent(a.id)}>{a.title}</a> · {a.kind}{(safeWorldLink(a.meta?.preview_url) || safeWorldLink(a.uri))&&<> · <a href={(safeWorldLink(a.meta?.preview_url) || safeWorldLink(a.uri))!} target="_blank" rel="noopener noreferrer">Open recorded preview / artifact</a></>}</li>)}</ul></>}
        <a href={`/departments/${encodeURIComponent(departmentId)}`}>Open department workspace</a><p className="workplace-note">Latest bounded records, refreshed periodically. Research starts only from the explicit research button; no deployment or public posting is started here.</p>
      </div></details>
      <footer className="workplace-composer"><div><span className="workplace-readonly">Read-only room</span><p>Continue the conversation in dashboard Chat.</p></div><a href={replyHref}>{data?.channel ? "Reply in dashboard chat" : "Open department workspace"}<span aria-hidden="true"> ↗</span></a></footer>
    </section>
  </div>;
}
