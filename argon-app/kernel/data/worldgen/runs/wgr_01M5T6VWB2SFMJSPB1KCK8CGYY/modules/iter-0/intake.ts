import type { BuildingModule, KitApi } from '../../kit/types';

const intakeBuilding: BuildingModule = {
  id: 'intake',
  interiorShell: { floor: 'wood_floor', walls: 'plaster_warm' },

  buildExterior(k: KitApi) {
    // Disjoint core colliders for the station hall
    k.group('colliders', () => {
      k.box({ size: [7.4, 8.2, 13.6], pos: [-6.5, 4.1, -0.4], mat: 'stucco', collide: true, name: 'col_west' });
      k.box({ size: [7.4, 8.2, 13.6], pos: [6.5, 4.1, -0.4], mat: 'stucco', collide: true, name: 'col_east' });
      k.box({ size: [5.0, 8.2, 11.6], pos: [0, 4.1, -1.4], mat: 'stucco', collide: true, name: 'col_center' });
    });

    // Main station architecture: rusticated base, warm stucco walls, slate roof & clerestory
    k.group('station_body', () => {
      // Plinth / stone foundation
      k.box({ size: [21.2, 1.2, 14.4], pos: [0, 0.6, -0.4], mat: 'plaza_stone', name: 'plinth' });
      // Main stucco hall body
      k.box({ size: [20.8, 7.4, 14.0], pos: [0, 4.9, -0.4], mat: 'stucco', name: 'main_walls' });
      // Central arched concourse pavilion projecting slightly forward
      k.box({ size: [7.6, 9.2, 2.2], pos: [0, 4.6, 5.9], mat: 'plaster_warm', name: 'center_pavilion' });
      k.box({ size: [8.0, 1.2, 2.5], pos: [0, 0.6, 5.9], mat: 'plaza_stone' });

      // Horizontal string courses and classical cornice
      k.box({ size: [21.4, 0.3, 14.6], pos: [0, 4.2, -0.4], mat: 'trim' });
      k.box({ size: [21.6, 0.45, 14.8], pos: [0, 8.7, -0.4], mat: 'trim', name: 'main_cornice' });
      k.box({ size: [8.2, 0.45, 2.6], pos: [0, 9.3, 5.9], mat: 'trim', name: 'pavilion_cornice' });
      k.box({ size: [20.8, 0.25, 14.2], pos: [0, 9.05, -0.4], mat: 'accent', name: 'roof_band' });

      // Slate pitched roof steps + vaulted station train-shed clerestory
      k.box({ size: [20.4, 1.2, 13.2], pos: [0, 9.7, -0.4], mat: 'roof', name: 'roof_lower' });
      k.box({ size: [18.4, 1.0, 11.2], pos: [0, 10.7, -0.4], mat: 'roof', name: 'roof_mid' });
      k.box({ size: [14.0, 1.4, 8.6], pos: [0, 11.8, -0.6], mat: 'metal_dark', name: 'clerestory_frame' });
      k.box({ size: [13.2, 0.9, 8.8], pos: [0, 11.8, -0.6], mat: 'window_glow', name: 'clerestory_glass' });
      k.box({ size: [14.6, 0.5, 9.2], pos: [0, 12.7, -0.6], mat: 'roof', name: 'clerestory_cap' });

      // Corner pilasters
      for (const x of [-10.3, -3.7, 3.7, 10.3]) {
        k.box({ size: [0.6, 7.5, 0.4], pos: [x, 4.9, 6.65], mat: 'trim' });
      }
    });

    // Wide arched front on central pavilion (series of rounded boxes forming a station arch)
    k.group('grand_arch', () => {
      // Recessed tall glazed concourse window above entrance
      k.box({ size: [4.6, 3.4, 0.2], pos: [0, 6.7, 6.92], mat: 'window_glow', name: 'arch_window' });
      // Mullions inside the grand arch window
      for (const mx of [-1.4, 0, 1.4]) {
        k.box({ size: [0.1, 3.4, 0.26], pos: [mx, 6.7, 6.96], mat: 'metal_dark' });
      }
      k.box({ size: [4.6, 0.1, 0.26], pos: [0, 6.5, 6.96], mat: 'metal_dark' });
      k.box({ size: [4.6, 0.1, 0.26], pos: [0, 7.6, 6.96], mat: 'metal_dark' });

      // Arch piers left and right
      k.roundedBox({ size: [0.75, 5.2, 0.55], pos: [-2.55, 5.4, 7.05], radius: 0.12, mat: 'trim' });
      k.roundedBox({ size: [0.75, 5.2, 0.55], pos: [2.55, 5.4, 7.05], radius: 0.12, mat: 'trim' });

      // Arch voussoirs (series of rounded boxes curving over the top)
      const archSegments = 9;
      for (let i = 0; i < archSegments; i++) {
        const t = (i / (archSegments - 1)) * Math.PI;
        const ax = -Math.cos(t) * 2.4;
        const ay = 7.4 + Math.sin(t) * 1.35;
        k.roundedBox({
          size: [0.95, 0.55, 0.6],
          pos: [ax, ay, 7.08],
          radius: 0.12,
          mat: i % 2 === 0 ? 'trim' : 'accent',
        });
      }
      // Keystone at top of arch
      k.roundedBox({ size: [0.7, 0.85, 0.7], pos: [0, 8.85, 7.12], radius: 0.1, mat: 'accent_dark' });
    });

    // Front and side facade windows (2 storeys, recessed with frames, sills, mullions)
    k.group('windows', () => {
      for (const x of [-8.2, -5.6, 5.6, 8.2]) {
        for (const y of [2.6, 6.0]) {
          // Window recess & frame
          k.box({ size: [1.7, 2.2, 0.22], pos: [x, y, 6.55], mat: 'trim' });
          k.box({ size: [1.4, 1.9, 0.26], pos: [x, y, 6.58], mat: y === 2.6 ? 'window_glow' : 'glass' });
          // Mullions
          k.box({ size: [0.07, 1.9, 0.3], pos: [x, y, 6.62], mat: 'metal_dark' });
          k.box({ size: [1.4, 0.07, 0.3], pos: [x, y + 0.2, 6.62], mat: 'metal_dark' });
          // Projecting sill & lintel hood
          k.box({ size: [1.9, 0.16, 0.42], pos: [x, y - 1.1, 6.7], mat: 'plaza_stone' });
          k.box({ size: [1.85, 0.22, 0.38], pos: [x, y + 1.15, 6.68], mat: 'trim' });
        }
      }
    });

    // Large clock-less station canopy in department accent orange + entrance
    k.group('canopy_and_entrance', () => {
      // Paved forecourt walk
      k.box({ size: [8.4, 0.12, 5.2], pos: [0, 0.06, 9.2], mat: 'plaza_stone', name: 'forecourt_walk' });

      // Wide accent orange canopy projecting over the entrance
      k.roundedBox({ size: [6.8, 0.42, 2.6], pos: [0, 3.65, 8.15], radius: 0.1, mat: 'accent', name: 'canopy_main' });
      k.box({ size: [7.0, 0.16, 2.75], pos: [0, 3.42, 8.15], mat: 'accent_dark', name: 'canopy_trim' });
      k.box({ size: [6.4, 0.08, 2.2], pos: [0, 3.4, 8.15], mat: 'plaster_warm', name: 'canopy_soffit' });

      // Diagonal metal suspension tie-rods holding the canopy
      k.tube({
        points: [
          [-2.8, 3.8, 9.2],
          [-2.8, 5.6, 7.0],
        ],
        radius: 0.05,
        mat: 'metal_dark',
      });
      k.tube({
        points: [
          [2.8, 3.8, 9.2],
          [2.8, 5.6, 7.0],
        ],
        radius: 0.05,
        mat: 'metal_dark',
      });

      // Entrance door & sign (unoccluded on front of canopy crown)
      k.entrance({ z: 7.0 });
      k.sign({ pos: [0, 4.35, 9.48], rotY: 0, width: 5.2 });
      k.box({ size: [5.5, 1.35, 0.18], pos: [0, 4.35, 9.35], mat: 'metal_dark', name: 'sign_backing' });
    });

    // Forecourt luggage carts, suitcases, benches, and landscaping
    k.group('forecourt_details', () => {
      // Left and right luggage carts outside (kept clear of central entrance ring)
      for (const side of [-1, 1]) {
        const cx = side * 5.8;
        const cz = 8.4;
        // Cart platform & brass/metal rails
        k.roundedBox({ size: [1.6, 0.14, 0.9], pos: [cx, 0.32, cz], radius: 0.04, mat: 'wood_dark', collide: true });
        for (const wx of [-0.6, 0.6]) {
          for (const wz of [-0.35, 0.35]) {
            k.cylinder({
              radiusTop: 0.16,
              radiusBottom: 0.16,
              height: 0.1,
              pos: [cx + wx, 0.16, cz + wz],
              rotX: Math.PI / 2,
              mat: 'metal_dark',
            });
          }
        }
        // Push handles on cart
        k.tube({
          points: [
            [cx - 0.72, 0.38, cz - 0.35],
            [cx - 0.72, 1.25, cz - 0.35],
            [cx - 0.72, 1.25, cz + 0.35],
            [cx - 0.72, 0.38, cz + 0.35],
          ],
          radius: 0.04,
          mat: 'metal_light',
        });
        // Suitcases stacked on cart
        k.roundedBox({ size: [0.75, 0.42, 0.52], pos: [cx - 0.2, 0.6, cz], radius: 0.06, mat: 'fabric_coral' });
        k.roundedBox({ size: [0.62, 0.34, 0.44], pos: [cx - 0.18, 0.98, cz], radius: 0.05, mat: 'fabric_blue' });
        k.roundedBox({ size: [0.5, 0.55, 0.38], pos: [cx + 0.42, 0.66, cz], radius: 0.05, mat: 'accent_dark' });
      }

      // Station benches and flowerbeds framing the lot
      k.prop({ kind: 'bench', pos: [-8.5, 0, 8.2], rotY: 0, collide: true });
      k.prop({ kind: 'bench', pos: [8.5, 0, 8.2], rotY: 0, collide: true });
      k.prop({ kind: 'flowerbed', pos: [-7.5, 0, 10.6] });
      k.prop({ kind: 'flowerbed', pos: [7.5, 0, 10.6] });
      k.prop({ kind: 'plant_tall', pos: [-3.8, 0, 7.6] });
      k.prop({ kind: 'plant_tall', pos: [3.8, 0, 7.6] });
    });

    k.light({ kind: 'point', pos: [0, 3.25, 8.2], color: '#FFE4B8', intensity: 1.4, distance: 10 });
  },

  buildInterior(k: KitApi) {
    // Windows bringing warm daylight into the Arrivals Hall
    k.window({ wall: 'north', center: 0, width: 3.4, height: 1.9, sill: 1.0 });
    k.window({ wall: 'east', center: -1.5, width: 2.6, height: 1.8, sill: 1.0 });
    k.window({ wall: 'west', center: -1.5, width: 2.6, height: 1.8, sill: 1.0 });

    // Central layered area rug (no collider)
    k.group('rug_and_floor_details', () => {
      k.plane({ size: [6.4, 4.4], pos: [0, 0.01, -0.3], rot: [-Math.PI / 2, 0, 0], mat: 'fabric_coral_dark' });
      k.plane({ size: [5.9, 3.9], pos: [0, 0.015, -0.3], rot: [-Math.PI / 2, 0, 0], mat: 'fabric_coral' });
      // Floor cable snaking from reception desk to west wall outlet
      k.tube({
        points: [
          [-0.9, 0.02, -4.1],
          [-2.4, 0.02, -4.3],
          [-4.2, 0.02, -4.7],
          [-5.8, 0.02, -4.3],
        ],
        radius: 0.018,
        mat: 'cable',
      });
    });

    // Reception counter with paper stacks & spec intake terminal
    k.group('reception_area', () => {
      k.prop({ kind: 'counter', pos: [0, 0, -4.3], rotY: 0, collide: true });
      // Custom wood & accent front panel detail on counter
      k.roundedBox({ size: [1.8, 0.65, 0.06], pos: [0, 0.52, -3.98], radius: 0.02, mat: 'accent' });
      // Spec paper stacks, monitor, desk lamp, and mug on counter (y = 1.05)
      k.prop({ kind: 'screen_stand', pos: [-0.45, 1.05, -4.3], rotY: 0.2 });
      k.prop({ kind: 'lamp_desk', pos: [0.65, 1.05, -4.35] });
      k.prop({ kind: 'books', pos: [0.2, 1.05, -4.25], rotY: 0.15 });
      k.prop({ kind: 'mug', pos: [-0.05, 1.05, -4.15] });
      // Multiple neat stacks of intake briefs
      k.box({ size: [0.28, 0.12, 0.22], pos: [0.42, 1.11, -4.18], rotY: -0.1, mat: 'paper' });
      k.box({ size: [0.26, 0.08, 0.2], pos: [-0.72, 1.09, -4.2], rotY: 0.2, mat: 'paper' });

      // Chair and filing cabinets behind the reception counter
      k.prop({ kind: 'chair', pos: [0, 0, -5.2], rotY: 0 });
      k.prop({ kind: 'filing_cabinet', pos: [-2.2, 0, -6.2], rotY: 0, collide: true });
      k.prop({ kind: 'filing_cabinet', pos: [2.2, 0, -6.2], rotY: 0, collide: true });
    });

    // "Idea Wall" pinboard on the north-west & west wall: whiteboard + colorful paper notes
    k.group('idea_wall', () => {
      k.prop({ kind: 'whiteboard', pos: [-5.2, 0, -6.2], rotY: 0.15 });
      // Large wall-mounted cork/fabric idea pinboard on west wall
      k.box({ size: [0.1, 1.6, 3.6], pos: [-8.88, 2.1, 1.2], mat: 'wood_dark', name: 'pinboard_frame' });
      k.box({ size: [0.12, 1.44, 3.44], pos: [-8.86, 2.1, 1.2], mat: 'plaster_warm', name: 'pinboard_surface' });

      // Grid of colorful structured-brief cards pinned to the board
      const noteMats = ['paper', 'fabric_coral', 'fabric_blue', 'fabric_lavender', 'accent', 'fabric_pink'] as const;
      const zOffsets = [-0.2, 0.35, 0.9, 1.45, 2.0, 2.55];
      const yOffsets = [1.65, 2.1, 2.52];
      let idx = 0;
      for (const ny of yOffsets) {
        for (const nz of zOffsets) {
          const mat = noteMats[idx % noteMats.length];
          const jitterY = (k.rand() - 0.5) * 0.06;
          const jitterZ = (k.rand() - 0.5) * 0.06;
          k.box({
            size: [0.03, 0.3, 0.38],
            pos: [-8.79, ny + jitterY, nz + jitterZ],
            mat,
          });
          idx++;
        }
      }
    });

    // Spec-writing workstations (west and east north corners)
    k.group('workstations', () => {
      // West spec desk
      k.prop({ kind: 'desk', pos: [-6.6, 0, -4.2], rotY: 0, collide: true });
      k.prop({ kind: 'chair', pos: [-6.6, 0, -3.3], rotY: Math.PI });
      k.prop({ kind: 'screen_stand', pos: [-6.6, 0.75, -4.3], rotY: 0 });
      k.prop({ kind: 'books', pos: [-6.15, 0.75, -4.15], rotY: 0.3 });
      k.prop({ kind: 'mug', pos: [-7.0, 0.75, -4.1] });

      // East spec desk
      k.prop({ kind: 'desk', pos: [6.6, 0, -4.2], rotY: 0, collide: true });
      k.prop({ kind: 'chair', pos: [6.6, 0, -3.3], rotY: Math.PI });
      k.prop({ kind: 'screen_stand', pos: [6.6, 0.75, -4.3], rotY: 0 });
      k.prop({ kind: 'lamp_desk', pos: [7.05, 0.75, -4.3] });
      k.prop({ kind: 'books', pos: [6.15, 0.75, -4.15], rotY: -0.2 });
    });

    // Waiting lounge on the east side: two sofas facing a low table
    k.group('lounge_corner', () => {
      k.prop({ kind: 'sofa', pos: [6.5, 0, -0.6], rotY: 0, collide: true });
      k.prop({ kind: 'sofa', pos: [6.5, 0, 2.8], rotY: Math.PI, collide: true });
      // Low coffee table between the two sofas
      k.roundedBox({ size: [1.5, 0.42, 0.8], pos: [6.5, 0.21, 1.1], radius: 0.05, mat: 'wood_light' });
      k.box({ size: [0.32, 0.06, 0.24], pos: [6.35, 0.45, 1.1], rotY: 0.2, mat: 'paper' });
      k.prop({ kind: 'mug', pos: [6.75, 0.42, 1.05] });
      k.prop({ kind: 'plant_small', pos: [6.55, 0.42, 1.2] });

      // Floor cushions & lamp
      k.roundedBox({ size: [0.55, 0.14, 0.55], pos: [4.8, 0.07, 0.6], radius: 0.06, rotY: 0.3, mat: 'fabric_lavender' });
      k.roundedBox({ size: [0.55, 0.14, 0.55], pos: [4.8, 0.07, 1.6], radius: 0.06, rotY: -0.2, mat: 'fabric_blue' });
      k.prop({ kind: 'lamp_floor', pos: [8.1, 0, 1.1] });
    });

    // Suitcase props (rounded boxes with handles) & bookshelves near arrival corner
    k.group('suitcases_and_props', () => {
      k.prop({ kind: 'bookshelf', pos: [-8.2, 0, 4.2], rotY: Math.PI / 2, collide: true });
      k.prop({ kind: 'plant_tall', pos: [-8.0, 0, -6.0] });
      k.prop({ kind: 'plant_tall', pos: [8.0, 0, 5.6] });
      k.prop({ kind: 'clock', pos: [0, 3.1, -6.92], rotY: 0 });

      // Cluster of arriving founder suitcases by the west wall
      // Upright rolling suitcase
      k.roundedBox({ size: [0.48, 0.72, 0.32], pos: [-7.6, 0.36, -0.8], radius: 0.06, rotY: 0.25, mat: 'accent' });
      k.tube({
        points: [
          [-7.65, 0.72, -0.88],
          [-7.65, 1.05, -0.88],
          [-7.52, 1.05, -0.72],
          [-7.52, 0.72, -0.72],
        ],
        radius: 0.018,
        mat: 'metal_dark',
      });
      // Flat leather-style trunk with handle
      k.roundedBox({ size: [0.76, 0.34, 0.5], pos: [-7.5, 0.17, 0.1], radius: 0.05, rotY: 0.1, mat: 'wood_dark' });
      k.roundedBox({ size: [0.62, 0.26, 0.42], pos: [-7.5, 0.47, 0.1], radius: 0.05, rotY: -0.15, mat: 'fabric_blue' });
      k.torus({ radius: 0.08, tube: 0.018, pos: [-7.18, 0.47, 0.1], rotY: Math.PI / 2, mat: 'metal_light' });
    });

    // Warm interior lights (<= 3)
    k.light({ kind: 'point', pos: [0, 3.5, -2.5], color: '#FFE5C2', intensity: 1.3, distance: 12 });
    k.light({ kind: 'point', pos: [5.5, 3.3, 1.1], color: '#FFDDB3', intensity: 1.0, distance: 10 });
    k.light({ kind: 'point', pos: [-5.5, 3.3, -1.0], color: '#FFE8C8', intensity: 1.0, distance: 10 });

    // 6 NPC slots in the open central floor (all >= 2.5m apart, clear walkways to door at (0, 5.4))
    k.npcSlot({ id: 's1', pos: [0, 0, -2.4], facingY: 0 });
    k.npcSlot({ id: 's2', pos: [-4.2, 0, -2.2], facingY: 0 });
    k.npcSlot({ id: 's3', pos: [3.2, 0, -2.2], facingY: 0 });
    k.npcSlot({ id: 's4', pos: [-4.5, 0, 1.2], facingY: 0 });
    k.npcSlot({ id: 's5', pos: [2.2, 0, 1.2], facingY: 0 });
    k.npcSlot({ id: 's6', pos: [-1.8, 0, 3.2], facingY: 0 });
  },
};

export default intakeBuilding;
