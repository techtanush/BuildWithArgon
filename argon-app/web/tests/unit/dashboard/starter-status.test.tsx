// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { StarterStatus } from "../../../src/dashboard/components/StarterStatus";
const state = vi.hoisted(() => ({ record: { status: "queued", preview_url: null as string | null, message: "Static starter only", tickets: [{id: "t1", type: "starter.plan", status: "queued"}], runs: [{ id: "r1", model: "actual-recorded-model", status: "failed", error: "Provider rejected request" }] } }));
vi.mock("../../../src/api/hooks", () => ({ useQuery: () => ({ data: state.record, error: null, refetch: vi.fn() }) }));
it("shows persisted status/model/error and only a safe ready preview", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const el = document.createElement("div"), root = createRoot(el);
  const render = () => act(async () => root.render(<MemoryRouter><StarterStatus ventureId="v" /></MemoryRouter>));
  await render();
  expect(el.textContent).toContain("Recorded status: queued");
  expect(el.textContent).toContain("actual-recorded-model");
  expect(el.textContent).toContain("Provider rejected request");
  expect(el.querySelector('a[target="_blank"]')).toBeNull();
  state.record.status = "ready"; state.record.preview_url = "javascript:alert(1)"; await render();
  expect(el.querySelector('a[target="_blank"]')).toBeNull();
  state.record.preview_url = "/v1/ventures/v/starter/preview"; await render();
  expect(el.querySelector('a[target="_blank"]')?.getAttribute("href")).toBe(state.record.preview_url);
  await act(async () => root.unmount());
});
