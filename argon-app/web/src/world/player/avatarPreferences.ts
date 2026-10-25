import type { FaceSpec } from '../npc/FaceSpec';
import {fallbackFace, validFace} from '../npc/faces';
export type CameraMode = 'third' | 'first';
export interface AvatarSelection { assetId: string | null; styleId: string; face?: FaceSpec }
export const AVATAR_KEY = 'foundry.player.avatar.v1';
export const STYLES = [{id:'slate',name:'Slate',color:'#546B85'},{id:'sage',name:'Sage',color:'#66846A'},{id:'terracotta',name:'Terracotta',color:'#A46C50'}];
export function readSelection(): AvatarSelection | null {
  try { const v=JSON.parse(localStorage.getItem(AVATAR_KEY)||'null'); return v && (v.assetId===null||typeof v.assetId==='string') && STYLES.some(s=>s.id===v.styleId) ? {assetId:v.assetId,styleId:v.styleId} : null; } catch { return null; }
}
export function saveSelection(v:AvatarSelection) { try {localStorage.setItem(AVATAR_KEY,JSON.stringify({assetId:v.assetId,styleId:v.styleId}));} catch {} }
export function selectedFace(v:AvatarSelection):FaceSpec { const base=fallbackFace('player',STYLES.find(s=>s.id===v.styleId)?.color); return {...base,accessory:'none',height:1,build:1,...(validFace(v.face)?{skin:v.face.skin,hair_color:v.face.hair_color,eye_color:v.face.eye_color,outfit_color:v.face.outfit_color,pants_color:v.face.pants_color}:{}),agent_id:'player'}; }
