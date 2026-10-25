// OWNER: tanush
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, get, post } from '../../api/client';
import { invalidateQueries, patchQuery, useQuery } from '../../api/hooks';
import { subscribe } from '../../api/sse';
import type { Agent, CaptureSet, Department, ListPage, LiveRound, WorldgenBuildingHistory, WorldgenIterationScore, WorldgenRun, WorldgenRunSummary } from '../../shared/contracts';
import { Card, Empty, ErrorNotice, Loading, PageHeader, Status, useAction } from '../components/Shared';
import { useCompany } from '../context';
import { percent, titleCase } from '../types';
import { captureUrl, comparisonCameras, displayRound, finalIteration, roundElapsed, scoreSeries, weakestDepartment, worldLink, type ScoreKey } from './worldLabModel';
import './WorldLab.css';

const base='/v1/world/worldgen';
async function optional<T>(path:string, fallback:T):Promise<T>{
  try{return await get<T>(path);}catch(error){if(error instanceof ApiError&&error.status===404)return fallback;throw error;}
}
const date=(value:string)=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString():value;
const elapsed=(seconds:number)=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
const running=(round:LiveRound|undefined)=>!!round&&!['done','failed'].includes(round.status);

function Capture({url,label}:{url:string;label:string}){
  const safe=captureUrl(url),[failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[url]);
  return safe&&!failed?<a className="wl-capture" href={safe} target="_blank" rel="noreferrer"><img src={safe} alt={label} loading="lazy" onError={()=>setFailed(true)}/><span>{label} ↗</span></a>:<div className="wl-missing">Capture unavailable: {label}</div>;
}
function Videos({captures,label}:{captures:CaptureSet;label:string}){
  const videos=Object.entries(captures.videos).filter(([,url])=>captureUrl(url));
  if(!videos.length)return <p className="muted">No walkthrough video recorded for {label.toLowerCase()}.</p>;
  return <div className="wl-videos">{videos.map(([camera,url])=><figure key={camera}><video controls preload="none" src={captureUrl(url)} aria-label={`${label} ${camera} walkthrough`}/><figcaption>{label} · {titleCase(camera)} walkthrough</figcaption></figure>)}</div>;
}
function Issues({issues,keep=[]}:{issues:WorldgenBuildingHistory['iterations'][number]['issues'];keep?:string[]}){
  return <div className="wl-critic"><h4>Critic notes</h4>{issues.length?<ul>{issues.map((issue,index)=><li key={index}><Status value={issue.severity}/><strong>{issue.where} · {issue.camera}</strong><p>{issue.description}</p><p className="muted">Suggested fix: {issue.fix}</p></li>)}</ul>:<p className="muted">No critic issues recorded.</p>}{keep.length>0&&<><h4>Keep</h4><ul>{keep.map((item,index)=><li key={index}>{item}</li>)}</ul></>}</div>;
}
function ScoreCurve({iterations}:{iterations:WorldgenIterationScore[]}){
  const rows=[...iterations].sort((a,b)=>a.n-b.n),max=Math.max(1,...rows.map(row=>row.n)),width=760,height=250,left=48,top=16,plotW=width-left-24,plotH=height-top-44;
  const series:{key:ScoreKey;label:string;color:string}[]=[{key:'world_score',label:'World score',color:'#527A70'},{key:'visual_score',label:'Visual score',color:'#C56E43'},{key:'realism',label:'Realism',color:'#697FAD'}];
  const y=(score:number)=>top+(1-Math.max(0,Math.min(1,score)))*plotH,x=(n:number)=>left+n/max*plotW;
  return <>{rows.length?<><svg className="wl-curve" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="World, visual and realism scores by iteration; iteration zero is the single-pass baseline"><title>Recorded world generation score curve</title>{[0,.25,.5,.75,1].map(value=><g key={value}><line x1={left} x2={width-24} y1={y(value)} y2={y(value)} stroke="#e6e1d8"/><text x={left-8} y={y(value)+4} textAnchor="end">{Math.round(value*100)}%</text></g>)}{rows.map(row=><text key={row.n} x={x(row.n)} y={height-16} textAnchor="middle">{row.n===0?'0 · baseline':row.n}</text>)}{series.map(series=>{
      const points=scoreSeries(rows,series.key),segments:string[][]=[];let segment:string[]=[];
      points.forEach(point=>{if(point.score===null){if(segment.length)segments.push(segment);segment=[];}else segment.push(`${x(point.n)},${y(point.score)}`);});if(segment.length)segments.push(segment);
      return <g key={series.key}>{segments.map((segment,index)=><polyline key={index} points={segment.join(' ')} fill="none" stroke={series.color} strokeWidth="2.5"/>)}{points.filter((p):p is {n:number;score:number}=>p.score!==null).map(point=><circle key={point.n} cx={x(point.n)} cy={y(point.score)} r="4" fill={series.color}><title>{series.label}, iteration {point.n}: {percent(point.score)}</title></circle>)}</g>;
    })}</svg><div className="wl-legend">{series.map(item=><span key={item.key}><i style={{background:item.color}}/>{item.label}</span>)}<span>Iteration 0 = single pass</span></div><details className="wl-score-data"><summary>View recorded scores</summary><table><thead><tr><th>Iteration</th><th>World</th><th>Visual</th><th>Realism</th></tr></thead><tbody>{rows.map(row=><tr key={row.n}><td>{row.n===0?'0 — single-pass baseline':row.n}</td><td>{percent(row.world_score)}</td><td>{percent(row.visual_score)}</td><td>{percent(row.realism)}</td></tr>)}</tbody></table></details></>:<Empty title="No iteration scores recorded">A generation run will add the single-pass baseline and improvement scores here.</Empty>}</>;
}
function Filmstrip({building,name}:{building:WorldgenBuildingHistory;name:string}){
  const[allCameras,setAllCameras]=useState(false);
  return <details className="wl-building"><summary><strong>{name}</strong><span>{building.iterations.length} recorded iterations</span><Status value={building.status}/></summary><div className="wl-building-content"><label className="wl-checkbox"><input type="checkbox" checked={allCameras} onChange={event=>setAllCameras(event.target.checked)}/> Show all recorded camera angles</label><div className="wl-filmstrip">{[...building.iterations].sort((a,b)=>a.n-b.n).map(iteration=>{
    const cameras=Object.entries(iteration.captures.screenshots).filter(([camera])=>allCameras||['ext-1','int-1'].includes(camera));
    return <article className="wl-iteration" key={iteration.n}><h3>{iteration.n===0?'Iteration 0 · single-pass baseline':`Iteration ${iteration.n}`}{iteration.n===building.best_iteration&&<span className="wl-current">Selected module</span>}</h3><p className="muted">Probes {percent(iteration.probe_score)} · Visual {percent(iteration.visual_score)} · Realism {percent(iteration.realism)}</p>{cameras.length?cameras.map(([camera,url])=><Capture key={camera} url={url} label={`${camera} · iteration ${iteration.n}`}/>):<p className="muted">No screenshots recorded for these angles.</p>}<Videos captures={iteration.captures} label={`Iteration ${iteration.n}`}/><Issues issues={iteration.issues} keep={iteration.keep}/>{iteration.failed_probes.length>0&&<p className="wl-failures">Failed probes: {iteration.failed_probes.join(', ')}</p>}</article>;
  })}</div></div></details>;
}
function Comparison({round}:{round:LiveRound}){
  const cameras=comparisonCameras(round.before,round.after),[camera,setCamera]=useState(''),[position,setPosition]=useState(50);
  const selected=cameras.includes(camera)?camera:cameras[0];
  useEffect(()=>{setCamera('');setPosition(50);},[round.id]);
  const before=selected?captureUrl(round.before.captures.screenshots[selected]):undefined,after=selected&&round.after?captureUrl(round.after.captures.screenshots[selected]):undefined;
  return <div className="wl-comparison"><div className="wl-score-comparison"><div/><strong>Before</strong><strong>After</strong>{(['probe_score','visual_score','realism'] as const).map(key=><div className="wl-score-row" key={key}><span>{key==='probe_score'?'Probes':titleCase(key)}</span><strong>{percent(round.before[key])}</strong><strong>{percent(round.after?.[key])}</strong></div>)}</div>{before&&after?<><div className="wl-compare-controls"><label>Camera<select value={selected} onChange={event=>setCamera(event.target.value)}>{cameras.map(value=><option key={value}>{value}</option>)}</select></label><span>Before ← drag to compare → After</span></div><div className="wl-image-comparison"><img src={before} alt={`${selected} before improvement`}/><img src={after} alt={`${selected} after improvement`} style={{clipPath:`inset(0 0 0 ${position}%)`}}/><span className="wl-before-label">Before</span><span className="wl-after-label">After</span><div className="wl-slider-line" style={{left:`${position}%`}}/></div><label className="wl-range">Compare before and after<input type="range" min="0" max="100" value={position} onChange={event=>setPosition(Number(event.target.value))} aria-label="Before and after comparison"/></label></>:<Empty title="No matching before/after screenshots">Comparison needs the same camera angle in both saved capture sets.</Empty>}<div className="wl-video-comparison"><div><h4>Before</h4><Videos captures={round.before.captures} label="Before"/></div><div><h4>After</h4>{round.after?<Videos captures={round.after.captures} label="After"/>:<p className="muted">After captures have not been recorded.</p>}</div></div><h3>Issues targeted by this round</h3><p className="muted">These are the critic’s recorded issues. Compare the captures and scores to assess the result.</p><Issues issues={round.issues}/></div>;
}

export default function WorldLab(){
  const manualDepartment=useRef(false);
  const{ventureId}=useCompany(),[selectedRun,setSelectedRun]=useState(''),[department,setDepartment]=useState(''),[roundId,setRoundId]=useState(''),[started,setStarted]=useState<LiveRound>(),[now,setNow]=useState(Date.now()),action=useAction();
  const latest=useQuery<WorldgenRunSummary|null>(`${base}/latest`,()=>optional(`${base}/latest`,null));
  const history=useQuery<ListPage<WorldgenRunSummary>>(`${base}/runs`,()=>optional(`${base}/runs`,{items:[]}));
  const currentRunId=selectedRun||latest.data?.run_id||history.data?.items[0]?.run_id;
  const run=useQuery<WorldgenRun|null>(currentRunId?`${base}/runs/${encodeURIComponent(currentRunId)}`:null,()=>optional(`${base}/runs/${encodeURIComponent(currentRunId!)}`,null));
  const rounds=useQuery<ListPage<LiveRound>>(`${base}/live-rounds`,()=>optional(`${base}/live-rounds`,{items:[]}));
  const round=useQuery<LiveRound|null>(roundId?`${base}/live-rounds/${encodeURIComponent(roundId)}`:null,()=>optional(`${base}/live-rounds/${encodeURIComponent(roundId)}`,null));
  const departments=useQuery<ListPage<Department>>(ventureId?`/v1/ventures/${ventureId}/departments`:null,()=>get(`/v1/ventures/${ventureId}/departments`));
  const agents=useQuery<ListPage<Agent>>(ventureId?`/v1/ventures/${ventureId}/agents`:null,()=>get(`/v1/ventures/${ventureId}/agents`));
  const current=round.data??(started?.id===roundId?started:rounds.data?.items.find(value=>value.id===roundId));
  const liveSeconds=current?roundElapsed(current,now):0,shown=displayRound(current,rounds.data?.items??[],liveSeconds);
  const refreshers=useRef({round:round.refetch,rounds:rounds.refetch,latest:latest.refetch,run:run.refetch});refreshers.current={round:round.refetch,rounds:rounds.refetch,latest:latest.refetch,run:run.refetch};
  useEffect(()=>{if(!roundId&&rounds.data?.items.length)setRoundId(rounds.data.items[0].id);},[roundId,rounds.data]);
  useEffect(()=>{
    const chosen=run.data?weakestDepartment(run.data.buildings):departments.data?.items[0]?.id;
    if(chosen&&!manualDepartment.current)setDepartment(chosen);
  },[run.data,departments.data,department]);
  useEffect(()=>{if(!running(current))return;const timer=setInterval(()=>{setNow(Date.now());void refreshers.current.round();void refreshers.current.rounds();},1000);return()=>clearInterval(timer);},[current?.id,current?.status]);
  useEffect(()=>ventureId?subscribe(ventureId,event=>{
    if(event.type!=='worldgen.progress')return;
    const data=event.data as {round_id?:string};
    if(data.round_id){if(!roundId)setRoundId(data.round_id);if(!roundId||data.round_id===roundId)void refreshers.current.round();void refreshers.current.rounds();}
    void refreshers.current.latest();void refreshers.current.run();
  }):undefined,[ventureId,roundId]);
  const name=(id:string)=>departments.data?.items.find(value=>value.id===id)?.name??titleCase(id);
  const buildings=run.data?.buildings??[];
  const options=[...new Set([...buildings.map(value=>value.department_id),...(departments.data?.items.map(value=>value.id)??[])])];
  const header=run.data??history.data?.items.find(value=>value.run_id===currentRunId)??(latest.data?.run_id===currentRunId?latest.data:null);
  const busyRound=rounds.data?.items.find(value=>running(value));
  async function improve(){await action.run(async()=>{try{
    const result=await post<LiveRound>(`${base}/live-rounds`,{department_id:department,fast:true});
    setStarted(result);setRoundId(result.id);setNow(Date.now());patchQuery<LiveRound|null>(`${base}/live-rounds/${encodeURIComponent(result.id)}`,()=>result);void rounds.refetch();
  }catch(error){if(error instanceof ApiError&&error.status===409)throw new Error('Another live round is already running. Wait for it to finish, then try again.');if(error instanceof ApiError&&error.status===503)throw new Error('The world preview is unavailable. Start the web preview before running a live improvement.');if(error instanceof ApiError&&error.status===404)throw new Error('Live world improvements are not available on this branch yet. Recorded evidence remains available when present.');throw error;}});}
  async function promote(result:LiveRound){await action.run(async()=>{
    const promoted=await post<LiveRound>(`${base}/live-rounds/${encodeURIComponent(result.id)}/promote`);
    patchQuery<LiveRound|null>(`${base}/live-rounds/${encodeURIComponent(result.id)}`,()=>promoted);
    if(started?.id===result.id)setStarted(promoted);
    invalidateQueries(`${base}/`);
  });}
  return <><PageHeader eyebrow="More dimensions · render → watch → critique → fix" title="World Lab" description="Recorded evidence of a better town, plus one improvement you can watch happen live." actions={<Link className="button" to={worldLink(ventureId,department,agents.data?.items??[])}>Open in the world ↗</Link>}/>
    <ErrorNotice error={latest.error} retry={latest.refetch}/><ErrorNotice error={history.error} retry={history.refetch}/>
    {latest.loading?<Loading/>:header?<Card title="Recorded generation run" action={history.data&&history.data.items.length>1?<label className="wl-run-picker">Run history<select value={currentRunId} onChange={event=>{manualDepartment.current=false;setSelectedRun(event.target.value);}}>{history.data.items.map(value=><option key={value.run_id} value={value.run_id}>{date(value.created_at)} · {value.run_id}</option>)}</select></label>:undefined}><div className="wl-run-header"><div><code>{header.run_id}</code><p className="muted">{date(header.created_at)}</p><Status value={header.status}/></div><div className="wl-score-cards"><div><span>World score</span><strong>{percent(header.final_world_score)}</strong></div><div><span>Visual score</span><strong>{percent(header.final_visual_score)}</strong></div><div><span>Realism</span><strong>{percent(header.final_realism)}</strong></div><div><span>Buildings</span><strong>{header.generated} generated</strong><small>{header.fallback} fallback</small></div></div></div></Card>:<Card><Empty title="No world generation run yet">Generate the town to record its baseline, improvement scores and camera captures. No results are shown until they exist.</Empty></Card>}
    <Card title="Improve one building live"><p className="card-intro">A live round captures the building, asks the critic what to fix, patches it, and records new scores. Promoting the result is a separate decision.</p><div className="wl-live-controls"><label>Building<select value={department} onChange={event=>{manualDepartment.current=true;setDepartment(event.target.value);}} disabled={action.working||running(current)}><option value="">Choose a building</option>{options.map(id=><option key={id} value={id}>{name(id)}</option>)}</select></label><button className="button primary" disabled={!department||action.working||running(current)||!!busyRound} onClick={()=>void improve()}>{action.working?'Working…':'Improve live'}</button>{rounds.data&&rounds.data.items.length>0&&<label>Recorded live rounds<select value={roundId} onChange={event=>{setRoundId(event.target.value);setStarted(undefined);setNow(Date.now());}}>{rounds.data.items.map(value=><option key={value.id} value={value.id}>{name(value.department_id)} · {titleCase(value.status)} · {date(value.created_at)}</option>)}</select></label>}</div><ErrorNotice error={action.error}/><ErrorNotice error={rounds.error} retry={rounds.refetch}/><ErrorNotice error={round.error} retry={round.refetch}/>
    {busyRound&&busyRound.id!==current?.id&&<p className="notice">A live round is already running for {name(busyRound.department_id)}. <button className="button small" onClick={()=>setRoundId(busyRound.id)}>View running round</button></p>}
    {!options.length&&<p className="muted">Building choices appear with a company’s departments or a recorded world run.</p>}
    {current&&<div className="wl-progress"><div className="wl-round-heading"><strong>{name(current.department_id)}</strong><Status value={current.status}/><span>{elapsed(liveSeconds)} elapsed</span>{current.used_managed_agent&&<span className="wl-current">Antigravity managed agent</span>}</div><ol className="wl-steps">{current.steps.map((step,index)=><li key={`${step.name}-${index}`}><Status value={step.status}/><strong>{titleCase(step.name)}</strong>{step.note&&<p>{step.note}</p>}{step.started_at&&<small>{date(step.started_at)}{step.finished_at?` → ${date(step.finished_at)}`:''}</small>}</li>)}</ol>{current.error&&<ErrorNotice error={current.error}/>}</div>}
    {shown.reason&&<p className="notice" role="status">{shown.reason} {shown.stored?`Showing a stored completed round for ${name(shown.round!.department_id)} from ${date(shown.round!.finished_at??shown.round!.created_at)}. This is recorded evidence.`:'No stored completed round is available. No result has been substituted.'}</p>}
    {shown.round&&<><div className="wl-result-header"><h3>{shown.stored?'Stored completed round':'Round captures'} · {name(shown.round.department_id)}</h3><div className="actions">{shown.round.status==='done'&&<button className="button primary" disabled={shown.round.promoted||action.working} onClick={()=>void promote(shown.round!)}>{shown.round.promoted?'Promoted':'Promote this result'}</button>}<Link className="button" to={worldLink(ventureId,shown.round.department_id,agents.data?.items??[])}>Open in the world ↗</Link></div></div><Comparison round={shown.round}/></>}
    {!current&&!rounds.loading&&<p className="muted">No live round has been recorded yet.</p>}</Card>
    {header&&<Card title="Score curve"><ScoreCurve iterations={run.data?.iterations??header.iterations}/></Card>}
    <ErrorNotice error={run.error} retry={run.refetch}/>{run.loading&&<Loading/>}
    {currentRunId&&!run.loading&&!run.data&&!run.error&&<p className="notice">Detailed captures for this recorded run are unavailable. Summary scores remain visible above.</p>}
    {buildings.length>0&&<><Card title="Per-building results"><div className="table-scroll"><table><thead><tr><th>Building</th><th>Status</th><th>Selected iteration</th><th>Probes</th><th>Visual</th><th>Realism</th><th>Failed probes</th></tr></thead><tbody>{buildings.map(building=>{const last=finalIteration(building);return <tr key={building.department_id}><td>{name(building.department_id)}</td><td><Status value={building.status}/></td><td>{last?.n??'Not recorded'}</td><td>{percent(last?.probe_score)}</td><td>{percent(last?.visual_score)}</td><td>{percent(last?.realism)}</td><td>{last?.failed_probes.join(', ')||'None recorded'}</td></tr>;})}</tbody></table></div></Card><Card title="Building filmstrips"><p className="card-intro">Compare each recorded iteration, its camera angles, walkthrough videos and critic notes.</p>{buildings.map(building=><Filmstrip key={building.department_id} building={building} name={name(building.department_id)}/>)}</Card></>}
  </>;
}
