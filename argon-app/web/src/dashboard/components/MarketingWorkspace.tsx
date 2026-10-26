import { useEffect, useState } from 'react';
import { get, post } from '../../api/client';
import { useQuery } from '../../api/hooks';
import { IntegrationConnect } from './IntegrationConnect';
import { Card, ErrorNotice, useAction } from './Shared';
type Draft = {id:string;content:string;visibility:string;status:string;approval_id:string;review_hash:string;name?:string;author?:string;account_ref?:string;post_url?:string;error?:string;source_mode:string;artifact_id:string};
type Workspace = {tasks:{id:string;title:string;status:string}[];venture_status:string;artifacts:{id:string;title:string;uri:string;ticket_id:string;run_id:string;model:string}[];drafts:Draft[];connection?:{status:string;account_ref:string};setup:string};
export function MarketingWorkspace({ventureId}:{ventureId:string}) {
 const base=`/v1/ventures/${ventureId}/marketing`,query=useQuery<Workspace>(`${base}/workspace`,()=>get(`${base}/workspace`)),action=useAction();
 const [generation,setGeneration]=useState<{ticket_id:string;message:string}>();
 const [draft,setDraft]=useState<Draft>(),[content,setContent]=useState(''),[visibility,setVisibility]=useState('PUBLIC'),[reviewed,setReviewed]=useState(false);
 useEffect(()=>{setDraft(undefined);setContent('');setReviewed(false);setGeneration(undefined)},[ventureId]);
 const select=(d:Draft)=>{setDraft(d);setContent(d.content);setVisibility(d.visibility);setReviewed(false)};
 const locked=Boolean(draft&&['publishing','published','uncertain'].includes(draft.status));
 const changed=Boolean(draft&&(content!==draft.content||visibility!==draft.visibility));
 const validReview=Boolean(draft?.status==='review'&&!changed);
 return <Card title="Marketing studio"><p>Turn the actual marketing team's work into a downloadable plan and an editable LinkedIn post. Nothing is published until you review and click Post.</p>
 <ErrorNotice error={query.error??action.error}/>
 <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:24}}><section><h3>1. Marketing plan</h3>
 <button className="button primary" disabled={action.working} onClick={()=>void action.run(async()=>{setGeneration(await post<{ticket_id:string;message:string}>(`${base}/generate`));query.refetch()})}>Generate marketing plan</button>
 <p>Uses the company's existing Growth agent and model job, under its current budget and approval gates. This does not start a paused or draft company.</p>
 {generation&&<p role="status">{generation.message} <a href={`/tickets/${generation.ticket_id}`}>View live task</a></p>}
 {query.data?.tasks.map(t=><p key={t.id}><a href={`/tickets/${t.id}`}>{t.title}</a> · {t.status}</p>)}
 {!query.data?.artifacts.length&&<p>No completed marketing PDF yet. Ask the Growth department to create a launch plan; its real task output will appear here.</p>}
 {query.data?.artifacts.map(a=><div key={a.id} style={{padding:'12px 0',borderBottom:'1px solid var(--border)'}}><strong>{a.title}</strong><p><a href={a.uri} download>Download PDF</a> · <a href={`/artifacts/${a.id}`}>Source</a> · <a href={`/tickets/${a.ticket_id}`}>Task</a> · <a href={`/runs/${a.run_id}`}>{a.model||'Model run'}</a></p><button className="button" disabled={action.working} onClick={()=>void action.run(async()=>{select(await post<Draft>(`${base}/drafts`,{artifact_id:a.id}));query.refetch()})}>Prepare LinkedIn draft</button></div>)}
 <h3>2. Your LinkedIn account</h3><p>{query.data?.setup}</p><IntegrationConnect ventureId={ventureId} provider="linkedin" name="LinkedIn" status={query.data?.connection?.status}/>
 <button className="button ghost" onClick={()=>query.refetch()}>Refresh workspace</button>
 {query.data?.drafts.map(d=><p key={d.id}><button className="button ghost" onClick={()=>select(d)}>Open {d.status} · {d.id.slice(-6)}</button></p>)}</section>
 <section><h3>3. Review &amp; publish</h3>{!draft?<p>Choose a real plan to prepare your post. No sample copy is treated as finished work.</p>:<><p>{draft.source_mode} · <a href={`/artifacts/${draft.artifact_id}`}>View exact source</a></p><label>Post text<textarea aria-label="LinkedIn post text" style={{width:'100%',minHeight:260}} maxLength={3000} disabled={locked||action.working} value={content} onChange={e=>{setContent(e.target.value);setReviewed(false)}}/></label><p>{content.length}/3000 characters</p><label>Audience <select value={visibility} disabled={locked||action.working} onChange={e=>{setVisibility(e.target.value);setReviewed(false)}}><option value="PUBLIC">Public</option><option value="CONNECTIONS">Connections</option></select></label>
 <p><button className="button" disabled={locked||action.working||!content.trim()} onClick={()=>void action.run(async()=>{select(await post<Draft>(`${base}/drafts/${draft.id}/edit`,{content,visibility}));query.refetch()})}>Save draft</button> <button className="button" disabled={locked||action.working||!content.trim()} onClick={()=>void action.run(async()=>{await post(`${base}/drafts/${draft.id}/edit`,{content,visibility});select(await post<Draft>(`${base}/drafts/${draft.id}/review`));query.refetch()})}>Review publishing account</button></p>
 {validReview&&<div className="notice"><strong>Posting as {draft.name}</strong><p>{draft.author} · Account {draft.account_ref} · {draft.visibility}</p><label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/> I reviewed this exact text, account and audience. Publish this post.</label></div>}
 <button className="button primary" disabled={!validReview||!reviewed||action.working||locked} onClick={()=>void action.run(async()=>{await post(`/v1/approvals/${draft.approval_id}/decision`,{decision:'approve',decided_by:'Founder',note:'Explicit Post click after reviewing exact content, account and visibility.'});select(await post<Draft>(`${base}/drafts/${draft.id}/post`,{approval_id:draft.approval_id,review_hash:draft.review_hash}));query.refetch()})}>Post to LinkedIn</button><p role="status">Status: {draft.status}. {draft.error}</p>{draft.post_url&&/^https:\/\/www\.linkedin\.com\/feed\/update\/urn:li:(share|ugcPost):[0-9]+\/$/.test(draft.post_url)&&<a href={draft.post_url} target="_blank" rel="noopener noreferrer">View published post</a>}
 </>}</section></div></Card>
}
