import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {Character} from '../npc/Character';
import {loadManifest} from '../assets/loadManifest';
import type {CharacterAsset} from '../assets/manifest.contract';
import {STYLES,readSelection,saveSelection,selectedFace,type AvatarSelection as Selection,type CameraMode} from './avatarPreferences';
import CameraAvatarCapture from './CameraAvatarCapture';
import type {FaceSpec} from '../npc/FaceSpec';
import './AvatarSelection.css';
function Preview({asset,selection}:{asset?:CharacterAsset;selection:Selection}) {
  const ref=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    if(!ref.current)return;
    let renderer:THREE.WebGLRenderer;
    try {renderer=new THREE.WebGLRenderer({canvas:ref.current,alpha:true,antialias:true});} catch{return;}
    renderer.setSize(240,260,false); renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));
    const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(35,240/260,.1,20);
    camera.position.set(0,1.1,3.7);camera.lookAt(0,.95,0);
    scene.add(new THREE.HemisphereLight(0xffffff,0x64748b,2.5));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(2,4,3);scene.add(light);
    const character=new Character(selectedFace(selection),{avatar:asset});scene.add(character.group);
    let frame=0,alive=true;const render=()=>{if(!alive)return;character.update(.016);renderer.render(scene,camera);frame=requestAnimationFrame(render);};render();
    return()=>{alive=false;cancelAnimationFrame(frame);character.dispose();renderer.dispose();};
  },[asset,selection.styleId,selection.face]);
  return <canvas ref={ref} aria-label={asset?'Licensed base avatar preview':'Procedural style preview'}/>;
}
export function AvatarSelection({ventureId,onSelect}:{ventureId:string|null;onSelect:(selection:Selection,mode:CameraMode)=>void}) {
  const [assets,setAssets]=useState<CharacterAsset[]|null>(null),[mode,setMode]=useState<CameraMode>('third');
  const saved=readSelection();
  const [photoOpen,setPhotoOpen]=useState(false),[face,setFace]=useState<FaceSpec|undefined>();
  useEffect(()=>{let alive=true;void loadManifest().then(m=>{if(alive)setAssets(m.characters.filter(a=>a.id&&a.url&&['MIT','CC0','CC-BY-4.0'].includes(a.credit?.license)));});return()=>{alive=false;};},[]);
  const choose=(selection:Selection)=>{saveSelection(selection);onSelect(selection.assetId ? {...selection,face:undefined} : selection,mode);};
  return <main className="avatar-landing"><div className="avatar-shell"><p className="avatar-eyebrow">FOUNDRY / YOUR WORLD</p><h1>Choose your presence.</h1><p className="avatar-intro">Pick an avatar and step into your company’s town.</p><div className="avatar-camera" role="group" aria-label="Camera perspective"><button aria-pressed={mode==='third'} onClick={()=>setMode('third')}>Third person · see your avatar</button><button aria-pressed={mode==='first'} onClick={()=>setMode('first')}>First person</button></div>
  {assets===null?<p role="status">Loading available avatars…</p>:<><p className="avatar-note">{assets.length?'Licensed base characters. Previews use the actual runtime model; if loading fails, a procedural fallback appears.':'No licensed character models are available. These are procedural styles, not generated human scans.'}</p><div className="avatar-gallery">{(assets.length?assets:STYLES).map((item,i)=>{const asset=assets.length?item as CharacterAsset:undefined,style=STYLES[i%STYLES.length],selection:Selection={assetId:asset?.id??null,styleId:style.id};return <button className="avatar-card" key={item.id} onClick={()=>choose(selection)}><Preview asset={asset} selection={selection}/><span className="avatar-card-name">{asset?asset.id.split('/').pop()?.replaceAll(/[_-]/g,' '):style.name}</span><span className="avatar-credit">{asset?`${asset.credit.source} · ${asset.credit.license}`:'Procedural style'}</span><span className="avatar-enter">{saved?.assetId===selection.assetId&&saved?.styleId===selection.styleId?'Use again':'Choose avatar'} →</span></button>;})}{face&&<button className="avatar-card avatar-photo-card" onClick={()=>choose({assetId:null,styleId:'slate',face})}><Preview selection={{assetId:null,styleId:'slate',face}}/><span className="avatar-card-name">Photo-inspired procedural style</span><span className="avatar-credit">Photo-inspired colors on a procedural avatar. Not a 3D scan or an exact likeness.</span><span className="avatar-enter">Choose photo-inspired style →</span></button>}</div></>}
  <p className="avatar-privacy">Only your base avatar choice is saved on this device. You can switch camera perspective in the world.</p>
  {ventureId&&<section><p className="avatar-photo-placeholder">Optional photo-inspired colors create a separate procedural style. Licensed base models keep their original appearance. This is not a new 3D scan, an exact likeness, or a completion-time guarantee.</p>{photoOpen?<CameraAvatarCapture ventureId={ventureId} onCancel={()=>setPhotoOpen(false)} onPersonalized={value=>{setFace(value);setPhotoOpen(false);}}/>:<button className="avatar-photo-button" onClick={()=>setPhotoOpen(true)}>{face?'Adjust photo-inspired colors':'Personalize with a photo'}</button>}{face&&<p role="status">Your photo-inspired procedural style is ready in the gallery. Choose that card to use the colors, or choose an unchanged licensed base. Photo-inspired colors are not saved on this device.</p>}</section>}
  </div></main>;
}
