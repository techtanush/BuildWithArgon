// OWNER: frozen contract (change only via docs/contract-requests/<you>.md, applied in the merge session)
// Verbatim from architecture-files/05-world/09-worldgen-pipeline.md. Given to Argon as the KIT API.

export type Vec3 = [number, number, number];

export type MaterialKey =
  | 'wood_floor' | 'wood_dark' | 'wood_light' | 'plaster_wall' | 'plaster_warm' | 'trim'
  | 'brick' | 'stucco' | 'roof' | 'roof_red' | 'plaza_stone' | 'metal_dark' | 'metal_light'
  | 'glass' | 'window_glow' | 'screen' | 'paper' | 'fabric_lavender' | 'fabric_blue'
  | 'fabric_pink' | 'fabric_cream' | 'fabric_coral' | 'fabric_coral_dark' | 'cable' | 'plant'
  | 'pot' | 'accent' | 'accent_dark';

export type PropKind =
  | 'desk' | 'chair' | 'armchair' | 'sofa' | 'table_round' | 'table_long' | 'bookshelf'
  | 'plant_small' | 'plant_tall' | 'lamp_floor' | 'lamp_desk' | 'screen_stand' | 'whiteboard'
  | 'counter' | 'crate' | 'barrel' | 'bench' | 'telescope' | 'clock' | 'vault_door' | 'workbench'
  | 'server_rack' | 'flowerbed' | 'mailbox' | 'flag' | 'easel' | 'filing_cabinet' | 'mug' | 'books';

export interface BoxOpts {
  size: Vec3;                 // width (x), height (y), depth (z)
  pos: Vec3;                  // center of the box
  rotY?: number;              // radians
  mat: MaterialKey;
  collide?: boolean;          // default false
  castShadow?: boolean;       // default true
  name?: string;
}

export interface KitApi {
  /** Rectangular solid. */
  box(o: BoxOpts): void;
  /** Rectangular solid with rounded edges (radius ≤ 0.5·min(size)). */
  roundedBox(o: BoxOpts & { radius: number }): void;
  cylinder(o: { radiusTop: number; radiusBottom: number; height: number; pos: Vec3; rotY?: number;
                rotX?: number; rotZ?: number; mat: MaterialKey; collide?: boolean; segments?: number; name?: string }): void;
  sphere(o: { radius: number; pos: Vec3; scale?: Vec3; mat: MaterialKey; collide?: boolean; name?: string }): void;
  cone(o: { radius: number; height: number; pos: Vec3; rotY?: number; mat: MaterialKey; segments?: number; name?: string }): void;
  torus(o: { radius: number; tube: number; pos: Vec3; rotX?: number; rotY?: number; arc?: number; mat: MaterialKey; name?: string }): void;
  /** Smooth tube through points (cables, rails). */
  tube(o: { points: Vec3[]; radius: number; mat: MaterialKey; name?: string }): void;
  /** Flat panel; rot in radians [x, y, z]. No collider. */
  plane(o: { size: [number, number]; pos: Vec3; rot: Vec3; mat: MaterialKey; name?: string }): void;
  /** Prefab furniture/props from the kit library, sized for a 1.75 m person. */
  prop(o: { kind: PropKind; pos: Vec3; rotY?: number; scale?: number; mat?: MaterialKey; collide?: boolean }): void;
  /** Up to 3 per interior, 1 per exterior. No shadows. */
  light(o: { kind: 'point' | 'spot'; pos: Vec3; color: string; intensity: number; distance: number; target?: Vec3 }): void;
  /** EXTERIOR ONLY. Exactly once. Door on the front face (local +Z), centered at x = 0. */
  entrance(o: { z: number }): void;
  /** EXTERIOR ONLY. Exactly once. The building's name sign (4:1 aspect). */
  sign(o: { pos: Vec3; rotY?: number; width: number }): void;
  /** INTERIOR ONLY. Window cut into a wall (glowing panel + frame). Never on 'south'. */
  window(o: { wall: 'north' | 'east' | 'west'; center: number; width: number; height: number; sill: number }): void;
  /** INTERIOR ONLY. Exactly s1..s6. facingY: 0 faces +Z (toward the door). */
  npcSlot(o: { id: 's1' | 's2' | 's3' | 's4' | 's5' | 's6'; pos: Vec3; facingY: number }): void;
  /** Group subsequent calls for readability (no transform). */
  group(name: string, fn: () => void): void;

  readonly mode: 'exterior' | 'interior';
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number };
  readonly colors: { accent: string; accentDark: string };
  readonly rand: () => number;          // deterministic per building
}

export interface BuildingModule {
  id: string;                            // department id, e.g. 'engineering'
  interiorShell?: { floor?: MaterialKey; walls?: MaterialKey };
  buildExterior(k: KitApi): void;
  buildInterior(k: KitApi): void;
}
