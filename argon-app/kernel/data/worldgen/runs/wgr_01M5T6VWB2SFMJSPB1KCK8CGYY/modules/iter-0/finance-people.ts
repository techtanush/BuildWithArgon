import type { BuildingModule, KitApi } from '../../kit/types';

const financePeopleBuilding: BuildingModule = {
  id: 'finance-people',
  interiorShell: { floor: 'wood_floor', walls: 'plaster_warm' },

  buildExterior(k: KitApi) {
    // Disjoint colliders for the solid stone bank (leaving entrance at z=7.2 clear)
    k.group('colliders', () => {
      k.box({ size: [7.4, 9.0, 13.6], pos: [-6.3, 4.5, -0.4], mat: 'plaza_stone', collide: true, name: 'bank_west_col' });
      k.box({ size: [7.4, 9.0, 13.6], pos: [6.3, 4.5, -0.4], mat: 'plaza_stone', collide: true, name: 'bank_east_col' });
      k.box({ size: [4.6, 9.0, 11.4], pos: [0, 4.5, -1.5], mat: 'plaza_stone', collide: true, name: 'bank_center_col' });
    });

    // Solid stone bank: symmetrical facade, 4 pillars, triangular pediment, green doors, vault_door visible through front window
    k.group('bank_temple_facade', () => {
      // Heavy stepped granite base
      k.box({ size: [21.0, 1.4, 14.6], pos: [0, 0.7, -0.2], mat: 'plaza_stone' });
      // Main ashlar stone building mass
      k.box({ size: [20.2, 8.2, 13.8], pos: [0, 5.5, -0.4], mat: 'plaza_stone', name: 'stone_walls' });
      // Rusticated horizontal stone bands across the facade
      for (const ry of [2.8, 4.8, 6.8, 8.8]) {
        k.box({ size: [20.5, 0.22, 14.0], pos: [0, ry, -0.4], mat: 'trim' });
      }

      // Projecting portico platform & 4 monumental classical pillars across the front (z = 8.0)
      k.box({ size: [12.4, 0.6, 2.6], pos: [0, 0.3, 7.6], mat: 'plaza_stone' });
      for (const px of [-4.8, -1.9, 1.9, 4.8]) {
        k.box({ size: [1.2, 0.55, 1.2], pos: [px, 0.85, 8.0], mat: 'trim' });
        k.cylinder({
          radiusTop: 0.46,
          radiusBottom: 0.54,
          height: 7.4,
          pos: [px, 4.8, 8.0],
          mat: 'trim',
          segments: 24,
        });
        k.box({ size: [1.28, 0.55, 1.28], pos: [px, 8.75, 8.0], mat: 'trim' });
      }

      // Classical entablature with emerald-green (`accent`) frieze & triangular pediment
      k.box({ size: [13.2, 0.65, 2.8], pos: [0, 9.35, 7.4], mat: 'trim' });
      k.box({ size: [13.0, 0.55, 2.6], pos: [0, 9.95, 7.4], mat: 'accent', name: 'emerald_frieze' });
      k.box({ size: [20.8, 0.5, 14.4], pos: [0, 10.0, -0.4], mat: 'trim' });

      // Triangular pediment built from stepped tympanum boxes & raking cornice
      k.box({ size: [13.4, 0.4, 3.0], pos: [0, 10.4, 7.4], mat: 'trim' });
      const pedSteps = 6;
      for (let i = 0; i < pedSteps; i++) {
        const w = 11.8 - i * 1.9;
        const y = 10.8 + i * 0.42;
        k.box({ size: [w, 0.44, 2.4], pos: [0, y, 7.35], mat: 'plaza_stone' });
        k.box({ size: [w + 0.5, 0.18, 2.7], pos: [0, y + 0.18, 7.42], mat: 'trim' });
      }
      // Central gold/emerald medallion crest inside the pediment tympanum
      k.cylinder({
        radiusTop: 0.75,
        radiusBottom: 0.75,
        height: 0.25,
        pos: [0, 11.6, 8.58],
        rotX: Math.PI / 2,
        mat: 'accent',
      });
      k.box({ size: [18.8, 1.2, 12.2], pos: [0, 10.8, -0.6], mat: 'roof' });
    });

    // Front windows + round `vault_door` prop visibly gleaming through the west front showcase window
    k.group('front_windows_and_vault_showcase', () => {
      // West front window: clear `glass` framing a round `vault_door` prop right behind it!
      k.box({ size: [3.2, 3.6, 0.3], pos: [-7.2, 3.4, 6.45], mat: 'trim' });
      k.box({ size: [2.8, 3.2, 0.12], pos: [-7.2, 3.4, 6.55], mat: 'glass', name: 'vault_display_glass' });
      k.prop({ kind: 'vault_door', pos: [-7.2, 1.8, 6.1], rotY: 0 });

      // Other front windows (`window_glow`) with security mullions
      for (const wx of [-3.4, 3.4, 7.2]) {
        k.box({ size: [2.4, 3.6, 0.24], pos: [wx, 3.4, 6.48], mat: 'trim' });
        k.box({ size: [2.0, 3.2, 0.28], pos: [wx, 3.4, 6.51], mat: 'window_glow' });
        for (const mx of [-0.5, 0, 0.5]) {
          k.box({ size: [0.06, 3.2, 0.32], pos: [wx + mx, 3.4, 6.55], mat: 'metal_dark' });
        }
        k.box({ size: [2.6, 0.22, 0.42], pos: [wx, 1.55, 6.6], mat: 'plaza_stone' });
      }
      // Upper storey windows
      for (const wx of [-7.2, -3.4, 3.4, 7.2]) {
        k.box({ size: [2.0, 2.2, 0.22], pos: [wx, 7.4, 6.48], mat: 'trim' });
        k.box({ size: [1.7, 1.9, 0.26], pos: [wx, 7.4, 6.51], mat: 'window_glow' });
      }
    });

    // Emerald green (`accent`) bank doors, entrance, sign, and forecourt planters
    k.group('entrance_and_forecourt', () => {
      k.box({ size: [3.2, 4.2, 0.6], pos: [0, 2.4, 6.6], mat: 'accent', name: 'emerald_door_frame' });
      k.entrance({ z: 6.9 });
      k.sign({ pos: [0, 5.2, 8.65], rotY: 0, width: 5.2 });

      k.prop({ kind: 'flowerbed', pos: [-7.2, 0, 9.2] });
      k.prop({ kind: 'flowerbed', pos: [7.2, 0, 9.2] });
      k.prop({ kind: 'bench', pos: [-7.5, 0, 11.0], rotY: 0, collide: true });
      k.prop({ kind: 'bench', pos: [7.5, 0, 11.0], rotY: 0, collide: true });
    });

    k.light({ kind: 'point', pos: [0, 4.2, 8.2], color: '#FFEBC8', intensity: 1.3, distance: 10 });
  },

  buildInterior(k: KitApi) {
    // Bank hall windows
    k.window({ wall: 'north', center: -4.2, width: 2.6, height: 2.0, sill: 0.9 });
    k.window({ wall: 'north', center: 4.2, width: 2.6, height: 2.0, sill: 0.9 });
    k.window({ wall: 'east', center: -1.5, width: 2.6, height: 2.0, sill: 0.9 });

    // Emerald-bordered bank hall rug
    k.plane({ size: [6.2, 4.4], pos: [0, 0.01, -0.4], rot: [-Math.PI / 2, 0, 0], mat: 'accent_dark' });
    k.plane({ size: [5.7, 3.9], pos: [0, 0.015, -0.4], rot: [-Math.PI / 2, 0, 0], mat: 'fabric_cream' });

    // Massive `vault_door` centered on the north wall framed by heavy steel/stone piers
    k.group('north_vault_feature', () => {
      k.box({ size: [3.4, 3.4, 0.45], pos: [0, 1.7, -6.75], mat: 'plaza_stone' });
      k.box({ size: [3.6, 0.3, 0.55], pos: [0, 3.45, -6.72], mat: 'trim' });
      k.prop({ kind: 'vault_door', pos: [0, 0, -6.55], rotY: 0 });
    });

    // Teller counter with glass partitions and brass mullions on the west side
    k.group('teller_counter', () => {
      k.prop({ kind: 'counter', pos: [-5.8, 0, -3.2], rotY: Math.PI / 2, collide: true });
      k.prop({ kind: 'counter', pos: [-5.8, 0, -0.8], rotY: Math.PI / 2, collide: true });

      // Glass security partitions + brass (`accent`) wickets on top of teller counters (y = 1.05..1.85)
      for (const tz of [-3.2, -0.8]) {
        k.box({ size: [0.06, 0.75, 1.85], pos: [-5.55, 1.42, tz], mat: 'glass' });
        k.box({ size: [0.1, 0.06, 1.95], pos: [-5.55, 1.82, tz], mat: 'metal_dark' });
        for (const bz of [-0.9, 0, 0.9]) {
          k.box({ size: [0.1, 0.78, 0.08], pos: [-5.55, 1.42, tz + bz], mat: 'accent' });
        }
      }
      // Teller chairs & filing cabinets behind the counter
      k.prop({ kind: 'chair', pos: [-6.8, 0, -3.2], rotY: Math.PI / 2 });
      k.prop({ kind: 'chair', pos: [-6.8, 0, -0.8], rotY: Math.PI / 2 });
      k.prop({ kind: 'filing_cabinet', pos: [-8.2, 0, -4.5], rotY: Math.PI / 2, collide: true });
      k.prop({ kind: 'filing_cabinet', pos: [-8.2, 0, -3.6], rotY: Math.PI / 2, collide: true });
    });

    // Ledger desks (east north side)
    k.group('ledger_desks', () => {
      k.prop({ kind: 'desk', pos: [5.8, 0, -4.0], rotY: 0, collide: true });
      k.prop({ kind: 'chair', pos: [5.8, 0, -3.1], rotY: Math.PI });
      k.prop({ kind: 'lamp_desk', pos: [6.25, 0.75, -4.05] });
      k.prop({ kind: 'books', pos: [5.45, 0.75, -3.95], rotY: 0.15 });
      k.prop({ kind: 'screen_stand', pos: [5.85, 0.75, -4.05], rotY: 0 });
    });

    // Corner "Guild" lounge (south-east corner: org-chart board with portrait frames, sofa, plant)
    k.group('guild_lounge', () => {
      // Wall-mounted Guild Org-Chart & Capability Hiring Board on east wall (`z = 2.2`)
      k.box({ size: [0.1, 1.8, 3.2], pos: [8.88, 2.2, 2.2], mat: 'wood_dark' });
      k.box({ size: [0.12, 1.64, 3.04], pos: [8.86, 2.2, 2.2], mat: 'plaster_warm' });

      // Top capability portrait frame + 4 role portrait frames connected by hierarchy lines
      k.box({ size: [0.04, 0.36, 0.42], pos: [8.79, 2.68, 2.2], mat: 'accent' });
      k.box({ size: [0.05, 0.28, 0.34], pos: [8.78, 2.68, 2.2], mat: 'paper' });
      for (const rz of [1.1, 1.83, 2.57, 3.3]) {
        k.box({ size: [0.04, 0.34, 0.38], pos: [8.79, 1.82, rz], mat: 'wood_dark' });
        k.box({ size: [0.05, 0.26, 0.3], pos: [8.78, 1.82, rz], mat: 'fabric_blue' });
        k.tube({
          points: [
            [8.78, 2.48, 2.2],
            [8.78, 2.25, rz],
            [8.78, 2.0, rz],
          ],
          radius: 0.012,
          mat: 'metal_dark',
        });
      }

      k.prop({ kind: 'sofa', pos: [6.4, 0, 2.2], rotY: -Math.PI / 2, collide: true });
      k.prop({ kind: 'table_round', pos: [4.8, 0, 2.2], scale: 0.85, collide: true });
      k.prop({ kind: 'mug', pos: [4.8, 0.64, 2.15] });
      k.prop({ kind: 'plant_tall', pos: [7.8, 0, 5.2] });
      k.prop({ kind: 'plant_tall', pos: [-7.8, 0, 5.2] });
    });

    // Warm interior lights (<= 3)
    k.light({ kind: 'point', pos: [0, 3.6, -2.2], color: '#FFE8C2', intensity: 1.4, distance: 13 });
    k.light({ kind: 'point', pos: [-4.5, 3.2, -2.0], color: '#E2FFE9', intensity: 1.0, distance: 10 });
    k.light({ kind: 'point', pos: [5.0, 3.2, 1.5], color: '#FFE4B8', intensity: 1.0, distance: 10 });

    // 6 NPC slots in the open central bank hall
    k.npcSlot({ id: 's1', pos: [0, 0, -3.4], facingY: 0 });
    k.npcSlot({ id: 's2', pos: [-3.2, 0, -2.4], facingY: 0 });
    k.npcSlot({ id: 's3', pos: [2.8, 0, -2.4], facingY: 0 });
    k.npcSlot({ id: 's4', pos: [-3.2, 0, 0.8], facingY: 0 });
    k.npcSlot({ id: 's5', pos: [2.2, 0, 0.8], facingY: 0 });
    k.npcSlot({ id: 's6', pos: [-0.4, 0, 2.4], facingY: 0 });
  },
};

export default financePeopleBuilding;
