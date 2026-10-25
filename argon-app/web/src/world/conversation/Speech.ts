// OWNER: karthik
import type { TtsResponse } from '../../shared/contracts';
import type { LipSync } from '../npc/LipSync';
export interface SpeakOptions { audioEnabled?: boolean; lipSync?: LipSync; onCaption?: (text: string) => void; voiceHint?: string }
export interface SpeakHandle { started: Promise<number>; done: Promise<void>; stop(): void }
let context: AudioContext | null = null;
export function speak(text: string, tts: TtsResponse | null, opts: SpeakOptions = {}): SpeakHandle {
  let resolveStart!: (time: number) => void, rejectStart!: (reason: Error) => void, resolveDone!: () => void;
  const started = new Promise<number>((resolve, reject) => { resolveStart = resolve; rejectStart = reject; });
  void started.catch(() => {}); // Callers may only await done, so avoid an unhandled rejection.
  const done = new Promise<void>(r => { resolveDone = r; });
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let finished = false, sounding = false, audio: HTMLAudioElement | null = null;
  let source: MediaElementAudioSourceNode | null = null, analyser: AnalyserNode | null = null;
  let utter: SpeechSynthesisUtterance | null = null;
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  const start = () => { if (!finished && !sounding) { sounding = true; clearTimeout(startupTimer); resolveStart(performance.now()); } };
  const finish = () => {
    if (finished) return; finished = true; clearTimeout(startupTimer);
    // Never publish a latency sample for audio that did not start.
    if (!sounding) { rejectStart(new Error('Speech ended before audio started.')); if (utter) synth?.cancel(); }
    audio?.pause(); source?.disconnect(); analyser?.disconnect(); opts.lipSync?.stop(); resolveDone();
  };
  const browser = () => {
    if (finished) return;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined' || !text.trim()) { finish(); return; }
    utter = new SpeechSynthesisUtterance(text);
    const hint = opts.voiceHint?.toLowerCase();
    if (hint) utter.voice = synth.getVoices().find(v => v.name.toLowerCase().includes(hint) || v.lang.toLowerCase() === hint) || null;
    utter.onstart = () => { if (finished) return; start(); opts.lipSync?.start({ kind: 'boundary' }); opts.lipSync?.onBoundary(); };
    utter.onboundary = () => { if (!finished) opts.lipSync?.onBoundary(); };
    utter.onend = finish; utter.onerror = finish;
    try { synth.speak(utter); } catch { finish(); }
  };
  startupTimer = setTimeout(finish, 20_000);
  opts.onCaption?.(text);
  if (opts.audioEnabled === false) { finish(); return { started, done, stop() {} }; }
  if (tts?.audio_url && tts.provider !== 'browser' && typeof Audio !== 'undefined') {
    audio = new Audio(tts.audio_url);
    audio.onplaying = () => { if (finished) return; start();
      if (tts.alignment) opts.lipSync?.start({ kind: 'alignment', audio: audio!, alignment: tts.alignment });
      else if (analyser) opts.lipSync?.start({ kind: 'analyser', analyser });
    };
    audio.onended = finish;
    let fallback = false;
    const failed = () => { if (finished || fallback) return; fallback = true; audio?.pause(); source?.disconnect(); analyser?.disconnect(); browser(); };
    audio.onerror = failed;
    if (!tts.alignment && opts.lipSync) {
      try {
        context ??= new AudioContext(); void context.resume().catch(() => {});
        analyser = context.createAnalyser(); analyser.fftSize = 1024;
        source = context.createMediaElementSource(audio); source.connect(analyser); analyser.connect(context.destination);
      } catch { /* audio remains playable if WebAudio is not available */ }
    }
    try { void audio.play().catch(failed); } catch { failed(); }
  } else browser();
  return { started, done, stop() { if (finished) return; const wasSounding = sounding; finish(); if (utter && wasSounding) synth?.cancel(); } };
}
