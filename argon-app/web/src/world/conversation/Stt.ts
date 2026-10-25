// OWNER: karthik — seed version; replace/extend freely but keep the exported names and signatures (mahin calls them).
// Speech-to-text session for one push-to-talk press (02-models-and-integrations/06-speech-to-text.md):
// server transcription of the Mic blob, or browser SpeechRecognition when the server says provider "none".
import type { SttResponse } from '../../shared/contracts';

export interface SttResult { text: string; provider: 'gemini' | 'browser' | 'none'; latency_ms: number }

export interface SttSession {
  /** Key released: finish and return the transcript ('' + provider 'none' → the UI offers typing). */
  stop(): Promise<SttResult>;
  cancel(): void;
}

export interface SttOptions {
  /** worldApi.transcribe — injected so this module never imports the API client. */
  transcribe: (audio: Blob) => Promise<SttResponse>;
  prefer?: 'server' | 'browser';
  lang?: string;
}

/** Key pressed: start listening. Seed: returns an empty transcript. */
export async function startListening(_opts: SttOptions): Promise<SttSession> {
  return {
    stop: async () => ({ text: '', provider: 'none', latency_ms: 0 }),
    cancel: () => {},
  };
}
