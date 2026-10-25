// OWNER: karthik — seed version; replace/extend freely but keep the exported names and signatures (mahin calls them).
// Plays an agent's answer: the TTS audio (ElevenLabs/Gemini) or browser speechSynthesis, and drives LipSync.
// mahin's ConversationController calls worldApi.tts(...) and then speak(...).
import type { TtsResponse } from '../../shared/contracts';
import type { LipSync } from '../npc/LipSync';

export interface SpeakOptions {
  lipSync?: LipSync;
  /** Called with the text being spoken (for captions). */
  onCaption?: (text: string) => void;
  voiceHint?: string;
}

export interface SpeakHandle {
  /** Resolves with performance.now() when sound starts (for latency samples). */
  started: Promise<number>;
  /** Resolves when speech ends or is stopped. */
  done: Promise<void>;
  stop(): void;
}

/** Seed: browser speechSynthesis only, no lip-sync. */
export function speak(text: string, _tts: TtsResponse | null, opts: SpeakOptions = {}): SpeakHandle {
  opts.onCaption?.(text);
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!synth) {
    return { started: Promise.resolve(performance.now()), done: Promise.resolve(), stop: () => {} };
  }
  const utter = new SpeechSynthesisUtterance(text);
  const started = new Promise<number>((r) => { utter.onstart = () => r(performance.now()); });
  const done = new Promise<void>((r) => { utter.onend = () => r(); utter.onerror = () => r(); });
  synth.speak(utter);
  return { started, done, stop: () => synth.cancel() };
}
