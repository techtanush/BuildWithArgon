import { afterEach, expect, it, vi } from "vitest";
import { ConversationController } from "../../../src/world/conversation/ConversationController";
import type { VoiceCallOptions, VoiceCallHandle } from "../../../src/world/conversation/VoiceCall";
import { mockApi } from "../../../src/shared/worldApi";
import type { ManifestNpc, TalkResponse } from "../../../src/shared/contracts";
import manifest from "../../../src/world/data/manifest.fallback.json";
import fixture from "../../../src/world/data/mock/talk.json";
const npc = manifest.npcs.find(n => n.agent_id !== "concierge") as ManifestNpc;
const answer = fixture as TalkResponse;
afterEach(() => { vi.useRealTimers(); });
function setup(delayed = false) {
  let opts!: VoiceCallOptions, resolve!: (h: VoiceCallHandle) => void;
  const handle: VoiceCallHandle = { status: "connecting", end: vi.fn(async () => {}), setMuted: vi.fn() };
  const api = { ...mockApi, mode: "live" as const, talk: vi.fn(async () => answer), concierge: vi.fn(async () => ({ ...answer, route_card: null })), answer: vi.fn(async () => ({ id: answer.answer_id, ...answer })) };
  const lip = { stop: vi.fn() };
  const onRoute = vi.fn(), cancel = vi.fn();
  const c = new ConversationController({ api, ventureId: "exact-venture", onRoute, pollIntervalMs: 5,
    getLipSync: () => lip as any,
    listen: async () => ({ cancel, stop: async () => ({ text: "", latency_ms: 0, provider: "none" }) }),
    startCall: async o => { opts = o; o.onStatus?.("connecting"); if (delayed) return new Promise(r => resolve = r); return handle; },
  });
  c.open(npc);
  return { c, api, handle, lip, onRoute, cancel, opts: () => opts, resolve: () => resolve(handle) };
}
it("routes the captured venture/NPC, displays transcripts separately, and checks grounded answers", async () => {
  vi.useFakeTimers(); const x = setup(); await x.c.startCall();
  expect(x.opts()).toMatchObject({ ventureId: "exact-venture", agentId: npc.agent_id, surface: "world", lipSync: x.lip });
  x.opts().onTranscript?.({ role: "agent", text: "unverified transcript" });
  expect(x.c.state.callTurns[0].text).toBe("unverified transcript"); expect(x.c.state.response).toBeNull(); expect(x.c.state.turns).toEqual([]);
  const grounded = await x.opts().talk!({ text: "Question", history: [] });
  expect(x.api.talk).toHaveBeenCalledWith("exact-venture", npc.agent_id, { text: "Question", history: [] });
  x.opts().onAnswer?.({ ...grounded, check: { status: "pending", per_citation: [], reason: "" } });
  expect(x.c.state.response?.citations).toEqual(answer.citations);
  expect(x.c.state.turns).toEqual([{ role: "user", text: "Question" }, { role: "agent", text: answer.text }]);
  await vi.advanceTimersByTimeAsync(6); expect(x.api.answer).toHaveBeenCalledWith(answer.answer_id);
  expect(x.c.state.response?.check.status).toBe(answer.check.status); x.c.dispose();
});
it("can mute and end before the connecting handle arrives, ignoring late callbacks", async () => {
  const x = setup(true); const pending = x.c.startCall(); expect(x.c.state.callStatus).toBe("connecting");
  x.c.setCallMuted(true); x.resolve(); await pending; expect(x.handle.setMuted).toHaveBeenCalledWith(true);
  x.c.endCall(); x.opts().onStatus?.("speaking"); x.opts().onTranscript?.({ role: "agent", text: "late" }); x.opts().onAnswer?.(answer);
  expect(x.handle.end).toHaveBeenCalledOnce(); expect(x.c.state.callStatus).toBe("ended"); expect(x.c.state.response).toBeNull(); expect(x.c.state.callTurns).toEqual([]); expect(x.lip.stop).toHaveBeenCalled(); x.c.dispose();
});
it.each(["close", "switch", "dispose", "route", "ptt", "typing", "end"])("ends startup on %s and disposes a late handle", async action => {
  const x = setup(true); const pending = x.c.startCall();
  if (action === "close") x.c.close();
  if (action === "switch") x.c.open({ ...npc, agent_id: "next" });
  if (action === "dispose") x.c.dispose();
  if (action === "route") { x.opts().onAnswer?.({ ...answer, suggested_agent: { agent_id: "target" } } as TalkResponse); x.c.followRoute(); }
  if (action === "ptt") { x.opts().onStatus?.("listening"); await x.c.startPushToTalk(); }
  if (action === "typing") { x.api.talk.mockImplementation(() => new Promise(() => {})); void x.c.send("typed"); }
  if (action === "end") x.c.endCall();
  x.resolve(); await pending; x.opts().onStatus?.("speaking"); x.opts().onAnswer?.(answer);
  expect(x.handle.end).toHaveBeenCalledOnce(); expect(x.c.state.callStatus).not.toBe("speaking");
  if (action === "switch") expect(x.c.state.npc?.agent_id).toBe("next");
  if (action === "ptt") expect(x.c.state.phase).toBe("listening"); x.c.dispose();
});
it("falls back on unavailable/error and never lets late callbacks revive it", async () => {
  for (const status of ["unavailable", "error"] as const) {
    const x = setup(); await x.c.startCall(); x.opts().onStatus?.(status, "Microphone denied");
    expect(x.c.state.phase).toBe("engaged"); expect(x.c.state.error).toContain("push-to-talk or typing");
    x.opts().onStatus?.("speaking"); x.opts().onAnswer?.(answer); expect(x.c.state.callStatus).toBe(status); expect(x.c.state.response).toBeNull(); x.c.dispose();
  }
});
it("routes Nova through concierge and closes call before following a route", async () => {
  const x = setup(); x.c.open({ ...npc, agent_id: "concierge", department_id: "concierge" }); await x.c.startCall();
  await x.opts().talk!({ text: "Who?", history: [] }); expect(x.api.concierge).toHaveBeenCalledWith("exact-venture", { text: "Who?", history: [] });
  x.opts().onAnswer?.({ ...answer, route_card: { agent_id: "target" } } as any); x.c.followRoute("race");
  expect(x.handle.end).toHaveBeenCalledOnce(); expect(x.onRoute).toHaveBeenCalledWith("target", "race"); x.c.dispose();
});

it.each(["typing", "ptt"] as const)("ends an established live call before switching to %s", async action => {
  const x = setup(); await x.c.startCall(); x.opts().onStatus?.("listening");
  if (action === "typing") { x.api.talk.mockImplementation(() => new Promise(() => {})); void x.c.send("typed"); }
  else await x.c.startPushToTalk();
  expect(x.handle.end).toHaveBeenCalledOnce(); expect(x.c.state.callStatus).toBe("ended");
  x.opts().onStatus?.("speaking"); x.opts().onTranscript?.({ role: "agent", text: "late" });
  expect(x.c.state.callStatus).toBe("ended"); expect(x.c.state.callTurns).toEqual([]);
  expect(x.c.state.phase).toBe(action === "typing" ? "thinking" : "listening"); x.c.dispose();
});
it('continues checking the last grounded answer after the user ends a live call',async()=>{
  vi.useFakeTimers();const x=setup();await x.c.startCall();
  x.opts().onAnswer?.({...answer,check:{status:'pending',per_citation:[],reason:''}});x.c.endCall();
  await vi.advanceTimersByTimeAsync(6);expect(x.api.answer).toHaveBeenCalledWith(answer.answer_id);expect(x.c.state.response?.check.status).toBe(answer.check.status);expect(x.c.state.callStatus).toBe('ended');x.c.dispose();
});
it("uses optional voice lookup without bypassing grounded onAnswer UI", async () => {
  const x = setup();
  const fast = vi.fn(async () => answer);
  x.api.voiceAsk = fast;
  await x.c.startCall();
  const req = { text: "What is your role?", history: [] };
  const grounded = await x.opts().talk!(req);
  expect(fast).toHaveBeenCalledWith("exact-venture", npc.agent_id, req);
  expect(x.api.talk).not.toHaveBeenCalled();
  expect(x.c.state.response).toBeNull();
  x.opts().onAnswer?.(grounded);
  expect(x.c.state.response?.citations).toEqual(answer.citations);
  x.c.dispose();
});
