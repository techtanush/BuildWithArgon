import { afterEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "../../../src/shared/contracts";
import fixture from "../../../src/world/data/manifest.fallback.json";
import { fallbackFace } from "../../../src/world/npc/faces";
import { allowsPreviewFaces, loadPortraitManifest, withRuntimeFaces } from "../../../src/world/capture/faceIdentity";
const base = fixture as Manifest;
const id = "eng.builder";
// Synthetic test faces only; never production identity data.
const runtime = () => ({ npcs: base.npcs.map(npc => ({ ...npc, face: fallbackFace(npc.agent_id, "#123456") })) });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("capture runtime identities", () => {
  it("permits only explicit fallback/mock previews, not implicit defaults or staging/generated", () => {
    for (const query of ["", "source=staging", "source=generated"]) expect(allowsPreviewFaces(new URLSearchParams(query))).toBe(false);
    for (const query of ["source=fallback", "mock=1"]) expect(allowsPreviewFaces(new URLSearchParams(query))).toBe(true);
    expect(allowsPreviewFaces(new URLSearchParams(), true)).toBe(true);
  });
  it("merges backend faces before selection without mutating the fallback manifest", () => {
    const result = withRuntimeFaces(base, runtime(), id);
    expect(result.npcs.find(n => n.agent_id === id)?.face).toEqual(fallbackFace(id, "#123456"));
    expect(base.npcs.find(n => n.agent_id === id)?.face).toBeFalsy();
  });
  it("rejects missing, malformed, duplicate, mismatched identities and missing peers", () => {
    for (const face of [null, {}, { ...fallbackFace(id), agent_id: "other" }]) {
      const data = runtime(); data.npcs.find(n => n.agent_id === id)!.face = face as never;
      expect(() => withRuntimeFaces(base, data, id)).toThrow(/Runtime face/);
    }
    expect(() => withRuntimeFaces(base, { npcs: [] }, id)).toThrow(/Runtime face/);
    const data = runtime(); data.npcs.push(data.npcs.find(n => n.agent_id === id)!);
    expect(() => withRuntimeFaces(base, data, id)).toThrow(/Runtime face/);
    const peers = runtime(); const target = peers.npcs.find(n => n.agent_id === id)!;
    const peer = peers.npcs.find(n => n.agent_id !== id && n.building_id === target.building_id)!;
    peer.face = null as never;
    expect(() => withRuntimeFaces(base, peers, id)).toThrow(/Runtime face/);
  });
  it("uses the exact same-origin GET envelope without an auth client", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: runtime() })));
    vi.stubGlobal("fetch", fetcher);
    await loadPortraitManifest(base, id, new AbortController().signal);
    expect(fetcher).toHaveBeenCalledWith("/v1/world/manifest", { method: "GET", signal: expect.any(AbortSignal) });
  });
  it("fails closed on HTTP and envelope errors", async () => {
    for (const response of [new Response("no", { status: 503 }), new Response("{}")]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      await expect(loadPortraitManifest(base, id, new AbortController().signal)).rejects.toThrow();
    }
  });
  it("bounds hung requests and aborts unmounted work even if fetch ignores signals", async () => {
    vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const timed = loadPortraitManifest(base, id, new AbortController().signal, 20);
    const check = expect(timed).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(20); await check;
    const controller = new AbortController();
    const pending = loadPortraitManifest(base, id, controller.signal);
    controller.abort(); await expect(pending).rejects.toThrow(/cancelled/);
    expect(vi.getTimerCount()).toBe(0);
  });
});
