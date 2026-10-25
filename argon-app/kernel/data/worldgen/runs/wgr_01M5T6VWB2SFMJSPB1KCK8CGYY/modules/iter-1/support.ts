import type { BuildingModule, KitApi } from '../../kit/types';

const supportBuilding: BuildingModule = {
  id: 'support',
  interiorShell: { floor: 'wood_floor', walls: 'plaster_warm' },

  buildExterior(k: KitApi) {
    // Disjoint colliders for the Harbor House (leaving the wooden pier & entrance at z=6.6 clear)
    k.group('colliders', () => {
      k.box({ size: [6.8, 7.5, 11.2], pos: [-5.6, 3.75, -0.8], mat: 'wood_light', collide: true, name: 'harbor_west_col' });
      k.box({ size: [6.8, 7.5, 11.2], pos: [5.6, 3.75, -0.8], mat: 'wood_light', collide: true, name: 'harbor_east_col' });
      k.box({ size: [4.2, 7.5, 9.6], pos: [0, 3.75, -1.6], mat: 'wood_light', collide: true, name: 'harbor_center_col' });
    });

    // Wooden pier deck planks extending to the front on timber pilings
    k.group('wooden_pier', () => {
      // Heavy dark-wood pier pilings along the front and sides
      for (const px of [-9.4, -5.8, -2.6, 2.6, 5.8, 9.4]) {
        for (const pz of [5.5, 8.2, 10.8]) {
          k.cylinder({ radiusTop: 0.24, radiusBottom: 0.24, height: 1.1, pos: [px, 0.55, pz], mat: 'wood_dark' });
        }
      }
      // Sub-deck stringer beams
      k.box({ size: [19.4, 0.22, 6.2], pos: [0, 0.16, 8.2], mat: 'wood_dark' });
      // Individual wooden deck planks extending across the front forecourt (collide: false default)
      for (let pz = 5.4; pz <= 11.0; pz += 0.48) {
        k.box({
          size: [19.2, 0.1, 0.42],
          pos: [0, 0.3, pz],
          mat: Math.round(pz * 10) % 2 === 0 ? 'wood_floor' : 'wood_light',
        });
      }
      // Pier mooring bollards & rope railings on left and right sides (`|x| >= 3.2`)
      for (const side of [-1, 1]) {
        for (const bz of [6.8, 10.6]) {
          k.cylinder({
            radiusTop: 0.2,
            radiusBottom: 0.22,
            height: 0.95,
            pos: [side * 8.8, 0.78, bz],
            mat: 'wood_dark',
            collide: true,
          });
          k.cylinder({
            radiusTop: 0.2,
            radiusBottom: 0.22,
            height: 0.95,
            pos: [side * 3.8, 0.78, bz],
            mat: 'wood_dark',
          });
        }
        k.tube({
          points: [
            [side * 3.8, 1.05, 10.6],
            [side * 6.3, 0.85, 10.6],
            [side * 8.8, 1.05, 10.6],
          ],
          radius: 0.035,
          mat: 'wood_light',
        });
      }
    });

    // Harbor-master house with sky-blue (`accent`) shutters, widow's walk lookout, life rings, and mast with flags
    k.group('harbor_house_body', () => {
      // Main two-storey coastal house body
      k.box({ size: [18.0, 0.9, 11.6], pos: [0, 0.45, -0.6], mat: 'plaza_stone' });
      k.box({ size: [17.6, 6.8, 11.2], pos: [0, 4.3, -0.6], mat: 'stucco', name: 'house_walls' });
      // Horizontal clapboard trim courses
      for (const cy of [2.6, 4.3, 6.0, 7.6]) {
        k.box({ size: [17.9, 0.16, 11.4], pos: [0, cy, -0.6], mat: 'trim' });
      }
      k.box({ size: [18.2, 0.35, 11.8], pos: [0, 7.8, -0.6], mat: 'accent' });

      // Pitched slate roof + rooftop widow's walk harbor lookout cupola
      k.box({ size: [17.2, 1.3, 10.6], pos: [0, 8.6, -0.6], mat: 'roof' });
      k.box({ size: [15.0, 1.1, 8.6], pos: [0, 9.7, -0.6], mat: 'roof' });
      k.box({ size: [5.4, 2.2, 4.8], pos: [0, 11.3, -0.6], mat: 'window_glow', name: 'lookout_cupola' });
      k.box({ size: [5.8, 0.35, 5.2], pos: [0, 12.5, -0.6], mat: 'accent' });
      k.cone({ radius: 3.8, height: 1.8, pos: [0, 13.5, -0.6], rotY: Math.PI / 4, mat: 'roof', segments: 4 });

      // Front windows with sky-blue (`accent`) shutters on both storeys
      for (const wx of [-6.4, -3.4, 3.4, 6.4]) {
        for (const wy of [2.6, 5.8]) {
          k.box({ size: [1.4, 1.9, 0.2], pos: [wx, wy, 5.02], mat: 'trim' });
          k.box({ size: [1.15, 1.65, 0.24], pos: [wx, wy, 5.05], mat: 'window_glow' });
          // Sky-blue (`accent`) louvered shutters flanking each window
          k.box({ size: [0.42, 1.85, 0.16], pos: [wx - 0.88, wy, 5.08], mat: 'accent' });
          k.box({ size: [0.42, 1.85, 0.16], pos: [wx + 0.88, wy, 5.08], mat: 'accent' });
        }
      }

      // Life rings (`torus`) mounted on the front wall beside the porch
      for (const lx of [-4.9, 4.9]) {
        k.torus({
          radius: 0.42,
          tube: 0.12,
          pos: [lx, 2.6, 5.12],
          mat: 'fabric_coral',
        });
        // White quarter bands on the life ring
        k.box({ size: [0.22, 0.92, 0.28], pos: [lx, 2.6, 5.12], mat: 'plaster_wall' });
        k.box({ size: [0.92, 0.22, 0.28], pos: [lx, 2.6, 5.12], mat: 'plaster_wall' });
      }

      // Tall nautical signal mast on the east side of the pier with yardarm & flags
      const mx = 7.6;
      const mz = 7.4;
      k.cylinder({ radiusTop: 0.1, radiusBottom: 0.18, height: 11.0, pos: [mx, 5.8, mz], mat: 'trim' });
      k.box({ size: [3.2, 0.12, 0.12], pos: [mx, 9.2, mz], mat: 'trim' });
      k.prop({ kind: 'flag', pos: [mx, 9.2, mz] });
      k.box({ size: [0.9, 0.55, 0.06], pos: [mx - 0.9, 8.8, mz], mat: 'accent' });
      k.box({ size: [0.8, 0.5, 0.06], pos: [mx - 0.85, 8.1, mz], mat: 'fabric_coral' });

      // Projecting harbor entrance cabin at x = 0, z = 6.6
      k.box({ size: [4.2, 5.2, 1.8], pos: [0, 2.8, 5.8], mat: 'stucco' });
      k.box({ size: [4.6, 0.35, 2.1], pos: [0, 5.45, 5.8], mat: 'accent' });
      k.entrance({ z: 6.7 });
      k.sign({ pos: [0, 4.35, 6.85], rotY: 0, width: 6.4 });
    });

    k.light({ kind: 'point', pos: [0, 3.8, 7.6], color: '#E0F6FF', intensity: 1.4, distance: 10 });
  },

  buildInterior(k: KitApi) {
    // Harbor house windows
    k.window({ wall: 'north', center: -3.2, width: 2.6, height: 1.8, sill: 1.0 });
    k.window({ wall: 'north', center: 3.2, width: 2.6, height: 1.8, sill: 1.0 });
    k.window({ wall: 'east', center: -1.5, width: 2.6, height: 1.8, sill: 1.0 });

    // Cozy sky-blue and cream rug in the central area
    k.plane({ size: [6.2, 4.4], pos: [0, 0.01, -0.4], rot: [-Math.PI / 2, 0, 0], mat: 'accent' });
    k.plane({ size: [5.7, 3.9], pos: [0, 0.015, -0.4], rot: [-Math.PI / 2, 0, 0], mat: 'fabric_cream' });

    // Ship's wheel decor (`torus` + cylinder spokes) mounted on the center of the north wall
    k.group('ships_wheel_decor', () => {
      const wy = 2.55;
      const wz = -6.85;
      // Outer and inner wooden wheel rings
      k.torus({ radius: 0.68, tube: 0.065, pos: [0, wy, wz], mat: 'wood_dark' });
      k.cylinder({ radiusTop: 0.16, radiusBottom: 0.16, height: 0.14, pos: [0, wy, wz], rotX: Math.PI / 2, mat: 'accent' });
      // 8 turned wooden spokes projecting past the rim as handles
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        k.box({
          size: [0.06, 1.75, 0.06],
          pos: [0, wy, wz],
          rotY: 0,
          mat: 'wood_light',
        });
        const hx = Math.sin(a) * 0.86;
        const hy = wy + Math.cos(a) * 0.86;
        k.sphere({ radius: 0.055, pos: [hx, hy, wz], mat: 'wood_dark' });
      }
    });

    // Help desk with two stations and custom headset props (`torus` headband + earcups + mic boom)
    k.group('help_desk_stations', () => {
      // Station 1 (North-West help desk)
      k.prop({ kind: 'desk', pos: [-2.8, 0, -4.3], rotY: 0, collide: true });
      k.prop({ kind: 'chair', pos: [-2.8, 0, -5.2], rotY: 0 });
      k.prop({ kind: 'screen_stand', pos: [-3.0, 0.75, -4.35], rotY: 0.1 });

      // Station 2 (North-East help desk)
      k.prop({ kind: 'desk', pos: [2.8, 0, -4.3], rotY: 0, collide: true });
      k.prop({ kind: 'chair', pos: [2.8, 0, -5.2], rotY: 0 });
      k.prop({ kind: 'screen_stand', pos: [2.6, 0.75, -4.35], rotY: -0.1 });

      // Custom Headset Props resting on stands on both stations (y = 0.75)
      for (const hx of [-2.4, 3.2]) {
        // Headset stand
        k.cylinder({ radiusTop: 0.07, radiusBottom: 0.09, height: 0.03, pos: [hx, 0.765, -4.2], mat: 'metal_dark' });
        k.cylinder({ radiusTop: 0.015, radiusBottom: 0.015, height: 0.24, pos: [hx, 0.89, -4.2], mat: 'metal_light' });
        // Headband arc (`torus`) + cushioned earcups + boom mic
        k.torus({ radius: 0.09, tube: 0.018, pos: [hx, 0.96, -4.2], arc: Math.PI, mat: 'metal_dark' });
        k.sphere({ radius: 0.038, pos: [hx - 0.09, 0.92, -4.2], mat: 'accent' });
        k.sphere({ radius: 0.038, pos: [hx + 0.09, 0.92, -4.2], mat: 'accent' });
        k.tube({
          points: [
            [hx - 0.09, 0.91, -4.2],
            [hx - 0.06, 0.86, -4.1],
          ],
          radius: 0.008,
          mat: 'metal_dark',
        });
      }
      k.prop({ kind: 'mug', pos: [-3.3, 0.75, -4.15] });
      k.prop({ kind: 'mug', pos: [2.25, 0.75, -4.15] });
    });

    // Ticket triage board (pinboard with cards for Triage / In Progress / Routed to Eng) on west wall
    k.group('ticket_triage_board', () => {
      k.box({ size: [0.1, 1.7, 3.6], pos: [-8.88, 2.1, -1.2], mat: 'wood_dark' });
      k.box({ size: [0.12, 1.54, 3.44], pos: [-8.86, 2.1, -1.2], mat: 'plaster_wall' });

      const ticketMats = ['fabric_coral', 'accent', 'fabric_blue', 'paper', 'fabric_lavender'] as const;
      let idx = 0;
      for (const tz of [-2.5, -1.85, -1.2, -0.55, 0.1]) {
        for (const ty of [1.65, 2.1, 2.55]) {
          k.box({
            size: [0.03, 0.3, 0.48],
            pos: [-8.79, ty, tz],
            mat: ticketMats[idx % ticketMats.length],
          });
          idx++;
        }
      }
    });

    // Cozy waiting area (sofa, cushions, round table, plants) on the east and south-west sides
    k.group('waiting_lounge', () => {
      k.prop({ kind: 'sofa', pos: [6.6, 0, 1.2], rotY: -Math.PI / 2, collide: true });
      // Plush cushions on and around the sofa
      k.roundedBox({ size: [0.38, 0.32, 0.16], pos: [6.4, 0.62, 0.65], radius: 0.05, rotY: 0.3, mat: 'accent' });
      k.roundedBox({ size: [0.38, 0.32, 0.16], pos: [6.4, 0.62, 1.75], radius: 0.05, rotY: -0.3, mat: 'fabric_coral' });
      k.roundedBox({ size: [0.55, 0.14, 0.55], pos: [5.0, 0.07, 2.6], radius: 0.06, mat: 'fabric_blue' });

      k.prop({ kind: 'table_round', pos: [5.0, 0, 1.2], scale: 0.85, collide: true });
      k.prop({ kind: 'mug', pos: [4.95, 0.64, 1.15] });
      k.prop({ kind: 'books', pos: [5.15, 0.64, 1.3], rotY: 0.25 });

      k.prop({ kind: 'bookshelf', pos: [-8.3, 0, 2.8], rotY: Math.PI / 2, collide: true });
      k.prop({ kind: 'plant_tall', pos: [-7.8, 0, -5.6] });
      k.prop({ kind: 'plant_tall', pos: [7.8, 0, -5.6] });
      k.prop({ kind: 'plant_tall', pos: [7.8, 0, 5.0] });
      k.prop({ kind: 'lamp_floor', pos: [7.8, 0, -0.6] });
    });

    // Warm interior lights (<= 3)
    k.light({ kind: 'point', pos: [0, 3.6, -2.0], color: '#E6F7FF', intensity: 1.4, distance: 13 });
    k.light({ kind: 'point', pos: [5.2, 3.2, 1.2], color: '#FFE5BD', intensity: 1.1, distance: 10 });
    k.light({ kind: 'point', pos: [-5.2, 3.2, -1.5], color: '#FFE5BD', intensity: 1.0, distance: 10 });

    // 6 NPC slots in the open central floor
    k.npcSlot({ id: 's1', pos: [0, 0, -2.6], facingY: 0 });
    k.npcSlot({ id: 's2', pos: [-2.8, 0, -2.4], facingY: 0 });
    k.npcSlot({ id: 's3', pos: [2.8, 0, -2.4], facingY: 0 });
    k.npcSlot({ id: 's4', pos: [-3.4, 0, 1.0], facingY: 0 });
    k.npcSlot({ id: 's5', pos: [2.2, 0, 1.0], facingY: 0 });
    k.npcSlot({ id: 's6', pos: [-0.6, 0, 2.4], facingY: 0 });
  },
};

export default supportBuilding;
