import type { Manifest, ManifestNpc } from "../../shared/contracts";
import type { Collider } from "../player/Collision";
import { clearPosition, type Walkable, type WalkBounds } from "./activity";

export interface ExecutiveMeetingOptions { bounds?: WalkBounds }
export interface ExecutivePlacement { position: [number, number, number]; facingY: number; seated: false }
/** Original manifest records only, one actual lead per department, excluding the plaza concierge. */
export function departmentLeads(manifest: Manifest): ManifestNpc[] {
  const seen = new Set<string>();
  const leads: ManifestNpc[] = [];
  for (const building of manifest.buildings) {
    const lead = manifest.npcs.find(n => n.is_lead && n.agent_id !== manifest.plaza.concierge.agent_id && n.department_id === building.department_id && n.building_id === building.building_id && !seen.has(n.agent_id));
    if (lead && !leads.some(n => n.department_id === lead.department_id)) { seen.add(lead.agent_id); leads.push(lead); }
  }
  return leads;
}
export function isExecutiveBuilding(manifest: Manifest, buildingId?: string | null): boolean {
  return manifest.buildings.some(b => b.building_id === buildingId && b.department_id === "chief-of-staff");
}
/** Local presentation only. No global records, identities, or home building IDs are rewritten. */
export function executivePlacements(leads: readonly ManifestNpc[], colliders: readonly Collider[], options: ExecutiveMeetingOptions = {}, walkable?: Walkable): Map<string, ExecutivePlacement> {
  const bounds = options.bounds ?? { minX: -8.3, maxX: 8.3, minZ: -6.3, maxZ: 5.5 };
  const result = new Map<string, ExecutivePlacement>();
  const occupied: Collider[] = [...colliders];
  const candidates: [number, number][] = [];
  // Side aisles face the central meeting table, leaving the entrance and desk backs clear.
  for (const z of [-3.3, -1.8, -0.3, 1.2, 2.7, 4.2]) for (const x of [-4.6, 4.6]) candidates.push([x, z]);
  candidates.push([0, -2.8]);
  for (let z = bounds.minZ + 0.5; z <= bounds.maxZ - 0.5; z += 1.1)
    for (let x = bounds.minX + 0.5; x <= bounds.maxX - 0.5; x += 1.1) candidates.push([x, z]);
  for (const npc of leads) {
    if (result.has(npc.agent_id)) continue;
    const point = candidates.find(([x, z]) => clearPosition(x, z, 0.4, occupied, bounds, walkable));
    if (!point) continue; // Fail closed if the supplied room genuinely has no space.
    const [x, z] = point;
    result.set(npc.agent_id, { position: [x, 0, z], facingY: Math.atan2(-x, 1.2 - z), seated: false });
    occupied.push({ kind: "circle", x, z, r: 0.48 });
  }
  return result;
}
