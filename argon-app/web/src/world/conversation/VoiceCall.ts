// OWNER: karthik — seed version; replace/extend freely but keep the exported names and signatures (mahin + tanush call them).
// Live voice call with any agent via ElevenLabs Agents (architecture-files/02-models-and-integrations/12-elevenlabs-voice-agents.md).
// Used by mahin's ConversationController (world, key C) and tanush's dashboard (Agent detail / Org "Call").
// Factual answers always come from the grounded /talk (or /concierge/ask) pipeline through the
// ask_company client tool. Seed: always 'unavailable' so callers fall back to push-to-talk.
import type { ConciergeResponse, TalkRequest, TalkResponse } from '../../shared/contracts';
import type { LipSync } from '../npc/LipSync';

export type VoiceCallStatus = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended' | 'unavailable' | 'error';

export interface VoiceCallOptions {
  ventureId: string;
  agentId: string;
  surface: 'world' | 'dashboard';
  /** Override the grounded answer call (e.g. mock mode); default: POST /talk or /concierge/ask. */
  talk?: (req: TalkRequest) => Promise<TalkResponse | ConciergeResponse>;
  lipSync?: LipSync;
  onStatus?: (status: VoiceCallStatus, reason?: string) => void;
  onTranscript?: (turn: { role: 'user' | 'agent'; text: string }) => void;
  /** Each ask_company result (citations, check, route card) — show as source cards. */
  onAnswer?: (answer: TalkResponse | ConciergeResponse) => void;
}

export interface VoiceCallHandle {
  readonly status: VoiceCallStatus;
  end(): Promise<void>;
  setMuted(muted: boolean): void;
}

export async function startVoiceCall(opts: VoiceCallOptions): Promise<VoiceCallHandle> {
  opts.onStatus?.('unavailable', 'live voice calls not implemented yet (owner: karthik)');
  return { status: 'unavailable', end: async () => {}, setMuted: () => {} };
}
