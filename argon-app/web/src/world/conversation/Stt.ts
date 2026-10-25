// OWNER: karthik
import type { SttResponse } from '../../shared/contracts';
import { Mic } from './Mic';
export interface SttResult { text: string; provider: 'gemini' | 'browser' | 'none'; latency_ms: number }
export interface SttSession { stop(): Promise<SttResult>; cancel(): void }
export interface SttOptions { transcribe: (audio: Blob) => Promise<SttResponse>; prefer?: 'server' | 'browser'; lang?: string }
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
/** Browser recognition runs during capture, not after the audio has already been released. */
export async function startListening(opts: SttOptions): Promise<SttSession> {
  const pressed = performance.now();
  const scope = globalThis as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Constructor = scope.SpeechRecognition || scope.webkitSpeechRecognition;
  let recognition: Recognition | null = null, finalText = '', cancelled = false, releasedAlready = false;
  let micReady = false;
  let cancelWait!: () => void;
  const cancellation = new Promise<null>(resolve => { cancelWait = () => resolve(null); });
  let hardLimit: ReturnType<typeof setTimeout> | undefined;
  let finishBrowser: () => void = () => {};
  const browserDone = new Promise<void>(resolve => { finishBrowser = resolve; });
  if (Constructor) {
    try {
      recognition = new Constructor(); recognition.lang = opts.lang || 'en-US'; recognition.continuous = true; recognition.interimResults = true;
      recognition.onresult = e => { if (cancelled) return; finalText = Array.from(e.results).filter(r => r.isFinal).map(r => r[0].transcript).join(' ').trim(); };
      recognition.onend = finishBrowser; recognition.onerror = finishBrowser; recognition.start();
    } catch { recognition = null; finishBrowser(); }
  } else finishBrowser();
  const mic = new Mic();
  const server = opts.prefer === 'server' || !recognition;
  let stopped: Promise<SttResult> | null = null;
  const empty = (start: number): SttResult => ({ text: '', provider: 'none', latency_ms: performance.now() - start });
  const session: SttSession = {
    stop() {
      if (stopped) return stopped;
      clearTimeout(hardLimit);
      releasedAlready = true;
      // Do not wait on a permission prompt after key release. Its late stream is invalidated.
      if (!micReady) mic.cancel();
      const released = performance.now();
      if (released - pressed < 300) { session.cancel(); stopped = Promise.resolve(empty(released)); return stopped; }
      try { recognition?.stop(); } catch { finishBrowser(); }
      stopped = (async () => {
        // Never wait forever for recognition or a hung transcription endpoint.
        let browserTimer: ReturnType<typeof setTimeout> | undefined;
        const browserWait = Promise.race([browserDone, new Promise<void>(r => { browserTimer = setTimeout(r, 1500); })]).finally(() => clearTimeout(browserTimer));
        if (server && micReady && !cancelled) {
          const blob = await Promise.race([mic.stop(), cancellation]);
          if (blob && !cancelled) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              const response = await Promise.race([cancellation, opts.transcribe(blob), new Promise<null>(r => { timer = setTimeout(() => r(null), 15_000); })]);
              if (!cancelled && response?.provider === 'gemini' && response.text.trim()) return { text: response.text.trim(), provider: 'gemini' as const, latency_ms: performance.now() - released };
            } catch { /* use already captured browser transcript */ } finally { clearTimeout(timer); }
          }
        }
        await browserWait;
        try { recognition?.abort(); } catch { /* closed */ }
        return !cancelled && finalText ? { text: finalText, provider: 'browser' as const, latency_ms: performance.now() - released } : empty(released);
      })().finally(() => { mic.cancel(); try { recognition?.abort(); } catch { /* closed */ } });
      return stopped;
    },
    cancel() { cancelled = true; clearTimeout(hardLimit); cancelWait(); finalText = ''; mic.cancel(); try { recognition?.abort(); } catch { /* closed */ } finishBrowser(); },
  };
  hardLimit = setTimeout(() => { void session.stop(); }, Math.max(0, 30_000 - (performance.now() - pressed)));
  // Launch permission acquisition without delaying the cancellation handle.
  if (server) void mic.start().then(() => {
    if (cancelled || releasedAlready) mic.cancel();
    else micReady = true;
  }).catch(() => { /* Browser transcript or typing remains available. */ });
  return session;
}
