// OWNER: mahin
import { useEffect, useRef, useState } from "react";
import { Engine, initialWorldState } from "./engine/Engine";
import { Hud } from "./hud/Hud";
import {AvatarSelection} from './player/AvatarSelection';
import type {AvatarSelection as Selection,CameraMode} from './player/avatarPreferences';
import "./hud/hud.css";
export default function WorldHost() {
  const canvas = useRef<HTMLCanvasElement>(null),engine = useRef<Engine | null>(null);
  const [state, setState] = useState(initialWorldState),[selection,setSelection]=useState<Selection|null>(null),[cameraMode,setCameraMode]=useState<CameraMode>('third');
  const ventureId=new URLSearchParams(location.search).get('venture');
  useEffect(() => {
    if (!canvas.current || !selection) return;
    const params = new URLSearchParams(location.search);
    const instance = new Engine(canvas.current, {ventureId: params.get("venture"),goto: params.get("goto") ?? undefined,onChange: setState,avatar:selection,cameraMode});
    engine.current = instance; void instance.start();
    return () => {instance.dispose();engine.current = null;};
  }, [selection]);
  if(!selection)return <AvatarSelection ventureId={ventureId} onSelect={(s,m)=>{setCameraMode(m);setSelection(s);}}/>;
  return <main className="world-root"><canvas ref={canvas} className="world-canvas" aria-label="Foundry interactive 3D town"/><Hud state={state} engine={engine.current}/>{state.ready&&['foot','conversation'].includes(state.mode)&&<button className="world-camera-switch" onClick={()=>{const next=cameraMode==='third'?'first':'third';setCameraMode(next);engine.current?.setCameraMode(next);}}>{cameraMode==='third'?'Switch to first person':'Switch to third person'}</button>}</main>;
}
