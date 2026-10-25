// OWNER: tanush
import type { Agent, LiveRound, LiveRoundSide, WorldgenBuildingHistory, WorldgenIterationScore, WorldgenIterationView } from '../../shared/contracts';

export function finalIteration(building: WorldgenBuildingHistory): WorldgenIterationView | undefined {
  return building.iterations.find(value => value.n === building.best_iteration)
    ?? [...building.iterations].sort((a,b) => b.n-a.n)[0];
}
const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
export function weakestDepartment(buildings: WorldgenBuildingHistory[]): string | undefined {
  const scored = buildings.map(building => {
    const last = finalIteration(building), scores = [last?.visual_score,last?.realism].filter(finite);
    return {id:building.department_id,score:scores.length ? Math.min(...scores) : undefined,probe:last?.probe_score};
  });
  const visual = scored.filter((row): row is typeof row & {score:number} => finite(row.score));
  if (visual.length) return visual.sort((a,b)=>a.score-b.score || a.id.localeCompare(b.id))[0].id;
  const probes = scored.filter((row): row is typeof row & {probe:number} => finite(row.probe));
  return probes.sort((a,b)=>a.probe-b.probe || a.id.localeCompare(b.id))[0]?.id ?? buildings[0]?.department_id;
}
export type ScoreKey = 'world_score' | 'visual_score' | 'realism';
export function scoreSeries(iterations: WorldgenIterationScore[], key: ScoreKey): {n:number;score:number | null}[] {
  return [...iterations].sort((a,b)=>a.n-b.n).map(row=>({n:row.n,score:finite(row[key]) ? row[key] : null}));
}
export function captureUrl(value: string | null | undefined): string | undefined {
  if (!value || /[\\?#\u0000-\u001f]/.test(value) || value.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(value)) return;
  const prefix='/v1/world/worldgen/files/';
  if (value.startsWith('/') && !value.startsWith(prefix)) return;
  const raw=value.startsWith(prefix)?value.slice(prefix.length):value;
  const parts=raw.split('/');
  if (!parts.length || parts.some(part=>!part)) return;
  try {
    const decoded=parts.map(part=>decodeURIComponent(part));
    if(decoded.some(part=>part==='.' || part==='..' || /[%/\\\u0000-\u001f]/.test(part)))return;
    return prefix+decoded.map(encodeURIComponent).join('/');
  } catch { return; }
}
export function comparisonCameras(before: LiveRoundSide, after: LiveRoundSide | null): string[] {
  if(!after)return [];
  return Object.keys(before.captures.screenshots).filter(camera=>captureUrl(before.captures.screenshots[camera]) && captureUrl(after.captures.screenshots[camera]));
}
export function roundElapsed(round: LiveRound, now=Date.now()): number {
  if(round.status==='done'||round.status==='failed')return Math.max(0,round.elapsed_s);
  const start=Date.parse(round.created_at);
  return Math.max(round.elapsed_s,Number.isFinite(start)?Math.max(0,(now-start)/1000):0);
}
export function displayRound(current: LiveRound | undefined, stored: LiveRound[], elapsed=0): {round:LiveRound | undefined;stored:boolean;reason:string | null} {
  const failed=current?.status==='failed',overrun=!!current && !['done','failed'].includes(current.status) && elapsed>150;
  if(!failed&&!overrun)return {round:current,stored:false,reason:null};
  const completed=[...stored].filter(round=>round.status==='done' && round.after!==null && round.id!==current?.id).sort((a,b)=>Date.parse(b.finished_at??b.created_at)-Date.parse(a.finished_at??a.created_at))[0];
  const reason=failed?'The current live round failed.':'The live round has exceeded the 150-second demo target.';
  return {round:completed??current,stored:!!completed,reason};
}
export function worldLink(ventureId: string | null, departmentId: string, agents: Agent[]): string {
  const lead=agents.find(agent=>agent.department_id===departmentId && agent.is_lead && agent.id!=='concierge');
  const query=new URLSearchParams();
  if(ventureId)query.set('venture',ventureId);
  if(lead)query.set('goto',lead.id);
  return '/view'+(query.size?'?'+query.toString():'');
}
