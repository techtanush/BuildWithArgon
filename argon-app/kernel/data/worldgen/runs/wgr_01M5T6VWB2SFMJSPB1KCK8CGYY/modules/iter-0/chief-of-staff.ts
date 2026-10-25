import type { BuildingModule, KitApi } from '../../kit/types';

const chiefOfStaffBuilding: BuildingModule = {
  id: 'chief-of-staff',
  interiorShell: { floor: 'wood_floor', walls: 'plaster_warm' },

  buildExterior(k: KitApi) {
    // Disjoint colliders for the grand symmetrical Town Hall
    k.group('colliders', () => {
      k.box({ size: [8.0, 11.0, 14.0], pos: [-6.8, 5.5, -0.4], mat: 'plaster_warm', collide: true, name: 'th_west_col' });
      k.box({ size: [8.0, 11.0, 14.0], pos: [6.8, 5.5, -0.4], mat: 'plaster_warm', collide: true, name: 'th_east_col' });
      k.box({ size: [5.0, 16.0, 11.6], pos: [0, 8.0, -1.6], mat: 'plaster_warm', collide: true, name: 'th_center_col' });
    });

    // Largest building: symmetrical palazzo, central tower with clock face & flag, wide steps, 6 columns, slate trim
    k.group('town_hall_palazzo', () => {
      // Monumental rusticated limestone plinth
      k.box({ size: [22.4, 1.6, 14.8], pos: [0, 0.8, -0.4], mat: 'plaza_stone', name: 'civic_plinth' });
      // Main 3-storey symmetrical wings & central block
      k.box({ size: [21.8, 9.6, 14.2], pos: [0, 6.4, -0.4], mat: 'plaster_warm', name: 'main_palazzo' });

      // Projecting side pavilions for deep Union Square civic articulation
      k.box({ size: [5.6, 10.0, 14.8], pos: [-8.2, 6.6, -0.4], mat: 'stucco' });
      k.box({ size: [5.6, 10.0, 14.8], pos: [8.2, 6.6, -0.4], mat: 'stucco' });

      // Horizontal string courses and slate (`accent`) cornice band across the main facade
      for (const sy of [4.6, 7.8]) {
        k.box({ size: [22.4, 0.28, 15.0], pos: [0, sy, -0.4], mat: 'trim' });
      }
      k.box({ size: [22.2, 0.6, 14.8], pos: [0, 11.3, -0.4], mat: 'accent', name: 'slate_frieze' });
      k.box({ size: [22.8, 0.5, 15.4], pos: [0, 11.85, -0.4], mat: 'trim', name: 'grand_cornice' });
      k.box({ size: [20.6, 1.4, 13.0], pos: [0, 12.8, -0.6], mat: 'roof' });
    });

    // Central civic tower rising above the Town Hall with clock face, lantern belfry, and flag
    k.group('central_civic_tower', () => {
      // Lower tower drum (y = 12.0 to 18.8)
      k.box({ size: [6.8, 6.8, 6.8], pos: [0, 15.4, -0.6], mat: 'plaster_warm', name: 'tower_shaft' });
      k.box({ size: [7.2, 0.45, 7.2], pos: [0, 18.9, -0.6], mat: 'accent' });
      k.box({ size: [7.6, 0.4, 7.6], pos: [0, 19.3, -0.6], mat: 'trim' });

      // Clock face mounted on the front of the central tower facing the plaza
      k.cylinder({
        radiusTop: 1.5,
        radiusBottom: 1.5,
        height: 0.24,
        pos: [0, 15.6, 2.85],
        rotX: Math.PI / 2,
        mat: 'accent_dark',
      });
      k.prop({ kind: 'clock', pos: [0, 15.6, 3.0], rotY: 0, scale: 2.8 });

      // Upper octagonal/square lantern cupola + dome + rooftop flagpole (`flag`)
      k.box({ size: [4.8, 3.4, 4.8], pos: [0, 21.2, -0.6], mat: 'window_glow' });
      for (const tx of [-2.35, 2.35]) {
        for (const tz of [-2.95, 1.75]) {
          k.box({ size: [0.45, 3.6, 0.45], pos: [tx, 21.2, tz], mat: 'trim' });
        }
      }
      k.box({ size: [5.4, 0.4, 5.4], pos: [0, 23.1, -0.6], mat: 'accent' });
      k.cone({ radius: 3.6, height: 2.2, pos: [0, 24.4, -0.6], rotY: Math.PI / 4, mat: 'roof', segments: 4 });
      // Flag atop the central tower (top at y = 24.5 + 4.0 = 28.5 <= 30.0)
      k.prop({ kind: 'flag', pos: [0, 24.5, -0.6] });
    });

    // Multi-storey grid of recessed windows across the grand facade
    k.group('facade_windows', () => {
      for (const wx of [-9.4, -7.0, -4.4, 4.4, 7.0, 9.4]) {
        for (const wy of [3.0, 6.2, 9.4]) {
          const zFace = Math.abs(wx) > 5.5 ? 7.02 : 6.72;
          k.box({ size: [1.5, 2.1, 0.2], pos: [wx, wy, zFace], mat: 'trim' });
          k.box({ size: [1.2, 1.8, 0.24], pos: [wx, wy, zFace + 0.03], mat: 'window_glow' });
          k.box({ size: [0.06, 1.8, 0.28], pos: [wx, wy, zFace + 0.06], mat: 'metal_dark' });
          k.box({ size: [1.2, 0.06, 0.28], pos: [wx, wy + 0.15, zFace + 0.06], mat: 'metal_dark' });
          k.box({ size: [1.7, 0.16, 0.36], pos: [wx, wy - 1.08, zFace + 0.08], mat: 'plaza_stone' });
        }
      }
    });

    // Monumental 6-column portico, wide terraced steps, entrance, sign, and flowerbeds
    k.group('portico_and_steps', () => {
      // Wide terraced steps leading up to the portico (collide: false default)
      k.box({ size: [12.8, 0.28, 3.6], pos: [0, 0.14, 8.6], mat: 'plaza_stone' });
      k.box({ size: [11.8, 0.28, 2.8], pos: [0, 0.42, 8.1], mat: 'plaza_stone' });

      // 6 classical columns across the central portico at z = 8.2
      for (const cx of [-5.2, -3.4, -1.8, 1.8, 3.4, 5.2]) {
        k.box({ size: [0.95, 0.5, 0.95], pos: [cx, 0.8, 8.2], mat: 'plaza_stone' });
        k.cylinder({
          radiusTop: 0.36,
          radiusBottom: 0.44,
          height: 7.4,
          pos: [cx, 4.75, 8.2],
          mat: 'trim',
          segments: 20,
        });
        k.box({ size: [1.05, 0.45, 1.05], pos: [cx, 8.65, 8.2], mat: 'trim' });
      }
      // Portico entablature & slate crown
      k.box({ size: [12.2, 0.65, 2.2], pos: [0, 9.2, 7.6], mat: 'trim' });
      k.box({ size: [12.0, 0.5, 2.1], pos: [0, 9.75, 7.6], mat: 'accent' });
      k.box({ size: [12.4, 0.4, 2.4], pos: [0, 10.15, 7.6], mat: 'trim' });

      k.entrance({ z: 6.8 });
      k.sign({ pos: [0, 5.2, 8.75], rotY: 0, width: 5.4 });

      // Symmetrical flowerbeds and benches on the civic forecourt
      k.prop({ kind: 'flowerbed', pos: [-8.2, 0, 9.2] });
      k.prop({ kind: 'flowerbed', pos: [8.2, 0, 9.2] });
      k.prop({ kind: 'flowerbed', pos: [-8.2, 0, 11.2] });
      k.prop({ kind: 'flowerbed', pos: [8.2, 0, 11.2] });
      k.prop({ kind: 'bench', pos: [-5.0, 0, 10.8], rotY: 0, collide: true });
      k.prop({ kind: 'bench', pos: [5.0, 0, 10.8], rotY: 0, collide: true });
    });

    k.light({ kind: 'point', pos: [0, 4.5, 8.0], color: '#FFEAC4', intensity: 1.4, distance: 11 });
  },

  buildInterior(k: KitApi) {
    // Tall civic windows on north, east, and west walls
    k.window({ wall: 'north', center: -4.2, width: 2.6, height: 2.2, sill: 0.8 });
    k.window({ wall: 'north', center: 4.2, width: 2.6, height: 2.2, sill: 0.8 });
    k.window({ wall: 'east', center: 0, width: 3.0, height: 2.2, sill: 0.8 });

    // Grand council chamber runner rug
    k.plane({ size: [5.6, 6.4], pos: [0, 0.01, -0.6], rot: [-Math.PI / 2, 0, 0], mat: 'accent_dark' });
    k.plane({ size: [5.0, 5.8], pos: [0, 0.015, -0.6], rot: [-Math.PI / 2, 0, 0], mat: 'fabric_lavender' });

    // Big wall-mounted "Foundry Org Map" (13 colored tiles in a grid = the 13 departments) on the north wall
    k.group('foundry_org_map', () => {
      // Framed dark slate board on the center of the north wall
      k.box({ size: [4.8, 2.3, 0.1], pos: [0, 2.45, -6.9], mat: 'wood_dark' });
      k.box({ size: [4.56, 2.06, 0.12], pos: [0, 2.45, -6.88], mat: 'metal_dark' });

      // Top apex tile: D13 Chief of Staff (`accent`)
      k.box({ size: [0.68, 0.34, 0.05], pos: [0, 3.12, -6.8], mat: 'accent' });

      // 2 rows x 6 columns = 12 department tiles below D13 (total 13 colored department tiles!)
      const deptMats = [
        'fabric_coral',
        'accent',
        'fabric_blue',
        'fabric_lavender',
        'fabric_pink',
        'fabric_coral_dark',
        'fabric_blue',
        'accent',
        'fabric_lavender',
        'fabric_coral',
        'fabric_pink',
        'window_glow',
      ] as const;

      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 6; col++) {
          const tx = -1.75 + col * 0.7;
          const ty = 2.42 - row * 0.56;
          const mat = deptMats[row * 6 + col];
          k.box({ size: [0.54, 0.34, 0.05], pos: [tx, ty, -6.8], mat });
          // Coordination bus line connecting to the central trunk
          k.box({ size: [0.03, 0.22, 0.03], pos: [tx, ty + 0.22, -6.81], mat: 'paper' });
        }
      }
      // Horizontal coordination bus bars
      k.box({ size: [3.6, 0.03, 0.03], pos: [0, 2.72, -6.81], mat: 'paper' });
      k.box({ size: [3.6, 0.03, 0.03], pos: [0, 2.14, -6.81], mat: 'paper' });
    });

    // Speaker's lectern flanked by two flags at the north end of the chamber
    k.group('lectern_and_flags', () => {
      // Custom slanted speaker's lectern at [0, 0, -4.5] (`collide: true`)
      k.box({ size: [0.75, 1.1, 0.55], pos: [0, 0.55, -4.5], mat: 'wood_dark', collide: true });
      k.box({ size: [0.85, 0.08, 0.65], pos: [0, 1.12, -4.5], mat: 'wood_light' });
      k.box({ size: [0.5, 0.45, 0.04], pos: [0, 0.75, -4.21], mat: 'accent' });
      k.plane({ size: [0.42, 0.3], pos: [0, 1.17, -4.5], rot: [-Math.PI / 2, 0, 0], mat: 'paper' });

      // Two ceremonial flags flanking the north wall (scaled to fit comfortably under 4.2m ceiling)
      k.prop({ kind: 'flag', pos: [-2.8, 0, -6.1], scale: 0.9 });
      k.prop({ kind: 'flag', pos: [2.8, 0, -6.1], scale: 0.9 });
    });

    // Long council table in the center with 8 chairs
    k.group('council_table_and_chairs', () => {
      // Long council table centered at [0, 0, -0.8] (`collide: true`, size 3.0 x 1.1, rotated along Z)
      k.prop({ kind: 'table_long', pos: [0, 0, -0.8], rotY: Math.PI / 2, collide: true });

      // 8 council chairs: 3 along the west side, 3 along the east side, 1 at north head, 1 at south head
      for (const cz of [-1.8, -0.8, 0.2]) {
        k.prop({ kind: 'chair', pos: [-1.05, 0, cz], rotY: Math.PI / 2 });
        k.prop({ kind: 'chair', pos: [1.05, 0, cz], rotY: -Math.PI / 2 });
        // Briefing dossiers on the table in front of each seat
        k.plane({ size: [0.26, 0.34], pos: [-0.32, 0.77, cz], rot: [-Math.PI / 2, 0, 0], mat: 'paper' });
        k.plane({ size: [0.26, 0.34], pos: [0.32, 0.77, cz], rot: [-Math.PI / 2, 0, 0], mat: 'paper' });
      }
      k.prop({ kind: 'chair', pos: [0, 0, -2.65], rotY: 0 });
      k.prop({ kind: 'chair', pos: [0, 0, 1.05], rotY: Math.PI });

      k.prop({ kind: 'books', pos: [0, 0.76, -1.2], rotY: 0.15 });
      k.prop({ kind: 'mug', pos: [-0.25, 0.76, -0.3] });
      k.prop({ kind: 'mug', pos: [0.28, 0.76, 0.1] });
    });

    // Perimeter reference bookshelves, executive side desks, and plants
    k.group('perimeter_furnishings', () => {
      k.prop({ kind: 'bookshelf', pos: [-8.3, 0, -2.8], rotY: Math.PI / 2, collide: true });
      k.prop({ kind: 'bookshelf', pos: [-8.3, 0, 2.2], rotY: Math.PI / 2, collide: true });
      k.prop({ kind: 'bookshelf', pos: [8.3, 0, -2.8], rotY: -Math.PI / 2, collide: true });
      k.prop({ kind: 'bookshelf', pos: [8.3, 0, 2.2], rotY: -Math.PI / 2, collide: true });

      k.prop({ kind: 'desk', pos: [-6.4, 0, -4.6], rotY: 0, collide: true });
      k.prop({ kind: 'lamp_desk', pos: [-6.8, 0.75, -4.65] });
      k.prop({ kind: 'screen_stand', pos: [-6.2, 0.75, -4.65], rotY: 0.1 });

      k.prop({ kind: 'desk', pos: [6.4, 0, -4.6], rotY: 0, collide: true });
      k.prop({ kind: 'lamp_desk', pos: [6.8, 0.75, -4.65] });
      k.prop({ kind: 'books', pos: [6.1, 0.75, -4.55], rotY: -0.2 });

      k.prop({ kind: 'plant_tall', pos: [-7.8, 0, -5.8] });
      k.prop({ kind: 'plant_tall', pos: [7.8, 0, -5.8] });
      k.prop({ kind: 'plant_tall', pos: [-7.8, 0, 5.2] });
      k.prop({ kind: 'plant_tall', pos: [7.8, 0, 5.2] });
    });

    // Warm interior lights (<= 3)
    k.light({ kind: 'point', pos: [0, 3.6, -1.0], color: '#FFE8C2', intensity: 1.4, distance: 13 });
    k.light({ kind: 'point', pos: [-4.8, 3.2, -1.0], color: '#FFE0B2', intensity: 1.0, distance: 10 });
    k.light({ kind: 'point', pos: [4.8, 3.2, -1.0], color: '#FFE0B2', intensity: 1.0, distance: 10 });

    // 6 NPC slots flanking the central council table (wide walkways at x = ±3.2 and south at z = 2.4)
    k.npcSlot({ id: 's1', pos: [-2.4, 0, -3.2], facingY: 0 });
    k.npcSlot({ id: 's2', pos: [2.4, 0, -3.2], facingY: 0 });
    k.npcSlot({ id: 's3', pos: [-3.4, 0, -0.8], facingY: 0 });
    k.npcSlot({ id: 's4', pos: [3.4, 0, -0.8], facingY: 0 });
    k.npcSlot({ id: 's5', pos: [-2.8, 0, 2.2], facingY: 0 });
    k.npcSlot({ id: 's6', pos: [2.8, 0, 2.2], facingY: 0 });
  },
};

export default chiefOfStaffBuilding;
