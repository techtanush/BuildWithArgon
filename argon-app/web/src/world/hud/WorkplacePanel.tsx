// OWNER: mahin
import {useEffect, useRef, useState} from "react";
import {poll, safeWorldLink} from "../activity/network";
import {chatLink, loadCommunications, scopeActivity, type Activity} from "../activity/workplace";
type Communications = Awaited<ReturnType<typeof loadCommunications>>;
export function WorkplacePanel({ventureId, departmentId, name, mock, activity, activityError, onClose}: {
  ventureId: string | null; departmentId: string; name: string; mock: boolean;
  activity: Activity | null; activityError: string | null; onClose: () => void;
}) {
  const [data,setData] = useState<Communications | null>(null), [error,setError] = useState<string | null>(null), [selected,setSelected] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { const previous=document.activeElement as HTMLElement|null; closeRef.current?.focus(); return () => previous?.focus(); }, []);
  useEffect(() => {
    setData(null); setError(null);
    if (!ventureId || mock) return;
    return poll(signal => loadCommunications(ventureId, departmentId, selected, signal), value => {setData(value);setError(null);}, e => setError(e.message));
  }, [ventureId, departmentId, selected, mock]);
  const work = activity ? scopeActivity(activity,departmentId) : null;
  return <div className="modal-backdrop workplace-backdrop" onKeyDown={e => {
    if (e.key === "Escape") {e.stopPropagation();onClose();}
    if(e.key === "Tab") {
      const elements=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button,a[href],select')).filter(el=>!el.hasAttribute("disabled"));
      const first=elements[0],last=elements[elements.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
    e.stopPropagation();
  }}>
    <section className="world-modal workplace-panel" role="dialog" aria-modal="true" aria-labelledby="workplace-title">
      <header><div><span className="eyebrow">LIVE WORKSPACE · READ ONLY</span><h2 id="workplace-title">{name}</h2></div><button ref={closeRef} onClick={onClose} aria-label="Close workplace">Close · Esc</button></header>
      <h3>See communications</h3>
      {mock ? <p>Local world preview. Live communications and activity are disabled.</p> : !ventureId ? <p>Select a venture in the dashboard to see real communications.</p> : <>
        {error && <p role="alert">{error} {data && "Previously loaded messages may be out of date."}</p>}
        {!data && !error && <p role="status">Loading recorded team conversations…</p>}
        {data && <>
          {data.channels.length === 0 ? <p>No channel is recorded for this department.</p> : <label>Department channel <select value={data.channel?.id??""} onChange={e=>setSelected(e.target.value)}>{data.channels.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
          {data.channel && <a href={chatLink(ventureId,data.channel)}>Open #{data.channel.slug} in dashboard Chat</a>}
          {data.channel && !data.messages.length && <p>No messages yet. No conversation has been invented.</p>}
          <ol className="workplace-messages" aria-label="Recorded messages">{data.messages.map(m=><li key={m.id}><strong>{m.author_id}</strong> <small>{m.author_kind} · {new Date(m.created_at).toLocaleString()}</small><p>{m.body}</p>{!!m.reply_count&&<small>{m.reply_count} replies · open dashboard to read thread</small>}</li>)}</ol>
        </>}
        <h3>Recorded work</h3>{activityError&&<p role="alert">{activityError} Activity may be out of date.</p>}
        {!work ? <p>Activity has not loaded yet.</p> : <>
          <ul>{work.agents.map(a=><li key={a.id}>{a.display_name}: {a.state.status}</li>)}</ul>
          {!work.runs.length&&!work.tickets.length&&<p>No recent runs or tickets recorded for this department.</p>}
          <ul>{work.tickets.slice(0,10).map(t=><li key={t.id}><a href={"/tickets/"+encodeURIComponent(t.id)}>{t.title}</a> · {t.status}</li>)}{work.runs.slice(0,10).map(r=><li key={r.id}><a href={"/runs/"+encodeURIComponent(r.id)}>{r.job || r.kind}</a> · {r.status}</li>)}</ul>
          <ul>{work.artifacts.slice(0,10).map(a=><li key={a.id}><a href={"/artifacts/"+encodeURIComponent(a.id)}>{a.title}</a> · {a.kind}{(safeWorldLink(a.meta?.preview_url) || safeWorldLink(a.uri))&&<> · <a href={safeWorldLink(a.uri)!} target="_blank" rel="noopener noreferrer">Open recorded preview / artifact</a></>}</li>)}</ul>
        </>}
        <p className="workplace-note">Latest bounded records, refreshed every 10 seconds. Read-only: no builds, deployments, funding or calls are started here.</p>
      </>}
    </section>
  </div>;
}
