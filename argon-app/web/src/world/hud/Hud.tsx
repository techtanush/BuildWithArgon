// OWNER: mahin
import type { Engine, WorldState } from "../engine/Engine";
import type { QualityChoice } from "../engine/Quality";
import {MiniMap} from "./MiniMap";
import { MapOverlay } from "./MapOverlay";
import { ConversationPanel } from "./ConversationPanel";
import {WorkplacePanel} from "./WorkplacePanel";
export function Hud({
  state,
  engine,
}: {
  state: WorldState;
  engine: Engine | null;
}) {
  const back = () => { location.href = "/dashboard"; };
  return (
    <div className="world-hud" onKeyDown={event=>{
      if((event.target as HTMLElement).closest("button,a,select,input,textarea")) {
        if(["Space","Enter","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(event.code)) event.stopPropagation();
      }
    }}>
      <header className="world-topbar">
        <a className="world-brand" href="/dashboard" aria-label="Back to dashboard">
          <span className="brand-mark">f.</span>
          <div>
            FOUNDRY<small>YOUR COMPANY. YOUR CITY.</small>
          </div>
        </a>
        <div className="world-location">
          <span className="location-dot" />
          {state.place}
          <span className="location-divider">/</span>
          <span>{state.scene === "city" ? "OUTDOORS" : "INTERIOR"}</span>
        </div>
        <nav>
          {state.ready&&["foot","conversation"].includes(state.mode)&&state.scene!=="city"&&<button onClick={()=>engine?.openWorkplace()}>See communications</button>}
          {state.ready&&state.mode!=="transition"&&<button onClick={()=>void engine?.meetDepartmentLeads()}>Meet department leads</button>}
          {state.ready&&state.scene==="city"&&state.mode==="foot"&&<button onClick={()=>engine?.enterCar(true)}>Drive the city</button>}
          <button onClick={() => engine?.showMap()}>
            City map <kbd>M</kbd>
          </button>
          <button
            className="icon-button"
            onClick={() => engine?.pause()}
            aria-label="Open settings"
          >
            ☰
          </button>
        </nav>
      </header>
      {state.ready && (
        <button
          className="nova-launcher"
          onClick={() => engine?.openNova()}
          disabled={state.mode === "transition"}
          aria-label="Ask Nova"
        >
          Ask Nova <kbd>N</kbd>
        </button>
      )}
      {!state.ready && !state.error && (
        <div className="world-loading">
          <span className="brand-mark">f.</span>
          <h1>A city of possibility.</h1>
          <p>Laying out the streets of Foundry.</p>
          <div className="loading-line" />
        </div>
      )}
      {state.error && (
        <div className="world-modal error-modal">
          <span className="eyebrow">WORLD UNAVAILABLE</span>
          <h2>I couldn’t open the town.</h2>
          <p>{state.error}</p>
          <button onClick={() => location.reload()}>Try again</button>
        </div>
      )}
      {state.ready && (
        <>
          <div className="world-status">
            <span className={state.mock ? "mock-badge" : "live-badge"}>
              {state.mock
                ? "LOCAL PREVIEW · MOCK DATA"
                : state.offline
                  ? "OFFLINE EXPLORATION"
                  : "CONNECTED"}
            </span>
            {state.offline && (
              <p>
                Conversations unavailable. You can still explore the entire
                town.
              </p>
            )}
          </div>
          {state.mode === "foot" && <div className="crosshair" />}
          {state.prompt && state.mode === "foot" && (
            <button
              className="interact-prompt"
              onClick={() => engine?.interact()}
            >
              <kbd>E</kbd>
              {state.prompt}
            </button>
          )}
          {state.mode !== "workplace" && state.mode !== "conversation" &&
            state.mode !== "map" &&
            state.mode !== "paused" && (
              <div className="world-caption">
                <span className="eyebrow">EXPLORE FOUNDRY</span>
                <h1>
                  {state.scene === "city"
                    ? "The city is yours."
                    : state.place}
                </h1>
                <p>
                  {state.scene === "city"
                    ? "13 departments. One connected city."
                    : "Walk up to someone. Start a conversation."}
                </p>
              </div>
            )}
          {state.manifest&&state.scene==="city"&&!["map","paused","conversation","workplace"].includes(state.mode)&&<MiniMap manifest={state.manifest} position={state.position} yaw={state.yaw} onOpen={()=>engine?.showMap()}/>}
          <footer className="world-bottom">
            <div className="control-guide">
              <span>
                <kbd>W A S D</kbd>
                {state.mode === "car" || state.mode === "race"
                  ? "Drive"
                  : "Move"}
              </span>
              <span>
                <kbd>CLICK + MOUSE</kbd>Look
              </span>
              <span>
                <kbd>E</kbd>Interact
              </span>
              <span>
                <kbd>M</kbd>Map
              </span>
              <span>
                <kbd>N</kbd>Ask Nova
              </span>
            </div>
            <button className="quality-readout" onClick={() => engine?.pause()}>
              {state.fps} FPS · {state.actualQuality.toUpperCase()}{" "}
              <span>{state.calls} draws</span>
            </button>
          </footer>
          {state.toast && (
            <div className="world-toast" role="status">
              {state.toast}
            </div>
          )}
          {(state.mode === "car" || state.mode === "race") && (
            <div className="driving-hud">
              <strong>{Math.round(state.speed)}</strong>
              <span>KM/H</span>
              <button onClick={() => engine?.interact()}>Exit car · E</button>
              <small>Space: handbrake · R: reset · Q: abandon race</small>
            </div>
          )}
          {state.race && (state.mode === "race" || state.mode === "car") && (
            <div className="race-hud">
              <span className="eyebrow">
                {state.race.state === "finished"
                  ? "ARRIVED"
                  : "FOLLOW THE GOLDEN ROUTE"}
              </span>
              <strong>
                {state.race.countdownLabel || (state.race.state === "countdown"
                  ? state.race.countdown
                  : state.race.time.toFixed(1) + "s")}
              </strong>
              <small>Route ghost · scripted pace car</small>
              <span>
                Checkpoint{" "}
                {Math.min(state.race.checkpoint + 1, state.race.total)} /{" "}
                {state.race.total}
              </span>
            </div>
          )}
          {state.mode === "conversation" && state.conversation && (
            <>
              {state.remoteConcierge && <div className="world-toast" role="status">REMOTE CONNECTION · NOVA</div>}
              <ConversationPanel
                state={state.conversation}
                mock={state.mock}
                offline={state.offline}
                onClose={() => engine?.closeConversation()}
                onSend={(text) => void engine?.sendText(text)}
                onTravel={(id) => void engine?.travel(id)}
                onRace={(id) => engine?.startRace(id)}
                onCall={() => engine?.toggleCall()}
                onEndCall={() => engine?.endCall()}
                onMuteCall={(muted) => engine?.muteCall(muted)}
                onVoiceStart={() => void engine?.holdVoice()}
                onVoiceStop={() => void engine?.releaseVoice()}
              />
            </>
          )}
          {state.mode === "workplace" && state.workplace && <WorkplacePanel ventureId={state.ventureId} departmentId={state.workplace.departmentId} name={state.workplace.name} mock={state.mock} activity={state.activity} activityError={state.activityError} onClose={()=>engine?.closeWorkplace()}/>}
          {state.mode === "map" && state.manifest && (
            <div className="modal-backdrop">
              <MapOverlay
                manifest={state.manifest}
                position={state.position}
                onTravel={(id) => void engine?.travel(id)}
                onRace={(id) => engine?.startRace(id)}
                onClose={() => engine?.resume()}
              />
            </div>
          )}
          {state.mode === "paused" && !state.error && (
            <div className="modal-backdrop">
              <section
                className="world-modal pause-modal"
                role="dialog"
                aria-modal="true"
                aria-label="World settings"
              >
                <span className="eyebrow">TAKE A BREATHER</span>
                <h2>Your city can wait.</h2>
                <label>
                  Visual quality
                  <select
                    value={state.quality}
                    onChange={(e) =>
                      engine?.setQuality(e.target.value as QualityChoice)
                    }
                  >
                    <option value="auto">Auto · adapt to your device</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
                <button aria-pressed={state.conversation?.audioEnabled ?? true} onClick={()=>engine?.setAudioEnabled(!(state.conversation?.audioEnabled ?? true))}>
                  Automatic speech: {(state.conversation?.audioEnabled ?? true) ? "on" : "off"}
                </button>
                <p>
                  Higher quality uses more GPU. Voice and generated assets are
                  supplied by your team’s integrations.
                </p>
                <button
                  className="primary-button"
                  onClick={() => engine?.resume()}
                >
                  Back to exploring
                </button>
                <button onClick={() => engine?.showMap()}>
                  Open city directory
                </button>
                <button onClick={back}>Back to dashboard</button>
              </section>
            </div>
          )}
        </>
      )}
      <div
        className={`world-fade ${state.fade ? "active" : ""}`}
        aria-hidden="true"
      />
    </div>
  );
}
