// OWNER: tanush
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LaunchReadiness } from "../../../src/dashboard/components/LaunchReadiness";
import Overview from "../../../src/dashboard/pages/Overview";
const state = vi.hoisted(() => ({
  post: vi.fn(), responses: new Map<string, unknown>(),
  venture: { id: "ven_test", name: "Tutor", idea: "AI tutor", status: "draft", budget_usd: 25, spent_usd: 0.006106, repo_full_name: null as string | null, stats: { tickets: {}, artifacts: 0 } },
  system: { mode: "live", executor: "antigravity", providers: { gemini: { configured: true } } },
}));
vi.mock("../../../src/api/client", () => ({ get: vi.fn(), post: state.post }));
vi.mock("../../../src/api/hooks", () => ({ useQuery: (key: string) => ({ data: state.responses.get(key), error: null, loading: false, refetch: vi.fn() }), invalidateQueries: vi.fn() }));
vi.mock("../../../src/dashboard/context", () => ({ useCompany: () => ({ ventureId: "ven_test", venture: state.venture, system: state.system, live: "live" }) }));
let root: Root, element: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.post.mockReset(); state.responses.clear(); state.venture.status = "draft"; state.venture.spent_usd = 0.006106; state.venture.repo_full_name = null; state.system.mode = "live";
  state.responses.set("/v1/ventures/ven_test/integrations", { items: [{ provider: "github", status: "not_connected" }] });
  state.responses.set("/v1/ventures/ven_test/approvals?status=pending", { items: [{ id: "apr_one", gate_type: "integration", payload: { provider: "github" }, title: "Connect GitHub", summary: "Review consent", status: "pending", created_at: "2026-10-25" }] });
  element = document.createElement("div"); document.body.append(element); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); });
async function render(overview = false) { await act(async () => root.render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{overview ? <Overview /> : <LaunchReadiness />}</MemoryRouter>)); }
it("shows a concise recorded-state summary without launching anything", async () => {
  await render();
  expect(element.textContent).toContain("Building has not started");
  expect(element.textContent).toContain("0 queued");
  expect(element.textContent).toContain("0 artifacts");
  expect(element.textContent).toContain("not wallet funding or publishing");
  expect(state.post).not.toHaveBeenCalled();
});
it("does not infer a successful build from an active integration", async () => {
  state.responses.set("/v1/ventures/ven_test/integrations", { items: [{ provider: "github", status: "active" }] });
  state.venture.repo_full_name = "owner/tutor";
  await render();
  expect(element.textContent).toContain("Building has not started");
  expect(element.querySelector('a[target="_blank"]')).toBeNull();
});
it("shows budget exhaustion", async () => {
  state.venture.spent_usd = 25;
  await render();
  expect(element.textContent).toContain("Budget cap reached");
});
it("uses the actual start action only after an explicit click, despite pending GitHub consent", async () => {
  state.post.mockResolvedValue({ status: "running", brief_ticket_id: "tkt_actual" });
  await render(true); expect(state.post).not.toHaveBeenCalled();
  await act(async () => [...element.querySelectorAll("button")].find(b => b.textContent === "Start building company")!.click());
  expect(state.post).toHaveBeenCalledExactlyOnceWith("/v1/ventures/ven_test/starter/start", { budget_usd: 0.25 });
});
it("surfaces a failed start without pretending a build exists", async () => {
  state.post.mockRejectedValue(new Error("Budget authorization required"));
  await render(true);
  await act(async () => [...element.querySelectorAll("button")].find(b => b.textContent === "Start building company")!.click());
  expect(element.textContent).toContain("Budget authorization required");
  expect(element.textContent).toContain("Building has not started");
});
