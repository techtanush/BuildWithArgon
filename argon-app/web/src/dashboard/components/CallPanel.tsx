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
  const handle = useRef<VoiceCallHandle | null>(null),
    panel = useRef<HTMLDivElement>(null),
    close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let disposed = false;
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    void startVoiceCall({
      ventureId,
      agentId: agent.id,
      surface: "dashboard",
      onStatus: (value) => {
        if (!disposed) setStatus(value);
      },
      onTranscript: (turn) => {
        if (!disposed) setTurns((old) => [...old, turn]);
      },
      onAnswer: (answer) => {
        if (!disposed) setAnswers((old) => [...old, answer]);
      },
    })
      .then((value) => {
        if (disposed) void value.end();
        else {
          handle.current = value;
          setStatus(value.status);
        }
      })
      .catch(() => {
        if (!disposed) setStatus("error");
      });
    return () => {
      disposed = true;
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
  function keyboard(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      onClose();
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
          <Status value={status} />
        </header>
        {unavailable && (
          <div className="notice" role="status">
            {status === "ended"
              ? "Call ended."
              : "Voice calls unavailable. You can keep typing in the Talk box."}
          </div>
        )}
        <div className="call-transcript" aria-live="polite">
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
          <Sources key={answer.answer_id} answer={answer} />
        ))}
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
          <button ref={close} className="button danger" onClick={onClose}>
            {unavailable ? "Close call" : "End call"}
          </button>
        </footer>
      </div>
    </div>
  );
}
