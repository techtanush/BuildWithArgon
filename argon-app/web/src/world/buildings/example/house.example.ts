// OWNER: frozen contract (change only via docs/contract-requests/<you>.md, applied in the merge session)

// Reference module: shows correct KitApi usage and passes every probe by construction.
// - ayan: used as the "EXAMPLE" section of the worldgen prompt until fallback/archetypes.ts exists.
// - mahin: the kit implementation must render this without errors; start fallback archetypes from it.
import type { BuildingModule, KitApi } from '../../kit/types';

const house: BuildingModule = {
  id: 'example-house',
  interiorShell: { floor: 'wood_floor', walls: 'plaster_warm' },
  buildExterior(k: KitApi) {
    k.group('body', () => {
      k.box({ size: [18, 7, 14], pos: [0, 3.5, -1], mat: 'stucco', collide: true, name: 'walls' });
      k.box({ size: [18.6, 0.4, 14.6], pos: [0, 7.2, -1], mat: 'trim' });
      k.box({ size: [16, 2.6, 12], pos: [0, 8.7, -1], mat: 'roof_red', name: 'roof' });
      k.box({ size: [1.4, 3, 1.4], pos: [5, 10, -4], mat: 'brick', name: 'chimney' });
    });
    k.group('front', () => {
      k.box({ size: [2.4, 3.2, 0.3], pos: [0, 1.6, 6.1], mat: 'wood_dark', name: 'door' });
      k.box({ size: [4, 0.2, 2], pos: [0, 0.1, 7.2], mat: 'plaza_stone', name: 'step' });
      for (const x of [-5.5, 5.5]) {
        k.box({ size: [3, 2, 0.15], pos: [x, 3.2, 6.05], mat: 'window_glow' });
        k.box({ size: [3.3, 0.15, 0.4], pos: [x, 2.1, 6.2], mat: 'trim' });
      }
      k.prop({ kind: 'flowerbed', pos: [-4, 0, 8.5] });
      k.prop({ kind: 'flowerbed', pos: [4, 0, 8.5] });
      k.prop({ kind: 'mailbox', pos: [7.5, 0, 9.5], collide: true });
    });
    k.light({ kind: 'point', pos: [0, 4.2, 7], color: '#FFE9C7', intensity: 1.2, distance: 8 });
    k.entrance({ z: 7.2 });
    k.sign({ pos: [0, 5.2, 6.3], width: 5 });
  },
  buildInterior(k: KitApi) {
    k.window({ wall: 'north', center: -3, width: 3, height: 1.8, sill: 1.0 });
    k.window({ wall: 'east', center: 0, width: 2.5, height: 1.8, sill: 1.0 });
    k.group('work', () => {
      k.prop({ kind: 'desk', pos: [-5, 0, -4], collide: true });
      k.prop({ kind: 'chair', pos: [-5, 0, -3] });
      k.prop({ kind: 'desk', pos: [5, 0, -4], collide: true });
      k.prop({ kind: 'chair', pos: [5, 0, -3] });
      k.prop({ kind: 'bookshelf', pos: [-8, 0, 1], rotY: Math.PI / 2, collide: true });
      k.prop({ kind: 'plant_tall', pos: [7.8, 0, 5.5] });
      k.prop({ kind: 'table_round', pos: [0, 0, -1.5], collide: true });
      k.prop({ kind: 'lamp_floor', pos: [-7.5, 0, 5.5] });
    });
    k.light({ kind: 'point', pos: [0, 3.6, 0], color: '#FFE2B8', intensity: 1.4, distance: 14 });
    k.npcSlot({ id: 's1', pos: [-5, 0, -2], facingY: 0 });
    k.npcSlot({ id: 's2', pos: [5, 0, -2], facingY: 0 });
    k.npcSlot({ id: 's3', pos: [-2.5, 0, 1.5], facingY: 0.4 });
    k.npcSlot({ id: 's4', pos: [2.5, 0, 1.5], facingY: -0.4 });
    k.npcSlot({ id: 's5', pos: [-6, 0, 3.5], facingY: 0.8 });
    k.npcSlot({ id: 's6', pos: [6, 0, 3.5], facingY: -0.8 });
  },
};
export default house;
