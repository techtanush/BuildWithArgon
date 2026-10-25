import { afterEach, expect, it, vi } from 'vitest';
import { ConversationController } from '../../../src/world/conversation/ConversationController';
import { mockApi } from '../../../src/shared/worldApi';
import manifest from '../../../src/world/data/manifest.fallback.json';
import answer from '../../../src/world/data/mock/talk.json';
import type { ManifestNpc, TalkResponse } from '../../../src/shared/contracts';
const npc=manifest.npcs.find(n=>n.agent_id!=='concierge') as ManifestNpc;
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
function setup(audioEnabled=true){
  const service={...mockApi,talk:vi.fn(async()=>answer as TalkResponse),tts:vi.fn(async()=>({provider:'browser' as const,audio_url:null,mime:null,alignment:null,latency_ms:0}))};
  const stop=vi.fn(),say=vi.fn(()=>({started:Promise.resolve(1),done:Promise.resolve(),stop}));
  const c=new ConversationController({api:service,ventureId:'v',speak:say,audioEnabled});c.open(npc);return {c,service,say,stop};
}
it('persists an explicit automatic-audio opt-out across controllers without dropping text or facts',async()=>{
  const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)});
  const x=setup();x.c.setAudioEnabled(false);await x.c.greet();await x.c.send('question');
  expect(x.service.tts).not.toHaveBeenCalled();expect(x.say).not.toHaveBeenCalled();expect(x.c.state.caption).toBe(answer.text);expect(x.c.state.response?.citations).toEqual(answer.citations);expect(x.c.state.phase).toBe('engaged');
  const next=new ConversationController({api:x.service,ventureId:'v'});expect(next.state.audioEnabled).toBe(false);next.dispose();x.c.dispose();
});
it('disabling audio while TTS is pending cannot start late playback, even after re-enabling',async()=>{
  const x=setup();let resolve!:(a:any)=>void;x.service.tts.mockImplementation(()=>new Promise(r=>resolve=r));
  const pending=x.c.send('question');await vi.waitFor(()=>expect(x.service.tts).toHaveBeenCalled());x.c.setAudioEnabled(false);x.c.setAudioEnabled(true);
  resolve({provider:'browser'});await pending;expect(x.say).not.toHaveBeenCalled();expect(x.c.state.phase).toBe('engaged');expect(x.c.state.response?.text).toBe(answer.text);x.c.dispose();
});
it('automatic audio opt-out never blocks, ends, or stops lip sync on an explicit live call',async()=>{
  let opts:any;const end=vi.fn(async()=>{}),stop=vi.fn();
  const c=new ConversationController({api:{...mockApi,mode:'live'},ventureId:'v',audioEnabled:false,getLipSync:()=>({stop} as any),startCall:async o=>{opts=o;return {status:'listening',end,setMuted:vi.fn()};}});
  c.open(npc);await c.startCall();opts.onStatus('speaking');stop.mockClear();c.setAudioEnabled(true);c.setAudioEnabled(false);
  expect(c.isCalling()).toBe(true);expect(end).not.toHaveBeenCalled();expect(stop).not.toHaveBeenCalled();c.dispose();
});
it('closing during transcription cancels the in-flight capture session',async()=>{
  const cancel=vi.fn();let resolve!:(value:any)=>void;const c=new ConversationController({api:mockApi,ventureId:'v',listen:async()=>({cancel,stop:()=>new Promise(r=>resolve=r)})});c.open(npc);await c.startPushToTalk();
  const pending=c.stopPushToTalk();await vi.waitFor(()=>expect(c.state.phase).toBe('transcribing'));c.close();expect(cancel).toHaveBeenCalledOnce();resolve({text:'stale',provider:'browser',latency_ms:0});await pending;expect(c.state.phase).toBe('idle');c.dispose();
});
