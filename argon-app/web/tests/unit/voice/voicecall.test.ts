// OWNER: karthik
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(()=>({startSession:vi.fn()}));
vi.mock('@elevenlabs/client',()=>({Conversation:sdk}));
import { startVoiceCall } from '../../../src/world/conversation/VoiceCall';
beforeEach(()=>{vi.stubGlobal('window',{});});
afterEach(()=>{vi.unstubAllGlobals(); vi.clearAllMocks(); vi.useRealTimers();});
const info={session_id:'s1',provider:'elevenlabs',connection:'webrtc',conversation_token:'temporary',overrides:{prompt:'grounded',first_message:'hello',voice_id:'voice'},dynamic_variables:{venture:'v'}};
const response=(data:unknown)=>({ok:true,json:async()=>({data})});
it('missing credentials are unavailable, never an imaginary successful call',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({provider:'unavailable',reason:'not configured'})));
  const onStatus=vi.fn(); const handle=await startVoiceCall({ventureId:'v',agentId:'a',surface:'world',onStatus});
  await vi.waitFor(()=>expect(handle.status).toBe('unavailable')); expect(onStatus).toHaveBeenLastCalledWith('unavailable','not configured'); expect(sdk.startSession).not.toHaveBeenCalled();
});
it('maps SDK callbacks, grounds tool responses and posts an idempotent summary',async()=>{
  const fetcher=vi.fn().mockResolvedValue(response(info));vi.stubGlobal('fetch',fetcher);
  const conversation={endSession:vi.fn().mockResolvedValue(undefined),getOutputVolume:()=>0.4,getId:()=> 'conversation',setMicMuted:vi.fn()};
  let config:any; sdk.startSession.mockImplementation(async c=>{config=c;return conversation;});
  const answer={answer_id:'answer',text:'Grounded answer',citations:[],check:{status:'pending'},latency_ms:2};
  const talk=vi.fn().mockResolvedValue(answer), onAnswer=vi.fn(), onTranscript=vi.fn();
  const handle=await startVoiceCall({ventureId:'v',agentId:'a',surface:'world',talk,onAnswer,onTranscript});
  await vi.waitFor(()=>expect(handle.status).toBe('listening')); expect(config.overrides.tts.voiceId).toBe('voice');
  config.onModeChange({mode:'speaking'}); expect(handle.status).toBe('speaking');
  config.onMessage({source:'user',message:'question'});expect(onTranscript).toHaveBeenCalledWith({role:'user',text:'question'});
  expect(await config.clientTools.ask_company({question:'what happened?'})).toBe('Grounded answer');expect(talk).toHaveBeenCalledWith({text:'what happened?',history:[]});expect(onAnswer).toHaveBeenCalledWith(answer);
  handle.setMuted(true);expect(conversation.setMicMuted).toHaveBeenCalledWith(true);
  await Promise.all([handle.end(),handle.end()]);expect(conversation.endSession).toHaveBeenCalledOnce();expect(handle.status).toBe('ended');
  expect(JSON.parse(fetcher.mock.calls[1][1].body).answer_ids).toEqual(['answer']);
});
it('tool failure states ignorance, not fabricated company facts',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response(info)));let config:any;
  sdk.startSession.mockImplementation(async c=>{config=c;return {endSession:async()=>{},getOutputVolume:()=>0,getId:()=> 'c',setMicMuted:()=>{}};});
  const h=await startVoiceCall({ventureId:'v',agentId:'a',surface:'world',talk:vi.fn().mockRejectedValue(new Error('network'))});
  await vi.waitFor(()=>expect(h.status).toBe('listening'));
  expect(await config.clientTools.ask_company({question:'profits?'})).toContain('I do not know');await h.end();
});
it('returns an end handle before HTTP resolves, aborts startup, and cleans a late session',async()=>{
  let resolve!: (value:unknown)=>void; let signal!: AbortSignal;
  const fetcher=vi.fn().mockImplementation((url:string,init:RequestInit)=>{
    if(url.endsWith('/end')) return Promise.resolve(response({stored:true}));
    signal=init.signal!;return new Promise(r=>resolve=r);
  });vi.stubGlobal('fetch',fetcher); const onStatus=vi.fn();
  const h=await startVoiceCall({ventureId:'v',agentId:'a',surface:'world',onStatus});
  expect(h.status).toBe('connecting'); await h.end();expect(signal.aborted).toBe(true);expect(h.status).toBe('ended');
  resolve(response(info));await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
  expect(sdk.startSession).not.toHaveBeenCalled();expect(onStatus.mock.calls.map(c=>c[0])).toEqual(['connecting','ended']);
});
it('ends during SDK permission acquisition and disposes a late connection without reviving callbacks',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response(info)));
  let resolve!: (value:any)=>void, config:any;
  sdk.startSession.mockImplementation(c=>{config=c;return new Promise(r=>resolve=r);});
  const lip={start:vi.fn(),stop:vi.fn()} as any, onStatus=vi.fn(), onTranscript=vi.fn(),talk=vi.fn();
  const h=await startVoiceCall({ventureId:'v',agentId:'a',surface:'world',onStatus,onTranscript,talk,lipSync:lip});
  await vi.waitFor(()=>expect(sdk.startSession).toHaveBeenCalledOnce());expect(h.status).toBe('connecting');
  await h.end();
  const connection={endSession:vi.fn().mockResolvedValue(undefined),getOutputVolume:()=>1,getId:()=> 'late',setMicMuted:vi.fn()};resolve(connection);
  await vi.waitFor(()=>expect(connection.endSession).toHaveBeenCalledOnce());
  config.onModeChange({mode:'speaking'});config.onStatusChange({status:'connected'});config.onError('late error');config.onMessage({source:'ai',message:'late'});
  expect(await config.clientTools.ask_company({question:'facts?'})).toBe('The call has ended.');
  expect(talk).not.toHaveBeenCalled();expect(onTranscript).not.toHaveBeenCalled();expect(lip.start).not.toHaveBeenCalled();expect(h.status).toBe('ended');
  expect(onStatus.mock.calls.map(c=>c[0])).toEqual(['connecting','ended']);
});
it('times out unanswered SDK permission and closes a connection arriving after the timeout',async()=>{
  vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response(info)));
  let resolve!: (value:any)=>void;sdk.startSession.mockImplementation(()=>new Promise(r=>resolve=r));
  const h=await startVoiceCall({ventureId:'v',agentId:'a',surface:'world'});
  await vi.waitFor(()=>expect(sdk.startSession).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(30_001);expect(h.status).toBe('unavailable');
  const connection={endSession:vi.fn().mockResolvedValue(undefined),getOutputVolume:()=>0,getId:()=> 'late',setMicMuted:vi.fn()};resolve(connection);
  await vi.waitFor(()=>expect(connection.endSession).toHaveBeenCalledOnce());expect(h.status).toBe('unavailable');
});
it('does not begin provider work outside a browser',async()=>{
  vi.stubGlobal('window',undefined);const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  const h=await startVoiceCall({ventureId:'v',agentId:'a',surface:'world'});
  expect(h.status).toBe('unavailable');expect(fetcher).not.toHaveBeenCalled();expect(sdk.startSession).not.toHaveBeenCalled();
});
it('bounds a startup HTTP transport that ignores abort and does not revive after its late rejection',async()=>{
  vi.useFakeTimers();let reject!: (reason:Error)=>void;
  const fetcher=vi.fn().mockImplementation(()=>new Promise((_resolve,r)=>reject=r));vi.stubGlobal('fetch',fetcher);
  const onStatus=vi.fn();const h=await startVoiceCall({ventureId:'v',agentId:'a',surface:'world',onStatus});
  expect(h.status).toBe('connecting');await vi.advanceTimersByTimeAsync(30_001);expect(h.status).toBe('unavailable');
  reject(new Error('late transport error'));await vi.advanceTimersByTimeAsync(0);
  expect(onStatus.mock.calls.map(c=>c[0])).toEqual(['connecting','unavailable']);expect(sdk.startSession).not.toHaveBeenCalled();
});

it('passes bounded grounded follow-up history and captures venture/agent routing once',async()=>{
  const fetcher=vi.fn().mockImplementation(async (url:string)=>response(url==='/v1/voice/sessions'?info:{answer_id:'answer',text:'Grounded',citations:[],check:{status:'pending'},latency_ms:0}));
  vi.stubGlobal('fetch',fetcher); let config:any;
  sdk.startSession.mockImplementation(async c=>{config=c;return {endSession:async()=>{},getOutputVolume:()=>0,getId:()=> 'c',setMicMuted:()=>{}};});
  const opts={ventureId:'v /1',agentId:'a /1',surface:'world' as const};
  const h=await startVoiceCall(opts); await vi.waitFor(()=>expect(h.status).toBe('listening'));
  opts.ventureId='other';opts.agentId='other';
  config.onMessage({source:'ai',message:'Ungrounded invented facts'});
  for(let i=0;i<5;i++) await config.clientTools.ask_company({question:'q'+i});
  const calls=fetcher.mock.calls.filter(c=>c[0].endsWith('/talk'));
  expect(calls).toHaveLength(5);
  expect(calls.every(c=>c[0]==='/v1/ventures/v%20%2F1/agents/a%20%2F1/talk')).toBe(true);
  expect(JSON.parse(calls[0][1].body).history).toEqual([]);
  expect(JSON.parse(calls[1][1].body).history).toEqual([{role:'user',text:'q0'},{role:'agent',text:'Grounded'}]);
  expect(JSON.parse(calls[4][1].body).history).toEqual([1,2,3].flatMap(i=>[{role:'user',text:'q'+i},{role:'agent',text:'Grounded'}]));
  await h.end();
});
it('applies mute selected during connecting and settles microphone denial without hanging',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response(info)));let reject!:(e:Error)=>void;
  sdk.startSession.mockImplementation(()=>new Promise((_r,j)=>reject=j));
  const h=await startVoiceCall({ventureId:'v',agentId:'a',surface:'world'});h.setMuted(true);
  await vi.waitFor(()=>expect(sdk.startSession).toHaveBeenCalledOnce()); reject(new Error('Permission denied'));
  await vi.waitFor(()=>expect(h.status).toBe('unavailable'));await h.end();
});
it('remembers mute until a late SDK connection is ready',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response(info)));let resolve!:(c:any)=>void;
  sdk.startSession.mockImplementation(()=>new Promise(r=>resolve=r));
  const h=await startVoiceCall({ventureId:'v',agentId:'a',surface:'world'});h.setMuted(true);
  await vi.waitFor(()=>expect(sdk.startSession).toHaveBeenCalledOnce());const setMicMuted=vi.fn();
  resolve({endSession:async()=>{},getOutputVolume:()=>0,getId:()=> 'c',setMicMuted});
  await vi.waitFor(()=>expect(h.status).toBe('listening'));expect(setMicMuted).toHaveBeenCalledWith(true);await h.end();
});
