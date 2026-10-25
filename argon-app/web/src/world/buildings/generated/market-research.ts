import type { BuildingModule, KitApi } from '../../kit/types';

const marketResearchBuilding: BuildingModule = {
  id: 'market-research',
  interiorShell: { floor: 'wood_floor', walls: 'plaster_wall' },

  buildExterior(k: KitApi) {
    // Disjoint colliders for the round observatory body (keeping entrance at z=8.0 clear)
    k.group('colliders', () => {
      k.box({ size: [12.0, 8.0, 11.0], pos: [0, 4.0, -1.8], mat: 'stucco', collide: true, name: 'obs_core_col' });
      k.box({ size: [4.2, 7.0, 3.2], pos: [-4.8, 3.5, 5.6], mat: 'stucco', collide: true, name: 'obs_west_col' });
      k.box({ size: [4.2, 7.0, 3.2], pos: [4.8, 3.5, 5.6], mat: 'stucco', collide: true, name: 'obs_east_col' });
    });

    // Round building (cylinder r = 8.6) with glass window ring, blue accent band, and metal dome
    k.group('observatory_drum', () => {
      // Stepped stone foundation drum
      k.cylinder({
        radiusTop: 9.1,
        radiusBottom: 9.3,
        height: 1.3,
        pos: [0, 0.65, -0.8],
        mat: 'plaza_stone',
        segments: 32,
      });
      // Main lower cylindrical wall
      k.cylinder({
        radiusTop: 8.6,
        radiusBottom: 8.6,
        height: 4.2,
        pos: [0, 3.4, -0.8],
        mat: 'stucco',
        segments: 32,
      });
      // Continuous glass ring of windows around the upper drum
      k.cylinder({
        radiusTop: 8.45,
        radiusBottom: 8.45,
        height: 2.1,
        pos: [0, 6.55, -0.8],
        mat: 'window_glow',
        segments: 32,
      });
      // Vertical piers / mullions around the glass ring
      for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2;
        const px = Math.sin(angle) * 8.52;
        const pz = -0.8 + Math.cos(angle) * 8.52;
        k.box({ size: [0.38, 6.4, 0.38], pos: [px, 4.4, pz], rotY: angle, mat: 'trim' });
      }
      // Accent blue band and cornice ring crowning the cylinder
      k.cylinder({
        radiusTop: 8.85,
        radiusBottom: 8.85,
        height: 0.65,
        pos: [0, 7.9, -0.8],
        mat: 'accent',
        segments: 32,
      });
      k.cylinder({
        radiusTop: 9.1,
        radiusBottom: 8.9,
        height: 0.45,
        pos: [0, 8.45, -0.8],
        mat: 'trim',
        segments: 32,
      });
    });

    // Observatory hemisphere dome (`metal_light`) with dark observation slit & telescope poking out
    k.group('observatory_dome', () => {
      // Rotating track ring
      k.cylinder({
        radiusTop: 7.9,
        radiusBottom: 8.1,
        height: 0.7,
        pos: [0, 9.0, -0.8],
        mat: 'metal_dark',
        segments: 32,
      });
      // Hemisphere dome (scaled sphere centered at y = 9.2)
      k.sphere({
        radius: 7.7,
        pos: [0, 9.2, -0.8],
        scale: [1, 0.88, 1],
        mat: 'metal_light',
        name: 'dome',
      });
      // Observation slit arch & shutter ribs
      k.box({ size: [1.9, 6.4, 7.2], pos: [0, 12.9, 1.8], mat: 'metal_dark', name: 'dome_slit' });
      k.box({ size: [2.3, 6.2, 7.0], pos: [0, 12.8, 1.7], mat: 'trim', name: 'slit_flange' });

      // Giant observatory telescope tube poking out of the slit + telescope prop on front terrace
      k.cylinder({
        radiusTop: 0.62,
        radiusBottom: 0.78,
        height: 5.6,
        pos: [0, 13.6, 4.2],
        rotX: Math.PI / 3.2,
        mat: 'metal_dark',
        name: 'main_telescope_tube',
      });
      k.cylinder({
        radiusTop: 0.68,
        radiusBottom: 0.68,
        height: 0.45,
        pos: [0, 15.0, 6.3],
        rotX: Math.PI / 3.2,
        mat: 'accent',
        name: 'telescope_lens_hood',
      });
      // Secondary rooftop observation deck telescope prop
      k.prop({ kind: 'telescope', pos: [3.2, 8.65, 5.8], rotY: -0.25, scale: 1.3 });
    });

    // Front entrance portico projecting to z = 8.0
    k.group('entrance_portico', () => {
      k.box({ size: [5.4, 4.8, 2.4], pos: [0, 2.4, 7.0], mat: 'plaster_warm' });
      k.box({ size: [5.8, 0.4, 2.7], pos: [0, 4.95, 7.0], mat: 'trim' });
      k.box({ size: [5.6, 0.35, 2.6], pos: [0, 5.3, 7.0], mat: 'accent' });

      // Flanking ground-floor windows on portico
      for (const wx of [-1.85, 1.85]) {
        k.box({ size: [1.0, 2.0, 0.18], pos: [wx, 2.4, 8.15], mat: 'window_glow' });
        k.box({ size: [1.18, 2.2, 0.14], pos: [wx, 2.4, 8.12], mat: 'trim' });
      }

      k.entrance({ z: 8.2 });
      k.sign({ pos: [0, 4.25, 8.35], rotY: 0, width: 6.4 });
    });

    // Forecourt paving & landscaping
    k.group('landscaping', () => {
      k.box({ size: [4.6, 0.1, 3.6], pos: [0, 0.05, 10.0], mat: 'plaza_stone' });
      k.prop({ kind: 'flowerbed', pos: [-5.2, 0, 9.2] });
      k.prop({ kind: 'flowerbed', pos: [5.2, 0, 9.2] });
      k.prop({ kind: 'bench', pos: [-7.2, 0, 7.8], rotY: 0.5, collide: true });
      k.prop({ kind: 'bench', pos: [7.2, 0, 7.8], rotY: -0.5, collide: true });
    });

    k.light({ kind: 'point', pos: [0, 3.8, 8.8], color: '#D8ECFF', intensity: 1.3, distance: 10 });
  },

  buildInterior(k: KitApi) {
    // North window for the telescope + east and west observation windows
    k.window({ wall: 'north', center: 0, width: 3.4, height: 2.1, sill: 0.9 });
    k.window({ wall: 'east', center: -1.0, width: 2.6, height: 1.8, sill: 1.0 });
    k.window({ wall: 'west', center: -1.0, width: 2.6, height: 1.8, sill: 1.0 });

    // Curved corner architectural pilasters to give the room a round observatory feel
    k.group('round_room_framing', () => {
      for (const cx of [-8.2, 8.2]) {
        for (const cz of [-6.2, 6.2]) {
          k.cylinder({
            radiusTop: 0.7,
            radiusBottom: 0.7,
            height: 4.1,
            pos: [cx, 2.05, cz],
            mat: 'trim',
          });
        }
      }
    });

    // Star-map rug: dark blue rug (`fabric_blue`) with concentric orbit rings & small light star dots
    k.group('star_map_rug', () => {
      k.cylinder({
        radiusTop: 3.4,
        radiusBottom: 3.4,
        height: 0.02,
        pos: [0, 0.01, -1.0],
        mat: 'accent_dark',
        segments: 32,
      });
      k.cylinder({
        radiusTop: 3.15,
        radiusBottom: 3.15,
        height: 0.026,
        pos: [0, 0.013, -1.0],
        mat: 'fabric_blue',
        segments: 32,
      });
      // Constellation dots (small light paper/window_glow discs on the rug)
      const stars: [number, number, number][] = [
        [-1.8, -1.6, 0.08],
        [-1.2, -0.2, 0.06],
        [-0.5, -2.3, 0.07],
        [0.8, -2.1, 0.09],
        [1.9, -1.2, 0.07],
        [1.5, 0.4, 0.08],
        [-1.6, 0.8, 0.06],
        [0.3, 1.1, 0.07],
        [-2.3, -0.6, 0.05],
        [2.2, -0.3, 0.06],
      ];
      for (const [sx, sz, sr] of stars) {
        k.cylinder({
          radiusTop: sr,
          radiusBottom: sr,
          height: 0.032,
          pos: [sx, 0.016, sz],
          mat: 'paper',
        });
      }
    });

    // Central round table with market maps (`paper` planes) + big telescope by the north window
    k.group('centerpiece_and_telescope', () => {
      // Big brass/metal telescope by the north window
      k.prop({ kind: 'telescope', pos: [0, 0, -5.2], rotY: Math.PI, scale: 1.25 });

      // Central round table (`table_round` r=0.6 at [0, 0, -1.0])
      k.prop({ kind: 'table_round', pos: [0, 0, -1.0], collide: true });
      // Market maps & quadrant charts laid out on the round table (y = 0.76)
      k.plane({ size: [0.55, 0.42], pos: [-0.12, 0.76, -1.05], rot: [-Math.PI / 2, 0, 0.2], mat: 'paper' });
      k.plane({ size: [0.38, 0.28], pos: [0.22, 0.765, -0.88], rot: [-Math.PI / 2, 0, -0.4], mat: 'fabric_blue' });
      k.prop({ kind: 'books', pos: [-0.25, 0.75, -0.78], rotY: 0.5 });
      k.prop({ kind: 'mug', pos: [0.32, 0.75, -1.15] });
    });

    // Chart screens (`screen`) and market intelligence workstations along east and west walls
    k.group('chart_screens_and_workstations', () => {
      // West wall large market landscape screen + chart bars
      k.box({ size: [0.1, 1.5, 2.8], pos: [-8.88, 2.2, -1.2], mat: 'metal_dark' });
      k.box({ size: [0.12, 1.36, 2.66], pos: [-8.85, 2.2, -1.2], mat: 'screen' });
      // East wall competitor pricing matrix screen
      k.box({ size: [0.1, 1.5, 2.8], pos: [8.88, 2.2, -1.2], mat: 'metal_dark' });
      k.box({ size: [0.12, 1.36, 2.66], pos: [8.85, 2.2, -1.2], mat: 'screen' });

      // West research desks
      k.prop({ kind: 'desk', pos: [-6.4, 0, -3.8], rotY: 0, collide: true });
      k.prop({ kind: 'chair', pos: [-6.4, 0, -2.9], rotY: Math.PI });
      k.prop({ kind: 'screen_stand', pos: [-6.6, 0.75, -3.9], rotY: 0.1 });
      k.prop({ kind: 'screen_stand', pos: [-6.0, 0.75, -3.9], rotY: -0.1 });

      // East research desks
      k.prop({ kind: 'desk', pos: [6.4, 0, -3.8], rotY: 0, collide: true });
      k.prop({ kind: 'chair', pos: [6.4, 0, -2.9], rotY: Math.PI });
      k.prop({ kind: 'screen_stand', pos: [6.4, 0.75, -3.9], rotY: 0 });
      k.prop({ kind: 'lamp_desk', pos: [6.9, 0.75, -3.9] });

      // Bookshelves for cited evidence archives
      k.prop({ kind: 'bookshelf', pos: [-8.3, 0, 2.5], rotY: Math.PI / 2, collide: true });
      k.prop({ kind: 'bookshelf', pos: [8.3, 0, 2.5], rotY: -Math.PI / 2, collide: true });

      // Celestial/Market globe on a pedestal in the north-east corner
      k.cylinder({ radiusTop: 0.28, radiusBottom: 0.34, height: 0.9, pos: [4.2, 0.45, -5.4], mat: 'wood_dark' });
      k.sphere({ radius: 0.32, pos: [4.2, 1.25, -5.4], mat: 'accent' });
      k.torus({ radius: 0.38, tube: 0.025, pos: [4.2, 1.25, -5.4], rotX: 0.5, mat: 'metal_light' });

      k.prop({ kind: 'plant_tall', pos: [-7.6, 0, 5.2] });
      k.prop({ kind: 'plant_tall', pos: [7.6, 0, 5.2] });
      k.prop({ kind: 'lamp_floor', pos: [-4.2, 0, -5.4] });
    });

    // Interior lights (<= 3)
    k.light({ kind: 'point', pos: [0, 3.6, -1.0], color: '#E2F0FF', intensity: 1.4, distance: 13 });
    k.light({ kind: 'point', pos: [-5.5, 3.2, -1.5], color: '#FFE4B8', intensity: 1.0, distance: 10 });
    k.light({ kind: 'point', pos: [5.5, 3.2, -1.5], color: '#FFE4B8', intensity: 1.0, distance: 10 });

    // 6 NPC slots around the star-map rug (clear of the central table at z=-1.0, r=0.6)
    k.npcSlot({ id: 's1', pos: [0, 0, -3.2], facingY: 0 });
    k.npcSlot({ id: 's2', pos: [-3.2, 0, -1.2], facingY: 0 });
    k.npcSlot({ id: 's3', pos: [3.2, 0, -1.2], facingY: 0 });
    k.npcSlot({ id: 's4', pos: [-3.2, 0, 1.8], facingY: 0 });
    k.npcSlot({ id: 's5', pos: [3.2, 0, 1.8], facingY: 0 });
    k.npcSlot({ id: 's6', pos: [0, 0, 1.6], facingY: 0 });
  },
};

export default marketResearchBuilding;
