// OWNER: karthik
import { afterEach, expect, it, vi } from 'vitest';
import { startListening } from '../../../src/world/conversation/Stt';
import { Mic } from '../../../src/world/conversation/Mic';
import { speak } from '../../../src/world/conversation/Speech';
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});
it('unsupported STT resolves empty and does not invent a provider',async()=>{
  const s=await startListening({transcribe:vi.fn()}); expect((await s.stop()).provider).toBe('none');
});
it('browser uses final transcript only, and cancel discards it',async()=>{
  let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock += 400);
  let instance: any;
  class Recognition { onresult:any; onend:any; start(){instance=this;} stop(){this.onend?.();} abort(){this.onend?.();} }
  vi.stubGlobal('SpeechRecognition',Recognition);
  const s=await startListening({prefer:'browser',transcribe:vi.fn()});
  instance.onresult({results:[{isFinal:true,0:{transcript:'hello'}},{isFinal:false,0:{transcript:'not final'}}]});
  expect((await s.stop()).text).toBe('hello');
  const cancelled=await startListening({prefer:'browser',transcribe:vi.fn()}); cancelled.cancel(); expect((await cancelled.stop()).text).toBe('');
});
it('denied microphone clearly rejects',async()=>{
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn().mockRejectedValue(new Error('denied'))}}); vi.stubGlobal('MediaRecorder',class {});
  await expect(new Mic().start()).rejects.toThrow('Type instead');
});
it('cancellation during pending permission stops late tracks',async()=>{
  let resolve!: (s:any)=>void; const track=vi.fn();
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:()=>new Promise(r=>resolve=r)}}); vi.stubGlobal('MediaRecorder',class {});
  const mic=new Mic(), pending=mic.start(); mic.cancel(); resolve({getTracks:()=>[{stop:track}]}); await pending; expect(track).toHaveBeenCalledOnce(); expect(mic.recording).toBe(false);
});
it('speech cancellation before sound settles both promises without false latency',async()=>{
  const cancel=vi.fn(); vi.stubGlobal('window',{speechSynthesis:{speak:vi.fn(),cancel,getVoices:()=>[]}}); vi.stubGlobal('SpeechSynthesisUtterance',class {});
  const h=speak('hello',null); h.stop(); await expect(h.started).rejects.toThrow('before audio started'); await h.done; expect(cancel).toHaveBeenCalledOnce();
});
it('no speech support does not claim audio started',async()=>{const h=speak('hello',null); await expect(h.started).rejects.toThrow('before audio started'); await h.done;});
it('records once, stops tracks, returns MIME and auto-stops at thirty seconds',async()=>{
  vi.useFakeTimers();const track=vi.fn();let instance:any;
  class Recorder {
    static isTypeSupported(m:string){return m.includes('webm');} state='inactive'; mimeType='audio/webm;codecs=opus';ondataavailable:any;onstop:any;
    constructor(){instance=this;}start(){this.state='recording';} stop(){this.state='inactive';this.ondataavailable({data:new Blob(['audio'])});this.onstop();}
  }
  const getUserMedia=vi.fn().mockResolvedValue({getTracks:()=>[{stop:track}]});
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia}});vi.stubGlobal('MediaRecorder',Recorder);
  const mic=new Mic();await mic.start();await mic.start();expect(getUserMedia).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(30001);expect(instance.state).toBe('inactive');expect(track).toHaveBeenCalledOnce();expect(mic.recording).toBe(false);
});
it('HTML audio resolves first sound and completion with alignment driver',async()=>{
  let audio:any;
  class AudioFake {onplaying:any;onended:any;onerror:any;pause=vi.fn();currentTime=0;constructor(){audio=this;}play(){return Promise.resolve();}}
  vi.stubGlobal('Audio',AudioFake);
  const lip={start:vi.fn(),stop:vi.fn(),onBoundary:vi.fn()} as any;
  const h=speak('hello',{audio_url:'/media/test.mp3',alignment:{chars:['h'],starts:[0],ends:[1]},provider:'elevenlabs',mime:'audio/mpeg',latency_ms:0},{lipSync:lip});
  audio.onplaying();expect(await h.started).toBeGreaterThanOrEqual(0);expect(lip.start.mock.calls[0][0].kind).toBe('alignment');audio.onended();await h.done;expect(lip.stop).toHaveBeenCalled();
});
it('failed provider audio uses browser speech rather than claiming provider success',async()=>{
  let utter:any;vi.stubGlobal('Audio',class {pause(){}play(){return Promise.reject(new Error('failed'));}});
  vi.stubGlobal('SpeechSynthesisUtterance',class {});vi.stubGlobal('window',{speechSynthesis:{speak:(u:any)=>{utter=u;},getVoices:()=>[],cancel:vi.fn()}});
  const h=speak('hello',{audio_url:'bad',alignment:null,provider:'gemini',mime:null,latency_ms:0});
  await Promise.resolve();utter.onstart();expect(await h.started).toBeGreaterThanOrEqual(0);utter.onend();await h.done;
});
it('server failure falls back to browser audio captured while held',async()=>{
  let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock += 400);
  let recognition:any;
  class Recognition {onresult:any;onend:any;start(){recognition=this;} stop(){this.onend();}abort(){}}
  vi.stubGlobal('SpeechRecognition',Recognition);
  vi.spyOn(Mic.prototype,'start').mockResolvedValue();vi.spyOn(Mic.prototype,'stop').mockResolvedValue(new Blob(['audio']));
  const transcribe=vi.fn().mockResolvedValue({provider:'none',text:'',latency_ms:0});
  const s=await startListening({prefer:'server',transcribe});recognition.onresult({results:[{isFinal:true,0:{transcript:'captured fallback'}}]});
  const r=await s.stop();expect(r.provider).toBe('browser');expect(r.text).toBe('captured fallback');expect(transcribe).toHaveBeenCalledOnce();
});
it('cancel promptly resolves a transcription that never answers',async()=>{
  let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock += 400);
  vi.spyOn(Mic.prototype,'start').mockResolvedValue();vi.spyOn(Mic.prototype,'stop').mockResolvedValue(new Blob(['audio']));
  const transcribe=vi.fn(() => new Promise<never>(()=>{}));
  const s=await startListening({transcribe});const pending=s.stop();await vi.waitFor(()=>expect(transcribe).toHaveBeenCalledOnce());s.cancel();expect((await pending).provider).toBe('none');
});
it('defaults to browser when recognition exists without an STT smoke-tested server preference',async()=>{
  class Recognition {onend:any;start(){}stop(){this.onend();}abort(){}}
  vi.stubGlobal('SpeechRecognition',Recognition);const start=vi.spyOn(Mic.prototype,'start');const transcribe=vi.fn();
  const session=await startListening({transcribe});await session.stop();expect(start).not.toHaveBeenCalled();expect(transcribe).not.toHaveBeenCalled();
});
it('stop returns one MIME-labelled blob and releases the microphone',async()=>{
  let now=0;vi.spyOn(performance,'now').mockImplementation(()=>now);const track=vi.fn();
  class Recorder {
    static isTypeSupported(){return true;}state='inactive';mimeType='audio/webm;codecs=opus';ondataavailable:any;onstop:any;
    start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['recorded'])});this.onstop();}
  }
  vi.stubGlobal('MediaRecorder',Recorder);vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop:track}]})}});
  const mic=new Mic();await mic.start();now=500;const blob=await mic.stop();expect(blob?.type).toBe('audio/webm;codecs=opus');expect(blob?.size).toBe(8);expect(await mic.stop()).toBe(blob);expect(track).toHaveBeenCalledOnce();
});
it('STT returns a cancellable handle before permission resolves and stops a late stream',async()=>{
  let resolve!: (value:any)=>void;const stopTrack=vi.fn(), recorder=vi.fn();
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:()=>new Promise(r=>resolve=r)}});
  vi.stubGlobal('MediaRecorder',recorder);const transcribe=vi.fn();
  const session=await startListening({prefer:'server',transcribe});
  session.cancel();resolve({getTracks:()=>[{stop:stopTrack}]});
  await vi.waitFor(()=>expect(stopTrack).toHaveBeenCalledOnce());expect(recorder).not.toHaveBeenCalled();
  expect((await session.stop()).provider).toBe('none');expect(transcribe).not.toHaveBeenCalled();
});
it('key release skips pending permission instead of waiting and prevents late recording',async()=>{
  let now=0;vi.spyOn(performance,'now').mockImplementation(()=>now);
  let resolve!: (value:any)=>void;const stopTrack=vi.fn(),recorder=vi.fn(),transcribe=vi.fn();
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:()=>new Promise(r=>resolve=r)}});vi.stubGlobal('MediaRecorder',recorder);
  const session=await startListening({prefer:'server',transcribe});now=600;
  expect((await session.stop()).provider).toBe('none');expect(transcribe).not.toHaveBeenCalled();
  resolve({getTracks:()=>[{stop:stopTrack}]});await vi.waitFor(()=>expect(stopTrack).toHaveBeenCalledOnce());expect(recorder).not.toHaveBeenCalled();
});
it('thirty-second limit starts at invocation even while permission remains unanswered',async()=>{
  vi.useFakeTimers();let now=0;vi.spyOn(performance,'now').mockImplementation(()=>now);
  let resolve!: (value:any)=>void;const stopTrack=vi.fn(),recorder=vi.fn(),transcribe=vi.fn();
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:()=>new Promise(r=>resolve=r)}});vi.stubGlobal('MediaRecorder',recorder);
  const session=await startListening({prefer:'server',transcribe});now=30_001;
  await vi.advanceTimersByTimeAsync(30_001);resolve({getTracks:()=>[{stop:stopTrack}]});
  await vi.waitFor(()=>expect(stopTrack).toHaveBeenCalledOnce());expect(recorder).not.toHaveBeenCalled();expect(transcribe).not.toHaveBeenCalled();expect((await session.stop()).provider).toBe('none');
});
