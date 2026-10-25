import type { BuildingModule, KitApi } from '../../kit/types';

const pivotBuilding: BuildingModule = {
  id: 'pivot',
  interiorShell: { floor: 'wood_floor', walls: 'plaster_warm' },

  buildExterior(k: KitApi) {
    // Disjoint colliders for the classical rotunda
    k.group('colliders', () => {
      k.box({ size: [11.6, 8.5, 11.2], pos: [0, 4.25, -1.2], mat: 'plaster_warm', collide: true, name: 'rotunda_core' });
      k.box({ size: [3.8, 7.5, 2.8], pos: [-4.6, 3.75, 5.8], mat: 'plaster_warm', collide: true, name: 'rotunda_west' });
      k.box({ size: [3.8, 7.5, 2.8], pos: [4.6, 3.75, 5.8], mat: 'plaster_warm', collide: true, name: 'rotunda_east' });
    });

    // Classical small rotunda: stepped stylobate, ring of 8 columns around a round hall, shallow dome
    k.group('rotunda_architecture', () => {
      // 3-stepped circular stone stylobate
      k.cylinder({
        radiusTop: 10.6,
        radiusBottom: 10.8,
        height: 0.45,
        pos: [0, 0.225, -0.6],
        mat: 'plaza_stone',
        segments: 32,
      });
      k.cylinder({
        radiusTop: 10.1,
        radiusBottom: 10.3,
        height: 0.45,
        pos: [0, 0.675, -0.6],
        mat: 'plaza_stone',
        segments: 32,
      });
      k.cylinder({
        radiusTop: 9.6,
        radiusBottom: 9.8,
        height: 0.45,
        pos: [0, 1.125, -0.6],
        mat: 'trim',
        segments: 32,
      });

      // Inner cylindrical cella (round hall)
      k.cylinder({
        radiusTop: 7.4,
        radiusBottom: 7.4,
        height: 7.4,
        pos: [0, 5.05, -0.6],
        mat: 'plaster_warm',
        segments: 32,
      });

      // Ring of 8 monumental classical columns around the round hall + purple (`accent`) banners
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const cx = Math.sin(angle) * 8.85;
        const cz = -0.6 + Math.cos(angle) * 8.85;
        // Column base
        k.box({ size: [1.15, 0.45, 1.15], pos: [cx, 1.57, cz], rotY: angle, mat: 'plaza_stone' });
        // Column shaft
        k.cylinder({
          radiusTop: 0.42,
          radiusBottom: 0.5,
          height: 6.4,
          pos: [cx, 5.0, cz],
          mat: 'trim',
          segments: 20,
        });
        // Column capital
        k.box({ size: [1.2, 0.5, 1.2], pos: [cx, 8.45, cz], rotY: angle, mat: 'trim' });

        // Vertical purple (`accent`) banner suspended inside each intercolumniation
        const bannerAngle = angle + Math.PI / 8;
        const bx = Math.sin(bannerAngle) * 8.15;
        const bz = -0.6 + Math.cos(bannerAngle) * 8.15;
        if (Math.abs(bx) > 2.2 || bz < 4.0) {
          k.box({ size: [1.1, 4.2, 0.1], pos: [bx, 5.3, bz], rotY: bannerAngle, mat: 'accent' });
          k.box({ size: [1.25, 0.14, 0.14], pos: [bx, 7.45, bz], rotY: bannerAngle, mat: 'metal_dark' });
        }
      }

      // Classical entablature ring, purple frieze, and shallow stepped dome
      k.cylinder({
        radiusTop: 9.5,
        radiusBottom: 9.3,
        height: 0.75,
        pos: [0, 9.05, -0.6],
        mat: 'trim',
        segments: 32,
      });
      k.cylinder({
        radiusTop: 9.4,
        radiusBottom: 9.4,
        height: 0.55,
        pos: [0, 9.7, -0.6],
        mat: 'accent',
        segments: 32,
      });
      k.cylinder({
        radiusTop: 9.8,
        radiusBottom: 9.5,
        height: 0.45,
        pos: [0, 10.2, -0.6],
        mat: 'trim',
        segments: 32,
      });

      // Shallow classical dome + oculus lantern
      k.sphere({
        radius: 8.6,
        pos: [0, 9.4, -0.6],
        scale: [1, 0.52, 1],
        mat: 'roof',
        name: 'shallow_dome',
      });
      k.cylinder({
        radiusTop: 1.8,
        radiusBottom: 2.0,
        height: 1.4,
        pos: [0, 14.1, -0.6],
        mat: 'window_glow',
        segments: 24,
      });
      k.cone({ radius: 2.2, height: 1.4, pos: [0, 15.5, -0.6], mat: 'accent', segments: 24 });
    });

    // Front portico, glowing windows, steps, entrance, and sign
    k.group('front_portico', () => {
      // Front face of the rotunda extending to z = 7.6
      k.box({ size: [6.4, 6.8, 1.8], pos: [0, 4.75, 6.7], mat: 'plaster_warm' });
      // 4 glowing tall windows on the front face
      for (const wx of [-2.4, -1.45, 1.45, 2.4]) {
        k.box({ size: [0.75, 3.2, 0.18], pos: [wx, 4.6, 7.62], mat: 'window_glow' });
        k.box({ size: [0.9, 3.4, 0.14], pos: [wx, 4.6, 7.58], mat: 'trim' });
      }
      // Steps up to the door (no collider so P3 ring is clear)
      k.box({ size: [5.4, 0.45, 2.6], pos: [0, 0.225, 8.2], mat: 'plaza_stone' });
      k.box({ size: [4.6, 0.45, 1.8], pos: [0, 0.675, 7.8], mat: 'plaza_stone' });

      k.entrance({ z: 7.6 });
      k.sign({ pos: [0, 5.1, 7.85], rotY: 0, width: 6.4 });
    });

    // Landscaping around the forecourt
    k.group('landscaping', () => {
      k.prop({ kind: 'flowerbed', pos: [-5.4, 0, 9.2] });
      k.prop({ kind: 'flowerbed', pos: [5.4, 0, 9.2] });
      k.prop({ kind: 'bench', pos: [-7.5, 0, 8.2], rotY: 0.4, collide: true });
      k.prop({ kind: 'bench', pos: [7.5, 0, 8.2], rotY: -0.4, collide: true });
    });

    k.light({ kind: 'point', pos: [0, 4.2, 8.2], color: '#F0E2FF', intensity: 1.3, distance: 10 });
  },

  buildInterior(k: KitApi) {
    // Tall classical windows on north, east, and west walls
    k.window({ wall: 'north', center: 0, width: 3.2, height: 2.0, sill: 0.9 });
    k.window({ wall: 'east', center: 0, width: 2.8, height: 2.0, sill: 0.9 });
    k.window({ wall: 'west', center: 0, width: 2.8, height: 2.0, sill: 0.9 });

    // Classical pilasters around the room perimeter to give a round rotunda feel
    k.group('rotunda_pilasters', () => {
      for (const px of [-8.6, -4.5, 4.5, 8.6]) {
        k.box({ size: [0.45, 4.1, 0.35], pos: [px, 2.05, -6.8], mat: 'trim' });
      }
      for (const pz of [-4.5, 3.5]) {
        k.box({ size: [0.35, 4.1, 0.45], pos: [-8.8, 2.05, pz], mat: 'trim' });
        k.box({ size: [0.35, 4.1, 0.45], pos: [8.8, 2.05, pz], mat: 'trim' });
      }
    });

    // Circular purple rug (`fabric_lavender` & `accent`) under the decision table
    k.group('purple_decision_rug', () => {
      k.cylinder({
        radiusTop: 3.6,
        radiusBottom: 3.6,
        height: 0.02,
        pos: [0, 0.01, -0.8],
        mat: 'accent',
        segments: 32,
      });
      k.cylinder({
        radiusTop: 3.25,
        radiusBottom: 3.25,
        height: 0.026,
        pos: [0, 0.013, -0.8],
        mat: 'fabric_lavender',
        segments: 32,
      });
    });

    // Big round council table in the center with 6 chairs + prominent Scales of Decision prop
    k.group('decision_table_and_scales', () => {
      // Central round council table (`collide: true` on core cylinder r=1.25 at [0, 0, -0.8])
      k.cylinder({
        radiusTop: 1.35,
        radiusBottom: 1.35,
        height: 0.08,
        pos: [0, 0.72, -0.8],
        mat: 'wood_dark',
        collide: true,
        segments: 24,
      });
      k.cylinder({
        radiusTop: 0.45,
        radiusBottom: 0.65,
        height: 0.68,
        pos: [0, 0.34, -0.8],
        mat: 'wood_dark',
        segments: 20,
      });

      // 6 chairs arranged in a ring around the decision table (collide: false default)
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const cx = Math.sin(angle) * 1.85;
        const cz = -0.8 + Math.cos(angle) * 1.85;
        k.prop({ kind: 'chair', pos: [cx, 0, cz], rotY: angle + Math.PI });
        // Dossier paper in front of each seat
        k.plane({
          size: [0.3, 0.22],
          pos: [Math.sin(angle) * 1.0, 0.765, -0.8 + Math.cos(angle) * 1.0],
          rot: [-Math.PI / 2, 0, -angle],
          mat: 'paper',
        });
      }

      // Prominent Scales of Decision centerpiece on the center of the round table (y = 0.76)
      // Tiered base & central brass pillar
      k.cylinder({ radiusTop: 0.22, radiusBottom: 0.26, height: 0.08, pos: [0, 0.8, -0.8], mat: 'metal_dark' });
      k.cylinder({ radiusTop: 0.04, radiusBottom: 0.055, height: 0.68, pos: [0, 1.18, -0.8], mat: 'accent' });
      k.sphere({ radius: 0.07, pos: [0, 1.54, -0.8], mat: 'metal_light' });
      // Balance beam (tilted slightly to show weighing evidence)
      k.box({ size: [0.92, 0.04, 0.04], pos: [0, 1.5, -0.8], rotY: 0, mat: 'metal_light' });
      // Left and right weighing pans suspended by chains
      for (const side of [-1, 1]) {
        const px = side * 0.42;
        const py = side === -1 ? 1.16 : 1.22;
        k.tube({
          points: [
            [px, 1.5, -0.8],
            [px - 0.1, py, -0.8],
          ],
          radius: 0.008,
          mat: 'metal_light',
        });
        k.tube({
          points: [
            [px, 1.5, -0.8],
            [px + 0.1, py, -0.8],
          ],
          radius: 0.008,
          mat: 'metal_light',
        });
        k.cylinder({ radiusTop: 0.16, radiusBottom: 0.12, height: 0.04, pos: [px, py, -0.8], mat: 'accent' });
        // Evidence weights on the pans
        k.box({
          size: [0.1, 0.08, 0.1],
          pos: [px, py + 0.05, -0.8],
          mat: side === -1 ? 'fabric_coral' : 'fabric_blue',
        });
      }
    });

    // Evidence boards on easels & perimeter reference shelves
    k.group('evidence_boards', () => {
      // Three evidence easels ("Proceed", "Revise", "Kill" evidence boards)
      const easelPositions: [number, number, number, 'fabric_blue' | 'accent' | 'fabric_coral'][] = [
        [-4.8, -4.8, 0.45, 'fabric_blue'],
        [0, -5.4, 0, 'accent'],
        [4.8, -4.8, -0.45, 'fabric_coral'],
      ];
      for (const [ex, ez, rotY, badgeMat] of easelPositions) {
        k.prop({ kind: 'easel', pos: [ex, 0, ez], rotY });
        k.box({ size: [0.6, 0.14, 0.04], pos: [ex, 1.55, ez + 0.05], rotY, mat: badgeMat });
      }

      // Perimeter desks & bookshelves
      k.prop({ kind: 'desk', pos: [-6.8, 0, -2.0], rotY: Math.PI / 2, collide: true });
      k.prop({ kind: 'books', pos: [-6.75, 0.75, -1.8], rotY: 0.2 });
      k.prop({ kind: 'lamp_desk', pos: [-6.75, 0.75, -2.3] });

      k.prop({ kind: 'desk', pos: [6.8, 0, -2.0], rotY: -Math.PI / 2, collide: true });
      k.prop({ kind: 'screen_stand', pos: [6.75, 0.75, -2.0], rotY: -Math.PI / 2 });

      k.prop({ kind: 'bookshelf', pos: [-8.3, 0, 2.2], rotY: Math.PI / 2, collide: true });
      k.prop({ kind: 'bookshelf', pos: [8.3, 0, 2.2], rotY: -Math.PI / 2, collide: true });
      k.prop({ kind: 'plant_tall', pos: [-7.8, 0, -5.6] });
      k.prop({ kind: 'plant_tall', pos: [7.8, 0, -5.6] });
    });

    // Interior lights (<= 3)
    k.light({ kind: 'point', pos: [0, 3.6, -0.8], color: '#F3E5FF', intensity: 1.4, distance: 13 });
    k.light({ kind: 'point', pos: [-5.0, 3.2, -1.5], color: '#FFE3B8', intensity: 1.0, distance: 10 });
    k.light({ kind: 'point', pos: [5.0, 3.2, -1.5], color: '#FFE3B8', intensity: 1.0, distance: 10 });

    // 6 NPC slots surrounding the central decision table (all outside r=2.8 from (0, -0.8))
    // Keep the +Z approach 1.2m in front of s1 clear of the council table.
    k.npcSlot({ id: 's1', pos: [0, 0, -4.2], facingY: 0 });
    k.npcSlot({ id: 's2', pos: [-3.4, 0, -1.6], facingY: 0 });
    k.npcSlot({ id: 's3', pos: [3.4, 0, -1.6], facingY: 0 });
    k.npcSlot({ id: 's4', pos: [-3.4, 0, 1.6], facingY: 0 });
    k.npcSlot({ id: 's5', pos: [3.4, 0, 1.6], facingY: 0 });
    k.npcSlot({ id: 's6', pos: [0, 0, 2.2], facingY: 0 });
  },
};

export default pivotBuilding;
