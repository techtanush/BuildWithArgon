// OWNER: karthik
import type { ChatTurn, ConciergeResponse, TalkRequest, TalkResponse, VoiceSessionInfo } from '../../shared/contracts';
import type { LipSync } from '../npc/LipSync';
export type VoiceCallStatus = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended' | 'unavailable' | 'error';
export interface VoiceCallOptions {
  ventureId: string; agentId: string; surface: 'world' | 'dashboard';
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
/** Resolves immediately with a handle; provider and microphone startup continue in the background. */
export async function startVoiceCall(opts: VoiceCallOptions): Promise<VoiceCallHandle> {
  let status: VoiceCallStatus = 'connecting', closed = false, ending: Promise<void> | null = null, muted = false;
  let session: VoiceSessionInfo | null = null, turns = 0, conversationId: string | undefined;
  let summary: Promise<void> | null = null;
  const history: ChatTurn[] = [];
  // Capture routing once, including when a caller mutates its options during a call.
  const ventureId = opts.ventureId, agentId = opts.agentId;
  const answerIds: string[] = [], began = performance.now(), startup = new AbortController();
  let conversation: CallConnection | null = null;
  const disposed = new WeakMap<CallConnection, Promise<void>>();
  const closeConnection = (connection: CallConnection | null): Promise<void> => {
    if (!connection) return Promise.resolve();
    const previous = disposed.get(connection); if (previous) return previous;
    const pending = Promise.resolve().then(() => connection.endSession()).catch(() => {});
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
  const startupTimer = setTimeout(() => fail('unavailable', 'Live voice connection timed out. Use push-to-talk or typing.'), 30_000);
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
      if (!closed) try { conversation?.setMicMuted(value); } catch { fail('error', 'Microphone control failed. Use push-to-talk or typing.'); }
    },
  };
  // Importing this browser-only adapter from SSR/tests must not start network or mic work.
  if (typeof window === 'undefined') {
    fail('unavailable', 'Live voice requires a browser. Use push-to-talk or typing.');
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
      if (info.provider !== 'elevenlabs') { fail('unavailable', info.reason || 'Live voice is unavailable. Use push-to-talk or typing.'); return; }
      if (info.connection === 'webrtc' ? !info.conversation_token : !info.signed_url) throw new Error('Missing connection credentials');
      const { Conversation } = await abortable(import('@elevenlabs/client'), startup.signal);
      if (closed) return;
      const overrides = info.overrides;
      const connectionWork = Conversation.startSession({
        ...(info.connection === 'webrtc' ? { conversationToken: info.conversation_token!, connectionType: 'webrtc' as const } : { signedUrl: info.signed_url!, connectionType: 'websocket' as const }),
        overrides: overrides ? { agent: { prompt: { prompt: overrides.prompt }, firstMessage: overrides.first_message }, ...(overrides.voice_id ? { tts: { voiceId: overrides.voice_id } } : {}) } : undefined,
        dynamicVariables: info.dynamic_variables,
        clientTools: {
          ask_company: async (parameters: { question?: unknown }) => {
            if (closed) return 'The call has ended.';
            if (typeof parameters.question !== 'string' || !parameters.question.trim()) return 'Please ask a specific question. No company facts were retrieved.';
            notify('thinking');
            try {
              const req = { text: parameters.question.trim(), history: history.slice(-6) }, base = `/v1/ventures/${encodeURIComponent(ventureId)}`;
              const answer = opts.talk ? await opts.talk(req) : await post<TalkResponse | ConciergeResponse>(agentId === 'concierge' ? `${base}/concierge/ask` : `${base}/agents/${encodeURIComponent(agentId)}/talk`, req);
              if (closed) return 'The call has ended.';
              if (!answer || typeof answer.text !== 'string' || !answer.answer_id) throw new Error('Invalid grounded response');
              history.push({ role: 'user', text: req.text }, { role: 'agent', text: answer.text });
              history.splice(0, Math.max(0, history.length - 6));
              answerIds.push(answer.answer_id);
              try { opts.onAnswer?.(answer); } catch { /* UI only */ }
              notify('listening'); return answer.text;
            } catch {
              if (!closed) notify('listening');
              return 'I could not retrieve a grounded company answer. I do not know. Please try push-to-talk or the dashboard; do not invent company facts.';
            }
          },
        },
        onMessage: ({ source, message }: { source: string; message: string }) => {
          if (closed) return; turns++;
          try { opts.onTranscript?.({ role: source === 'user' ? 'user' : 'agent', text: message }); } catch { /* UI only */ }
        },
        onModeChange: ({ mode }: { mode: string }) => { if (!closed) notify(mode === 'speaking' ? 'speaking' : 'listening'); },
        onStatusChange: ({ status: next }: { status: string }) => {
          if (closed) return;
          if (next === 'connected') notify('listening');
          else if (next === 'connecting') notify('connecting');
          else if (next === 'disconnected') void handle.end();
        },
        onError: () => fail('error', 'Live voice connection failed. Use push-to-talk or typing.'),
      }).then(created => {
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
    } catch {
      fail('unavailable', 'Live voice could not connect. Check microphone permission and provider configuration; use push-to-talk or typing.');
    }
  };
  void connect();
  return handle;
}
