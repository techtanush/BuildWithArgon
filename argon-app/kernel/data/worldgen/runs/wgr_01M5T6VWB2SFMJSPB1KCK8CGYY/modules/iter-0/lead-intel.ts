import type { BuildingModule, KitApi } from '../../kit/types';

const leadIntelBuilding: BuildingModule = {
  id: 'lead-intel',
  interiorShell: { floor: 'wood_floor', walls: 'plaster_warm' },

  buildExterior(k: KitApi) {
    // Disjoint colliders for the Beaux-Arts Archive library
    k.group('colliders', () => {
      k.box({ size: [7.6, 9.0, 13.6], pos: [-6.4, 4.5, -0.4], mat: 'stucco', collide: true, name: 'lib_west_col' });
      k.box({ size: [7.6, 9.0, 13.6], pos: [6.4, 4.5, -0.4], mat: 'stucco', collide: true, name: 'lib_east_col' });
      k.box({ size: [4.6, 9.0, 11.4], pos: [0, 4.5, -1.5], mat: 'stucco', collide: true, name: 'lib_center_col' });
    });

    // Library-like facade: stucco with tall arched windows, wide steps, two lamps, slate-blue door, roof balustrade
    k.group('archive_facade', () => {
      // Heavy rusticated limestone base course
      k.box({ size: [21.2, 1.6, 14.4], pos: [0, 0.8, -0.4], mat: 'plaza_stone', name: 'rusticated_base' });
      // Main monumental stucco hall
      k.box({ size: [20.6, 7.8, 13.8], pos: [0, 5.5, -0.4], mat: 'stucco', name: 'stucco_walls' });

      // Classical pilasters dividing the front into 5 grand bays
      for (const px of [-9.8, -5.8, -2.2, 2.2, 5.8, 9.8]) {
        k.box({ size: [0.65, 7.8, 0.45], pos: [px, 5.5, 6.55], mat: 'trim' });
        k.box({ size: [0.8, 0.4, 0.55], pos: [px, 9.2, 6.58], mat: 'trim' });
      }

      // Slate-blue (`accent`) frieze band and classical projecting cornice
      k.box({ size: [21.0, 0.55, 14.2], pos: [0, 9.65, -0.4], mat: 'accent', name: 'slate_frieze' });
      k.box({ size: [21.6, 0.45, 14.8], pos: [0, 10.15, -0.4], mat: 'trim', name: 'main_cornice' });

      // Classical roof balustrade (corner pedestals + row of stone balusters + top rail)
      k.box({ size: [20.8, 0.25, 14.0], pos: [0, 10.5, -0.4], mat: 'plaza_stone' });
      k.box({ size: [20.8, 0.22, 0.45], pos: [0, 11.55, 6.45], mat: 'trim', name: 'balustrade_rail' });
      for (let bx = -9.6; bx <= 9.6; bx += 0.8) {
        const isPier = Math.abs(bx) > 9.4 || Math.abs(Math.abs(bx) - 5.8) < 0.3 || Math.abs(Math.abs(bx) - 2.2) < 0.3;
        if (isPier) {
          k.box({ size: [0.55, 1.0, 0.55], pos: [bx, 11.0, 6.45], mat: 'trim' });
        } else {
          k.cylinder({ radiusTop: 0.1, radiusBottom: 0.13, height: 0.85, pos: [bx, 11.0, 6.45], mat: 'plaza_stone' });
        }
      }
      // Low copper/slate hipped roof behind the balustrade
      k.box({ size: [18.4, 1.2, 11.6], pos: [0, 11.0, -0.6], mat: 'roof' });
    });

    // 4 Tall arched reading-room windows on the front facade
    k.group('arched_windows', () => {
      for (const wx of [-7.8, -4.0, 4.0, 7.8]) {
        // Rectangular window shaft
        k.box({ size: [2.2, 4.4, 0.22], pos: [wx, 5.0, 6.48], mat: 'trim' });
        k.box({ size: [1.85, 4.2, 0.26], pos: [wx, 5.0, 6.51], mat: 'window_glow' });
        // Arched semicircular head
        k.cylinder({
          radiusTop: 1.1,
          radiusBottom: 1.1,
          height: 0.22,
          pos: [wx, 7.2, 6.48],
          rotX: Math.PI / 2,
          mat: 'trim',
        });
        k.cylinder({
          radiusTop: 0.92,
          radiusBottom: 0.92,
          height: 0.26,
          pos: [wx, 7.2, 6.51],
          rotX: Math.PI / 2,
          mat: 'window_glow',
        });
        // Mullions & stone sill
        k.box({ size: [0.07, 5.0, 0.3], pos: [wx, 5.3, 6.55], mat: 'metal_dark' });
        k.box({ size: [1.85, 0.07, 0.3], pos: [wx, 4.6, 6.55], mat: 'metal_dark' });
        k.box({ size: [1.85, 0.07, 0.3], pos: [wx, 6.2, 6.55], mat: 'metal_dark' });
        k.box({ size: [2.5, 0.22, 0.45], pos: [wx, 2.75, 6.62], mat: 'plaza_stone' });
      }
    });

    // Slate-blue (`accent`) monumental door surround, wide steps, two lamps, sign
    k.group('entrance_and_steps', () => {
      // Accent slate-blue portal surround framing the entrance
      k.box({ size: [3.6, 4.6, 0.45], pos: [0, 2.9, 6.65], mat: 'accent', name: 'slate_blue_portal' });
      k.box({ size: [4.0, 0.4, 0.65], pos: [0, 5.3, 6.72], mat: 'trim' });

      // Wide civic steps leading to the door (collide: false default)
      k.box({ size: [7.6, 0.28, 2.8], pos: [0, 0.14, 8.0], mat: 'plaza_stone' });
      k.box({ size: [6.8, 0.28, 2.0], pos: [0, 0.42, 7.6], mat: 'plaza_stone' });

      // Two classical bronze/dark-metal pedestal lamps flanking the steps
      for (const lx of [-3.4, 3.4]) {
        k.box({ size: [0.75, 0.9, 0.75], pos: [lx, 0.45, 8.8], mat: 'plaza_stone', collide: true });
        k.cylinder({ radiusTop: 0.08, radiusBottom: 0.12, height: 2.1, pos: [lx, 1.95, 8.8], mat: 'metal_dark' });
        k.sphere({ radius: 0.28, pos: [lx, 3.15, 8.8], mat: 'window_glow' });
      }

      k.entrance({ z: 6.8 });
      k.sign({ pos: [0, 4.85, 7.05], rotY: 0, width: 4.8 });

      k.prop({ kind: 'flowerbed', pos: [-6.8, 0, 8.8] });
      k.prop({ kind: 'flowerbed', pos: [6.8, 0, 8.8] });
    });

    k.light({ kind: 'point', pos: [0, 4.0, 7.8], color: '#FFE8C5', intensity: 1.3, distance: 10 });
  },

  buildInterior(k: KitApi) {
    // Tall library windows on north, east, and west walls
    k.window({ wall: 'north', center: -3.5, width: 2.6, height: 2.0, sill: 0.9 });
    k.window({ wall: 'north', center: 3.5, width: 2.6, height: 2.0, sill: 0.9 });
    k.window({ wall: 'east', center: 0, width: 2.8, height: 2.0, sill: 0.9 });

    // Classic library runner rug in the center
    k.plane({ size: [5.8, 4.8], pos: [0, 0.01, -0.6], rot: [-Math.PI / 2, 0, 0], mat: 'accent_dark' });
    k.plane({ size: [5.3, 4.3], pos: [0, 0.015, -0.6], rot: [-Math.PI / 2, 0, 0], mat: 'fabric_blue' });

    // Big network-graph board (spheres + tubes on a wall) centered on the north wall
    k.group('network_graph_board', () => {
      k.box({ size: [4.2, 2.2, 0.1], pos: [0, 2.3, -6.9], mat: 'wood_dark' });
      k.box({ size: [3.96, 1.96, 0.12], pos: [0, 2.3, -6.88], mat: 'metal_dark' });

      // ICP & company-level lead evidence nodes (`sphere`) and relationship edges (`tube`)
      const nodes: [number, number, 'accent' | 'fabric_coral' | 'fabric_blue' | 'window_glow'][] = [
        [0, 2.35, 'window_glow'],
        [-1.3, 2.8, 'accent'],
        [-1.4, 1.8, 'fabric_coral'],
        [-0.5, 1.65, 'fabric_blue'],
        [0.6, 2.9, 'fabric_blue'],
        [1.35, 2.55, 'accent'],
        [1.2, 1.7, 'fabric_coral'],
      ];
      for (const [nx, ny, mat] of nodes) {
        k.sphere({ radius: ny === 2.35 && nx === 0 ? 0.14 : 0.095, pos: [nx, ny, -6.78], mat });
      }
      const edges: [[number, number], [number, number]][] = [
        [[0, 2.35], [-1.3, 2.8]],
        [[0, 2.35], [-1.4, 1.8]],
        [[0, 2.35], [-0.5, 1.65]],
        [[0, 2.35], [0.6, 2.9]],
        [[0, 2.35], [1.35, 2.55]],
        [[0, 2.35], [1.2, 1.7]],
        [[-1.3, 2.8], [-1.4, 1.8]],
        [[0.6, 2.9], [1.35, 2.55]],
        [[1.35, 2.55], [1.2, 1.7]],
      ];
      for (const [[x1, y1], [x2, y2]] of edges) {
        k.tube({
          points: [
            [x1, y1, -6.79],
            [x2, y2, -6.79],
          ],
          radius: 0.015,
          mat: 'paper',
        });
      }
    });

    // Card-catalog cabinets (wooden box grid of drawers with brass pulls) on the west wall
    k.group('card_catalog_cabinets', () => {
      k.box({ size: [0.65, 1.8, 3.6], pos: [-8.45, 0.9, -2.2], mat: 'wood_dark', collide: true });
      for (let cy = 0.35; cy <= 1.55; cy += 0.24) {
        for (let cz = -3.7; cz <= -0.7; cz += 0.38) {
          k.box({ size: [0.06, 0.19, 0.32], pos: [-8.11, cy, cz], mat: 'wood_light' });
          k.box({ size: [0.08, 0.05, 0.1], pos: [-8.09, cy, cz], mat: 'accent' });
        }
      }
    });

    // Tall bookshelves in rows along the east wall & south-west (leaving wide walkable aisles)
    k.group('bookshelf_rows', () => {
      k.prop({ kind: 'bookshelf', pos: [8.3, 0, -4.2], rotY: -Math.PI / 2, collide: true });
      k.prop({ kind: 'bookshelf', pos: [8.3, 0, -2.6], rotY: -Math.PI / 2, collide: true });
      k.prop({ kind: 'bookshelf', pos: [8.3, 0, 1.8], rotY: -Math.PI / 2, collide: true });
      k.prop({ kind: 'bookshelf', pos: [8.3, 0, 3.4], rotY: -Math.PI / 2, collide: true });
      k.prop({ kind: 'bookshelf', pos: [-8.3, 0, 2.6], rotY: Math.PI / 2, collide: true });
    });

    // Reading tables with green/banker desk lamps & lead dossiers
    k.group('reading_tables', () => {
      // Lead intelligence desk at north center
      k.prop({ kind: 'desk', pos: [0, 0, -4.4], rotY: 0, collide: true });
      k.prop({ kind: 'chair', pos: [0, 0, -5.3], rotY: 0 });
      k.prop({ kind: 'lamp_desk', pos: [-0.45, 0.75, -4.45] });
      k.prop({ kind: 'screen_stand', pos: [0.35, 0.75, -4.45], rotY: -0.1 });
      k.prop({ kind: 'books', pos: [-0.1, 0.75, -4.25], rotY: 0.2 });

      // West reading table
      k.prop({ kind: 'desk', pos: [-5.6, 0, -2.2], rotY: 0, collide: true });
      k.prop({ kind: 'chair', pos: [-5.6, 0, -1.3], rotY: Math.PI });
      k.prop({ kind: 'lamp_desk', pos: [-5.95, 0.75, -2.25] });
      k.prop({ kind: 'books', pos: [-5.3, 0.75, -2.15], rotY: -0.25 });

      // East reading table
      k.prop({ kind: 'desk', pos: [5.4, 0, -2.2], rotY: 0, collide: true });
      k.prop({ kind: 'chair', pos: [5.4, 0, -1.3], rotY: Math.PI });
      k.prop({ kind: 'lamp_desk', pos: [5.75, 0.75, -2.25] });
      k.prop({ kind: 'books', pos: [5.1, 0.75, -2.15], rotY: 0.15 });
      k.prop({ kind: 'mug', pos: [5.45, 0.75, -2.0] });

      k.prop({ kind: 'plant_tall', pos: [-7.8, 0, -5.8] });
      k.prop({ kind: 'plant_tall', pos: [7.8, 0, 5.4] });
    });

    // Warm interior lights (<= 3)
    k.light({ kind: 'point', pos: [0, 3.6, -2.0], color: '#FFE5BD', intensity: 1.4, distance: 13 });
    k.light({ kind: 'point', pos: [-5.2, 3.0, -2.0], color: '#D8F5E0', intensity: 1.0, distance: 10 });
    k.light({ kind: 'point', pos: [5.2, 3.0, -2.0], color: '#D8F5E0', intensity: 1.0, distance: 10 });

    // 6 NPC slots in the wide central reading room
    k.npcSlot({ id: 's1', pos: [0, 0, -2.6], facingY: 0 });
    k.npcSlot({ id: 's2', pos: [-2.8, 0, -2.2], facingY: 0 });
    k.npcSlot({ id: 's3', pos: [2.8, 0, -2.2], facingY: 0 });
    k.npcSlot({ id: 's4', pos: [-3.2, 0, 1.2], facingY: 0 });
    k.npcSlot({ id: 's5', pos: [3.2, 0, 1.2], facingY: 0 });
    k.npcSlot({ id: 's6', pos: [0, 0, 2.2], facingY: 0 });
  },
};

export default leadIntelBuilding;
