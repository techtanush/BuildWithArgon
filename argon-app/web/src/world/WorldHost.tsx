// OWNER: mahin
import { useEffect, useRef, useState } from "react";
import { Engine, initialWorldState } from "./engine/Engine";
import { Hud } from "./hud/Hud";
import "./hud/hud.css";
export default function WorldHost() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<Engine | null>(null);
  const [state, setState] = useState(initialWorldState);
  useEffect(() => {
    if (!canvas.current) return;
    const params = new URLSearchParams(location.search);
    const instance = new Engine(canvas.current, {
      ventureId: params.get("venture"),
      goto: params.get("goto") ?? undefined,
      onChange: setState,
    });
    engine.current = instance;
    void instance.start();
    return () => {
      instance.dispose();
      engine.current = null;
    };
  }, []);
  return (
    <main className="world-root">
      <canvas
        ref={canvas}
        className="world-canvas"
        aria-label="Foundry interactive 3D town"
      />
      <Hud state={state} engine={engine.current} />
    </main>
  );
}
