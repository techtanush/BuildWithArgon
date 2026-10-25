// OWNER: tanush
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChannelView } from "../../../src/dashboard/pages/Chat";
const state = vi.hoisted(() => ({
  responses: new Map<string, unknown>(),
  get: vi.fn(),
}));
vi.mock("../../../src/api/client", () => ({ get: state.get, post: vi.fn() }));
vi.mock("../../../src/api/hooks", () => ({
  useQuery: (key: string) => ({
    data: state.responses.get(key),
    error: null,
    loading: false,
    refetch: async () => {},
  }),
  invalidateQueries: () => {},
}));
vi.mock("../../../src/dashboard/context", () => ({
  useCompany: () => ({ ventureId: "ven_test" }),
}));
let root: Root | undefined, element: HTMLDivElement;
function message(id: string, body: string, replies = 0) {
  return {
    id,
    body,
    author_kind: "human",
    author_id: "Founder",
    kind: "message",
    refs: [],
    reply_count: replies,
    created_at: "2026-10-25T12:00:00Z",
  };
}
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  state.responses.clear();
  state.get.mockReset();
  element = document.createElement("div");
  document.body.append(element);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  element.remove();
});
it("loads older thread replies with their cursor and deduplicates overlapping live messages", async () => {
  state.responses.set("/v1/channels/ch_one/messages", {
    items: [message("msg_root", "Standup", 51)],
    next_cursor: null,
  });
  state.responses.set("/v1/channels/ch_one/messages?thread_root_id=msg_root", {
    items: [message("msg_latest", "Current reply")],
    next_cursor: "older/replies",
  });
  state.get.mockResolvedValue({
    items: [
      message("msg_older", "Earlier reply"),
      message("msg_latest", "Stale reply"),
    ],
    next_cursor: null,
  });
  root = createRoot(element);
  await act(async () =>
    root!.render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <ChannelView channelId="ch_one" />
      </MemoryRouter>,
    ),
  );
  await act(async () =>
    element.querySelector<HTMLButtonElement>(".thread-button")!.click(),
  );
  await act(async () =>
    [...element.querySelectorAll("button")]
      .find((button) => button.textContent === "Load earlier replies")!
      .click(),
  );
  expect(state.get).toHaveBeenCalledWith(
    "/v1/channels/ch_one/messages?thread_root_id=msg_root&cursor=older%2Freplies",
  );
  expect(
    [...element.querySelectorAll(".thread-message .message-body > p")].map(
      (node) => node.textContent,
    ),
  ).toEqual(["Earlier reply", "Current reply"]);
  expect(element.textContent).not.toContain("Load earlier replies");
});
