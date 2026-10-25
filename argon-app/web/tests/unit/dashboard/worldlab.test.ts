// OWNER: tanush
import { describe, expect, it } from 'vitest';
import type { Agent, LiveRound, LiveRoundSide, WorldgenBuildingHistory, WorldgenIterationView, WorldgenRun } from '../../../src/shared/contracts';
import { captureUrl, comparisonCameras, displayRound, finalIteration, roundElapsed, scoreSeries, weakestDepartment, worldLink } from '../../../src/dashboard/pages/worldLabModel';

const captures={screenshots:{'ext-1':'runs/wgr_fixture/engineering/ext-1.png','int-1':'/v1/world/worldgen/files/runs/wgr_fixture/engineering/int-1.png'},videos:{ext:'runs/wgr_fixture/engineering/ext.webm'}};
function iteration(n:number,visual:number|null=.8,realism:number|null=.8):WorldgenIterationView{return {n,probe_score:.9,visual_score:visual,realism,failed_probes:[],issues:[],keep:['Keep the entrance'],captures};}
function building(id:string,iterations:WorldgenIterationView[],best:number|null=null):WorldgenBuildingHistory{return {department_id:id,status:'generated',best_iteration:best,iterations};}
const run:WorldgenRun={run_id:'wgr_fixture',created_at:'2026-10-25T18:00:00Z',status:'succeeded',iterations:[{n:0,world_score:.6,visual_score:.5,realism:null},{n:1,world_score:.9,visual_score:.8,realism:.85}],final_world_score:.9,final_visual_score:.8,final_realism:.85,generated:2,fallback:0,buildings:[building('intake',[iteration(0,.5,.7),iteration(1,.9,.9)],1),building('engineering',[iteration(0,.3,.4),iteration(1,.65,.55)],1)]};
const side:LiveRoundSide={captures,probe_score:.9,visual_score:.65,realism:.55};
function live(id:string,status:LiveRound['status']='done',overrides:Partial<LiveRound>={}):LiveRound{return {id,department_id:'engineering',status,fast:true,created_at:'2026-10-25T18:00:00Z',finished_at:status==='done'?'2026-10-25T18:02:00Z':null,elapsed_s:120,steps:[{name:'capture_before',status:'done',started_at:'2026-10-25T18:00:00Z',finished_at:'2026-10-25T18:00:15Z',note:'Recorded six cameras'}],before:side,after:status==='done'?{...side,visual_score:.8,realism:.75}:null,issues:[{severity:'high',where:'door',camera:'ext-1',description:'Entrance clips into trim',fix:'Move trim outward'}],used_managed_agent:true,promoted:false,error:null,...overrides};}
function agent(id:string,department_id:string,is_lead:boolean):Agent{return {id,department_id,is_lead,display_name:id,title:'Department lead',role_summary:'Owns the department work',model:'fixture-model',tools:[],persona:'Concise',voice_id:null,portrait_url:null,face:null,npc_slot:null};}

describe('recorded world evidence',()=>{
  it('selects the actual weakest selected module from visual or realism scores',()=>{
    expect(weakestDepartment(run.buildings)).toBe('engineering');
  });
  it('uses the selected best iteration rather than an unpromoted later attempt',()=>{
    const value=building('intake',[iteration(0,.8,.8),iteration(1,.95,.95),iteration(2,.1,.1)],1);
    expect(finalIteration(value)?.n).toBe(1);
    expect(weakestDepartment([value,building('engineering',[iteration(0,.7,.7)])])).toBe('engineering');
  });
  it('selects highest recorded iteration when best iteration is absent without mutating history',()=>{
    const values=[iteration(2),iteration(0),iteration(1)],value=building('engineering',values);
    expect(finalIteration(value)?.n).toBe(2);
    expect(value.iterations.map(value=>value.n)).toEqual([2,0,1]);
  });
  it('keeps missing visual scores missing instead of interpreting them as zero',()=>{
    const empty=building('intake',[iteration(0,null,null)]);
    expect(weakestDepartment([empty,building('engineering',[iteration(0,.7,.8)])])).toBe('engineering');
    expect(scoreSeries(run.iterations,'realism')).toEqual([{n:0,score:null},{n:1,score:.85}]);
  });
  it('falls back to recorded probe scores when no visual evidence exists',()=>{
    expect(weakestDepartment([building('intake',[{...iteration(0,null,null),probe_score:.9}]),building('engineering',[{...iteration(0,null,null),probe_score:.7}])])).toBe('engineering');
    expect(weakestDepartment([])).toBeUndefined();
    expect(finalIteration(building('intake',[]))).toBeUndefined();
  });
  it('retains an actual zero score and sorts iteration zero as baseline',()=>{
    expect(scoreSeries([{n:2,world_score:.9,visual_score:null,realism:.8},{n:0,world_score:0,visual_score:0,realism:null}],'world_score')).toEqual([{n:0,score:0},{n:2,score:.9}]);
  });
});

describe('capture URLs and mappings',()=>{
  it('accepts API paths and safely maps relative capture paths',()=>{
    expect(captureUrl('runs/wgr_one/engineering/ext-1.png')).toBe('/v1/world/worldgen/files/runs/wgr_one/engineering/ext-1.png');
    expect(captureUrl('/v1/world/worldgen/files/live/lr_one/before/ext.webm')).toBe('/v1/world/worldgen/files/live/lr_one/before/ext.webm');
    expect(captureUrl('runs/building%20capture.png')).toBe('/v1/world/worldgen/files/runs/building%20capture.png');
  });
  it.each(['https://example.com/a.png','//example.com/a.png','javascript:alert(1)','/etc/passwd','../secret','runs/../secret','runs/%2e%2e/secret','runs/%252e%252e/secret','runs/%2fsecret','runs/a.png?key=secret','runs/a.png#fragment','runs/%ZZ.png','runs//image.png','runs/%00.png',''])('rejects unsafe capture URL %s',value=>{
    expect(captureUrl(value)).toBeUndefined();
  });
  it('compares only matching cameras with usable captures in both sides',()=>{
    const after:LiveRoundSide={...side,captures:{screenshots:{'ext-1':'live/after/ext.png','int-2':'live/after/int.png','int-1':'https://external.invalid/image.png'},videos:{}}};
    expect(comparisonCameras(side,after)).toEqual(['ext-1']);
    expect(comparisonCameras(side,null)).toEqual([]);
  });
  it('maps open-world links to actual department lead and skips Nova as CoS lead',()=>{
    const list=[agent('concierge','chief-of-staff',true),agent('cos.orchestrator','chief-of-staff',true),agent('eng.builder','engineering',false),agent('eng.tech-lead','engineering',true)];
    expect(worldLink('ven_one','engineering',list)).toBe('/view?venture=ven_one&goto=eng.tech-lead');
    expect(worldLink('ven_one','chief-of-staff',list)).toContain('goto=cos.orchestrator');
    expect(worldLink(null,'missing',list)).toBe('/view');
    expect(worldLink('ven_one','missing',list)).toBe('/view?venture=ven_one');
  });
});

describe('live round state and honest fallback',()=>{
  it('shows a current success without replacing its scores or captures',()=>{
    const current=live('lr_done');
    expect(displayRound(current,[live('lr_old')],120)).toEqual({round:current,stored:false,reason:null});
    expect(current.after?.realism).toBe(.75);
  });
  it('shows the newest stored completed round when current round fails',()=>{
    const current=live('lr_failed','failed',{error:'Patch validation failed'}),old=live('lr_old','done',{finished_at:'2026-10-25T17:00:00Z'}),recent=live('lr_recent','done',{finished_at:'2026-10-25T17:30:00Z'});
    const shown=displayRound(current,[old,recent],30);
    expect(shown.round?.id).toBe('lr_recent');
    expect(shown.stored).toBe(true);
    expect(shown.reason).toContain('failed');
    expect(current.error).toBe('Patch validation failed');
  });
  it('labels a stored fallback when the150-second demo target is exceeded',()=>{
    const current=live('lr_running','patching');
    expect(displayRound(current,[live('lr_old')],150).stored).toBe(false);
    expect(displayRound(current,[live('lr_old')],151).stored).toBe(true);
    expect(displayRound(current,[live('lr_old')],151).reason).toContain('150-second');
  });
  it('never substitutes failed or incomplete records as a completed fallback',()=>{
    const current=live('lr_running','failed');
    const shown=displayRound(current,[live('lr_incomplete','done',{after:null}),live('lr_also_failed','failed')],151);
    expect(shown.round).toBe(current);
    expect(shown.stored).toBe(false);
    expect(shown.reason).toContain('failed');
  });
  it('calculates elapsed time from actual creation time while preserving recorded minimum',()=>{
    const value=live('lr_running','capturing',{elapsed_s:10});
    expect(roundElapsed(value,Date.parse('2026-10-25T18:01:00Z'))).toBe(60);
    expect(roundElapsed(value,Date.parse('2026-10-25T17:00:00Z'))).toBe(10);
    expect(roundElapsed(live('lr_done'),Date.parse('2026-10-25T20:00:00Z'))).toBe(120);
  });
});
