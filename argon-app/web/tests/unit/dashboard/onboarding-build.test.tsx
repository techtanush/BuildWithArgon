// OWNER: tanush
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Onboarding from "../../../src/dashboard/pages/Onboarding";
import Chat from "../../../src/dashboard/pages/Chat";
import { buildEvidence, BuildNotifications } from "../../../src/dashboard/components/BuildNotifications";
import type { Artifact, Run, Ticket } from "../../../src/shared/contracts";
const state = vi.hoisted(() => ({ responses: new Map<string, unknown>(), post: vi.fn(), get: vi.fn(), configured: false, selectVenture: vi.fn() }));
vi.mock("../../../src/api/client", () => ({ get: state.get, post: state.post }));
vi.mock("../../../src/api/hooks", () => ({ useQuery: (key: string) => ({ data: state.responses.get(key), error: null, loading: false, refetch: async () => {} }), invalidateQueries: vi.fn() }));
vi.mock("../../../src/dashboard/context", () => ({ useCompany: () => ({ ventureId: "ven_test", live: "reconnecting", ventures: [{ id: "ven_test" }, { id: "ven_other" }], selectVenture: state.selectVenture, system: { providers: { composio: { configured: state.configured } } } }) }));
let root: Root, element: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.responses.clear(); state.post.mockReset(); state.get.mockReset(); state.configured = false; state.selectVenture.mockReset();
  element = document.createElement("div"); document.body.append(element); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); });
async function render(node: React.ReactNode, url = "/") { await act(async () => root.render(<MemoryRouter initialEntries={[url]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{node}</MemoryRouter>)); }
async function fill(selector: string, value: string) { await act(async () => { const node = element.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!; const proto = node.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function submit() { await act(async () => { element.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); }
it("persists discovery intent using the existing idea contract without connecting, funding or starting", async () => {
  state.post.mockResolvedValue({ id: "ven_created", name: "Discovery company" });
  await render(<Onboarding />);
  expect(state.post).not.toHaveBeenCalled();
  await fill('input[autocomplete="given-name"]', "Founder"); await submit();
  await act(async () => element.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1].click());
  await fill('input[maxlength="200"]', "Discovery company");
  await fill("textarea", "Help independent teachers find a useful education product within a small budget, using research evidence.");
  expect(element.textContent).toContain("No discovery has run yet");
  await submit(); await submit();
  expect(state.post).toHaveBeenCalledTimes(1);
  expect(state.post).toHaveBeenCalledWith("/v1/ventures", expect.objectContaining({ idea: expect.stringContaining("Founder intent: Discover an idea for me."), budget_usd: 25 }));
  expect(element.textContent).toContain("not deposited");
  expect(element.querySelector('a[href="/treasury"]')?.textContent).toContain("Review funding");
  const connect = [...element.querySelectorAll("button")].find(b => b.textContent === "Connect")!;
  expect(connect.disabled).toBe(true);
  expect(element.textContent).toContain("not configured on the server");
});
it("opens a world channel query deep link by ID and shows only recorded participants", async () => {
  state.responses.set("/v1/ventures/ven_test/channels", { items: [{ id: "ch_eng", slug: "dept-engineering", name: "Engineering" }] });
  state.responses.set("/v1/channels/ch_eng/messages", { items: [{ id: "msg_one", author_kind: "agent", author_id: "eng.builder", body: "Actual recorded handoff", refs: [], kind: "handoff", created_at: "2026-10-25T12:00:00Z" }] });
  await render(<Chat />, "/chat?channel=ch_eng");
  expect(element.textContent).toContain("Actual recorded handoff");
  expect(element.textContent).toContain("Participants in loaded messages (1)");
  expect(element.textContent).toContain("may be stale");
  expect(element.querySelector('a[aria-current="page"]')?.textContent).toContain("dept-engineering");
});
it("never invents success, push or preview URLs", () => {
  expect(buildEvidence([], [], [])).toEqual([]);
  const artifact: Artifact = { id: "a", kind: "test_report", title: "Actual failing test report", summary: "Recorded report", department_id: "engineering", agent_id: null, ticket_id: null, uri: "javascript:alert(1)", meta: { preview_url: "//untrusted.test" }, created_at: "2026-10-25T12:00:00Z" };
  const running: Run = { id: "r", ticket_id: null, agent_id: null, kind: "managed_agent", job: "engineering_build", model: "test-model", status: "running", tokens_in: 0, tokens_out: 0, cost_usd: 0, interaction_id: null, created_at: "2026-10-25T12:00:00Z", started_at: "2026-10-25T12:00:00Z", completed_at: null, error: null };
  const result = buildEvidence([artifact], [running], []);
  expect(result).toHaveLength(1); expect(result[0].external).toBeUndefined(); expect(result[0].preview).toBeUndefined();
  expect(result[0].detail).toBe("Recorded test report");
  const ticket: Ticket = { id: "t", title: "Test run", department_id: "engineering", status: "done", result: { tests_passed: 3, tests_failed: 1 }, completed_at: "2026-10-25T13:00:00Z", type: "eng.build", assigned_agent_id: null, body: "", priority: 1, payload: {}, depends_on: [], parent_ticket_id: null, generation: 1, attempts: 1, max_attempts: 3, created_by: "Founder", created_at: "2026-10-25T12:00:00Z", updated_at: "2026-10-25T13:00:00Z" };
  expect(buildEvidence([], [], [ticket])[0].detail).toBe("3 tests passed; 1 failed");
});
it("labels disconnected evidence and stays honest when no build exists", async () => {
  await render(<BuildNotifications />);
  expect(element.textContent).toContain("No completed build evidence yet");
  expect(element.textContent).toContain("may be stale");
  expect(element.querySelector('a[href*="localhost"]')).toBeNull();
});
async function prepareLaunch() {
  state.configured = true;
  state.post.mockResolvedValueOnce({ id: "ven_created", name: "My idea" });
  await render(<Onboarding />);
  await fill('input[autocomplete="given-name"]', "Founder"); await submit();
  await fill('input[maxlength="200"]', "My idea");
  await fill("textarea", "A useful app for teachers that helps organize lessons and collaborate safely with other educators.");
  await submit(); await submit();
}
it("rejects insecure connection redirects and never starts during connection", async () => {
  await prepareLaunch();
  state.post.mockResolvedValueOnce({ redirect_url: "javascript:alert(1)" });
  state.get.mockResolvedValue({ items: [] });
  await act(async () => [...element.querySelectorAll("button")].find(b => b.textContent === "Connect")!.click());
  expect(element.textContent).toContain("did not return a secure sign-in link");
  expect(state.post).toHaveBeenCalledTimes(2);
  expect(state.post.mock.calls.some(([url]) => String(url).endsWith("/start"))).toBe(false);
});
it("shows the real integration approval wait instead of pretending connected", async () => {
  await prepareLaunch();
  state.post.mockRejectedValueOnce(new Error("Approval required"));
  state.get.mockResolvedValue({ items: [{ gate_type: "integration", id: "apr_actual" }] });
  await act(async () => [...element.querySelectorAll("button")].find(b => b.textContent === "Connect")!.click());
  expect(element.textContent).toContain("waiting for your approval");
  expect(element.textContent).toContain("Nothing has been connected yet");
  expect(state.post.mock.calls.some(([url]) => String(url).includes("wallet") || String(url).endsWith("/start"))).toBe(false);
});

it("switches to the known company in a world deep link before displaying its channel", async () => {
  await render(<Chat />, "/chat/dept-engineering?venture=ven_other&channel=ch_other");
  expect(state.selectVenture).toHaveBeenCalledWith("ven_other");
  expect(element.textContent).not.toContain("No channel selected");
});
it("does not show the current company conversation for an unknown deep-linked company", async () => {
  await render(<Chat />, "/chat?venture=ven_unknown&channel=ch_eng");
  expect(element.textContent).toContain("Requested company is unavailable");
  expect(state.selectVenture).not.toHaveBeenCalled();
});

function CurrentRoute() { return <output data-current-route>{useLocation().pathname}</output>; }
it("finishes onboarding in the normal dashboard, not the world", async () => {
  state.post.mockResolvedValue({ id: "ven_created", name: "My idea" });
  await render(<><Onboarding /><CurrentRoute /></>, "/onboarding");
  await fill('input[autocomplete="given-name"]', "Founder"); await submit();
  await fill('input[maxlength="200"]', "My idea");
  await fill("textarea", "A useful app for teachers that helps organize lessons and collaborate safely with other educators.");
  await submit(); await submit();
  expect(element.querySelector('[data-current-route]')?.textContent).toBe('/onboarding');
  await submit();
  expect(state.post).toHaveBeenCalledWith('/v1/ventures/ven_created/start');
  expect(element.querySelector('[data-current-route]')?.textContent).toBe('/dashboard');
  expect(sessionStorage.getItem('foundry.just-launched')).toBe('ven_created');
});

it("keeps the founder on onboarding if the actual backend start fails", async () => {
  state.post.mockResolvedValueOnce({ id: "ven_created", name: "My idea" });
  await render(<><Onboarding /><CurrentRoute /></>, "/onboarding");
  await fill('input[autocomplete="given-name"]', "Founder"); await submit();
  await fill('input[maxlength="200"]', "My idea");
  await fill("textarea", "A useful app for teachers that helps organize lessons and collaborate safely with other educators.");
  await submit(); await submit();
  state.post.mockRejectedValueOnce(new Error('Server authorization required'));
  await submit();
  expect(element.querySelector('[data-current-route]')?.textContent).toBe('/onboarding');
  expect(element.textContent).toContain('Server authorization required');
});
