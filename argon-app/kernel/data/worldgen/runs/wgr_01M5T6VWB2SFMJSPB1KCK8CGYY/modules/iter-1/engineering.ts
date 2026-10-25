import type { BuildingModule, KitApi } from '../../kit/types';

const engineeringBuilding: BuildingModule = {
  id: 'engineering',
  interiorShell: { floor: 'wood_floor', walls: 'plaster_wall' },

  buildExterior(k: KitApi) {
    // Disjoint colliders for the industrial workshop (leaving entrance at z=7.0 clear)
    k.group('colliders', () => {
      k.box({ size: [7.6, 8.0, 14.0], pos: [-6.4, 4.0, -0.2], mat: 'brick', collide: true, name: 'eng_west_col' });
      k.box({ size: [7.6, 8.0, 14.0], pos: [6.4, 4.0, -0.2], mat: 'brick', collide: true, name: 'eng_east_col' });
      k.box({ size: [4.6, 8.0, 11.4], pos: [0, 4.0, -1.5], mat: 'brick', collide: true, name: 'eng_center_col' });
    });

    // Industrial brick workshop with sawtooth roof (3 slanted roof boxes) and tall chimney
    k.group('workshop_body', () => {
      // Heavy concrete/stone industrial plinth
      k.box({ size: [21.2, 1.2, 14.6], pos: [0, 0.6, -0.2], mat: 'plaza_stone' });
      // Main brick workshop walls
      k.box({ size: [20.8, 7.2, 14.2], pos: [0, 4.8, -0.2], mat: 'brick', name: 'brick_walls' });

      // Structural dark-steel I-beam pilasters along the front facade
      for (const px of [-10.2, -6.8, -3.4, 3.4, 6.8, 10.2]) {
        k.box({ size: [0.45, 7.6, 0.45], pos: [px, 4.9, 6.92], mat: 'metal_dark' });
      }
      // Red-orange (`accent`) industrial cornice fascia band
      k.box({ size: [21.2, 0.55, 14.6], pos: [0, 8.55, -0.2], mat: 'accent', name: 'accent_fascia' });
      k.box({ size: [21.4, 0.28, 14.8], pos: [0, 8.95, -0.2], mat: 'metal_dark' });

      // Sawtooth roof: 3 slanted roof boxes across the depth of the workshop with clerestory skylights
      for (const sz of [-4.6, -0.2, 4.2]) {
        // Slanted roof deck (tilted via rotX)
        k.box({
          size: [20.4, 0.5, 4.4],
          pos: [0, 9.9, sz],
          rotY: 0,
          mat: 'roof',
        });
        // Stepped wedge profile to read strongly as a sawtooth ridge from every angle
        k.box({ size: [20.2, 0.9, 3.2], pos: [0, 9.6, sz - 0.5], mat: 'roof' });
        k.box({ size: [20.0, 1.5, 1.8], pos: [0, 10.1, sz - 1.1], mat: 'roof' });
        // North/front-facing sawtooth clerestory glazing strip
        k.box({ size: [19.6, 1.1, 0.3], pos: [0, 10.2, sz - 1.95], mat: 'window_glow' });
        k.box({ size: [20.2, 0.25, 0.45], pos: [0, 10.85, sz - 1.9], mat: 'accent' });
      }

      // Tall industrial brick & steel smokestack chimney on the rear-west side (rising to 22m)
      k.box({ size: [2.8, 3.6, 2.8], pos: [-8.2, 10.2, -5.2], mat: 'brick' });
      k.cylinder({
        radiusTop: 0.95,
        radiusBottom: 1.35,
        height: 11.5,
        pos: [-8.2, 17.5, -5.2],
        mat: 'brick',
        segments: 24,
        name: 'chimney_stack',
      });
      // Steel tension bands and red-orange crown on the chimney
      for (const cy of [15.0, 18.5, 21.8]) {
        k.cylinder({
          radiusTop: 1.12,
          radiusBottom: 1.12,
          height: 0.32,
          pos: [-8.2, cy, -5.2],
          mat: cy === 21.8 ? 'accent' : 'metal_dark',
        });
      }
      k.cylinder({ radiusTop: 1.18, radiusBottom: 1.05, height: 0.6, pos: [-8.2, 23.2, -5.2], mat: 'metal_dark' });
    });

    // Multi-pane factory steel-sash windows on the front face
    k.group('factory_windows', () => {
      for (const wx of [-8.5, -5.1, 5.1, 8.5]) {
        k.box({ size: [2.4, 3.8, 0.22], pos: [wx, 4.6, 6.92], mat: 'metal_dark' });
        k.box({ size: [2.1, 3.5, 0.26], pos: [wx, 4.6, 6.95], mat: 'window_glow' });
        // Grid of steel muntins
        for (const mx of [-0.5, 0.5]) {
          k.box({ size: [0.06, 3.5, 0.3], pos: [wx + mx, 4.6, 6.98], mat: 'metal_dark' });
        }
        for (const my of [3.6, 4.6, 5.6]) {
          k.box({ size: [2.1, 0.06, 0.3], pos: [wx, my, 6.98], mat: 'metal_dark' });
        }
        k.box({ size: [2.6, 0.2, 0.42], pos: [wx, 2.65, 7.05], mat: 'plaza_stone' });
      }
    });

    // Large industrial roll-up door assembly framing the entrance + overhead hoist beam
    k.group('rollup_door_entrance', () => {
      // Heavy steel portal frame
      k.box({ size: [5.4, 5.8, 0.6], pos: [0, 2.9, 7.0], mat: 'metal_dark' });
      // Partially raised corrugated roll-up shutter slats above the entrance opening
      k.cylinder({
        radiusTop: 0.42,
        radiusBottom: 0.42,
        height: 4.6,
        pos: [0, 5.2, 7.25],
        rotZ: Math.PI / 2,
        mat: 'metal_light',
      });
      for (let sy = 3.2; sy <= 4.8; sy += 0.28) {
        k.box({ size: [4.4, 0.22, 0.16], pos: [0, sy, 7.18], mat: sy % 0.56 < 0.28 ? 'metal_light' : 'accent' });
      }
      // Overhead steel I-beam gantry projecting over the loading apron
      k.box({ size: [0.35, 0.45, 2.6], pos: [0, 5.85, 7.9], mat: 'accent' });

      k.entrance({ z: 7.0 });
      k.sign({ pos: [0, 4.5, 7.45], rotY: 0, width: 6.4 });
    });

    // Crates and barrels outside on the loading apron (kept clear of the central door ring)
    k.group('yard_crates_and_barrels', () => {
      k.box({ size: [6.4, 0.1, 4.0], pos: [0, 0.05, 9.0], mat: 'plaza_stone' });
      // West loading stack
      k.prop({ kind: 'crate', pos: [-5.2, 0, 8.2], rotY: 0.15, collide: true });
      k.prop({ kind: 'crate', pos: [-4.4, 0, 8.3], rotY: -0.1, collide: true });
      k.prop({ kind: 'crate', pos: [-4.8, 0.6, 8.25], rotY: 0.4 });
      k.prop({ kind: 'barrel', pos: [-6.2, 0, 8.1], collide: true });
      // East loading stack
      k.prop({ kind: 'barrel', pos: [4.8, 0, 8.2], collide: true });
      k.prop({ kind: 'barrel', pos: [5.6, 0, 8.4], collide: true });
      k.prop({ kind: 'crate', pos: [6.5, 0, 8.2], rotY: -0.2, collide: true });
    });

    k.light({ kind: 'point', pos: [0, 4.0, 8.2], color: '#FFD9B0', intensity: 1.4, distance: 10 });
  },

  buildInterior(k: KitApi) {
    // Industrial windows on north, east, and west walls
    k.window({ wall: 'north', center: -3.2, width: 2.8, height: 1.9, sill: 1.0 });
    k.window({ wall: 'north', center: 3.2, width: 2.8, height: 1.9, sill: 1.0 });
    k.window({ wall: 'west', center: -1.0, width: 2.8, height: 1.9, sill: 1.0 });

    // Heavy-duty workshop floor mat & snaking floor cable runs (like the reference image)
    k.group('floor_mat_and_cables', () => {
      k.plane({ size: [6.4, 4.6], pos: [0, 0.01, -0.8], rot: [-Math.PI / 2, 0, 0], mat: 'metal_dark' });
      k.plane({ size: [6.0, 4.2], pos: [0, 0.015, -0.8], rot: [-Math.PI / 2, 0, 0], mat: 'fabric_coral_dark' });

      // Prominent rubberized cable runs snaking across the floor from server racks to workbenches
      k.tube({
        points: [
          [6.8, 0.025, -4.2],
          [4.2, 0.025, -4.4],
          [1.6, 0.025, -4.2],
          [0.2, 0.025, -4.5],
        ],
        radius: 0.025,
        mat: 'cable',
      });
      k.tube({
        points: [
          [6.8, 0.025, -2.2],
          [4.5, 0.025, -1.8],
          [2.0, 0.025, -0.4],
          [-2.5, 0.025, 0.2],
          [-5.8, 0.025, -1.2],
        ],
        radius: 0.024,
        mat: 'cable',
      });
      k.tube({
        points: [
          [-5.8, 0.022, -3.8],
          [-3.2, 0.022, -4.2],
          [-0.8, 0.022, -4.4],
        ],
        radius: 0.02,
        mat: 'accent',
      });
    });

    // Workbenches with monitors (`workbench`, `screen_stand`)
    k.group('workbenches', () => {
      // Lead engineering workbench at north center
      k.prop({ kind: 'workbench', pos: [0, 0, -4.6], rotY: 0, collide: true });
      k.prop({ kind: 'screen_stand', pos: [-0.45, 0.9, -4.65], rotY: 0.15 });
      k.prop({ kind: 'screen_stand', pos: [0.45, 0.9, -4.65], rotY: -0.15 });
      k.prop({ kind: 'lamp_desk', pos: [0.75, 0.9, -4.7] });
      k.prop({ kind: 'mug', pos: [-0.05, 0.9, -4.4] });

      // West workbench 1
      k.prop({ kind: 'workbench', pos: [-6.4, 0, -3.8], rotY: 0, collide: true });
      k.prop({ kind: 'screen_stand', pos: [-6.4, 0.9, -3.85], rotY: 0 });
      k.prop({ kind: 'books', pos: [-5.8, 0.9, -3.75], rotY: 0.2 });

      // West workbench 2
      k.prop({ kind: 'workbench', pos: [-6.4, 0, -0.8], rotY: 0, collide: true });
      k.prop({ kind: 'screen_stand', pos: [-6.6, 0.9, -0.85], rotY: 0.1 });
      k.prop({ kind: 'lamp_desk', pos: [-5.8, 0.9, -0.85] });
    });

    // Server rack row on the east wall with blinking/emissive LED dots (`sphere`)
    k.group('server_rack_row', () => {
      const rackZs = [-4.4, -3.0, -1.6, -0.2];
      for (const rz of rackZs) {
        k.prop({ kind: 'server_rack', pos: [7.6, 0, rz], rotY: -Math.PI / 2, collide: true });
        // Emissive LED status spheres along the front face of each rack
        for (const ly of [0.6, 1.0, 1.4, 1.75]) {
          k.sphere({
            radius: 0.025,
            pos: [7.08, ly, rz - 0.18],
            mat: ly === 1.4 ? 'accent' : 'window_glow',
          });
          k.sphere({
            radius: 0.022,
            pos: [7.08, ly, rz + 0.12],
            mat: 'window_glow',
          });
        }
      }
    });

    // 3D printer-ish gantry box on a heavy stand + architecture diagram whiteboard
    k.group('3d_printer_and_diagram', () => {
      // 3D printer station in the south-west corner (x = -6.6, z = 2.8)
      k.box({ size: [1.4, 0.85, 1.2], pos: [-6.6, 0.425, 2.8], mat: 'metal_dark', collide: true });
      // Enclosure frame & glass panels
      k.box({ size: [1.1, 1.05, 0.95], pos: [-6.6, 1.38, 2.8], mat: 'glass' });
      for (const px of [-7.12, -6.08]) {
        for (const pz of [2.35, 3.25]) {
          k.box({ size: [0.07, 1.1, 0.07], pos: [px, 1.38, pz], mat: 'metal_light' });
        }
      }
      k.box({ size: [1.18, 0.08, 1.02], pos: [-6.6, 1.92, 2.8], mat: 'accent' });
      // Heated print bed, X/Y gantry rails, extruder head, and half-printed prototype part
      k.box({ size: [0.75, 0.05, 0.65], pos: [-6.6, 1.02, 2.8], mat: 'metal_light' });
      k.cylinder({ radiusTop: 0.02, radiusBottom: 0.02, height: 0.95, pos: [-6.6, 1.55, 2.8], rotZ: Math.PI / 2, mat: 'metal_light' });
      k.box({ size: [0.16, 0.18, 0.16], pos: [-6.55, 1.52, 2.8], mat: 'accent_dark' });
      k.torus({ radius: 0.16, tube: 0.04, pos: [-6.6, 1.12, 2.8], rotX: Math.PI / 2, mat: 'accent' });

      // Whiteboard with system architecture diagram (boxes + connector tubes) at north-west
      k.prop({ kind: 'whiteboard', pos: [-3.4, 0, -6.1], rotY: 0.15 });
      k.box({ size: [0.32, 0.2, 0.03], pos: [-3.75, 1.45, -6.02], rotY: 0.15, mat: 'fabric_blue' });
      k.box({ size: [0.32, 0.2, 0.03], pos: [-3.1, 1.45, -6.12], rotY: 0.15, mat: 'accent' });
      k.box({ size: [0.36, 0.2, 0.03], pos: [-3.4, 1.1, -6.07], rotY: 0.15, mat: 'fabric_lavender' });

      k.prop({ kind: 'crate', pos: [7.6, 0, 3.6], rotY: 0.2 });
      k.prop({ kind: 'plant_tall', pos: [7.6, 0, 5.4] });
    });

    // Interior lights (<= 3)
    k.light({ kind: 'point', pos: [0, 3.6, -2.0], color: '#FFE3B8', intensity: 1.4, distance: 13 });
    k.light({ kind: 'point', pos: [-5.5, 3.2, -1.0], color: '#FFDAB0', intensity: 1.0, distance: 10 });
    k.light({ kind: 'point', pos: [5.5, 3.2, -2.0], color: '#D8ECFF', intensity: 1.1, distance: 10 });

    // 6 NPC slots in the open workshop floor
    k.npcSlot({ id: 's1', pos: [0, 0, -2.8], facingY: 0 });
    k.npcSlot({ id: 's2', pos: [-3.4, 0, -2.6], facingY: 0 });
    k.npcSlot({ id: 's3', pos: [3.6, 0, -2.6], facingY: 0 });
    k.npcSlot({ id: 's4', pos: [-3.4, 0, 0.6], facingY: 0 });
    k.npcSlot({ id: 's5', pos: [3.6, 0, 0.6], facingY: 0 });
    k.npcSlot({ id: 's6', pos: [0, 0, 2.2], facingY: 0 });
  },
};

export default engineeringBuilding;
