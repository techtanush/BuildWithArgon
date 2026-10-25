// OWNER: mahin
import type {
  BuildingModule,
  KitApi,
  MaterialKey,
  PropKind,
  Vec3,
} from "../../kit/types";
export const DEPARTMENTS = [
  "intake",
  "office-hours",
  "market-research",
  "outreach",
  "synthetic-population",
  "pivot",
  "engineering",
  "growth",
  "lead-intel",
  "sales",
  "finance-people",
  "support",
  "chief-of-staff",
] as const;
export const BUILDING_NAMES = [
  "The Arrivals Hall",
  "The Clocktower",
  "The Observatory",
  "The Telegraph House",
  "The Greenhouse",
  "The Rotunda",
  "The Foundry Works",
  "The Lighthouse",
  "The Archive",
  "The Market Hall",
  "The Bank & Guild",
  "The Harbor House",
  "Town Hall",
];
export const SLOT_POSITIONS: Vec3[] = [
  [-2.5, 0, -2],
  [2.5, 0, -2],
  [-6, 0, 1],
  [6, 0, 1],
  [-6, 0, -4.5],
  [6, 0, -4.5],
];
const signature: PropKind[] = [
  "counter",
  "clock",
  "telescope",
  "mailbox",
  "plant_tall",
  "table_round",
  "server_rack",
  "barrel",
  "bookshelf",
  "counter",
  "vault_door",
  "whiteboard",
  "table_long",
];
export function fallbackModule(departmentId: string): BuildingModule {
  const index = Math.max(
    0,
    DEPARTMENTS.indexOf(departmentId as (typeof DEPARTMENTS)[number]),
  );
  return {
    id: departmentId,
    interiorShell: {
      floor: "wood_floor",
      walls: index % 2 ? "plaster_warm" : "plaster_wall",
    },
    buildExterior(k) {
      const wall: MaterialKey =
        index === 1 || index === 6
          ? "brick"
          : index === 4
            ? "metal_light"
            : "stucco";
      const height = index === 1 ? 7 : index === 12 ? 9 : 7.2;
      // Split front wall and a recessed door: entrance approach stays unobstructed.
      k.box({
        size: [18, height, 12],
        pos: [0, height / 2, -2],
        mat: wall,
        collide: true,
      });
      for (const x of [-5.3, 5.3])
        k.box({
          size: [7.4, height, 2],
          pos: [x, height / 2, 5],
          mat: wall,
          collide: true,
        });
      k.box({
        size: [3.2, height - 3, 2],
        pos: [0, 3 + (height - 3) / 2, 5],
        mat: wall,
      });
      for (const y of [0.22, height - 0.25])
        k.box({
          size: [18.5, 0.25, 14.4],
          pos: [0, y, -1],
          mat: y < 1 ? "plaza_stone" : "trim",
        });
      k.box({
        size: [18.8, 0.22, 14.7],
        pos: [0, height + 0.05, -1],
        mat: "roof",
      });
      // Real facade depth: recessed glazing, dark frames, projecting sills and mullions.
      for (const x of [-6.8, -3.5, 3.5, 6.8]) {
        k.box({
          size: [2.1, 2.2, 0.08],
          pos: [x, 3.25, 6.02],
          mat: "window_glow",
        });
        k.box({ size: [1.98, 2.08, 0.03], pos: [x, 3.25, 6.08], mat: "glass" });
        for (const dx of [-1.1, 0, 1.1])
          k.box({
            size: [0.07, 2.35, 0.16],
            pos: [x + dx, 3.25, 6.15],
            mat: "metal_dark",
          });
        for (const y of [2.08, 4.42])
          k.box({ size: [2.35, 0.09, 0.22], pos: [x, y, 6.15], mat: "trim" });
        k.box({ size: [2.5, 0.12, 0.4], pos: [x, 1.99, 6.2], mat: "trim" });
      }
      k.box({ size: [3.7, 0.18, 1.8], pos: [0, 3.15, 6.5], mat: "accent" });
      for (const x of [-9.1, 9.1])
        k.cylinder({
          radiusTop: 0.045,
          radiusBottom: 0.045,
          height: height - 0.3,
          pos: [x, height / 2, 5.9],
          mat: "metal_dark",
        });
      k.entrance({ z: 6.1 });
      k.sign({ pos: [0, 5.3, 6.28], width: 6.4 });
      const tower = index === 1 || index === 7 || index === 12,
        round = index === 2 || index === 5;
      if (tower) {
        if (index === 7) {
          k.cylinder({
            radiusTop: 2.1,
            radiusBottom: 2.7,
            height: 16,
            pos: [-5, 8, -2],
            mat: "stucco",
          });
          k.cylinder({
            radiusTop: 2.3,
            radiusBottom: 2.3,
            height: 1.2,
            pos: [-5, 13, -2],
            mat: "accent",
          });
          k.cylinder({
            radiusTop: 2.1,
            radiusBottom: 2.1,
            height: 2,
            pos: [-5, 17, -2],
            mat: "glass",
          });
          k.cone({ radius: 2.8, height: 2, pos: [-5, 19, -2], mat: "roof" });
        } else {
          k.box({
            size: [5, 9, 5],
            pos: [0, height + 4.5, -2],
            mat: wall,
            collide: true,
          });
          k.prop({ kind: "clock", pos: [0, height + 5, 0.55], scale: 4 });
          k.cone({
            radius: 4,
            height: 3,
            pos: [0, height + 10.5, -2],
            segments: 4,
            rotY: Math.PI / 4,
            mat: "roof",
          });
        }
      } else if (round) {
        k.sphere({
          radius: 7,
          pos: [0, height, -1],
          scale: [1, 0.52, 1],
          mat: index === 2 ? "metal_light" : "roof",
        });
        if (index === 2)
          k.prop({ kind: "telescope", pos: [0, height + 3, -1], scale: 1.5 });
        if (index === 5)
          for (const x of [-7.8, -4, 4, 7.8])
            k.cylinder({
              radiusTop: 0.24,
              radiusBottom: 0.34,
              height: height,
              pos: [x, height / 2, 6.6],
              mat: "trim",
            });
      } else if (index === 4) {
        for (const x of [-6, -3, 0, 3, 6]) {
          k.box({
            size: [0.1, 3, 12],
            pos: [x, height + 1.5, -1],
            mat: "metal_light",
          });
          k.box({
            size: [2.8, 2.8, 0.05],
            pos: [x, height + 1.5, 5.2],
            mat: "glass",
          });
        }
        k.box({ size: [18, 0.15, 13], pos: [0, height + 3, -1], mat: "glass" });
      } else if (index === 6) {
        for (const x of [-6, 0, 6])
          k.cone({
            radius: 4.3,
            height: 2.5,
            segments: 4,
            rotY: Math.PI / 4,
            pos: [x, height + 1.2, -1],
            mat: "roof",
          });
        k.cylinder({
          radiusTop: 0.6,
          radiusBottom: 0.8,
          height: 13,
          pos: [7, 6.5, -5],
          mat: "brick",
        });
      } else {
        k.cone({
          radius: 11,
          height: index === 9 ? 3 : 4,
          segments: 4,
          rotY: Math.PI / 4,
          pos: [0, height + 1.5, -1],
          mat: index === 3 ? "roof_red" : "roof",
        });
        if (index === 10 || index === 12)
          for (const x of [-7, -4, 4, 7])
            k.cylinder({
              radiusTop: 0.25,
              radiusBottom: 0.35,
              height: 5.8,
              pos: [x, 2.9, 6.8],
              mat: "trim",
            });
      }
      if (index === 11) {
        k.torus({ radius: 0.5, tube: 0.1, pos: [6, 5, 6.25], mat: "accent" });
        for (let j = 0; j < 10; j++)
          k.box({
            size: [18, 0.08, 0.24],
            pos: [0, 0.06, 7 + j * 0.28],
            mat: "wood_dark",
          });
      }
      if (index === 3) {
        k.cylinder({
          radiusTop: 0.08,
          radiusBottom: 0.12,
          height: 11,
          pos: [10, 5.5, -2],
          mat: "wood_dark",
        });
        k.tube({
          points: [
            [10, 10, -2],
            [9, 8, 2],
            [8, 7, 5],
          ],
          radius: 0.018,
          mat: "cable",
        });
      }
      for (const x of [-6.5, 6.5]) {
        k.prop({ kind: "flowerbed", pos: [x, 0, 9], collide: true });
        k.prop({
          kind: "plant_tall",
          pos: [x < 0 ? -10 : 10, 0, 5],
          collide: true,
        });
      }
      k.light({
        kind: "point",
        pos: [0, 3.4, 7],
        color: "#ffe6c7",
        intensity: 12,
        distance: 9,
      });
    },
    buildInterior(k) {
      k.window({ wall: "north", center: -4, width: 3, height: 1.8, sill: 1.2 });
      k.window({ wall: "north", center: 4, width: 3, height: 1.8, sill: 1.2 });
      k.window({ wall: "east", center: 1, width: 2.8, height: 1.8, sill: 1.2 });
      k.plane({
        size: [7, 5],
        pos: [0, 0.012, 1.4],
        rot: [-Math.PI / 2, 0, 0],
        mat: index === 5 ? "fabric_lavender" : "fabric_cream",
      });
      for (const x of [-7.9, 7.9]) {
        k.prop({
          kind: "bookshelf",
          pos: [x, 0, -2],
          rotY: x < 0 ? Math.PI / 2 : -Math.PI / 2,
          collide: true,
        });
        k.prop({ kind: "plant_tall", pos: [x, 0, 5.4], collide: true });
      }
      for (const x of [-3.2, 3.2]) {
        k.prop({ kind: "desk", pos: [x, 0, -5.4], collide: true });
        k.prop({ kind: "screen_stand", pos: [x, 0.75, -5.6] });
        k.prop({ kind: "mug", pos: [x + 0.45, 0.75, -5.2] });
        k.prop({ kind: "books", pos: [x - 0.4, 0.75, -5.3] });
        k.prop({ kind: "chair", pos: [x, 0, -4.4], collide: true });
      }
      k.prop({ kind: signature[index], pos: [0, 0, -5.2], collide: true });
      if (index === 6)
        for (const x of [-1, 1])
          k.prop({ kind: "server_rack", pos: [x, 0, -6.3], collide: true });
      if (index === 12) {
        k.prop({ kind: "table_long", pos: [0, 0, 1.2], collide: true });
        for (const x of [-1, 1])
          for (const z of [0.1, 2.3])
            k.prop({ kind: "chair", pos: [x, 0, z], collide: true });
      } else {
        k.prop({
          kind: "sofa",
          pos: [-3, 0, 4.4],
          rotY: Math.PI,
          collide: true,
        });
        k.prop({
          kind: "armchair",
          pos: [3.5, 0, 4.5],
          rotY: -0.4,
          collide: true,
        });
        k.prop({ kind: "table_round", pos: [-3, 0, 2.8], collide: true });
      }
      k.prop({ kind: "lamp_floor", pos: [-7.8, 0, 3.7], collide: true });
      k.prop({ kind: "whiteboard", pos: [0, 0, -6.75] });
      k.light({
        kind: "point",
        pos: [0, 3.7, 0],
        color: "#ffe3bf",
        intensity: 35,
        distance: 18,
      });
      k.light({
        kind: "point",
        pos: [-6, 3.1, 3],
        color: "#ffe8cd",
        intensity: 14,
        distance: 10,
      });
      SLOT_POSITIONS.forEach((pos, i) =>
        k.npcSlot({ id: `s${i + 1}` as "s1", pos: [...pos], facingY: 0 }),
      );
    },
  };
}
