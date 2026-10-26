// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {ExecutiveBriefing} from '../../../src/world/hud/ExecutiveBriefing';
import {executiveSeats,demoBriefing} from '../../../src/world/interiors/executiveRoom';
import {MapOverlay} from '../../../src/world/hud/MapOverlay';
import manifest from '../../../src/world/data/manifest.fallback.json';
let root:Root|undefined,host:HTMLDivElement;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(()=>{act(()=>root?.unmount());host?.remove();vi.unstubAllGlobals();});
function mount(node:React.ReactNode){host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>root!.render(node));}
it('assigns thirteen unique seats with an open south entrance',()=>{expect(executiveSeats).toHaveLength(13);expect(new Set(executiveSeats.map(s=>s.position.join(','))).size).toBe(13);expect(executiveSeats.every(s=>s.position[2]<3)).toBe(true);expect(manifest.buildings).toHaveLength(13);});
it('keeps scripted engineering and marketing separate from recorded work',()=>{const fetcher=vi.fn(),recorded=vi.fn();vi.stubGlobal('fetch',fetcher);mount(<ExecutiveBriefing onClose={()=>{}} onRecorded={recorded}/>);expect(host.textContent).toContain('SCRIPTED DEMO');expect(host.textContent).toContain('engineering an AI tutor app');act(()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Next executive')!.click());expect(host.textContent).toContain('writing the growth plan and post');act(()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Recorded work / communications')!.click());expect(recorded).toHaveBeenCalledOnce();expect(fetcher).not.toHaveBeenCalled();expect(demoBriefing).toHaveLength(3);});
it('provides an explicit HQ map entry without removing departments',()=>{const travel=vi.fn();mount(<MapOverlay manifest={manifest as any} position={[0,0]} onTravel={travel} onRace={()=>{}} onClose={()=>{}}/>);expect(host.querySelectorAll('.map-building')).toHaveLength(13);act(()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Enter Executive HQ · Conference room')!.click());expect(travel).toHaveBeenCalledWith(manifest.npcs.find(n=>n.department_id==='chief-of-staff'&&n.is_lead)!.agent_id);});
