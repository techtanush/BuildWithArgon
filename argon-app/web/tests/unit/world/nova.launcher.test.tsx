// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";
import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {Engine, initialWorldState, type Mode} from "../../../src/world/engine/Engine";
import {Hud} from "../../../src/world/hud/Hud";

const nova = {agent_id: "concierge", department_id: "concierge", display_name: "Nova"} as any;
function engineContext(mode: Mode, resumeMode: Mode = "foot") {
  const conversation = {open: vi.fn()};
  const patch = vi.fn();
  return {
    state: {ready: true, mode, remoteConcierge: false, conversation: null, workplace: {departmentId: "engineering", name: "Engineering"}},
    manifest: {npcs: [nova], plaza: {concierge: {agent_id: "concierge"}}},
    resumeMode, conversationResumeMode: "foot", conversation,
    voice: {stop: vi.fn()}, npcs: {setActive: vi.fn()}, input: {unlock: vi.fn()}, patch, toast: vi.fn(),
  };
}

describe("Nova launcher engine modes", () => {
  it.each([["map", "car"], ["paused", "race"], ["workplace", "foot"], ["conversation", "foot"]] as const)("opens from %s and retains %s as the close destination", (mode, expected) => {
    const context = engineContext(mode, expected);
    Engine.prototype.openNova.call(context as any);
    expect(context.conversation.open).toHaveBeenCalledWith(nova);
    expect(context.conversationResumeMode).toBe(expected);
    expect(context.patch).toHaveBeenCalledWith({mode: "conversation", prompt: "", workplace: null, remoteConcierge: true});
  });

  it.each([["map", "car"], ["paused", "race"]] as const)("returns to %s base mode after closing Nova", (modal, base) => {
    const patch = vi.fn();
    (Engine.prototype as any).closeConversation.call({voice: {stop: vi.fn()}, conversation: {close: vi.fn()}, npcs: {setActive: vi.fn()}, state: {remoteConcierge: true}, conversationResumeMode: base, patch});
    expect(patch).toHaveBeenCalledWith({mode: base, remoteConcierge: false});
  });

  it("is idempotent for an already-open Nova conversation", () => {
    const context = engineContext("conversation");
    context.state.remoteConcierge = true;
    context.state.conversation = {npc: nova} as any;
    Engine.prototype.openNova.call(context as any);
    expect(context.conversation.open).not.toHaveBeenCalled();
    expect(context.voice.stop).not.toHaveBeenCalled();
    expect(context.patch).not.toHaveBeenCalled();
  });

  it("handles N before the workplace early return", () => {
    const openNova = vi.fn(), closeWorkplace = vi.fn();
    (Engine.prototype as any).onKey.call({state: {ready: true, mode: "workplace"}, openNova, closeWorkplace}, "KeyN", true);
    expect(openNova).toHaveBeenCalledOnce();
    expect(closeWorkplace).not.toHaveBeenCalled();
  });

  it("allows only the explicit header assist to enter a far-away car", () => {
    const context = {interior: null, state: {mode: "foot"}, player: {position: {distanceTo: () => 20}}, car: {group: {position: {clone: () => ({setY: () => ({})})}}, state: {x: 0, z: 0}, followTerrain: vi.fn()}, toast: vi.fn(), conversation: {close: vi.fn()}, chase: {update: vi.fn()}, patch: vi.fn()};
    Engine.prototype.enterCar.call(context as any);
    expect(context.toast).toHaveBeenCalled();
    Engine.prototype.enterCar.call(context as any, true);
    expect(context.patch).toHaveBeenCalledWith({mode: "car", prompt: ""});
  });
});

let root: Root | undefined;
let host: HTMLDivElement;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { act(() => root?.unmount()); host?.remove(); });
function mount(node: React.ReactNode) { host = document.createElement("div"); document.body.append(host); root = createRoot(host); act(() => root!.render(node)); }

describe("persistent Nova launcher", () => {
  it.each(["foot", "car", "race", "conversation", "map", "paused", "workplace"] as Mode[])("renders one enabled launcher in %s", mode => {
    const openNova = vi.fn();
    mount(<Hud state={{...initialWorldState, ready: true, mode}} engine={{openNova} as unknown as Engine}/>);
    const launcher = host.querySelectorAll<HTMLButtonElement>('button[aria-label="Ask Nova"]');
    expect(launcher).toHaveLength(1);
    expect(launcher[0].disabled).toBe(false);
    act(() => launcher[0].click());
    expect(openNova).toHaveBeenCalledOnce();
  });

  it("uses the explicit header drive assist only", () => {
    const enterCar = vi.fn();
    mount(<Hud state={{...initialWorldState, ready: true, mode: "foot", scene: "city"}} engine={{enterCar} as unknown as Engine}/>);
    act(() => Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Drive the city")!.click());
    expect(enterCar).toHaveBeenCalledWith(true);
  });

  it("stays visible but disabled while transitioning", () => {
    mount(<Hud state={{...initialWorldState, ready: true, mode: "transition"}} engine={null}/>);
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Ask Nova"]')?.disabled).toBe(true);
  });
});
