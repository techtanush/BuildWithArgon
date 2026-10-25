import type { BuildingModule, KitApi } from '../../kit/types';

const growthBuilding: BuildingModule = {
  id: 'growth',
  interiorShell: { floor: 'wood_floor', walls: 'plaster_warm' },

  buildExterior(k: KitApi) {
    // Disjoint colliders: lighthouse tower on the west side, keeper's cottage holding the door
    k.group('colliders', () => {
      k.box({ size: [6.4, 16.0, 6.4], pos: [-7.0, 8.0, 1.2], mat: 'stucco', collide: true, name: 'lighthouse_col' });
      k.box({ size: [5.4, 6.5, 11.2], pos: [5.6, 3.25, 0.6], mat: 'brick', collide: true, name: 'cottage_east_col' });
      k.box({ size: [5.8, 6.5, 9.6], pos: [-0.4, 3.25, -0.2], mat: 'brick', collide: true, name: 'cottage_center_col' });
    });

    // Tapered lighthouse tower (r 3.2 -> 2.2, 16m shaft + lantern room) in white stucco & yellow accent stripes
    k.group('lighthouse_tower', () => {
      const lx = -7.0;
      const lz = 1.2;
      // Octagonal/round granite foundation base
      k.cylinder({
        radiusTop: 3.5,
        radiusBottom: 3.8,
        height: 1.8,
        pos: [lx, 0.9, lz],
        mat: 'plaza_stone',
        segments: 24,
      });

      // 5 stacked tapered segments alternating white (`stucco`) and growth yellow (`accent`)
      const bands: [number, number, number, number, 'stucco' | 'accent'][] = [
        [3.2, 3.0, 3.2, 3.4, 'stucco'],
        [3.0, 2.8, 3.2, 6.6, 'accent'],
        [2.8, 2.6, 3.2, 9.8, 'stucco'],
        [2.6, 2.4, 3.2, 13.0, 'accent'],
        [2.4, 2.2, 3.2, 16.2, 'stucco'],
      ];
      for (const [rBot, rTop, h, yCenter, mat] of bands) {
        k.cylinder({
          radiusTop: rTop,
          radiusBottom: rBot,
          height: h,
          pos: [lx, yCenter, lz],
          mat,
          segments: 28,
        });
      }

      // Narrow vertical slit windows up the lighthouse shaft
      for (const wy of [4.2, 8.2, 12.2, 15.8]) {
        k.box({ size: [0.65, 1.3, 0.25], pos: [lx, wy, lz + 2.65], mat: 'window_glow' });
        k.box({ size: [0.85, 1.5, 0.2], pos: [lx, wy, lz + 2.6], mat: 'trim' });
      }

      // Observation gallery deck with corbels & dark metal railing at y = 18.0
      k.cylinder({
        radiusTop: 2.95,
        radiusBottom: 2.3,
        height: 0.55,
        pos: [lx, 18.05, lz],
        mat: 'trim',
        segments: 28,
      });
      k.torus({
        radius: 2.8,
        tube: 0.06,
        pos: [lx, 19.1, lz],
        rotX: Math.PI / 2,
        mat: 'metal_dark',
      });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        k.cylinder({
          radiusTop: 0.04,
          radiusBottom: 0.04,
          height: 0.85,
          pos: [lx + Math.sin(a) * 2.8, 18.7, lz + Math.cos(a) * 2.8],
          mat: 'metal_dark',
        });
      }

      // Lantern room with emissive glass (`window_glow`) & conical cap
      k.cylinder({
        radiusTop: 1.95,
        radiusBottom: 1.95,
        height: 2.4,
        pos: [lx, 19.5, lz],
        mat: 'window_glow',
        segments: 20,
      });
      // Vertical storm bars around lantern glass
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        k.box({
          size: [0.1, 2.4, 0.1],
          pos: [lx + Math.sin(a) * 1.98, 19.5, lz + Math.cos(a) * 1.98],
          rotY: a,
          mat: 'metal_dark',
        });
      }
      k.cone({ radius: 2.35, height: 2.0, pos: [lx, 21.7, lz], mat: 'roof_red', segments: 24 });
      k.sphere({ radius: 0.26, pos: [lx, 22.8, lz], mat: 'accent' });
    });

    // Keeper's cottage beside the lighthouse holding the front door at x = 0, z = 7.0
    k.group('keepers_cottage', () => {
      // Stone foundation & warm plaster/brick walls
      k.box({ size: [13.2, 1.1, 12.2], pos: [2.2, 0.55, 0.8], mat: 'plaza_stone' });
      k.box({ size: [12.8, 6.2, 11.8], pos: [2.2, 4.2, 0.8], mat: 'plaster_warm', name: 'cottage_walls' });
      k.box({ size: [13.2, 0.35, 12.2], pos: [2.2, 7.35, 0.8], mat: 'trim' });
      k.box({ size: [13.0, 0.3, 12.0], pos: [2.2, 7.65, 0.8], mat: 'accent' });

      // Pitched red-tile keeper's roof & brick chimney
      k.box({ size: [12.4, 1.3, 11.0], pos: [2.2, 8.4, 0.8], mat: 'roof_red' });
      k.box({ size: [10.6, 1.1, 9.0], pos: [2.2, 9.5, 0.8], mat: 'roof_red' });
      k.box({ size: [1.2, 3.2, 1.2], pos: [6.8, 10.2, -2.5], mat: 'brick' });

      // Front cottage windows (4 glowing windows across 2 levels)
      for (const wx of [3.2, 6.4]) {
        for (const wy of [2.6, 5.5]) {
          k.box({ size: [1.5, 1.9, 0.2], pos: [wx, wy, 6.72], mat: 'trim' });
          k.box({ size: [1.2, 1.6, 0.24], pos: [wx, wy, 6.75], mat: 'window_glow' });
          k.box({ size: [0.06, 1.6, 0.28], pos: [wx, wy, 6.78], mat: 'metal_dark' });
          k.box({ size: [1.2, 0.06, 0.28], pos: [wx, wy + 0.1, 6.78], mat: 'metal_dark' });
          k.box({ size: [1.7, 0.16, 0.36], pos: [wx, wy - 0.98, 6.84], mat: 'plaza_stone' });
        }
      }

      // Entrance gable at x = 0, z = 7.0
      k.box({ size: [4.2, 5.6, 1.2], pos: [0, 2.8, 6.5], mat: 'plaster_warm' });
      k.box({ size: [4.5, 0.35, 1.5], pos: [0, 5.65, 6.5], mat: 'accent' });
      k.entrance({ z: 7.1 });
      k.sign({ pos: [0, 4.35, 7.25], rotY: 0, width: 4.6 });
    });

    // Coastal forecourt details: barrels, bollards, flowerbeds
    k.group('coastal_forecourt', () => {
      k.box({ size: [4.2, 0.08, 4.0], pos: [0, 0.04, 9.2], mat: 'plaza_stone' });
      k.prop({ kind: 'barrel', pos: [-3.8, 0, 7.8], collide: true });
      k.prop({ kind: 'barrel', pos: [-3.1, 0, 8.1], collide: true });
      k.prop({ kind: 'flowerbed', pos: [5.0, 0, 8.8] });
      k.prop({ kind: 'bench', pos: [5.2, 0, 10.6], rotY: 0, collide: true });
    });

    k.light({ kind: 'point', pos: [0, 3.8, 7.9], color: '#FFF0B8', intensity: 1.4, distance: 10 });
  },

  buildInterior(k: KitApi) {
    // Cottage windows
    k.window({ wall: 'north', center: -3.2, width: 2.6, height: 1.8, sill: 1.0 });
    k.window({ wall: 'east', center: -1.2, width: 2.6, height: 1.8, sill: 1.0 });
    k.window({ wall: 'west', center: 0, width: 2.6, height: 1.8, sill: 1.0 });

    // Nautical chart rug in the center of the cottage
    k.plane({ size: [6.4, 4.4], pos: [0, 0.01, -0.8], rot: [-Math.PI / 2, 0, 0], mat: 'fabric_blue' });
    k.plane({ size: [5.8, 3.8], pos: [0, 0.015, -0.8], rot: [-Math.PI / 2, 0, 0], mat: 'fabric_cream' });

    // Central map table with launch route lines (`tube`) and miniature lighthouse model on top
    k.group('map_table_and_model', () => {
      // Long chart table at [0, 0, -1.2] (`collide: true`)
      k.prop({ kind: 'table_long', pos: [0, 0, -1.2], rotY: 0, collide: true });
      // Large sea & market chart plane on the table surface (y = 0.77)
      k.plane({ size: [2.6, 0.9], pos: [0, 0.768, -1.2], rot: [-Math.PI / 2, 0, 0], mat: 'paper' });

      // Plotted launch route lines (`tube`) across the map table
      k.tube({
        points: [
          [-1.1, 0.775, -1.45],
          [-0.5, 0.775, -1.1],
          [0.1, 0.775, -1.35],
          [0.7, 0.775, -0.95],
          [1.15, 0.775, -1.15],
        ],
        radius: 0.014,
        mat: 'accent',
      });
      k.tube({
        points: [
          [-1.0, 0.775, -0.95],
          [-0.2, 0.775, -1.3],
          [0.5, 0.775, -1.2],
          [1.1, 0.775, -1.4],
        ],
        radius: 0.012,
        mat: 'fabric_coral',
      });

      // Miniature lighthouse model standing on the west end of the map table
      const mx = -0.95;
      const mz = -1.35;
      k.cylinder({ radiusTop: 0.14, radiusBottom: 0.16, height: 0.04, pos: [mx, 0.78, mz], mat: 'plaza_stone' });
      k.cylinder({ radiusTop: 0.08, radiusBottom: 0.12, height: 0.22, pos: [mx, 0.91, mz], mat: 'stucco' });
      k.cylinder({ radiusTop: 0.07, radiusBottom: 0.08, height: 0.14, pos: [mx, 1.09, mz], mat: 'accent' });
      k.cylinder({ radiusTop: 0.06, radiusBottom: 0.06, height: 0.1, pos: [mx, 1.21, mz], mat: 'window_glow' });
      k.cone({ radius: 0.08, height: 0.09, pos: [mx, 1.3, mz], mat: 'roof_red' });

      k.prop({ kind: 'books', pos: [0.85, 0.76, -0.95], rotY: 0.3 });
      k.prop({ kind: 'mug', pos: [0.35, 0.76, -0.88] });
    });

    // Big growth chart on the north wall (rising 3D bars from boxes)
    k.group('wall_growth_chart', () => {
      k.box({ size: [4.2, 2.1, 0.08], pos: [1.8, 2.3, -6.9], mat: 'wood_dark' });
      k.box({ size: [3.95, 1.85, 0.1], pos: [1.8, 2.3, -6.88], mat: 'plaster_wall' });
      // 7 rising 3D bars showing exponential launch traction
      const barHeights = [0.28, 0.42, 0.58, 0.76, 1.0, 1.28, 1.56];
      for (let i = 0; i < barHeights.length; i++) {
        const bh = barHeights[i];
        const bx = 0.3 + i * 0.5;
        k.box({
          size: [0.32, bh, 0.14],
          pos: [bx, 1.45 + bh / 2, -6.82],
          mat: i >= 5 ? 'accent' : i >= 3 ? 'fabric_blue' : 'fabric_lavender',
        });
      }
    });

    // Nautical props (barrels, rope coil = torus) & strategy workstations
    k.group('nautical_props_and_desks', () => {
      // Barrels and coiled rope (`torus` stack) in the north-west corner
      k.prop({ kind: 'barrel', pos: [-7.6, 0, -5.6], collide: true });
      k.prop({ kind: 'barrel', pos: [-6.8, 0, -5.8], collide: true });
      for (let ry = 0.04; ry <= 0.2; ry += 0.05) {
        k.torus({
          radius: 0.28,
          tube: 0.032,
          pos: [-7.4, ry, -4.5],
          rotX: Math.PI / 2,
          mat: 'wood_light',
        });
      }

      // Strategy desks on west and east walls
      k.prop({ kind: 'desk', pos: [-6.6, 0, -2.2], rotY: Math.PI / 2, collide: true });
      k.prop({ kind: 'chair', pos: [-7.5, 0, -2.2], rotY: Math.PI / 2 });
      k.prop({ kind: 'screen_stand', pos: [-6.55, 0.75, -2.2], rotY: Math.PI / 2 });

      k.prop({ kind: 'desk', pos: [6.6, 0, -3.6], rotY: -Math.PI / 2, collide: true });
      k.prop({ kind: 'chair', pos: [7.5, 0, -3.6], rotY: -Math.PI / 2 });
      k.prop({ kind: 'lamp_desk', pos: [6.55, 0.75, -3.9] });
      k.prop({ kind: 'books', pos: [6.55, 0.75, -3.3], rotY: -0.2 });

      k.prop({ kind: 'telescope', pos: [-3.2, 0, -5.6], rotY: Math.PI + 0.2 });
      k.prop({ kind: 'bookshelf', pos: [8.3, 0, 2.2], rotY: -Math.PI / 2, collide: true });
      k.prop({ kind: 'plant_tall', pos: [-7.8, 0, 5.0] });
      k.prop({ kind: 'plant_tall', pos: [7.8, 0, 5.0] });
    });

    // Warm interior lights (<= 3)
    k.light({ kind: 'point', pos: [0, 3.6, -1.2], color: '#FFF0C2', intensity: 1.4, distance: 13 });
    k.light({ kind: 'point', pos: [-5.0, 3.2, -2.0], color: '#FFE3B0', intensity: 1.0, distance: 10 });
    k.light({ kind: 'point', pos: [5.0, 3.2, -2.0], color: '#FFE3B0', intensity: 1.0, distance: 10 });

    // 6 NPC slots around the central map table (clear of table at x∈[-1.5,1.5], z∈[-1.75,-0.65])
    k.npcSlot({ id: 's1', pos: [0, 0, -3.2], facingY: 0 });
    k.npcSlot({ id: 's2', pos: [-3.4, 0, -2.2], facingY: 0 });
    k.npcSlot({ id: 's3', pos: [3.4, 0, -2.2], facingY: 0 });
    k.npcSlot({ id: 's4', pos: [-3.4, 0, 1.4], facingY: 0 });
    k.npcSlot({ id: 's5', pos: [3.4, 0, 1.4], facingY: 0 });
    k.npcSlot({ id: 's6', pos: [0, 0, 1.8], facingY: 0 });
  },
};

export default growthBuilding;
