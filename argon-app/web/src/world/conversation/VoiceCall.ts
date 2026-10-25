// OWNER: karthik
import type { ChatTurn, ConciergeResponse, TalkRequest, TalkResponse, VoiceSessionInfo } from '../../shared/contracts';
import type { PartialOptions } from '@elevenlabs/client';
import { voiceForAuthoredAsset } from './voiceProfile';
import type { LipSync } from '../npc/LipSync';
export type VoiceCallStatus = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended' | 'unavailable' | 'error';
export interface VoiceCallOptions {
  ventureId: string; agentId: string; surface: 'world' | 'dashboard';
  /** Actual rendered licensed body asset, never guessed from a name or face. */
  avatarAssetId?: string;
  talk?: (req: TalkRequest) => Promise<TalkResponse | ConciergeResponse>;
  lipSync?: LipSync;
  onStatus?: (status: VoiceCallStatus, reason?: string) => void;
  onTranscript?: (turn: { role: 'user' | 'agent'; text: string }) => void;
  onAnswer?: (answer: TalkResponse | ConciergeResponse) => void;
}
export interface VoiceCallHandle { readonly status: VoiceCallStatus; end(): Promise<void>; setMuted(muted: boolean): void }
type CallConnection = { endSession(): Promise<void>; setMicMuted(muted: boolean): void; getOutputVolume(): number; getId(): string };
/** Bound even a transport or SDK implementation that ignores AbortSignal. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Voice startup cancelled or timed out'));
    if (signal.aborted) { work.catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
async function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(20_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const work = fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: requestSignal }).then(async response => {
    if (!response.ok) throw new Error('Voice request failed');
    return (await response.json()).data as T;
  });
  // Startup callers retain the raw promise to clean up any late session response.
  return signal ? work : abortable(work, requestSignal);
}
async function get<T>(url: string, signal: AbortSignal): Promise<T> {
  const work = fetch(url, { signal }).then(async response => {
    if (!response.ok) throw new Error('Voice verification request failed');
    return (await response.json()).data as T;
  });
  return abortable(work, signal);
}
const VOICE_ABSTENTION = 'I cannot verify that from company records yet; review sources/dashboard.';
type StoredAnswer = { id: string; text: string; citations: unknown[]; check: { status?: unknown } };
function isVerified(answer: { check?: { status?: unknown } }): boolean { return answer.check?.status === 'verified'; }
function isValidAnswer(answer: unknown): answer is TalkResponse | ConciergeResponse {
  return !!answer && typeof answer === 'object' && typeof (answer as TalkResponse).text === 'string' && !!(answer as TalkResponse).text.trim()
    && typeof (answer as TalkResponse).answer_id === 'string' && !!(answer as TalkResponse).answer_id
    && Array.isArray((answer as TalkResponse).citations) && !!(answer as TalkResponse).check;
}
export function sdkVoiceOverrides(info: VoiceSessionInfo, avatarAssetId?: string): PartialOptions['overrides'] {
  const overrides = info.overrides;
  if (!overrides) return undefined;
  const voiceId = voiceForAuthoredAsset(avatarAssetId)?.voiceId ?? overrides.voice_id;
  return { agent: { prompt: { prompt: overrides.prompt }, firstMessage: overrides.first_message },
    ...(voiceId ? { tts: { voiceId } } : {}) };
}
function startupFailure(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'Microphone permission was denied. Allow microphone access in browser settings, then start a new call. You can still type.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No microphone was found. Connect a microphone, then start a new call. You can still type.';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'The microphone is busy or unavailable. Close other microphone apps and try a new call. You can still type.';
  if (name === 'OverconstrainedError') return 'The selected microphone is unavailable. Select an available input device in browser settings and retry.';
  return 'Live voice could not connect. Check microphone access and your connection, then start a new call. You can still type.';
}
/** Resolves immediately with a handle; provider and microphone startup continue in the background. */
export async function startVoiceCall(opts: VoiceCallOptions): Promise<VoiceCallHandle> {
  let status: VoiceCallStatus = 'connecting', closed = false, ending: Promise<void> | null = null, muted = false;
  let session: VoiceSessionInfo | null = null, turns = 0, conversationId: string | undefined;
  let summary: Promise<void> | null = null;
  const history: ChatTurn[] = [];
  let toolQueue: Promise<unknown> = Promise.resolve();
  // Capture routing once, including when a caller mutates its options during a call.
  const ventureId = opts.ventureId, agentId = opts.agentId, avatarAssetId = opts.avatarAssetId;
  const answerIds: string[] = [], began = performance.now(), startup = new AbortController();
  let conversation: CallConnection | null = null;
  const disposed = new WeakMap<CallConnection, Promise<void>>();
  const closeConnection = (connection: CallConnection | null): Promise<void> => {
    if (!connection) return Promise.resolve();
    const previous = disposed.get(connection); if (previous) return previous;
    const pending = abortable(Promise.resolve().then(() => connection.endSession()), AbortSignal.timeout(5000)).catch(() => {});
    disposed.set(connection, pending); return pending;
  };
  const notify = (next: VoiceCallStatus, reason?: string) => { status = next; try { opts.onStatus?.(next, reason); } catch { /* UI only */ } };
  const summarize = (): Promise<void> => {
    if (!session?.session_id) return Promise.resolve();
    return summary ??= post(`/v1/voice/sessions/${encodeURIComponent(session.session_id)}/end`, { conversation_id: conversationId, duration_s: (performance.now() - began) / 1000, answer_ids: answerIds, turns }).then(() => {}, () => {});
  };
  const stopStartup = () => { clearTimeout(startupTimer); startup.abort(); opts.lipSync?.stop(); };
  const fail = (next: 'unavailable' | 'error', reason: string) => {
    if (closed) return;
    closed = true; stopStartup(); notify(next, reason);
    void closeConnection(conversation); void summarize();
  };
  const startupTimer = setTimeout(() => fail('unavailable', 'Live voice connection timed out. Start a new call or type instead.'), 30_000);
  const handle: VoiceCallHandle = {
    get status() { return status; },
    end() {
      if (ending) return ending;
      closed = true; stopStartup(); notify('ended');
      // Do not wait for an unanswered permission prompt. Late SDK connections are disposed below.
      ending = Promise.all([closeConnection(conversation), summarize()]).then(() => {});
      return ending;
    },
    setMuted(value) {
      muted = value;
      if (!closed) try { conversation?.setMicMuted(value); } catch { fail('error', 'Microphone control failed. Start a new call or type instead.'); }
    },
  };
  // Importing this browser-only adapter from SSR/tests must not start network or mic work.
  if (typeof window === 'undefined') {
    fail('unavailable', 'Live voice requires a browser. Start a new call or type instead.');
    return handle;
  }
  if (window.isSecureContext === false) {
    fail('unavailable', 'Microphone calls require HTTPS or localhost. Open a secure address, then start a new call.');
    return handle;
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    fail('unavailable', 'This browser cannot access a microphone. Use a supported browser on HTTPS or localhost, or type instead.');
    return handle;
  }
  notify('connecting');
  const connect = async () => {
    try {
      const sessionWork = post<VoiceSessionInfo>('/v1/voice/sessions', { venture_id: ventureId, agent_id: agentId, surface: opts.surface }, startup.signal).then(info => {
        session = info;
        if (closed) void summarize();
        return info;
      });
      const info = await abortable(sessionWork, startup.signal);
      if (closed) return;
      if (info.provider !== 'elevenlabs') { fail('unavailable', info.reason || 'Live voice is unavailable. Start a new call or type instead.'); return; }
      if (info.connection === 'webrtc' ? !info.conversation_token : !info.signed_url) throw new Error('Missing connection credentials');
      const { Conversation } = await abortable(import('@elevenlabs/client'), startup.signal);
      if (closed) return;
      const connectionWork = Conversation.startSession({
        ...(info.connection === 'webrtc' ? { conversationToken: info.conversation_token!, connectionType: 'webrtc' as const } : { signedUrl: info.signed_url!, connectionType: 'websocket' as const }),
        textOnly: false,
        overrides: sdkVoiceOverrides(info, avatarAssetId),
        dynamicVariables: info.dynamic_variables,
        clientTools: {
          ask_company: (parameters: { question?: unknown }) => {
            // Serialize overlapping tool calls so each follow-up sees the previous grounded answer.
            const work = toolQueue.then(async () => {
              if (closed) return 'The call has ended.';
              if (typeof parameters.question !== 'string' || !parameters.question.trim()) return 'Please ask a specific question. No company facts were retrieved.';
              notify('thinking');
              try {
                const req = { text: parameters.question.trim(), history: history.slice(-6) }, base = `/v1/ventures/${encodeURIComponent(ventureId)}`;
                const signal = AbortSignal.any([startup.signal, AbortSignal.timeout(20_000)]);
                const answer = await abortable(opts.talk ? opts.talk(req) : post<TalkResponse | ConciergeResponse>(agentId === 'concierge' ? `${base}/concierge/ask` : `${base}/agents/${encodeURIComponent(agentId)}/talk`, req, signal), signal);
                if (closed) return 'The call has ended.';
                if (!isValidAnswer(answer)) throw new Error('Invalid grounded response');
                // Always publish the server answer to the UI, including its flagged check and citations.
                answerIds.push(answer.answer_id);
                try { opts.onAnswer?.(answer); } catch { /* UI only */ }
                let spoken: TalkResponse | ConciergeResponse | null = isVerified(answer) ? answer : null;
                if (answer.check.status === 'pending') {
                  // A pending answer is never spoken. Give its existing verification record up to 3s to settle.
                  const verificationSignal = AbortSignal.any([startup.signal, AbortSignal.timeout(3_000)]);
                  try {
                    const stored = await get<StoredAnswer>('/v1/answers/' + encodeURIComponent(answer.answer_id), verificationSignal);
                    if (!closed && stored?.id === answer.answer_id && typeof stored.text === 'string' && Array.isArray(stored.citations) && isVerified(stored)) {
                      spoken = { ...answer, text: stored.text, citations: stored.citations as typeof answer.citations, check: stored.check as typeof answer.check };
                      try { opts.onAnswer?.(spoken); } catch { /* UI only */ }
                    }
                  } catch { /* Pending or unavailable checks must fail closed. */ }
                }
                if (closed) return 'The call has ended.';
                if (!spoken) { notify('listening'); return VOICE_ABSTENTION; }
                history.push({ role: 'user', text: req.text }, { role: 'agent', text: spoken.text });
                history.splice(0, Math.max(0, history.length - 6));
                notify('listening'); return spoken.text;
              } catch {
                if (closed) return 'The call has ended.';
                notify('listening');
                return 'I could not retrieve a grounded company answer. I do not know. Please try push-to-talk or the dashboard; do not invent company facts.';
              }
            });
            toolQueue = work.catch(() => {});
            return work;
          },
        },
        onMessage: ({ source, message }: { source: string; message: string }) => {
          if (closed || (source !== 'user' && source !== 'ai') || typeof message !== 'string' || !message.trim()) return; turns++;
          try { opts.onTranscript?.({ role: source === 'user' ? 'user' : 'agent', text: message }); } catch { /* UI only */ }
        },
        onModeChange: ({ mode }: { mode: string }) => { if (!closed) notify(mode === 'speaking' ? 'speaking' : 'listening'); },
        onStatusChange: ({ status: next }: { status: string }) => {
          if (closed) return;
          if (next === 'connected') notify('listening');
          else if (next === 'connecting') notify('connecting');
          // SDK emits disconnected before rejecting startup (including permission denial).
          // Let that rejection surface its actionable error instead of falsely ending normally.
          else if (next === 'disconnected' && conversation) void handle.end();
        },
        onError: () => fail('error', 'Live voice connection failed. Start a new call or type instead.'),
      } satisfies PartialOptions).then(created => {
        // The SDK cannot abort its permission prompt. Close resources if it resolves after end/timeout.
        if (closed) void closeConnection(created);
        return created;
      });
      const created = await abortable(connectionWork, startup.signal);
      if (closed) { void closeConnection(created); return; }
      conversation = created; conversationId = created.getId();
      clearTimeout(startupTimer); created.setMicMuted(muted);
      opts.lipSync?.start({ kind: 'level', level: () => closed ? 0 : created.getOutputVolume() });
      if (status === 'connecting') notify('listening');
    } catch (error) {
      fail('unavailable', startupFailure(error));
    }
  };
  void connect();
  return handle;
}
