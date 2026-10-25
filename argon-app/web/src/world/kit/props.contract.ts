// OWNER: frozen contract (change only via docs/contract-requests/<you>.md, applied in the merge session)
// Footprints for every PropKind, in meters, sized for a 1.75 m person. Origin = floor center of the prop
// (a prop's pos.y is the height of the surface it stands on, e.g. 0.75 for a mug on a desk).
// - mahin: kit/props.ts must build each prop to these sizes (colliders = w × d OBB when collide: true).
// - ayan: the worldgen prompt's "PROPS LIBRARY" table is generated from this file.
import type { PropKind } from './types';

export interface PropFootprint { w: number; d: number; h: number; note: string }

export const PROP_FOOTPRINTS: Record<PropKind, PropFootprint> = {
  desk: { w: 1.4, d: 0.7, h: 0.75, note: 'work desk; front faces +Z' },
  chair: { w: 0.5, d: 0.5, h: 0.9, note: 'office chair; seat 0.45' },
  armchair: { w: 0.85, d: 0.85, h: 0.9, note: 'upholstered' },
  sofa: { w: 2.0, d: 0.9, h: 0.85, note: 'three-seat' },
  table_round: { w: 1.2, d: 1.2, h: 0.75, note: 'diameter 1.2' },
  table_long: { w: 3.0, d: 1.1, h: 0.76, note: 'meeting / council table' },
  bookshelf: { w: 1.0, d: 0.35, h: 2.0, note: 'filled with books' },
  plant_small: { w: 0.4, d: 0.4, h: 0.6, note: 'potted' },
  plant_tall: { w: 0.6, d: 0.6, h: 1.7, note: 'potted' },
  lamp_floor: { w: 0.4, d: 0.4, h: 1.6, note: 'decorative; no light (use k.light)' },
  lamp_desk: { w: 0.2, d: 0.2, h: 0.45, note: 'place on a desk (pos.y = 0.75)' },
  screen_stand: { w: 0.6, d: 0.25, h: 0.5, note: 'monitor on stand; place on a desk' },
  whiteboard: { w: 1.8, d: 0.1, h: 1.9, note: 'on legs; board 1.8 × 1.0' },
  counter: { w: 2.0, d: 0.6, h: 1.05, note: 'service counter' },
  crate: { w: 0.6, d: 0.6, h: 0.6, note: 'wooden' },
  barrel: { w: 0.6, d: 0.6, h: 0.9, note: 'diameter 0.6' },
  bench: { w: 1.8, d: 0.5, h: 0.45, note: 'seat bench' },
  telescope: { w: 0.8, d: 0.8, h: 1.6, note: 'on tripod' },
  clock: { w: 0.5, d: 0.08, h: 0.5, note: 'wall clock; pos.y = mount height' },
  vault_door: { w: 2.2, d: 0.4, h: 2.4, note: 'round door in frame; decorative' },
  workbench: { w: 1.8, d: 0.8, h: 0.9, note: 'tools on top' },
  server_rack: { w: 0.6, d: 1.0, h: 2.0, note: 'blinking lights' },
  flowerbed: { w: 2.4, d: 0.9, h: 0.4, note: 'raised bed with flowers' },
  mailbox: { w: 0.4, d: 0.4, h: 1.2, note: 'on post' },
  flag: { w: 0.6, d: 0.6, h: 4.0, note: 'pole with flag (flag 1.2 × 0.8 to +X)' },
  easel: { w: 0.7, d: 0.6, h: 1.7, note: 'with canvas' },
  filing_cabinet: { w: 0.5, d: 0.6, h: 1.3, note: '4 drawers' },
  mug: { w: 0.1, d: 0.1, h: 0.1, note: 'place on a surface' },
  books: { w: 0.3, d: 0.22, h: 0.25, note: 'small stack; place on a surface' },
};
