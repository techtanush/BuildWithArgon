// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ConversationPanel } from "../../../src/world/hud/ConversationPanel";
import { ConversationController } from "../../../src/world/conversation/ConversationController";
import { mockApi } from "../../../src/shared/worldApi";
import manifest from "../../../src/world/data/manifest.fallback.json";
import type { ManifestNpc } from "../../../src/shared/contracts";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
it("shows live status/transcript, supports call/mute/PTT, and ends on unmount", async () => {
  const c = new ConversationController({ api: mockApi, ventureId: "v" });
  c.open(manifest.npcs[0] as ManifestNpc);
  const el = document.createElement("div"), root = createRoot(el);
  const onCall = vi.fn(), onEndCall = vi.fn(), onMuteCall = vi.fn(), onVoiceStart = vi.fn();
  const props = { state: c.state, mock: false, offline: false, onCall, onEndCall, onMuteCall, onVoiceStart, onVoiceStop: vi.fn(), onSend: vi.fn(), onClose: vi.fn(), onTravel: vi.fn(), onRace: vi.fn() };
  await act(async () => root.render(React.createElement(ConversationPanel, props)));
  (el.querySelector('[aria-label="Call agent"]') as HTMLButtonElement).click(); expect(onCall).toHaveBeenCalledOnce();
  await act(async () => root.render(React.createElement(ConversationPanel, { ...props, state: { ...c.state, phase: "listening", callStatus: "listening", callTurns: [{ role: "agent", text: "Live transcript only" }] } })));
  expect(el.textContent).toContain("Live call: listening"); expect(el.textContent).toContain("Live transcript only");
  expect(el.textContent).not.toContain("Release V"); expect(el.querySelector(".sources")).toBeNull();
  const buttons = [...el.querySelectorAll("button")];
  buttons.find(b => b.textContent === "Mute")!.click(); expect(onMuteCall).toHaveBeenCalledWith(true);
  buttons.find(b => b.textContent?.includes("Hold"))!.dispatchEvent(new Event("pointerdown", { bubbles: true })); expect(onVoiceStart).toHaveBeenCalledOnce();
  await act(async () => root.unmount()); expect(onEndCall).toHaveBeenCalledOnce(); c.dispose();
});
