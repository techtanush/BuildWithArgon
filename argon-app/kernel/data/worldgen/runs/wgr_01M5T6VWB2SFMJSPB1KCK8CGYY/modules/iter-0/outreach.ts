import type { BuildingModule, KitApi } from '../../kit/types';

const outreachBuilding: BuildingModule = {
  id: 'outreach',
  interiorShell: { floor: 'wood_floor', walls: 'plaster_warm' },

  buildExterior(k: KitApi) {
    // Disjoint colliders for the Victorian house
    k.group('colliders', () => {
      k.box({ size: [15.0, 8.5, 11.0], pos: [-0.5, 4.25, -1.2], mat: 'stucco', collide: true, name: 'house_col' });
      k.box({ size: [4.6, 8.5, 2.4], pos: [-5.2, 4.25, 5.6], mat: 'stucco', collide: true, name: 'bay_col' });
    });

    // Two-storey Victorian house (stucco + accent teal trim, bay window, steep gables)
    k.group('victorian_house', () => {
      // Stone foundation plinth
      k.box({ size: [16.0, 1.1, 11.8], pos: [-0.5, 0.55, -1.0], mat: 'plaza_stone' });
      // Main two-storey stucco body
      k.box({ size: [15.4, 7.8, 11.2], pos: [-0.5, 4.9, -1.0], mat: 'stucco', name: 'main_body' });

      // Projecting Victorian bay wing on the west front (x = -5.2)
      k.box({ size: [5.0, 8.4, 2.8], pos: [-5.2, 4.7, 5.6], mat: 'plaster_warm', name: 'bay_wing' });
      k.box({ size: [5.2, 1.1, 3.0], pos: [-5.2, 0.55, 5.6], mat: 'plaza_stone' });

      // Teal (`accent`) Victorian corner boards, belly bands, and ornate eaves trim
      k.box({ size: [15.8, 0.28, 11.6], pos: [-0.5, 4.8, -1.0], mat: 'accent', name: 'mid_band' });
      k.box({ size: [5.4, 0.28, 3.1], pos: [-5.2, 4.8, 5.6], mat: 'accent' });
      k.box({ size: [16.0, 0.38, 11.8], pos: [-0.5, 8.9, -1.0], mat: 'trim', name: 'eaves_cornice' });
      k.box({ size: [5.6, 0.38, 3.2], pos: [-5.2, 9.0, 5.6], mat: 'accent' });

      // Steep Victorian gabled roof & cross-gable over the bay wing
      k.box({ size: [15.0, 1.5, 10.4], pos: [-0.5, 9.8, -1.0], mat: 'roof' });
      k.box({ size: [13.2, 1.3, 8.4], pos: [-0.5, 11.1, -1.0], mat: 'roof' });
      k.cone({
        radius: 3.6,
        height: 3.4,
        pos: [-5.2, 10.9, 5.5],
        rotY: Math.PI / 4,
        mat: 'roof',
        segments: 4,
        name: 'bay_gable_spire',
      });
      // Brick chimney
      k.box({ size: [1.2, 3.8, 1.2], pos: [4.5, 11.8, -3.5], mat: 'brick' });
    });

    // Windows with teal shutters / hoods on both storeys
    k.group('victorian_windows', () => {
      // Bay wing windows (ground & 2nd floor)
      for (const wy of [2.8, 6.6]) {
        for (const wx of [-6.5, -5.2, -3.9]) {
          k.box({ size: [1.0, 2.0, 0.18], pos: [wx, wy, 7.02], mat: 'trim' });
          k.box({ size: [0.78, 1.75, 0.22], pos: [wx, wy, 7.05], mat: 'window_glow' });
          k.box({ size: [1.1, 0.2, 0.3], pos: [wx, wy + 1.05, 7.1], mat: 'accent' });
          k.box({ size: [1.1, 0.14, 0.3], pos: [wx, wy - 1.02, 7.1], mat: 'plaza_stone' });
        }
      }
      // East wing windows (2nd floor and ground floor beside the porch)
      for (const wx of [0.0, 3.2, 5.6]) {
        k.box({ size: [1.4, 2.1, 0.18], pos: [wx, 6.6, 4.65], mat: 'trim' });
        k.box({ size: [1.1, 1.8, 0.22], pos: [wx, 6.6, 4.68], mat: 'window_glow' });
        k.box({ size: [1.55, 0.22, 0.32], pos: [wx, 7.72, 4.72], mat: 'accent' });
      }
      for (const wx of [3.2, 5.6]) {
        k.box({ size: [1.4, 2.1, 0.18], pos: [wx, 2.8, 4.65], mat: 'trim' });
        k.box({ size: [1.1, 1.8, 0.22], pos: [wx, 2.8, 4.68], mat: 'window_glow' });
        k.box({ size: [1.55, 0.22, 0.32], pos: [wx, 3.92, 4.72], mat: 'accent' });
      }
    });

    // Covered front porch with turned railings, steps, entrance, and sign
    k.group('front_porch', () => {
      // Porch deck extending to z = 7.4
      k.box({ size: [8.8, 0.6, 3.0], pos: [2.2, 0.3, 6.0], mat: 'wood_dark' });
      k.box({ size: [3.4, 0.2, 1.2], pos: [0, 0.1, 7.9], mat: 'plaza_stone' });
      // Porch roof & teal frieze
      k.box({ size: [9.0, 0.35, 3.2], pos: [2.2, 4.0, 6.0], mat: 'accent' });
      k.box({ size: [9.2, 0.4, 3.4], pos: [2.2, 4.35, 6.0], mat: 'roof' });

      // Turned porch posts
      for (const px of [-1.8, 1.8, 4.2, 6.3]) {
        k.cylinder({ radiusTop: 0.13, radiusBottom: 0.15, height: 3.4, pos: [px, 2.3, 7.35], mat: 'trim' });
      }
      // Porch railing on the right side of the entrance (`x = 1.9..6.3`)
      k.box({ size: [4.4, 0.1, 0.12], pos: [4.05, 1.35, 7.35], mat: 'trim' });
      k.box({ size: [4.4, 0.08, 0.12], pos: [4.05, 0.72, 7.35], mat: 'trim' });
      for (let bx = 2.1; bx <= 6.1; bx += 0.35) {
        k.box({ size: [0.05, 0.6, 0.05], pos: [bx, 1.03, 7.35], mat: 'trim' });
      }

      // Entrance wall backing at z = 7.2 for the foyer
      k.box({ size: [3.4, 3.6, 2.6], pos: [0, 2.1, 5.9], mat: 'plaster_warm' });
      k.entrance({ z: 7.2 });
      k.sign({ pos: [0, 4.85, 7.75], rotY: 0, width: 4.8 });
    });

    // Tall telegraph pole on the east side with crossbars, insulators, and sagging wires (`tube`)
    k.group('telegraph_pole_and_wires', () => {
      const poleX = 9.8;
      const poleZ = 6.2;
      k.cylinder({
        radiusTop: 0.18,
        radiusBottom: 0.26,
        height: 12.6,
        pos: [poleX, 6.3, poleZ],
        mat: 'wood_dark',
        collide: true,
      });
      // Two wooden crossbars with ceramic teal/glass insulators
      for (const cy of [10.4, 11.8]) {
        k.box({ size: [0.16, 0.18, 2.8], pos: [poleX, cy, poleZ], mat: 'wood_light' });
        for (const iz of [-1.1, -0.4, 0.4, 1.1]) {
          k.cylinder({
            radiusTop: 0.07,
            radiusBottom: 0.09,
            height: 0.22,
            pos: [poleX, cy + 0.18, poleZ + iz],
            mat: 'accent',
          });
        }
      }
      // Sagging telegraph wires connecting the pole to the house eaves & rear relay post
      for (const iz of [-1.0, -0.35, 0.35, 1.0]) {
        k.tube({
          points: [
            [poleX, 11.95, poleZ + iz],
            [8.2, 10.6, 3.5 + iz * 0.6],
            [6.6, 9.2, 1.0 + iz * 0.5],
          ],
          radius: 0.022,
          mat: 'cable',
        });
        k.tube({
          points: [
            [poleX, 10.55, poleZ + iz],
            [poleX, 9.8, 0.0 + iz * 0.4],
            [poleX - 0.5, 9.5, -5.5 + iz * 0.4],
          ],
          radius: 0.022,
          mat: 'cable',
        });
      }
    });

    // Path, mailbox, and garden landscaping
    k.group('landscaping', () => {
      k.box({ size: [3.2, 0.08, 4.0], pos: [0, 0.04, 9.8], mat: 'plaza_stone' });
      k.prop({ kind: 'mailbox', pos: [2.4, 0, 9.6], rotY: -0.3, collide: true });
      k.prop({ kind: 'flowerbed', pos: [-5.2, 0, 8.8] });
      k.prop({ kind: 'flowerbed', pos: [5.2, 0, 9.2] });
      k.prop({ kind: 'plant_tall', pos: [-2.2, 0.6, 7.0] });
    });

    k.light({ kind: 'point', pos: [0, 3.6, 7.8], color: '#FFE5BD', intensity: 1.3, distance: 9 });
  },

  buildInterior(k: KitApi) {
    // Windows on north, east, and west walls
    k.window({ wall: 'north', center: 2.8, width: 2.6, height: 1.8, sill: 1.0 });
    k.window({ wall: 'east', center: -1.8, width: 2.4, height: 1.8, sill: 1.0 });
    k.window({ wall: 'west', center: 1.5, width: 2.4, height: 1.8, sill: 1.0 });

    // Soft pastel rug in the central area
    k.group('rug_and_cables', () => {
      k.plane({ size: [6.0, 4.2], pos: [0, 0.01, -0.5], rot: [-Math.PI / 2, 0, 0], mat: 'accent_dark' });
      k.plane({ size: [5.5, 3.7], pos: [0, 0.015, -0.5], rot: [-Math.PI / 2, 0, 0], mat: 'fabric_cream' });
      // Floor telegraph cable bundle running from switchboard to desk
      k.tube({
        points: [
          [-2.5, 0.02, -6.2],
          [-2.0, 0.02, -4.8],
          [-0.8, 0.02, -4.2],
        ],
        radius: 0.02,
        mat: 'cable',
      });
    });

    // Switchboard wall on the north-west wall (grid of small cylinders + patching cables)
    k.group('switchboard_wall', () => {
      // Heavy mahogany switchboard console cabinet
      k.box({ size: [4.2, 2.4, 0.55], pos: [-4.2, 1.2, -6.5], mat: 'wood_dark', collide: true });
      k.box({ size: [3.9, 1.5, 0.6], pos: [-4.2, 1.55, -6.48], mat: 'metal_dark' });
      k.box({ size: [4.2, 0.12, 0.85], pos: [-4.2, 0.85, -6.32], mat: 'wood_light' });

      // Grid of jack sockets (small brass/teal cylinders)
      for (let gx = -5.8; gx <= -2.6; gx += 0.4) {
        for (let gy = 1.05; gy <= 2.05; gy += 0.25) {
          k.cylinder({
            radiusTop: 0.04,
            radiusBottom: 0.04,
            height: 0.08,
            pos: [gx, gy, -6.16],
            rotX: Math.PI / 2,
            mat: ( Math.round((gx + gy) * 10) % 3 === 0 ) ? 'accent' : 'metal_light',
          });
        }
      }

      // Looping patch cables across the switchboard face
      const patchPairs: [[number, number], [number, number]][] = [
        [[-5.8, 1.8], [-4.6, 1.3]],
        [[-5.4, 2.05], [-3.8, 1.55]],
        [[-5.0, 1.3], [-3.4, 1.8]],
        [[-4.2, 2.05], [-2.6, 1.3]],
        [[-3.8, 1.05], [-2.6, 1.8]],
      ];
      for (const [[x1, y1], [x2, y2]] of patchPairs) {
        k.tube({
          points: [
            [x1, y1, -6.14],
            [(x1 + x2) / 2, Math.min(y1, y2) - 0.22, -5.98],
            [x2, y2, -6.14],
          ],
          radius: 0.016,
          mat: 'cable',
        });
      }
    });

    // Wall of pigeonholes (box grid with stuffed letters) on the west wall
    k.group('pigeonhole_wall', () => {
      k.box({ size: [0.5, 2.3, 3.2], pos: [-8.55, 1.15, -2.2], mat: 'wood_dark', collide: true });
      // Horizontal shelves
      for (let py = 0.5; py <= 2.1; py += 0.4) {
        k.box({ size: [0.54, 0.04, 3.1], pos: [-8.52, py, -2.2], mat: 'wood_light' });
      }
      // Vertical dividers & paper letter bundles inside cubbies
      for (let pz = -3.6; pz <= -0.8; pz += 0.4) {
        k.box({ size: [0.54, 1.7, 0.04], pos: [-8.52, 1.3, pz], mat: 'wood_light' });
        if (pz < -0.9) {
          k.box({ size: [0.28, 0.07, 0.24], pos: [-8.38, 0.96, pz + 0.2], rotY: 0.1, mat: 'paper' });
          k.box({ size: [0.28, 0.09, 0.24], pos: [-8.38, 1.76, pz + 0.2], rotY: -0.1, mat: 'paper' });
        }
      }
    });

    // Writing desks with letter stacks & gated-send review desk
    k.group('writing_desks', () => {
      // Lead outreach desk
      k.prop({ kind: 'desk', pos: [0, 0, -4.0], rotY: 0, collide: true });
      k.prop({ kind: 'chair', pos: [0, 0, -4.9], rotY: 0 });
      k.prop({ kind: 'lamp_desk', pos: [-0.5, 0.75, -4.1] });
      k.prop({ kind: 'screen_stand', pos: [0.35, 0.75, -4.1], rotY: -0.15 });
      k.box({ size: [0.28, 0.14, 0.22], pos: [-0.15, 0.82, -3.9], rotY: 0.1, mat: 'paper' });
      k.prop({ kind: 'mug', pos: [0.15, 0.75, -3.8] });

      // East drafting desk 1
      k.prop({ kind: 'desk', pos: [6.4, 0, -3.8], rotY: 0, collide: true });
      k.prop({ kind: 'chair', pos: [6.4, 0, -2.9], rotY: Math.PI });
      k.prop({ kind: 'books', pos: [6.0, 0.75, -3.8], rotY: 0.2 });
      k.box({ size: [0.3, 0.16, 0.22], pos: [6.6, 0.83, -3.75], rotY: -0.15, mat: 'paper' });
      k.prop({ kind: 'lamp_desk', pos: [6.9, 0.75, -3.9] });

      // East drafting desk 2
      k.prop({ kind: 'desk', pos: [6.4, 0, 0.2], rotY: 0, collide: true });
      k.prop({ kind: 'chair', pos: [6.4, 0, 1.1], rotY: Math.PI });
      k.prop({ kind: 'screen_stand', pos: [6.4, 0.75, 0.1], rotY: 0 });
      k.box({ size: [0.26, 0.12, 0.2], pos: [5.95, 0.81, 0.25], mat: 'paper' });
    });

    // Comfy customer interview corner (two armchairs + round table + tall plant) in south-east / south-west
    k.group('interview_corner', () => {
      k.prop({ kind: 'armchair', pos: [-6.8, 0, 3.0], rotY: 0.8 });
      k.prop({ kind: 'armchair', pos: [-5.2, 0, 4.4], rotY: -2.2 });
      k.prop({ kind: 'table_round', pos: [-6.2, 0, 3.9], scale: 0.75 });
      k.prop({ kind: 'mug', pos: [-6.1, 0.56, 3.85] });
      k.prop({ kind: 'plant_tall', pos: [-8.0, 0, 5.2] });
      k.prop({ kind: 'plant_tall', pos: [7.8, 0, 5.2] });
      k.prop({ kind: 'lamp_floor', pos: [7.8, 0, -5.8] });
      k.prop({ kind: 'clock', pos: [0, 3.1, -6.92], rotY: 0 });
    });

    // Warm interior lights (<= 3)
    k.light({ kind: 'point', pos: [0, 3.5, -2.0], color: '#FFE4B8', intensity: 1.3, distance: 12 });
    k.light({ kind: 'point', pos: [-4.5, 3.2, -3.5], color: '#FFDAA6', intensity: 1.0, distance: 10 });
    k.light({ kind: 'point', pos: [5.0, 3.2, 0.0], color: '#FFE4B8', intensity: 1.0, distance: 10 });

    // 6 NPC slots in the open central floor
    k.npcSlot({ id: 's1', pos: [0, 0, -2.2], facingY: 0 });
    k.npcSlot({ id: 's2', pos: [-3.8, 0, -2.6], facingY: 0 });
    k.npcSlot({ id: 's3', pos: [3.2, 0, -2.2], facingY: 0 });
    k.npcSlot({ id: 's4', pos: [-3.4, 0, 0.8], facingY: 0 });
    k.npcSlot({ id: 's5', pos: [3.2, 0, 1.4], facingY: 0 });
    k.npcSlot({ id: 's6', pos: [0, 0, 2.2], facingY: 0 });
  },
};

export default outreachBuilding;
