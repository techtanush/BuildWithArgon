import { expect, it, vi } from "vitest";
import { Engine } from "../../../src/world/engine/Engine";
it("toggles calls with C only while engaged, retaining Escape and V", () => {
  const context = { state: { ready: true, mode: "conversation" }, conversation: { toggleCall: vi.fn(), startPushToTalk: vi.fn(), stopPushToTalk: vi.fn() }, closeConversation: vi.fn() };
  const key = (code: string, down = true) => (Engine.prototype as any).onKey.call(context, code, down);
  key("KeyC"); expect(context.conversation.toggleCall).toHaveBeenCalledOnce();
  key("KeyV"); key("KeyV", false); expect(context.conversation.startPushToTalk).toHaveBeenCalledOnce(); expect(context.conversation.stopPushToTalk).toHaveBeenCalledOnce();
  key("Escape"); expect(context.closeConversation).toHaveBeenCalledOnce();
  context.state.mode = "foot"; key("KeyC"); expect(context.conversation.toggleCall).toHaveBeenCalledOnce();
});
