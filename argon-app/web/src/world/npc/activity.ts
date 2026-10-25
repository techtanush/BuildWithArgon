import { resolveCircle, type Collider } from "../player/Collision";

export type WorkPose = "typing" | "reviewing" | "presenting";
/** A snapshot of actual backend state, never a timer-generated work claim. */
export interface ActualNpcActivity {
  status: string;
  current_ticket_id?: string | null;
  active_run_id?: string | null;
  run_status?: string | null;
  ticket_status?: string | null;
  pose?: WorkPose;
}
export type ActualStatusMap = ReadonlyMap<string, ActualNpcActivity> | Readonly<Record<string, ActualNpcActivity | undefined>>;
export interface NpcActivity {
  status: "idle" | "working" | "blocked" | "offline";
  pose: "idle" | WorkPose;
  ticketId: string | null;
  runId: string | null;
}
export function activityFromActual(actual?: ActualNpcActivity): NpcActivity {
  const idle: NpcActivity = { status: "idle", pose: "idle", ticketId: null, runId: null };
  if (!actual) return idle;
  const status = actual.status.toLowerCase();
  if (["offline", "unavailable"].includes(status)) return { ...idle, status: "offline" };
  if (["blocked", "waiting_approval", "waiting"].includes(status)) return { ...idle, status: "blocked" };
  // Idle wins over stale ticket/run references. A work label by itself is insufficient.
  if (!["working", "running", "in_progress", "busy"].includes(status)) return idle;
  const runId = actual.active_run_id?.trim() && ["running", "in_progress"].includes(actual.run_status ?? "") ? actual.active_run_id : null;
  const ticketId = actual.current_ticket_id?.trim() && actual.ticket_status === "in_progress" ? actual.current_ticket_id : null;
  if (!runId && !ticketId) return idle;
  const pose = ["typing", "reviewing", "presenting"].includes(actual.pose ?? "") ? actual.pose! : "typing";
  return { status: "working", pose, ticketId, runId };
}
export interface WalkBounds { minX: number; maxX: number; minZ: number; maxZ: number }
export type Walkable = (x: number, z: number, radius: number) => boolean;
export function clearPosition(x: number, z: number, radius: number, colliders: readonly Collider[], bounds?: WalkBounds, walkable?: Walkable): boolean {
  if (![x, z, radius].every(Number.isFinite) || radius <= 0) return false;
  if (bounds && (x - radius < bounds.minX || x + radius > bounds.maxX || z - radius < bounds.minZ || z + radius > bounds.maxZ)) return false;
  if (walkable && !walkable(x, z, radius)) return false;
  return !resolveCircle(x, z, radius, colliders).hit;
}
/** Sample the entire segment, not just its endpoint, to reject crossing desks/thin walls. */
export function clearSegment(fromX: number, fromZ: number, toX: number, toZ: number, radius: number, colliders: readonly Collider[], walkable: Walkable): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(toX - fromX, toZ - fromZ) / Math.min(0.1, radius * 0.5)));
  for (let i = 0; i <= steps; i++) {
    const alpha = i / steps;
    if (!clearPosition(fromX + (toX - fromX) * alpha, fromZ + (toZ - fromZ) * alpha, radius, colliders, undefined, walkable)) return false;
  }
  return true;
}
