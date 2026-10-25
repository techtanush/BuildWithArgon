// OWNER: mahin
import type {
  AnswerCheck,
  ChatTurn,
  Citation,
  ConciergeResponse,
  ManifestNpc,
  TalkResponse,
  TtsResponse,
} from "../../shared/contracts";
import type { WorldApi } from "../../shared/worldApi";
import type { LipSync } from "../npc/LipSync";
import { startListening, type SttSession } from "./Stt";
import { speak, type SpeakHandle } from "./Speech";
import { startVoiceCall, type VoiceCallHandle, type VoiceCallStatus } from "./VoiceCall";
export type ConversationPhase =
  "idle" | "engaged" | "listening" | "transcribing" | "thinking" | "speaking";
export type ConversationResponse = TalkResponse | ConciergeResponse;
export interface ConversationState {
  npc: ManifestNpc | null;
  phase: ConversationPhase;
  turns: ChatTurn[];
  response: ConversationResponse | null;
  error: string | null;
  caption: string;
  voiceUnavailable: boolean;
  callStatus: VoiceCallStatus | null;
  callMuted: boolean;
  callTurns: ChatTurn[];
}
export interface ConversationOptions {
  api: WorldApi;
  ventureId: string | null;
  conciergeId?: string;
  offline?: boolean;
  onChange?: (state: ConversationState) => void;
  getLipSync?: (id: string) => LipSync | undefined;
  onRoute?: (agentId: string, mode: "race" | "travel") => void;
  listen?: typeof startListening;
  speak?: typeof speak;
  pollIntervalMs?: number;
  startCall?: typeof startVoiceCall;
}
/** Returns only local, encoded dashboard routes. Unknown citation kinds have no unsafe URL fallback. */
export function sourceRoute(
  citation: Pick<Citation, "kind" | "id">,
): string | null {
  const id = encodeURIComponent(citation.id);
  switch (citation.kind) {
    case "ticket":
      return `/tickets/${id}`;
    case "run":
      return `/runs/${id}`;
    case "artifact":
      return `/artifacts/${id}`;
    case "approval":
      return `/approvals?id=${id}`;
    case "message":
      return `/chat?message=${id}`;
    case "agent":
      return `/agents/${id}`;
    default:
      return null;
  }
}
export class ConversationController {
  state: ConversationState = {
    npc: null,
    phase: "idle",
    turns: [],
    response: null,
    error: null,
    caption: "",
    voiceUnavailable: false,
    callStatus: null,
    callMuted: false,
    callTurns: [],
  };
  private call?: VoiceCallHandle;
  private greeted = new Set<string>();
  private greetingAudio = new Map<string, Promise<TtsResponse>>();
  private histories = new Map<string, ChatTurn[]>();
  private listeners = new Set<(s: ConversationState) => void>();
  private generation = 0;
  private audio?: SpeakHandle;
  private playbackCancelled?: () => void;
  private session?: SttSession;
  private starting?: Promise<void>;
  private poll?: ReturnType<typeof setTimeout>;
  private maxListen?: ReturnType<typeof setTimeout>;
  private disposed = false;
  constructor(private options: ConversationOptions) {}
  subscribe(listener: (state: ConversationState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private patch(p: Partial<ConversationState>): void {
    this.state = { ...this.state, ...p };
    this.options.onChange?.(this.state);
    this.listeners.forEach((l) => l(this.state));
  }
  private stopAudio(): void {
    const audio = this.audio;
    this.audio = undefined;
    this.playbackCancelled?.();
    this.playbackCancelled = undefined;
    try {
      audio?.stop();
    } catch {
      /* Device teardown must not prevent leaving the conversation. */
    }
    if (this.state.npc)
      this.options.getLipSync?.(this.state.npc.agent_id)?.stop();
  }
  private waitForAudio(audio: SpeakHandle): Promise<void> {
    return Promise.race([
      audio.done,
      new Promise<void>((resolve) => {
        this.playbackCancelled = resolve;
      }),
    ]).finally(() => {
      if (this.audio === audio) this.playbackCancelled = undefined;
    });
  }
  open(npc: ManifestNpc): void {
    if (this.disposed) return;
    this.close();
    this.patch({
      npc,
      phase: "engaged",
      turns: [...(this.histories.get(npc.agent_id) ?? [])],
      error: this.options.offline
        ? "Company offline: conversations unavailable"
        : null,
    });
  }
  close(): void {
    this.generation++;
    this.stopCall();
    this.stopAudio();
    this.session?.cancel();
    this.session = undefined;
    clearTimeout(this.poll);
    clearTimeout(this.maxListen);
    this.patch({
      npc: null,
      phase: "idle",
      turns: [],
      response: null,
      error: null,
      caption: "",
      voiceUnavailable: false,
      callStatus: null,
      callMuted: false,
      callTurns: [],
    });
  }
  isCalling(): boolean {
    return this.state.callStatus !== null && !["ended", "unavailable", "error"].includes(this.state.callStatus);
  }
  private stopCall(): void {
    const call = this.call;
    this.call = undefined;
    if (this.isCalling()) this.patch({ callStatus: "ended", callMuted: false });
    try { void call?.end().catch(() => {}); } catch { /* teardown is best effort */ }
  }
  endCall(): void {
    if (!this.isCalling() && !this.call) return;
    this.generation++;
    clearTimeout(this.poll);
    this.stopCall();
    this.stopAudio();
    this.patch({ phase: this.state.npc ? "engaged" : "idle" });
  }
  setCallMuted(muted: boolean): void {
    if (!this.isCalling()) return;
    this.patch({ callMuted: muted });
    this.call?.setMuted(muted);
  }
  toggleCall(): void {
    if (this.isCalling()) this.endCall();
    else void this.startCall();
  }
  async startCall(): Promise<void> {
    const npc = this.state.npc, venture = this.options.ventureId;
    if (!npc || this.disposed || this.isCalling()) return;
    if (this.options.offline || this.options.api.mode === "mock" || !venture) {
      this.patch({ callStatus: "unavailable", error: "Live calls unavailable. Use push-to-talk or typing." });
      return;
    }
    const token = ++this.generation;
    this.stopCall();
    this.stopAudio();
    this.session?.cancel(); this.session = undefined;
    clearTimeout(this.poll); clearTimeout(this.maxListen);
    this.patch({ callStatus: "connecting", callMuted: false, callTurns: [], phase: "engaged", error: null, caption: "", voiceUnavailable: false });
    let active = true;
    const questions = new Map<string, string>();
    const current = () => active && !this.disposed && token === this.generation;
    try {
      const call = await (this.options.startCall ?? startVoiceCall)({
        ventureId: venture, agentId: npc.agent_id, surface: "world",
        lipSync: this.options.getLipSync?.(npc.agent_id),
        talk: async (req) => {
          if (!current()) throw new Error("Call ended");
          const answer = await (npc.agent_id === (this.options.conciergeId ?? "concierge") || npc.department_id === "concierge"
            ? this.options.api.concierge(venture, req)
            : this.options.api.talk(venture, npc.agent_id, req));
          if (current()) questions.set(answer.answer_id, req.text);
          return answer;
        },
        onStatus: (status, reason) => {
          if (!current()) return;
          const terminal = ["ended", "unavailable", "error"].includes(status);
          this.patch({ callStatus: status, phase: terminal || status === "connecting" ? "engaged" : status as ConversationPhase,
            ...(status === "unavailable" || status === "error" ? { error: (reason ? reason + " " : "") + "Use push-to-talk or typing." } : {}) });
          if (terminal) { active = false; this.call = undefined; this.options.getLipSync?.(npc.agent_id)?.stop(); }
        },
        onTranscript: (turn) => {
          if (current()) this.patch({ callTurns: [...this.state.callTurns, turn].slice(-6), caption: turn.text });
        },
        onAnswer: (response) => {
          if (!current()) return;
          // Only the grounded tool response enters factual history or source/check/route UI.
          const question = questions.get(response.answer_id);
          questions.delete(response.answer_id);
          const turns: ChatTurn[] = [...(this.histories.get(npc.agent_id) ?? []), ...(question ? [{ role: "user" as const, text: question }] : []), { role: "agent", text: response.text }];
          this.histories.set(npc.agent_id, turns.slice(-6));
          clearTimeout(this.poll);
          this.patch({ response, turns: turns.slice(-6) });
          this.scheduleCheck(response.answer_id, token, 0);
        },
      });
      if (!current()) { void call.end().catch(() => {}); return; }
      this.call = call;
      call.setMuted(this.state.callMuted);
    } catch {
      if (!current()) return;
      active = false;
      this.stopAudio();
      this.patch({ callStatus: "unavailable", phase: "engaged", error: "Live calls unavailable. Check microphone permission; use push-to-talk or typing." });
    }
  }
  /** Call once after camera engagement. Does not fabricate roster copy or add to factual history. */
  async greet(text?: string): Promise<void> {
    const npc = this.state.npc;
    if (
      !npc ||
      this.disposed ||
      this.isCalling() ||
      !["engaged", "speaking"].includes(this.state.phase)
    )
      return;
    const line =
      text?.trim() ||
      (this.greeted.has(npc.agent_id)
        ? "Hi again."
        : `Hi, I'm ${npc.display_name}. What would you like to know?`);
    const token = ++this.generation;
    this.stopAudio();
    clearTimeout(this.poll);
    this.greeted.add(npc.agent_id);
    this.patch({
      caption: line,
      error: null,
      voiceUnavailable: false,
      phase: "speaking",
    });
    let tts: TtsResponse | null = null;
    if (!this.options.offline) {
      const key = npc.agent_id + "\n" + line;
      let pending = this.greetingAudio.get(key);
      if (!pending) {
        pending = this.options.api.tts(npc.agent_id, line);
        this.greetingAudio.set(key, pending);
      }
      try {
        tts = await pending;
      } catch {
        this.greetingAudio.delete(key);
        if (token === this.generation) this.patch({ voiceUnavailable: true });
      }
    } else this.patch({ voiceUnavailable: true });
    if (token !== this.generation) return;
    try {
      const audio = (this.options.speak ?? speak)(line, tts, {
        lipSync: this.options.getLipSync?.(npc.agent_id),
        onCaption: (caption) => {
          if (token === this.generation) this.patch({ caption });
        },
      });
      this.audio = audio;
      void audio.started.catch(() => {});
      await this.waitForAudio(audio);
    } catch {
      if (token === this.generation) this.patch({ voiceUnavailable: true });
    } finally {
      if (token === this.generation) {
        this.audio = undefined;
        this.patch({ phase: "engaged" });
      }
    }
  }
  async send(
    text: string,
    sttMs = 0,
    released = performance.now(),
  ): Promise<void> {
    text = text.trim();
    const npc = this.state.npc;
    if (!text || !npc || this.disposed) return;
    if (
      this.options.offline ||
      (!this.options.ventureId && this.options.api.mode !== "mock")
    ) {
      this.patch({
        error: "Company offline: conversations unavailable",
        phase: "engaged",
      });
      return;
    }
    const token = ++this.generation;
    this.stopCall();
    this.stopAudio();
    this.session?.cancel();
    this.session = undefined;
    clearTimeout(this.poll);
    clearTimeout(this.maxListen);
    const history = [...(this.histories.get(npc.agent_id) ?? [])].slice(-6);
    const turns: ChatTurn[] = [...history, { role: "user", text }];
    this.histories.set(npc.agent_id, turns.slice(-6));
    this.patch({
      phase: "thinking",
      turns: turns.slice(-6),
      response: null,
      error: null,
      caption: "",
      voiceUnavailable: false,
    });
    const started = performance.now();
    try {
      const req = { text, history };
      const venture = this.options.ventureId ?? "ven_mock";
      const response =
        npc.agent_id === (this.options.conciergeId ?? "concierge") ||
        npc.department_id === "concierge"
          ? await this.options.api.concierge(venture, req)
          : await this.options.api.talk(venture, npc.agent_id, req);
      if (token !== this.generation) return;
      const answerMs = performance.now() - started;
      const complete: ChatTurn[] = [
        ...turns,
        { role: "agent", text: response.text },
      ];
      this.histories.set(npc.agent_id, complete.slice(-6));
      this.patch({
        response,
        turns: complete.slice(-6),
        caption: response.text,
      });
      this.scheduleCheck(response.answer_id, token, 0);
      let tts = null;
      const ttsStarted = performance.now();
      try {
        tts = await this.options.api.tts(npc.agent_id, response.text);
      } catch {
        if (token === this.generation) this.patch({ voiceUnavailable: true });
      }
      if (token !== this.generation) return;
      const ttsMs = performance.now() - ttsStarted;
      this.patch({ phase: "speaking" });
      const audio = (this.options.speak ?? speak)(response.text, tts, {
        lipSync: this.options.getLipSync?.(npc.agent_id),
        onCaption: (caption) => {
          if (token === this.generation) this.patch({ caption });
        },
      });
      this.audio = audio;
      void audio.started
        .then((time) => {
          if (token === this.generation)
            void this.options.api
              .postLatency([
                {
                  agent_id: npc.agent_id,
                  stt_ms: sttMs,
                  answer_ms: answerMs,
                  tts_ms: ttsMs,
                  total_ms: Math.max(0, time - released),
                },
              ])
              .catch(() => {});
        })
        .catch(() => {});
      await this.waitForAudio(audio);
      if (token === this.generation) {
        this.audio = undefined;
        this.patch({ phase: "engaged" });
      }
    } catch (error) {
      if (token !== this.generation) return;
      this.patch({
        phase: "engaged",
        error: error instanceof Error ? error.message : String(error),
        caption: "Sorry, I lost my train of thought. Can you ask again?",
      });
    }
  }
  async startPushToTalk(): Promise<void> {
    if (
      !this.state.npc ||
      this.disposed ||
      (this.state.phase === "listening" && !this.isCalling()) ||
      this.options.offline
    )
      return;
    const token = ++this.generation;
    this.stopCall();
    this.stopAudio();
    this.session?.cancel();
    this.session = undefined;
    clearTimeout(this.maxListen);
    clearTimeout(this.poll);
    this.patch({ phase: "listening", error: null });
    this.starting = (async () => {
      try {
        const session = await (this.options.listen ?? startListening)({
          transcribe: (audio) => this.options.api.transcribe(audio),
        });
        if (token !== this.generation) {
          session.cancel();
          return;
        }
        this.session = session;
        this.maxListen = setTimeout(() => {
          void this.stopPushToTalk();
        }, 30000);
      } catch (error) {
        if (token === this.generation)
          this.patch({
            phase: "engaged",
            error: `Microphone unavailable. Type your message. ${error instanceof Error ? error.message : ""}`,
          });
      }
    })();
    await this.starting;
  }
  async stopPushToTalk(): Promise<void> {
    const token = this.generation;
    await this.starting;
    if (token !== this.generation) return;
    const session = this.session;
    if (!session) return;
    this.session = undefined;
    clearTimeout(this.maxListen);
    const released = performance.now();
    this.patch({ phase: "transcribing" });
    try {
      const result = await session.stop();
      if (token !== this.generation) return;
      if (!result.text.trim()) {
        this.patch({
          phase: "engaged",
          error: "No speech detected. You can type your message instead.",
        });
        return;
      }
      await this.send(result.text, result.latency_ms, released);
    } catch (error) {
      if (token === this.generation)
        this.patch({
          phase: "engaged",
          error: `Transcription unavailable. Type your message. ${error instanceof Error ? error.message : ""}`,
        });
    }
  }
  applyCheck(answerId: string, check: AnswerCheck): void {
    if (this.state.response?.answer_id === answerId)
      this.patch({ response: { ...this.state.response, check } });
  }
  private scheduleCheck(id: string, token: number, attempt: number): void {
    if (this.state.response?.answer_id !== id || this.state.response?.check.status !== "pending" || attempt >= 20)
      return;
    this.poll = setTimeout(() => {
      void this.options.api
        .answer(id)
        .then((answer) => {
          if (token !== this.generation || this.state.response?.answer_id !== id) return;
          this.applyCheck(id, answer.check);
          this.scheduleCheck(id, token, attempt + 1);
        })
        .catch(() => {
          if (token === this.generation)
            this.scheduleCheck(id, token, attempt + 1);
        });
    }, this.options.pollIntervalMs ?? 1500);
  }
  followRoute(mode: "race" | "travel" = "travel"): void {
    const r = this.state.response;
    const id =
      r &&
      ("route_card" in r
        ? r.route_card?.agent_id
        : r.suggested_agent?.agent_id);
    if (id) {
      this.close();
      this.options.onRoute?.(id, mode);
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.close();
    this.disposed = true;
    this.listeners.clear();
    this.greetingAudio.clear();
    this.histories.clear();
  }
}
