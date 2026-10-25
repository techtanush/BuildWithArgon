// OWNER: tanush
import { useEffect, useRef, useState } from "react";
import type {
  Agent,
  ChatTurn,
  ConciergeResponse,
  TalkResponse,
} from "../../shared/contracts";
import {
  startVoiceCall,
  type VoiceCallHandle,
  type VoiceCallStatus,
} from "../../world/conversation/VoiceCall";
import { liveApi } from "../../shared/worldApi";
import { startListening, type SttSession } from "../../world/conversation/Stt";
import { subscribe } from "../../api/sse";
import { Portrait, Sources, Status } from "./Shared";

export default function CallPanel({
  agent,
  ventureId,
  onClose,
}: {
  agent: Agent;
  ventureId: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<VoiceCallStatus>("connecting"),
    [muted, setMuted] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]),
    [answers, setAnswers] = useState<(TalkResponse | ConciergeResponse)[]>([]);
  const [reason, setReason] = useState("");
  const [fallbackPhase, setFallbackPhase] = useState<"idle" | "listening" | "transcribing" | "thinking">("idle");
  const fallbackState = useRef(fallbackPhase), fallbackReleased = useRef(false);
  function changeFallbackPhase(value: typeof fallbackPhase) { fallbackState.current = value; setFallbackPhase(value); }
  const fallbackSession = useRef<SttSession | null>(null), operation = useRef(0), cancelled = useRef(false);
  const fallbackHistory = useRef<ChatTurn[]>([]);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout>>();
  const handle = useRef<VoiceCallHandle | null>(null),
    panel = useRef<HTMLDivElement>(null),
    close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let disposed = false;
    cancelled.current = false; operation.current++;
    setTurns([]); setAnswers([]); setMuted(false); setReason(""); setStatus("connecting"); changeFallbackPhase("idle");
    fallbackHistory.current = [];
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    void startVoiceCall({
      ventureId,
      agentId: agent.id,
      surface: "dashboard",
      onStatus: (value, message) => {
        if (!disposed && !cancelled.current) { setStatus(value); setReason(message && !/credentials|api[ _-]?key|token/i.test(message) ? message : ""); }
      },
      onTranscript: (turn) => {
        if (!disposed && !cancelled.current) setTurns((old) => [...old, turn].slice(-40));
      },
      onAnswer: (answer) => {
        if (!disposed && !cancelled.current) setAnswers((old) => [...old.filter(a => a.answer_id !== answer.answer_id), answer].slice(-6));
      },
    })
      .then((value) => {
        if (disposed || cancelled.current) void value.end().catch(() => {});
        else {
          handle.current = value;
          setStatus(value.status);
        }
      })
      .catch(() => {
        if (!disposed && !cancelled.current) setStatus("error");
      });
    return () => {
      disposed = true; operation.current++;
      clearTimeout(fallbackTimer.current); fallbackSession.current?.cancel(); fallbackSession.current = null;
      void handle.current?.end().catch(() => {});
      handle.current = null;
      previous?.focus();
    };
  }, [ventureId, agent.id]);
  useEffect(
    () =>
      subscribe(ventureId, (event) => {
        if (event.type !== "answer.checked") return;
        const payload = event.data as {
          answer_id: string;
          check: TalkResponse["check"];
        };
        setAnswers((old) =>
          old.map((answer) =>
            answer.answer_id === payload.answer_id
              ? { ...answer, check: payload.check }
              : answer,
          ),
        );
      }),
    [ventureId],
  );
  function closeCall() {
    cancelled.current = true; operation.current++;
    clearTimeout(fallbackTimer.current); fallbackSession.current?.cancel(); fallbackSession.current = null;
    void handle.current?.end().catch(() => {});
    handle.current = null;
    onClose();
  }
  async function finishFallback() {
    if (fallbackState.current !== "listening") return;
    const token = operation.current, session = fallbackSession.current;
    if (!session) { fallbackReleased.current = true; return; }
    clearTimeout(fallbackTimer.current); changeFallbackPhase("transcribing");
    try {
      const result = await session.stop();
      if (token !== operation.current) return;
      if (!result.text.trim()) { setReason("No speech detected. Try again or close this call and use the Talk box."); return; }
      const text = result.text.trim();
      setTurns(old => [...old, { role: "user" as const, text }].slice(-40)); changeFallbackPhase("thinking");
      const req = { text, history: fallbackHistory.current.slice(-6) };
      const answer = await (agent.id === "concierge" || agent.department_id === "concierge" ? liveApi.concierge(ventureId, req) : liveApi.talk(ventureId, agent.id, req));
      if (token !== operation.current) return;
      fallbackHistory.current = [...fallbackHistory.current, { role: "user" as const, text }, { role: "agent" as const, text: answer.text }].slice(-6);
      setAnswers(old => [...old.filter(a => a.answer_id !== answer.answer_id), answer].slice(-6));
      setTurns(old => [...old, { role: "agent" as const, text: answer.text }].slice(-40)); setReason("");
    } catch { if (token === operation.current) setReason("Microphone or transcription unavailable. Close this call and type in the Talk box."); }
    finally { if (token === operation.current) { fallbackSession.current = null; changeFallbackPhase("idle"); } }
  }
  async function startFallback() {
    if (fallbackState.current !== "idle") return;
    fallbackReleased.current = false;
    // Explicitly switching input modes cancels startup as well as established calls.
    cancelled.current = true; const token = ++operation.current;
    void handle.current?.end().catch(() => {}); handle.current = null;
    setStatus("ended"); setMuted(false); setReason(""); changeFallbackPhase("listening");
    try {
      const session = await startListening({ transcribe: audio => liveApi.transcribe(audio) });
      if (token !== operation.current) { session.cancel(); return; }
      fallbackSession.current = session;
      if (fallbackReleased.current) void finishFallback();
      else fallbackTimer.current = setTimeout(() => { void finishFallback(); }, 30_000);
    } catch { if (token === operation.current) { changeFallbackPhase("idle"); setReason("Microphone unavailable. Close this call and type in the Talk box."); } }
  }
  function keyboard(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      closeCall();
      return;
    }
    if (event.key === "Tab") {
      const buttons = panel.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled),a[href]",
      );
      if (!buttons?.length) return;
      const first = buttons[0],
        last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  const unavailable = ["unavailable", "error", "ended"].includes(status);
  return (
    <div className="modal-backdrop">
      <div
        className="call-panel"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`Call ${agent.display_name}`}
        onKeyDown={keyboard}
      >
        <header>
          <Portrait agent={agent} size={60} />
          <div>
            <p className="eyebrow">Live voice call</p>
            <h2>{agent.display_name}</h2>
            <p>{agent.title}</p>
          </div>
          <div role="status" aria-live="polite" aria-atomic="true"><Status value={fallbackPhase === "idle" ? status : fallbackPhase} />{muted && <span>Microphone muted</span>}</div>
        </header>
        {(unavailable || reason) && (
          <div className="notice" role="status">
            {unavailable && status !== "ended" && <p>Voice calls unavailable. You can keep typing in the Talk box.</p>}
            {reason && <p>{reason}</p>}
            <p>{status === "ended" ? "Live call ended. Use push-to-talk below, or close this call to type in the Talk box." : "Use push-to-talk below, or close this call to type in the Talk box."}</p>
          </div>
        )}
        <div className="call-transcript" role="log" aria-label="Voice transcript, not independently verified" aria-live="polite" aria-relevant="additions text">
          <p className="muted">Live transcripts may be inaccurate. Only company tool answers below have sources and checks.</p>
          {!turns.length && !unavailable && (
            <p className="muted">Your conversation will appear here.</p>
          )}
          {turns.map((turn, i) => (
            <div className={`conversation-turn ${turn.role}`} key={i}>
              <strong>
                {turn.role === "user" ? "You" : agent.display_name}
              </strong>
              <p>{turn.text}</p>
            </div>
          ))}
        </div>
        {answers.map((answer) => (
          <section key={answer.answer_id} aria-label="Grounded company answer"><p>{answer.text}</p><Sources answer={answer} /></section>
        ))}
        <p className="muted">For push-to-talk, press to start recording, then send your voice question. Recording stops after 30 seconds.</p>
        <footer>
          <button
            className="button"
            disabled={unavailable || !handle.current}
            onClick={() => {
              handle.current?.setMuted(!muted);
              setMuted(!muted);
            }}
            aria-pressed={muted}
          >
            {muted ? "Unmute" : "Mute"}
          </button>
          <button className="button" disabled={fallbackPhase === "transcribing" || fallbackPhase === "thinking"} aria-pressed={fallbackPhase === "listening"}
            onClick={() => { void (fallbackPhase === "listening" ? finishFallback() : startFallback()); }}>
            {fallbackPhase === "listening" ? "Send voice question" : fallbackPhase === "transcribing" ? "Transcribing…" : fallbackPhase === "thinking" ? "Finding grounded answer…" : "Push-to-talk instead"}
          </button>
          <button ref={close} className="button danger" onClick={closeCall}>
            {unavailable ? "Close call" : "End call"}
          </button>
        </footer>
      </div>
    </div>
  );
}
