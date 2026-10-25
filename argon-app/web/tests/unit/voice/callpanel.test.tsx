// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({start:vi.fn(),listen:vi.fn(),talk:vi.fn(),transcribe:vi.fn(),events:vi.fn()}));
vi.mock('../../../src/world/conversation/VoiceCall',()=>({startVoiceCall:mocks.start}));
vi.mock('../../../src/world/conversation/Stt',()=>({startListening:mocks.listen}));
vi.mock('../../../src/shared/worldApi',()=>({liveApi:{talk:mocks.talk,concierge:mocks.talk,transcribe:mocks.transcribe}}));
vi.mock('../../../src/api/sse',()=>({subscribe:(_v:any,cb:any)=>{mocks.events.mockImplementation(cb);return ()=>{};}}));
vi.mock('../../../src/dashboard/components/Shared',()=>({Portrait:()=>null,Status:({value}:any)=><span>{value}</span>,Sources:({answer}:any)=><span>Sources {answer.answer_id}: {answer.check.status}</span>}));
import CallPanel from '../../../src/dashboard/components/CallPanel';
let root:Root,host:HTMLDivElement,opts:any;const agent={id:'agent-captured',display_name:'Agent',title:'Title',department_id:'eng'} as any;
const grounded={answer_id:'answer1',text:'Grounded answer',citations:[],check:{status:'pending'}};
const end=vi.fn(async()=>{}),mute=vi.fn(),cancel=vi.fn();
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.clearAllMocks();
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  mocks.start.mockImplementation(async o=>{opts=o;return {status:'listening',end,setMuted:mute};});
  mocks.listen.mockResolvedValue({cancel,stop:async()=>({text:'Actual question',provider:'browser',latency_ms:0})});mocks.talk.mockResolvedValue(grounded);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function render(close=vi.fn()){await act(async()=>root.render(<CallPanel agent={agent} ventureId="venture-captured" onClose={close}/>));return close;}
async function click(label:string){const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent===label);expect(button).toBeTruthy();await act(async()=>button!.click());}
it('announces status/mute, keeps transcript unverified, and updates checks only on grounded answers',async()=>{
  await render();expect(host.querySelector('[role=dialog]')).not.toBeNull();expect(host.querySelector('[role=status]')?.textContent).toBe('listening');
  await click('Mute');expect(mute).toHaveBeenCalledWith(true);expect(host.textContent).toContain('Microphone muted');
  await act(async()=>opts.onTranscript({role:'agent',text:'Unverified live claim'}));expect(host.querySelector('[role=log]')?.getAttribute('aria-label')).toContain('not independently verified');expect(host.querySelector('[aria-label="Grounded company answer"]')).toBeNull();
  await act(async()=>opts.onAnswer(grounded));expect(host.textContent).toContain('Sources answer1: pending');
  await act(async()=>mocks.events({type:'answer.checked',data:{answer_id:'answer1',check:{status:'verified'}}}));expect(host.textContent).toContain('Sources answer1: verified');
});
it('ends a connecting call immediately on close and disposes a handle arriving later',async()=>{
  let resolve!:(v:any)=>void;mocks.start.mockImplementation(o=>{opts=o;return new Promise(r=>resolve=r);});const close=await render();
  await click('End call');expect(close).toHaveBeenCalledOnce();await act(async()=>resolve({status:'listening',end,setMuted:mute}));expect(end).toHaveBeenCalledOnce();
  await act(async()=>opts.onStatus('speaking'));expect(host.textContent).not.toContain('speaking');
});
it('switches an established call to actual push-to-talk, routes captured identity and excludes live transcript facts',async()=>{
  await render();await act(async()=>opts.onTranscript({role:'agent',text:'Invented claim'}));await click('Push-to-talk instead');expect(end).toHaveBeenCalledOnce();expect(mocks.listen).toHaveBeenCalledOnce();
  await click('Send voice question');expect(mocks.talk).toHaveBeenCalledWith('venture-captured','agent-captured',{text:'Actual question',history:[]});expect(host.textContent).toContain('Sources answer1: pending');
});
it('cancels an active fallback when Escape closes the dialog',async()=>{
  const close=await render();await click('Push-to-talk instead');await act(async()=>host.querySelector('[role=dialog]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(cancel).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();
});
it('prevents duplicate grounded requests when Send and the capture timeout overlap',async()=>{
  let resolve!:(r:any)=>void;mocks.listen.mockResolvedValue({cancel,stop:()=>new Promise(r=>resolve=r)});
  await render();await click('Push-to-talk instead');await click('Send voice question');
  expect(host.querySelector('button[disabled]')?.textContent).not.toBe('Send voice question');
  await act(async()=>resolve({text:'Once only',provider:'browser',latency_ms:0}));expect(mocks.talk).toHaveBeenCalledOnce();
});
it('cancels a late fallback handle after closing without sending a grounded request',async()=>{
  let resolve!:(r:any)=>void;mocks.listen.mockImplementation(()=>new Promise(r=>resolve=r));await render();await click('Push-to-talk instead');await click('Close call');
  await act(async()=>resolve({cancel,stop:async()=>({text:'late'})}));expect(cancel).toHaveBeenCalledOnce();expect(mocks.talk).not.toHaveBeenCalled();
});
