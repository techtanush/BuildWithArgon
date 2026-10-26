import { expect, it, vi } from "vitest";
import { Engine } from "../../../src/world/engine/Engine";
function context() {
  const ctx = {
    state: {mode:"foot", fade:false}, disposed:false, transitionToken:0,
    conversation:{close:vi.fn()}, input:{unlock:vi.fn()},
    player:{velocity:{set:vi.fn()},present:vi.fn()}, interior:{},
    colliders:()=>[], toast:vi.fn(), patch(p: object) {Object.assign(this.state,p);},
  };
  return ctx;
}
it("recovers foot mode and camera even when a room callback throws", async () => {
  vi.useFakeTimers(); const c=context(); const error=vi.spyOn(console,"error").mockImplementation(()=>{});
  try {
    const task=(Engine.prototype as any).transition.call(c,()=>{throw Error("room unavailable");});
    expect(c.state.mode).toBe("transition"); await vi.runAllTimersAsync();
    expect(await task).toBe(false); expect(c.state).toMatchObject({mode:"foot",fade:false});
    expect(c.player.present).toHaveBeenCalled(); expect(c.toast).toHaveBeenCalled();
  } finally { vi.useRealTimers(); error.mockRestore(); }
});
it("rejects overlapping room changes instead of starting a second callback", async () => {
  vi.useFakeTimers(); const c=context(); const first=vi.fn(), second=vi.fn();
  try {
    const task=(Engine.prototype as any).transition.call(c,first);
    expect(await (Engine.prototype as any).transition.call(c,second)).toBe(false);
    await vi.runAllTimersAsync(); expect(await task).toBe(true);
    expect(first).toHaveBeenCalledOnce(); expect(second).not.toHaveBeenCalled(); expect(c.state.mode).toBe("foot");
  } finally { vi.useRealTimers(); }
});
