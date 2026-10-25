import type { BuildingModule, KitApi } from '../../kit/types';

const syntheticPopulationBuilding: BuildingModule = {
  id: 'synthetic-population',
  interiorShell: { floor: 'wood_floor', walls: 'plaster_wall' },

  buildExterior(k: KitApi) {
    // Disjoint colliders for the glass conservatory (leaving central entrance at z=7.6 clear)
    k.group('colliders', () => {
      k.box({ size: [7.2, 6.5, 13.4], pos: [-6.0, 3.25, -0.2], mat: 'metal_light', collide: true, name: 'gh_west_col' });
      k.box({ size: [7.2, 6.5, 13.4], pos: [6.0, 3.25, -0.2], mat: 'metal_light', collide: true, name: 'gh_east_col' });
      k.box({ size: [4.4, 6.5, 11.0], pos: [0, 3.25, -1.4], mat: 'metal_light', collide: true, name: 'gh_center_col' });
    });

    // Glass greenhouse (`glass` panels in `metal_light` frame, pitched roof + ridge lantern)
    k.group('greenhouse_structure', () => {
      // Stone knee-wall plinth around the perimeter
      k.box({ size: [19.6, 1.2, 13.8], pos: [0, 0.6, -0.2], mat: 'plaza_stone', name: 'plinth_wall' });
      k.box({ size: [20.0, 0.2, 14.2], pos: [0, 1.25, -0.2], mat: 'trim', name: 'sill_coping' });

      // Main glazed conservatory walls (`glass` with warm inner glow core)
      k.box({ size: [19.2, 5.2, 13.4], pos: [0, 3.9, -0.2], mat: 'glass', name: 'glass_walls' });
      k.box({ size: [18.4, 4.8, 12.6], pos: [0, 3.8, -0.2], mat: 'window_glow', name: 'inner_glow' });

      // Structural `metal_light` columns and horizontal glazing bars around the facade
      for (const x of [-9.6, -7.2, -4.8, -2.4, 2.4, 4.8, 7.2, 9.6]) {
        k.box({ size: [0.24, 5.6, 0.28], pos: [x, 4.0, 6.55], mat: 'metal_light' });
        k.box({ size: [0.24, 5.6, 0.28], pos: [x, 4.0, -6.95], mat: 'metal_light' });
      }
      for (const y of [2.8, 4.6, 6.5]) {
        k.box({ size: [19.6, 0.2, 13.8], pos: [0, y, -0.2], mat: 'metal_light' });
      }
      // Accent green frieze band at the eaves
      k.box({ size: [19.8, 0.36, 14.0], pos: [0, 6.8, -0.2], mat: 'accent', name: 'green_frieze' });

      // Pitched glass roof & raised botanical ridge lantern
      k.box({ size: [18.6, 1.1, 12.6], pos: [0, 7.5, -0.2], mat: 'glass' });
      k.box({ size: [18.8, 0.22, 12.8], pos: [0, 8.05, -0.2], mat: 'metal_light' });
      k.box({ size: [15.6, 1.0, 9.8], pos: [0, 8.6, -0.2], mat: 'glass' });
      k.box({ size: [15.8, 0.22, 10.0], pos: [0, 9.15, -0.2], mat: 'metal_light' });

      // Central clerestory ridge lantern
      k.box({ size: [11.2, 1.4, 5.2], pos: [0, 9.9, -0.2], mat: 'window_glow' });
      for (let rx = -5.5; rx <= 5.5; rx += 2.2) {
        k.box({ size: [0.22, 1.6, 5.4], pos: [rx, 9.9, -0.2], mat: 'metal_light' });
      }
      k.box({ size: [11.6, 0.35, 5.6], pos: [0, 10.75, -0.2], mat: 'accent' });
    });

    // Projecting glass entrance gable with accent green door portal
    k.group('entrance_portal', () => {
      k.box({ size: [4.8, 6.2, 1.4], pos: [0, 3.1, 7.0], mat: 'metal_light' });
      k.box({ size: [4.4, 5.8, 1.2], pos: [0, 3.1, 7.0], mat: 'glass' });
      k.box({ size: [2.6, 3.2, 0.35], pos: [0, 1.6, 7.65], mat: 'accent', name: 'green_door_surround' });
      k.box({ size: [5.2, 0.35, 1.7], pos: [0, 6.25, 7.0], mat: 'accent' });

      k.entrance({ z: 7.7 });
      k.sign({ pos: [0, 4.45, 7.85], rotY: 0, width: 5.2 });
    });

    // Exterior planters with rows of small "people" figures (synthetic persona panel on stands)
    k.group('persona_planters', () => {
      const personaMats = [
        'fabric_coral',
        'fabric_blue',
        'fabric_lavender',
        'fabric_pink',
        'accent',
        'fabric_cream',
      ] as const;

      for (const side of [-1, 1]) {
        const px = side * 6.2;
        const pz = 8.4;
        // Raised planter bed in stone & dark wood
        k.box({ size: [5.4, 0.7, 1.5], pos: [px, 0.35, pz], mat: 'plaza_stone', collide: true });
        k.box({ size: [5.0, 0.12, 1.2], pos: [px, 0.72, pz], mat: 'wood_dark' });
        // Label strip along front of planter indicating synthetic persona panel
        k.box({ size: [4.8, 0.16, 0.06], pos: [px, 0.5, pz + 0.76], mat: 'accent' });

        // 2 rows x 6 miniature persona figures (stand + torso cylinder + head sphere)
        for (let row = 0; row < 2; row++) {
          for (let col = 0; col < 6; col++) {
            const fx = px - 2.0 + col * 0.8;
            const fz = pz - 0.28 + row * 0.56;
            const mat = personaMats[(row * 6 + col) % personaMats.length];
            // Base stand
            k.cylinder({ radiusTop: 0.11, radiusBottom: 0.13, height: 0.06, pos: [fx, 0.81, fz], mat: 'metal_dark' });
            // Capsule body
            k.cylinder({ radiusTop: 0.08, radiusBottom: 0.09, height: 0.28, pos: [fx, 0.98, fz], mat });
            // Head sphere
            k.sphere({ radius: 0.075, pos: [fx, 1.2, fz], mat: 'plaster_warm' });
          }
        }
      }

      // Forecourt path and corner trees/plants
      k.box({ size: [4.2, 0.08, 4.2], pos: [0, 0.04, 9.8], mat: 'plaza_stone' });
      k.prop({ kind: 'plant_tall', pos: [-9.8, 0, 8.2] });
      k.prop({ kind: 'plant_tall', pos: [9.8, 0, 8.2] });
    });

    k.light({ kind: 'point', pos: [0, 3.8, 8.3], color: '#E6FFE9', intensity: 1.3, distance: 10 });
  },

  buildInterior(k: KitApi) {
    // Abundant daylight through north, east, and west conservatory windows
    k.window({ wall: 'north', center: 0, width: 4.0, height: 2.0, sill: 0.9 });
    k.window({ wall: 'east', center: 0, width: 3.4, height: 2.0, sill: 0.9 });
    k.window({ wall: 'west', center: 0, width: 3.4, height: 2.0, sill: 0.9 });

    // Central botanical runner rug (no collider)
    k.plane({ size: [3.6, 8.4], pos: [0, 0.01, -0.4], rot: [-Math.PI / 2, 0, 0], mat: 'fabric_cream' });
    k.plane({ size: [3.1, 7.9], pos: [0, 0.015, -0.4], rot: [-Math.PI / 2, 0, 0], mat: 'accent' });

    // 4 Planter tables with miniature figure groups (4 segments x 6 tiny figures = 24 synthetic personas)
    k.group('synthetic_persona_tables', () => {
      const segments: { pos: [number, number]; mat: 'fabric_coral' | 'fabric_blue' | 'fabric_lavender' | 'fabric_pink' }[] = [
        { pos: [-5.8, -3.4], mat: 'fabric_coral' },
        { pos: [5.8, -3.4], mat: 'fabric_blue' },
        { pos: [-5.8, 1.2], mat: 'fabric_lavender' },
        { pos: [5.8, 1.2], mat: 'fabric_pink' },
      ];

      for (const seg of segments) {
        const [tx, tz] = seg.pos;
        // Planter table base (collide: true, strictly disjoint at x=±5.8)
        k.box({ size: [3.2, 0.82, 1.5], pos: [tx, 0.41, tz], mat: 'wood_light', collide: true });
        k.box({ size: [3.36, 0.12, 1.66], pos: [tx, 0.86, tz], mat: 'wood_dark' });
        k.box({ size: [3.0, 0.06, 1.3], pos: [tx, 0.93, tz], mat: 'plant' });
        // Clearly labelled "SYNTHETIC COHORT" badge plate on the inward-facing side
        const badgeX = tx < 0 ? tx + 1.69 : tx - 1.69;
        k.box({ size: [0.04, 0.24, 1.1], pos: [badgeX, 0.65, tz], mat: 'accent' });

        // 6 miniature persona figures (2 rows x 3 cols) on stands per table
        for (let r = 0; r < 2; r++) {
          for (let c = 0; c < 3; c++) {
            const fx = tx - 0.9 + c * 0.9;
            const fz = tz - 0.32 + r * 0.64;
            k.cylinder({ radiusTop: 0.12, radiusBottom: 0.14, height: 0.06, pos: [fx, 0.98, fz], mat: 'metal_dark' });
            k.cylinder({ radiusTop: 0.085, radiusBottom: 0.1, height: 0.3, pos: [fx, 1.16, fz], mat: seg.mat });
            k.sphere({ radius: 0.08, pos: [fx, 1.39, fz], mat: 'plaster_warm' });
          }
        }

        // Hanging botanical grow-lamp suspended over each persona table
        k.cylinder({ radiusTop: 0.02, radiusBottom: 0.02, height: 1.1, pos: [tx, 3.6, tz], mat: 'metal_dark' });
        k.cone({ radius: 0.45, height: 0.28, pos: [tx, 2.95, tz], mat: 'metal_light' });
        k.sphere({ radius: 0.12, pos: [tx, 2.82, tz], mat: 'window_glow' });
      }
    });

    // Lead control desk at north end + data screens on easels + potted plants everywhere
    k.group('control_and_easels', () => {
      k.prop({ kind: 'desk', pos: [0, 0, -4.6], rotY: 0, collide: true });
      k.prop({ kind: 'chair', pos: [0, 0, -5.5], rotY: 0 });
      k.prop({ kind: 'screen_stand', pos: [-0.35, 0.75, -4.65], rotY: 0.15 });
      k.prop({ kind: 'screen_stand', pos: [0.35, 0.75, -4.65], rotY: -0.15 });
      k.prop({ kind: 'mug', pos: [0, 0.75, -4.4] });

      // Data screens mounted on easels flanking the north control zone
      k.prop({ kind: 'easel', pos: [-2.8, 0, -5.2], rotY: 0.35 });
      k.box({ size: [0.85, 0.62, 0.06], pos: [-2.8, 1.25, -5.12], rotY: 0.35, mat: 'screen' });

      k.prop({ kind: 'easel', pos: [2.8, 0, -5.2], rotY: -0.35 });
      k.box({ size: [0.85, 0.62, 0.06], pos: [2.8, 1.25, -5.12], rotY: -0.35, mat: 'screen' });

      // Lush potted greenery around the perimeter
      k.prop({ kind: 'plant_tall', pos: [-8.0, 0, -5.8] });
      k.prop({ kind: 'plant_tall', pos: [8.0, 0, -5.8] });
      k.prop({ kind: 'plant_tall', pos: [-8.0, 0, -1.1] });
      k.prop({ kind: 'plant_tall', pos: [8.0, 0, -1.1] });
      k.prop({ kind: 'plant_tall', pos: [-8.0, 0, 4.8] });
      k.prop({ kind: 'plant_tall', pos: [8.0, 0, 4.8] });
      k.prop({ kind: 'plant_small', pos: [-4.2, 0, -5.8] });
      k.prop({ kind: 'plant_small', pos: [4.2, 0, -5.8] });
    });

    // Interior lights (<= 3)
    k.light({ kind: 'point', pos: [0, 3.6, -2.0], color: '#EEFFF0', intensity: 1.4, distance: 13 });
    k.light({ kind: 'point', pos: [-5.8, 2.6, -1.0], color: '#FFF0C8', intensity: 1.1, distance: 10 });
    k.light({ kind: 'point', pos: [5.8, 2.6, -1.0], color: '#FFF0C8', intensity: 1.1, distance: 10 });

    // 6 NPC slots along the wide central walkway (x ∈ [-2.4, 2.4] is completely clear of tables at x=±5.8)
    k.npcSlot({ id: 's1', pos: [0, 0, -2.8], facingY: 0 });
    k.npcSlot({ id: 's2', pos: [-2.4, 0, -2.2], facingY: 0 });
    k.npcSlot({ id: 's3', pos: [2.4, 0, -2.2], facingY: 0 });
    k.npcSlot({ id: 's4', pos: [-2.4, 0, 1.2], facingY: 0 });
    k.npcSlot({ id: 's5', pos: [2.4, 0, 1.2], facingY: 0 });
    k.npcSlot({ id: 's6', pos: [0, 0, 2.6], facingY: 0 });
  },
};

export default syntheticPopulationBuilding;
