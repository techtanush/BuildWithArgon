// OWNER: mahin
import { useEffect, useRef, useState } from "react";
import type { ConversationState } from "../conversation/ConversationController";
import { sourceRoute } from "../conversation/ConversationController";
export function ConversationPanel({
  state,
  mock,
  offline,
  onSend,
  onClose,
  onTravel,
  onRace,
  onVoiceStart,
  onVoiceStop,
  onCall,
  onEndCall,
  onMuteCall,
}: {
  state: ConversationState;
  mock: boolean;
  offline: boolean;
  onSend: (text: string) => void;
  onClose: () => void;
  onTravel: (id: string) => void;
  onRace: (id: string) => void;
  onVoiceStart: () => void;
  onVoiceStop: () => void;
  onCall: () => void;
  onEndCall: () => void;
  onMuteCall: (muted: boolean) => void;
}) {
  const [text, setText] = useState("");
  const endCall = useRef(onEndCall);
  endCall.current = onEndCall;
  useEffect(() => () => endCall.current(), []);
  if (!state.npc) return null;
  const calling = state.callStatus !== null && !["ended", "unavailable", "error"].includes(state.callStatus);
  const npc = state.npc,
    response = state.response,
    route = response && ("route_card" in response ? response.route_card : response.suggested_agent);
  const busy = ["thinking", "transcribing"].includes(state.phase);
  const submit = (value = text) => {
    if (!value.trim()) return;
    onSend(value);
    setText("");
  };
  return (
    <section
      className="conversation-panel"
      aria-label={`Conversation with ${npc.display_name}`}
    >
      <header>
        <div className="avatar-initial">{npc.display_name[0]}</div>
        <div>
          <span className="eyebrow">{npc.title}</span>
          <h2>{npc.display_name}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close conversation"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="conversation-scroll" aria-live="polite">
        {state.callStatus && <p className="thinking" role="status">Live call: {state.callStatus}{state.callMuted && calling ? " (muted)" : ""}</p>}
        {!!state.callTurns.length && <div aria-label="Live call transcript">
          <p className="eyebrow">Live transcript · company facts require sources below</p>
          {state.callTurns.map((turn, i) => <div className={`chat-turn ${turn.role}`} key={i}><span>{turn.role === "user" ? "YOU" : npc.display_name.toUpperCase()}</span><p>{turn.text}</p></div>)}
        </div>}
        {!state.turns.length && !calling && (
          <>
            <p className="greeting">
              {npc.agent_id === "concierge"
                ? "Welcome to Foundry. I’m Nova. Ask me anything, and I’ll point you to the right person."
                : `Hi, I’m ${npc.display_name}. What would you like to know?`}
            </p>
            <div className="suggestions">
              <button
                disabled={offline}
                onClick={() =>
                  submit(
                    npc.agent_id === "concierge"
                      ? "Who wrote the pricing research?"
                      : "What are you working on?",
                  )
                }
              >
                {npc.agent_id === "concierge"
                  ? "Who wrote the pricing research?"
                  : "What are you working on?"}{" "}
                ↗
              </button>
            </div>
          </>
        )}
        {state.turns.map((t, i) => (
          <div key={i} className={`chat-turn ${t.role}`}>
            <span>
              {t.role === "user" ? "YOU" : npc.display_name.toUpperCase()}
            </span>
            <p>{t.text}</p>
          </div>
        ))}
        {busy && (
          <p className="thinking">
            {state.phase === "thinking"
              ? "Thinking through your question…"
              : "Transcribing…"}
          </p>
        )}
        {state.phase === "listening" && (
          <p className="thinking">{calling ? "Listening. Speak naturally, or end the call with C." : "Listening. Release V when you’re done."}</p>
        )}
        {response && (
          <div className="sources">
            <div className={`check-status ${response.check.status}`}>
              {response.check.status === "verified"
                ? "Sources verified"
                : `Source check: ${response.check.status}`}
            </div>
            {response.citations.map((c, i) => {
              const href = sourceRoute(c);
              return (
                <article className="source-card" key={i}>
                  <span>
                    {c.kind.toUpperCase()} · {c.id}
                  </span>
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer">
                      {c.label || c.id} ↗
                    </a>
                  ) : (
                    <strong>{c.label || c.id}</strong>
                  )}
                  <blockquote>{c.quote}</blockquote>
                </article>
              );
            })}
          </div>
        )}
        {route && (
          <div className="route-card">
            <span className="eyebrow">YOUR NEXT STOP</span>
            <h3>
              {"agent_name" in route && "building_name" in route ? `${route.agent_name} · ${route.building_name}` : `Continue with ${route.agent_id}`}
            </h3>
            <p>{route.reason}</p>
            <div>
              <button
                className="primary-button"
                onClick={() => onTravel(route.agent_id)}
              >
                Take me there ↗
              </button>
              <button onClick={() => onRace(route.agent_id)}>Race there</button>
            </div>
          </div>
        )}
        {state.error && (
          <p className="conversation-error" role="status">
            {state.error}
          </p>
        )}
        {state.voiceUnavailable && (
          <p className="conversation-error">
            Voice unavailable. You can read the conversation above.
          </p>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          aria-label={`Message ${npc.display_name}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            offline
              ? "Conversations unavailable"
              : `Ask ${npc.display_name} something…`
          }
          disabled={offline}
        />
        <button
          type="submit"
          aria-label="Send message"
          disabled={offline || !text.trim() || busy}
        >
          ↑
        </button>
      </form>
      <footer>
        <button onClick={onCall} disabled={offline || mock} aria-label={calling ? "End call" : "Call agent"}>
          {calling ? "End call" : "Call"} <kbd>C</kbd>
        </button>
        {calling && <button onClick={() => onMuteCall(!state.callMuted)} aria-pressed={state.callMuted}>{state.callMuted ? "Unmute" : "Mute"}</button>}
        <button
          onPointerDown={onVoiceStart}
          onPointerUp={onVoiceStop}
          onPointerCancel={onVoiceStop}
          onPointerLeave={() => {
            if (state.phase === "listening") onVoiceStop();
          }}
          disabled={offline}
        >
          Hold <kbd>V</kbd> to speak
        </button>
        <span>{offline ? "OFFLINE" : mock ? "MOCK CONVERSATIONS" : "LIVE CONVERSATIONS"}</span>
      </footer>
    </section>
  );
}
