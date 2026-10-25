import type { BuildingModule, KitApi } from '../../kit/types';

const officeHoursBuilding: BuildingModule = {
  id: 'office-hours',
  interiorShell: { floor: 'wood_floor', walls: 'plaster_warm' },

  buildExterior(k: KitApi) {
    // Disjoint colliders: main 8x8 brick tower in back, flanking annex colliders in front
    k.group('colliders', () => {
      k.box({ size: [8.0, 14.0, 8.0], pos: [0, 7.0, -2.2], mat: 'brick', collide: true, name: 'tower_col' });
      k.box({ size: [3.4, 5.2, 5.2], pos: [-4.1, 2.6, 4.8], mat: 'brick', collide: true, name: 'annex_west_col' });
      k.box({ size: [3.4, 5.2, 5.2], pos: [4.1, 2.6, 4.8], mat: 'brick', collide: true, name: 'annex_east_col' });
    });

    // Narrow 3-storey brick tower (8x8) with 4th clock level and gold roof band
    k.group('clocktower_body', () => {
      // Stone base plinth
      k.box({ size: [8.6, 1.4, 8.6], pos: [0, 0.7, -2.2], mat: 'plaza_stone', name: 'tower_plinth' });
      // 3-storey brick shaft (y = 1.4 to 13.8)
      k.box({ size: [8.0, 12.4, 8.0], pos: [0, 7.6, -2.2], mat: 'brick', name: 'tower_shaft' });

      // Corner brick/stone quoins & pilasters running up the tower
      for (const tx of [-3.95, 3.95]) {
        for (const tz of [-6.15, 1.75]) {
          k.box({ size: [0.55, 16.5, 0.55], pos: [tx, 9.6, tz], mat: 'trim' });
        }
      }

      // Horizontal string courses separating the 3 tower storeys
      for (const sy of [5.4, 9.4, 13.6]) {
        k.box({ size: [8.5, 0.32, 8.5], pos: [0, sy, -2.2], mat: 'trim' });
      }

      // 4th storey: Clock level (y = 13.8 to 18.2)
      k.box({ size: [7.6, 4.4, 7.6], pos: [0, 16.0, -2.2], mat: 'plaster_warm', name: 'clock_stage' });
      // Prominent gold accent roof band crowning the clock level
      k.box({ size: [8.3, 0.65, 8.3], pos: [0, 18.35, -2.2], mat: 'accent', name: 'gold_roof_band' });
      k.box({ size: [8.7, 0.35, 8.7], pos: [0, 18.85, -2.2], mat: 'trim', name: 'tower_cornice' });

      // Pyramidal slate spire + lantern cupola
      k.cone({ radius: 5.6, height: 4.8, pos: [0, 21.4, -2.2], rotY: Math.PI / 4, mat: 'roof', segments: 4, name: 'spire' });
      k.cylinder({ radiusTop: 0.08, radiusBottom: 0.14, height: 2.2, pos: [0, 24.6, -2.2], mat: 'accent' });
      k.sphere({ radius: 0.28, pos: [0, 25.7, -2.2], mat: 'accent' });

      // Big clock on the 4th level facing the plaza (+Z)
      k.cylinder({
        radiusTop: 1.1,
        radiusBottom: 1.1,
        height: 0.25,
        pos: [0, 16.0, 1.72],
        rotX: Math.PI / 2,
        mat: 'accent_dark',
      });
      k.cylinder({
        radiusTop: 0.95,
        radiusBottom: 0.95,
        height: 0.28,
        pos: [0, 16.0, 1.75],
        rotX: Math.PI / 2,
        mat: 'plaster_wall',
      });
      k.prop({ kind: 'clock', pos: [0, 15.2, 1.92], rotY: 0, scale: 3.2 });
    });

    // Articulated side and rear tower walls, plus annex side glazing.
    for (const y of [3.1, 7.4, 11.4, 16.0]) {
      for (const side of [-1, 1]) {
        k.box({ size: [0.22, 2.2, 1.6], pos: [side * 4.05, y, -2.2], mat: 'trim' });
        k.box({ size: [0.28, 1.9, 1.3], pos: [side * 4.1, y, -2.2], mat: 'window_glow' });
        k.box({ size: [0.32, 1.9, 0.07], pos: [side * 4.14, y, -2.2], mat: 'metal_dark' });
      }
      k.box({ size: [1.6, 2.2, 0.22], pos: [0, y, -6.25], mat: 'trim' });
      k.box({ size: [1.3, 1.9, 0.28], pos: [0, y, -6.3], mat: 'window_glow' });
      k.box({ size: [0.07, 1.9, 0.32], pos: [0, y, -6.34], mat: 'metal_dark' });
    }
    for (const side of [-1, 1]) {
      k.box({ size: [0.22, 2.1, 1.6], pos: [side * 5.85, 3.1, 4.7], mat: 'trim' });
      k.box({ size: [0.28, 1.8, 1.3], pos: [side * 5.9, 3.1, 4.7], mat: 'window_glow' });
    }
    // Tower windows on storeys 2 and 3
    k.group('tower_windows', () => {
      for (const wy of [7.4, 11.4]) {
        for (const wx of [-1.7, 1.7]) {
          k.box({ size: [1.3, 2.2, 0.22], pos: [wx, wy, 1.82], mat: 'trim' });
          k.box({ size: [1.0, 1.9, 0.26], pos: [wx, wy, 1.85], mat: 'window_glow' });
          k.box({ size: [0.07, 1.9, 0.3], pos: [wx, wy, 1.88], mat: 'metal_dark' });
          k.box({ size: [1.0, 0.07, 0.3], pos: [wx, wy + 0.2, 1.88], mat: 'metal_dark' });
          k.box({ size: [1.5, 0.16, 0.38], pos: [wx, wy - 1.12, 1.92], mat: 'plaza_stone' });
        }
      }
    });

    // Small annex hall in front holding the door (z up to 7.5)
    k.group('front_annex', () => {
      k.box({ size: [12.0, 1.0, 5.8], pos: [0, 0.5, 4.7], mat: 'plaza_stone', name: 'annex_plinth' });
      k.box({ size: [11.6, 4.5, 5.5], pos: [0, 3.25, 4.7], mat: 'brick', name: 'annex_walls' });
      k.box({ size: [12.2, 0.35, 6.0], pos: [0, 5.6, 4.7], mat: 'trim', name: 'annex_cornice' });
      k.box({ size: [11.8, 0.3, 5.7], pos: [0, 5.92, 4.7], mat: 'accent', name: 'annex_gold_band' });
      k.box({ size: [11.2, 1.1, 5.0], pos: [0, 6.6, 4.7], mat: 'roof', name: 'annex_roof' });

      // Front annex windows (at least 3 glowing window panels on the front face)
      for (const wx of [-4.1, -2.2, 2.2, 4.1]) {
        k.box({ size: [1.35, 2.1, 0.2], pos: [wx, 3.1, 7.48], mat: 'trim' });
        k.box({ size: [1.08, 1.8, 0.24], pos: [wx, 3.1, 7.51], mat: 'window_glow' });
        k.box({ size: [0.06, 1.8, 0.28], pos: [wx, 3.1, 7.54], mat: 'metal_dark' });
        k.box({ size: [1.08, 0.06, 0.28], pos: [wx, 3.25, 7.54], mat: 'metal_dark' });
        k.box({ size: [1.5, 0.16, 0.36], pos: [wx, 2.0, 7.58], mat: 'plaza_stone' });
      }

      // Entrance porch & gold-trimmed canopy
      k.box({ size: [3.2, 0.3, 1.8], pos: [0, 0.15, 8.2], mat: 'plaza_stone' });
      k.roundedBox({ size: [3.4, 0.32, 1.4], pos: [0, 3.5, 8.05], radius: 0.08, mat: 'accent' });
      k.cylinder({ radiusTop: 0.14, radiusBottom: 0.16, height: 3.3, pos: [-1.4, 1.75, 8.5], mat: 'trim' });
      k.cylinder({ radiusTop: 0.14, radiusBottom: 0.16, height: 3.3, pos: [1.4, 1.75, 8.5], mat: 'trim' });

      k.entrance({ z: 7.5 });
      k.sign({ pos: [0, 4.55, 7.75], rotY: 0, width: 6.4 });
    });

    // Landscaping around the clocktower plot
    k.group('landscaping', () => {
      k.box({ size: [4.2, 0.08, 4.0], pos: [0, 0.04, 10.2], mat: 'plaza_stone' });
      k.prop({ kind: 'flowerbed', pos: [-4.2, 0, 9.2] });
      k.prop({ kind: 'flowerbed', pos: [4.2, 0, 9.2] });
      k.prop({ kind: 'bench', pos: [-6.8, 0, 8.5], rotY: 0.3, collide: true });
      k.prop({ kind: 'bench', pos: [6.8, 0, 8.5], rotY: -0.3, collide: true });
      k.prop({ kind: 'lamp_floor', pos: [-2.4, 0, 8.6] });
      k.prop({ kind: 'lamp_floor', pos: [2.4, 0, 8.6] });
    });

    k.light({ kind: 'point', pos: [0, 3.9, 8.3], color: '#FFE6B5', intensity: 1.3, distance: 9 });
  },

  buildInterior(k: KitApi) {
    // Study windows on north, east, and west walls
    k.window({ wall: 'north', center: -3.2, width: 2.4, height: 1.8, sill: 1.0 });
    k.window({ wall: 'north', center: 3.2, width: 2.4, height: 1.8, sill: 1.0 });
    k.window({ wall: 'east', center: 0, width: 2.6, height: 1.8, sill: 1.0 });

    // Warm study rug in the center of the room (no collider)
    k.group('study_rug', () => {
      k.plane({ size: [6.6, 4.8], pos: [0, 0.01, -0.8], rot: [-Math.PI / 2, 0, 0], mat: 'accent_dark' });
      k.plane({ size: [6.0, 4.2], pos: [0, 0.015, -0.8], rot: [-Math.PI / 2, 0, 0], mat: 'fabric_cream' });
      // Lived-in floor cushions and power cable along north-west floor
      k.roundedBox({ size: [0.55, 0.14, 0.55], pos: [-3.8, 0.07, 2.2], radius: 0.06, rotY: 0.3, mat: 'fabric_coral' });
      k.roundedBox({ size: [0.55, 0.14, 0.55], pos: [-3.1, 0.07, 2.6], radius: 0.06, rotY: -0.2, mat: 'fabric_lavender' });
      k.tube({
        points: [
          [-0.6, 0.02, -4.3],
          [-2.8, 0.02, -4.8],
          [-5.2, 0.02, -4.5],
        ],
        radius: 0.016,
        mat: 'cable',
      });
    });

    // Core consultation desk with two armchairs facing it
    k.group('consultation_desk', () => {
      k.prop({ kind: 'desk', pos: [0, 0, -4.2], rotY: 0, collide: true });
      k.prop({ kind: 'chair', pos: [0, 0, -5.1], rotY: 0 });
      k.prop({ kind: 'lamp_desk', pos: [-0.5, 0.75, -4.3] });
      k.prop({ kind: 'books', pos: [0.45, 0.75, -4.2], rotY: -0.2 });
      k.prop({ kind: 'mug', pos: [0.15, 0.75, -4.05] });

      // Two upholstered armchairs facing the lead's desk
      k.prop({ kind: 'armchair', pos: [-1.1, 0, -1.4], rotY: Math.PI - 0.2 });
      k.prop({ kind: 'armchair', pos: [1.1, 0, -1.4], rotY: Math.PI + 0.2 });
    });

    k.roundedBox({ size: [0.65, 0.4, 0.65], pos: [0, 0.2, -1.4], radius: 0.04, mat: 'wood_dark' });
    // Large wall clock on the north wall with ornamental pendulum housing
    k.group('wall_clock_feature', () => {
      k.box({ size: [1.2, 2.8, 0.16], pos: [0, 2.1, -6.88], mat: 'wood_dark' });
      k.box({ size: [0.9, 1.4, 0.18], pos: [0, 1.6, -6.86], mat: 'glass' });
      // Brass pendulum bob inside glass case
      k.cylinder({ radiusTop: 0.015, radiusBottom: 0.015, height: 0.9, pos: [0, 1.75, -6.82], mat: 'accent' });
      k.cylinder({
        radiusTop: 0.16,
        radiusBottom: 0.16,
        height: 0.06,
        pos: [0, 1.3, -6.81],
        rotX: Math.PI / 2,
        mat: 'accent',
      });
      k.prop({ kind: 'clock', pos: [0, 2.85, -6.8], rotY: 0, scale: 1.6 });
    });

    // Chalkboard (`whiteboard` in `metal_dark`) with question marks on the west side
    k.group('chalkboard_area', () => {
      k.prop({ kind: 'whiteboard', pos: [-6.4, 0, -4.8], rotY: 0.35, mat: 'metal_dark' });
      // Wall-mounted slate chalkboard on the west wall with 3 chalk question marks
      k.box({ size: [0.1, 1.4, 2.8], pos: [-8.88, 2.1, -0.5], mat: 'wood_dark' });
      k.box({ size: [0.12, 1.24, 2.64], pos: [-8.86, 2.1, -0.5], mat: 'metal_dark' });
      for (const qz of [-1.2, -0.5, 0.2]) {
        // Question mark top hook + stem + dot built from paper primitives
        k.torus({
          radius: 0.14,
          tube: 0.025,
          pos: [-8.78, 2.32, qz],
          rotY: Math.PI / 2,
          arc: Math.PI * 1.35,
          mat: 'paper',
        });
        k.box({ size: [0.03, 0.18, 0.045], pos: [-8.78, 2.08, qz], mat: 'paper' });
        k.sphere({ radius: 0.035, pos: [-8.78, 1.86, qz], mat: 'accent' });
      }
    });

    // Tall bookshelves lining the perimeter & secondary reading desks
    k.group('library_shelves_and_desks', () => {
      k.prop({ kind: 'bookshelf', pos: [-8.4, 0, -2.8], rotY: Math.PI / 2, collide: true });
      k.prop({ kind: 'bookshelf', pos: [-8.4, 0, 1.8], rotY: Math.PI / 2, collide: true });
      k.prop({ kind: 'bookshelf', pos: [-8.4, 0, 3.4], rotY: Math.PI / 2, collide: true });

      k.prop({ kind: 'bookshelf', pos: [8.4, 0, -3.2], rotY: -Math.PI / 2, collide: true });
      k.prop({ kind: 'bookshelf', pos: [8.4, 0, 2.8], rotY: -Math.PI / 2, collide: true });

      // Side analyst desks
      k.prop({ kind: 'desk', pos: [-5.8, 0, -1.2], rotY: Math.PI / 2, collide: true });
      k.prop({ kind: 'chair', pos: [-6.7, 0, -1.2], rotY: Math.PI / 2 });
      k.prop({ kind: 'screen_stand', pos: [-5.75, 0.75, -1.2], rotY: Math.PI / 2 });

      k.prop({ kind: 'desk', pos: [5.8, 0, -1.2], rotY: -Math.PI / 2, collide: true });
      k.prop({ kind: 'chair', pos: [6.7, 0, -1.2], rotY: -Math.PI / 2 });
      k.prop({ kind: 'books', pos: [5.75, 0.75, -1.0], rotY: 0.2 });
      k.prop({ kind: 'lamp_desk', pos: [5.75, 0.75, -1.5] });

      k.prop({ kind: 'lamp_floor', pos: [-7.8, 0, -5.8] });
      k.prop({ kind: 'lamp_floor', pos: [7.8, 0, -5.8] });
      k.prop({ kind: 'plant_tall', pos: [7.8, 0, 5.2] });
      k.prop({ kind: 'plant_small', pos: [-5.8, 0.75, -0.75] });
    });

    // Warm interior lights (<= 3)
    k.light({ kind: 'point', pos: [0, 3.5, -2.5], color: '#FFE0B2', intensity: 1.4, distance: 12 });
    k.light({ kind: 'point', pos: [-4.5, 3.2, 0.5], color: '#FFD9A0', intensity: 1.0, distance: 10 });
    k.light({ kind: 'point', pos: [4.5, 3.2, 0.5], color: '#FFD9A0', intensity: 1.0, distance: 10 });

    // 6 NPC slots in the open floor (all >= 2.3m apart, clear of all colliders)
    k.npcSlot({ id: 's1', pos: [0, 0, -1.2], facingY: 0 });
    k.npcSlot({ id: 's2', pos: [-3.4, 0, -2.2], facingY: 0 });
    k.npcSlot({ id: 's3', pos: [3.4, 0, -2.2], facingY: 0 });
    k.npcSlot({ id: 's4', pos: [-3.4, 0, 0.8], facingY: 0 });
    k.npcSlot({ id: 's5', pos: [3.4, 0, 0.8], facingY: 0 });
    k.npcSlot({ id: 's6', pos: [0, 0, 2.4], facingY: 0 });
  },
};

export default officeHoursBuilding;
