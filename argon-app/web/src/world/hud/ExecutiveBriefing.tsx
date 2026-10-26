import {useEffect,useRef,useState} from "react";
import {demoBriefing} from "../interiors/executiveRoom";
export function ExecutiveBriefing({onClose,onRecorded}:{onClose:()=>void;onRecorded:()=>void}) {
 const [step,setStep]=useState(0);const close=useRef<HTMLButtonElement>(null);
 useEffect(()=>{close.current?.focus();},[]);
 return <div className="modal-backdrop workplace-backdrop" onKeyDown={e=>{e.stopPropagation();if(e.key==="Escape")onClose();if(e.key==="Tab"){const buttons=Array.from(e.currentTarget.querySelectorAll('button'));const first=buttons[0],last=buttons[buttons.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}}>
 <section className="world-modal workplace-panel" role="dialog" aria-modal="true" aria-labelledby="executive-demo-title">
 <header><div><span className="eyebrow">SCRIPTED DEMO · NOT LIVE WORK</span><h2 id="executive-demo-title">Executive HQ · Group briefing</h2></div><button ref={close} onClick={onClose}>Close demo · Esc</button></header>
 <p>This hardcoded presentation does not run agents, write company records, or claim completed work. All 13 departments remain available.</p>
 <p>Executives are assigned conference chairs. The built-in rig uses a static seated pose; imported avatars retain their supplied pose. No seated animation is claimed.</p>
 <nav aria-label="Briefing source"><button aria-current="page">Demo briefing</button><button onClick={onRecorded}>Recorded work / communications</button></nav>
 <ol aria-label="Scripted executive briefing">{demoBriefing.slice(0,step+1).map(item=><li key={item.department}><h3>{item.speaker} · DEMO</h3><p>{item.text}</p></li>)}</ol>
 <button onClick={()=>setStep(step===demoBriefing.length-1?0:step+1)}>{step===demoBriefing.length-1?'Replay scripted briefing':'Next executive'}</button>
 </section></div>;
}
