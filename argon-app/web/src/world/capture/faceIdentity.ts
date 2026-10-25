import type { Manifest } from "../../shared/contracts";
import { validFace } from "../npc/faces";

/** Only explicitly requested previews may use deterministic placeholder identities. */
export function allowsPreviewFaces(params: URLSearchParams, mockEnv = false) {
  return params.get("source") === "fallback" || params.get("mock") === "1" || mockEnv;
}

export function withRuntimeFaces(base: Manifest, runtime: unknown, agentId: string): Manifest {
  const npcs = (runtime as Partial<Manifest> | null)?.npcs;
  if (!Array.isArray(npcs)) throw new Error("Invalid runtime world manifest: missing NPCs");
  const target = base.npcs.find((npc) => npc.agent_id === agentId);
  if (!target) throw new Error(`Unknown agent: ${agentId}`);
  const merged = base.npcs.map((npc) => {
    const matches = npcs.filter((candidate) => candidate?.agent_id === npc.agent_id);
    const face = matches.length === 1 ? matches[0].face : null;
    // Avatar selection considers preceding building peers, so their identities must resolve too.
    if (npc.building_id === target.building_id &&
        (!validFace(face) || face.agent_id !== npc.agent_id)) {
      throw new Error(`Runtime face missing or invalid for ${npc.agent_id}; portrait capture requires backend identity. Use source=fallback only for an explicit preview.`);
    }
    return { ...npc, face };
  });
  return { ...base, npcs: merged };
}

export async function loadPortraitManifest(base: Manifest, agentId: string, signal: AbortSignal, timeoutMs = 5000): Promise<Manifest> {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("Portrait identity resolution cancelled"));
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(() => controller.abort(new Error("Runtime portrait identity request timed out")), timeoutMs);
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", onAbort, { once: true });
    if (controller.signal.aborted) onAbort();
  });
  try {
    return await Promise.race([aborted, (async () => {
      const response = await fetch("/v1/world/manifest", { method: "GET", signal: controller.signal });
      if (!response.ok) throw new Error(`Runtime portrait identity request failed: HTTP ${response.status}`);
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || !("data" in body))
        throw new Error("Invalid runtime world manifest: missing data envelope");
      return withRuntimeFaces(base, body.data, agentId);
    })()]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
