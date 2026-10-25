import type { BuildingModule, KitApi } from '../../kit/types';

const salesBuilding: BuildingModule = {
  id: 'sales',
  interiorShell: { floor: 'wood_floor', walls: 'plaster_warm' },

  buildExterior(k: KitApi) {
    // Disjoint colliders for the enclosed back hall (leaving the open market colonnade & entrance at z=6.8 clear)
    k.group('colliders', () => {
      k.box({ size: [7.6, 7.5, 11.2], pos: [-6.4, 3.75, -1.6], mat: 'brick', collide: true, name: 'mkt_west_col' });
      k.box({ size: [7.6, 7.5, 11.2], pos: [6.4, 3.75, -1.6], mat: 'brick', collide: true, name: 'mkt_east_col' });
      k.box({ size: [4.6, 7.5, 10.0], pos: [0, 3.75, -2.2], mat: 'brick', collide: true, name: 'mkt_center_col' });
    });

    // Enclosed back showroom hall + big pitched market roof extending over the open front colonnade
    k.group('market_hall_structure', () => {
      // Stone market platform covering both the enclosed hall and open front arcade
      k.box({ size: [21.6, 0.35, 16.8], pos: [0, 0.175, 0.8], mat: 'plaza_stone', name: 'market_platform' });

      // Enclosed back hall (z = -7.2 to +4.2, with central entrance bay reaching z = 6.8)
      k.box({ size: [20.4, 7.2, 11.4], pos: [0, 3.8, -1.5], mat: 'plaster_warm', name: 'back_hall' });
      k.box({ size: [5.0, 7.2, 2.8], pos: [0, 3.8, 5.4], mat: 'plaster_warm', name: 'entrance_vestibule' });

      // Glowing display windows along the front wall of the enclosed hall
      for (const wx of [-7.8, -4.6, 4.6, 7.8]) {
        k.box({ size: [2.2, 3.2, 0.22], pos: [wx, 3.0, 4.22], mat: 'metal_dark' });
        k.box({ size: [1.95, 2.9, 0.26], pos: [wx, 3.0, 4.25], mat: 'window_glow' });
      }
      for (const wx of [-1.7, 1.7]) {
        k.box({ size: [0.85, 2.8, 0.22], pos: [wx, 3.0, 6.82], mat: 'window_glow' });
      }

      // Open-fronted market colonnade: dark cast-iron columns supporting the big pitched roof at z = 8.6
      for (const cx of [-9.8, -6.4, -3.2, 3.2, 6.4, 9.8]) {
        k.cylinder({ radiusTop: 0.22, radiusBottom: 0.26, height: 6.8, pos: [cx, 3.6, 8.6], mat: 'metal_dark' });
        k.box({ size: [0.65, 0.45, 0.65], pos: [cx, 0.5, 8.6], mat: 'plaza_stone' });
        // Arched metal spandrel brackets
        k.box({ size: [1.4, 0.35, 0.25], pos: [cx, 6.7, 8.6], mat: 'metal_dark' });
      }

      // Big pitched market hall roof + glazed clerestory monitor spanning the entire hall & front arcade
      k.box({ size: [21.6, 0.55, 16.6], pos: [0, 7.25, 0.8], mat: 'metal_dark', name: 'roof_truss_beam' });
      k.box({ size: [21.2, 1.3, 16.0], pos: [0, 8.1, 0.8], mat: 'roof_red', name: 'market_roof_lower' });
      k.box({ size: [18.4, 1.1, 13.6], pos: [0, 9.2, 0.8], mat: 'roof_red', name: 'market_roof_upper' });
      k.box({ size: [14.0, 1.2, 9.6], pos: [0, 10.3, 0.8], mat: 'window_glow', name: 'market_clerestory' });
      k.box({ size: [14.6, 0.45, 10.2], pos: [0, 11.1, 0.8], mat: 'accent', name: 'clerestory_cap' });
    });

    // Striped awnings in `accent` magenta & `fabric_cream` + market stalls (`counter`) under the roof
    k.group('awnings_and_stalls', () => {
      // Striped awnings across the front bays (`x = -9.6..-3.4`, `x = -2.8..2.8`, `x = 3.4..9.6`)
      const bayRanges: [number, number][] = [
        [-9.5, -3.5],
        [-2.6, 2.6],
        [3.5, 9.5],
      ];
      for (const [xStart, xEnd] of bayRanges) {
        const stripeWidth = 0.6;
        let idx = 0;
        for (let sx = xStart; sx <= xEnd; sx += stripeWidth) {
          k.roundedBox({
            size: [stripeWidth + 0.02, 0.28, 2.2],
            pos: [sx, 5.5, 9.2],
            radius: 0.05,
            mat: idx % 2 === 0 ? 'accent' : 'fabric_cream',
          });
          idx++;
        }
      }

      // Market stalls (`counter` with merchandise displays) under the open roof on left & right sides
      for (const sx of [-7.6, -4.8, 4.8, 7.6]) {
        k.prop({ kind: 'counter', pos: [sx, 0.35, 6.8], rotY: 0, collide: true });
        // Tiered product display boxes on each stall counter
        k.roundedBox({ size: [0.55, 0.24, 0.35], pos: [sx - 0.45, 1.52, 6.8], radius: 0.04, mat: 'accent' });
        k.roundedBox({ size: [0.55, 0.24, 0.35], pos: [sx + 0.45, 1.52, 6.8], radius: 0.04, mat: 'fabric_blue' });
        k.box({ size: [0.35, 0.14, 0.28], pos: [sx, 1.47, 6.85], mat: 'paper' });
      }

      // Central entrance into the enclosed showroom at z = 6.8 & unoccluded sign
      k.entrance({ z: 6.8 });
      k.sign({ pos: [0, 4.5, 9.8], rotY: 0, width: 6.4 });
    });

    k.light({ kind: 'point', pos: [0, 4.2, 8.2], color: '#FFE3EC', intensity: 1.4, distance: 11 });
  },

  buildInterior(k: KitApi) {
    // Bright showroom windows
    k.window({ wall: 'north', center: 0, width: 3.4, height: 1.9, sill: 1.0 });
    k.window({ wall: 'east', center: 0, width: 2.8, height: 1.9, sill: 1.0 });
    k.window({ wall: 'west', center: 1.5, width: 2.6, height: 1.9, sill: 1.0 });

    // Magenta-bordered showroom rug
    k.plane({ size: [6.4, 4.4], pos: [0, 0.01, -0.5], rot: [-Math.PI / 2, 0, 0], mat: 'accent' });
    k.plane({ size: [5.9, 3.9], pos: [0, 0.015, -0.5], rot: [-Math.PI / 2, 0, 0], mat: 'fabric_pink' });

    // Stage-like demo counter with a large presentation `screen` and deal bell on the counter
    k.group('demo_stage_counter', () => {
      // Raised stage platform at north center (collide: false so counter holds the single collider)
      k.roundedBox({ size: [4.8, 0.18, 2.4], pos: [0, 0.09, -4.8], radius: 0.05, mat: 'wood_dark' });
      k.box({ size: [4.85, 0.06, 2.45], pos: [0, 0.16, -4.8], mat: 'accent' });

      // Demo counter on the stage (`collide: true`)
      k.prop({ kind: 'counter', pos: [0, 0.18, -4.3], rotY: 0, collide: true });

      // Large pitch & pricing demo screen behind the counter + desk screen
      k.box({ size: [3.2, 1.7, 0.1], pos: [0, 2.4, -6.85], mat: 'metal_dark' });
      k.box({ size: [3.0, 1.5, 0.12], pos: [0, 2.4, -6.83], mat: 'screen' });
      k.prop({ kind: 'screen_stand', pos: [-0.45, 1.23, -4.35], rotY: 0.15 });

      // Golden "Deal Bell" on the counter (base + dome cone + top button sphere)
      k.cylinder({ radiusTop: 0.12, radiusBottom: 0.14, height: 0.04, pos: [0.55, 1.25, -4.2], mat: 'metal_dark' });
      k.cone({ radius: 0.11, height: 0.1, pos: [0.55, 1.32, -4.2], mat: 'accent' });
      k.sphere({ radius: 0.03, pos: [0.55, 1.38, -4.2], mat: 'metal_light' });

      // Pricing page copy sheets on counter
      k.box({ size: [0.3, 0.06, 0.22], pos: [0.05, 1.26, -4.18], rotY: 0.1, mat: 'paper' });
    });

    // Pipeline wall on the west wall: 5 columns of colored deal cards representing pipeline stages
    k.group('pipeline_wall', () => {
      k.box({ size: [0.1, 1.9, 4.2], pos: [-8.88, 2.1, -1.8], mat: 'wood_dark' });
      k.box({ size: [0.12, 1.76, 4.04], pos: [-8.86, 2.1, -1.8], mat: 'plaster_wall' });

      const stages: { z: number; headerMat: 'fabric_blue' | 'fabric_lavender' | 'fabric_coral' | 'accent'; count: number }[] = [
        { z: -3.4, headerMat: 'fabric_blue', count: 4 },
        { z: -2.6, headerMat: 'fabric_lavender', count: 4 },
        { z: -1.8, headerMat: 'fabric_coral', count: 3 },
        { z: -1.0, headerMat: 'accent', count: 3 },
        { z: -0.2, headerMat: 'accent', count: 2 },
      ];
      for (const st of stages) {
        // Column divider & stage header
        k.box({ size: [0.03, 0.18, 0.62], pos: [-8.78, 2.8, st.z], mat: st.headerMat });
        // Stack of deal cards in this stage column
        for (let c = 0; c < st.count; c++) {
          k.box({
            size: [0.03, 0.24, 0.56],
            pos: [-8.78, 2.42 - c * 0.32, st.z],
            mat: c === 0 ? st.headerMat : 'paper',
          });
        }
      }
    });

    // Customer lounge chairs & pitch desks on the east and south-west sides
    k.group('customer_lounge', () => {
      // Customer seating lounge on the east side
      k.prop({ kind: 'sofa', pos: [6.8, 0, -2.2], rotY: -Math.PI / 2, collide: true });
      k.prop({ kind: 'armchair', pos: [5.4, 0, -3.8], rotY: -0.6 });
      k.prop({ kind: 'armchair', pos: [5.4, 0, -0.6], rotY: -2.5 });
      k.prop({ kind: 'table_round', pos: [5.4, 0, -2.2], collide: true });
      k.prop({ kind: 'mug', pos: [5.3, 0.75, -2.1] });
      k.prop({ kind: 'books', pos: [5.55, 0.75, -2.3], rotY: 0.4 });

      // Sales rep desks
      k.prop({ kind: 'desk', pos: [-6.4, 0, -4.4], rotY: 0, collide: true });
      k.prop({ kind: 'chair', pos: [-6.4, 0, -3.5], rotY: Math.PI });
      k.prop({ kind: 'screen_stand', pos: [-6.4, 0.75, -4.45], rotY: 0 });

      k.prop({ kind: 'desk', pos: [6.4, 0, 2.4], rotY: 0, collide: true });
      k.prop({ kind: 'chair', pos: [6.4, 0, 3.3], rotY: Math.PI });
      k.prop({ kind: 'lamp_desk', pos: [6.85, 0.75, 2.35] });

      k.prop({ kind: 'plant_tall', pos: [-7.8, 0, 5.0] });
      k.prop({ kind: 'plant_tall', pos: [7.8, 0, 5.0] });
      k.prop({ kind: 'lamp_floor', pos: [7.8, 0, -5.6] });
    });

    // Warm interior lights (<= 3)
    k.light({ kind: 'point', pos: [0, 3.6, -2.2], color: '#FFE4EE', intensity: 1.4, distance: 13 });
    k.light({ kind: 'point', pos: [5.2, 3.2, -2.0], color: '#FFE3B8', intensity: 1.0, distance: 10 });
    k.light({ kind: 'point', pos: [-5.2, 3.2, -1.5], color: '#FFE3B8', intensity: 1.0, distance: 10 });

    // 6 NPC slots in the open showroom floor
    k.npcSlot({ id: 's1', pos: [0, 0, -2.4], facingY: 0 });
    k.npcSlot({ id: 's2', pos: [-3.4, 0, -2.2], facingY: 0 });
    k.npcSlot({ id: 's3', pos: [2.6, 0, -2.2], facingY: 0 });
    k.npcSlot({ id: 's4', pos: [-3.6, 0, 1.0], facingY: 0 });
    k.npcSlot({ id: 's5', pos: [2.6, 0, 1.0], facingY: 0 });
    k.npcSlot({ id: 's6', pos: [0, 0, 2.4], facingY: 0 });
  },
};

export default salesBuilding;
