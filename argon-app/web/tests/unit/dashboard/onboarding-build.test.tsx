// OWNER: tanush
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IntegrationConnect } from "../../../src/dashboard/components/IntegrationConnect";
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
  sessionStorage.clear(); state.responses.clear(); state.post.mockReset(); state.get.mockReset(); state.configured = false; state.selectVenture.mockReset();
  element = document.createElement("div"); document.body.append(element); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); });
async function render(node: React.ReactNode, url = "/") { await act(async () => root.render(<MemoryRouter initialEntries={[url]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{node}</MemoryRouter>)); }
async function fill(selector: string, value: string) { await act(async () => { const node = element.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!; const proto = node.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function submit() { await act(async () => { element.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); }
it("keeps typing local and saves only the draft on explicit continue", async () => {
  state.post.mockResolvedValueOnce({ id: "ven_created", name: "Untitled project" });
  await render(<Onboarding />);
  await fill('input[autocomplete="given-name"]', "Founder");
  await act(async () => element.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await fill("textarea", "Help independent teachers find a useful education product within a small budget, using research evidence.");
  expect(state.post).not.toHaveBeenCalled();
  expect(element.querySelectorAll('input[type="radio"]')).toHaveLength(0);
  expect(element.querySelectorAll('textarea')).toHaveLength(1);
  await submit();
  expect(state.post).toHaveBeenNthCalledWith(1, "/v1/ventures", expect.objectContaining({ name: "Untitled project", idea: expect.stringContaining("Founder intent: Discover an idea for me."), budget_usd: 25 }));
  expect(state.post).toHaveBeenCalledTimes(1);
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
  await render(<IntegrationConnect ventureId="ven_created" provider="github" name="GitHub" />);
}
it("rejects insecure connection redirects and never starts during connection", async () => {
  await prepareLaunch();
  state.post.mockResolvedValueOnce({ redirect_url: "javascript:alert(1)" });
  state.get.mockResolvedValue({ items: [] });
  await act(async () => [...element.querySelectorAll("button")].find(b => b.textContent === "Connect GitHub")!.click());
  expect(element.textContent).toContain("Unsafe provider sign-in link rejected");
  expect(state.post).toHaveBeenCalledTimes(1);
  expect(state.post.mock.calls.some(([url]) => String(url).endsWith("/start"))).toBe(false);
});
it("shows the real integration approval wait instead of pretending connected", async () => {
  await prepareLaunch();
  state.post.mockResolvedValueOnce({ status: "waiting_approval", approval_id: "apr_actual", redirect_url: null });
  await act(async () => [...element.querySelectorAll("button")].find(b => b.textContent === "Connect GitHub")!.click());
  expect(element.textContent).toContain("Review connection permission: GitHub");
  expect(element.textContent).toContain("This is not provider consent");
  expect(element.textContent).toContain("Approve & continue");
  expect(state.post.mock.calls.some(([url]) => String(url).endsWith("/decision"))).toBe(false);
  expect(element.querySelector('a[target="_blank"]')).toBeNull();
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

function CurrentRoute() { const location = useLocation(); return <output data-current-route>{location.pathname + location.search}</output>; }
const connectionsRoute = '/onboarding?step=connections&venture=ven_created';
async function prepareBrief() {
  await render(<><Onboarding /><CurrentRoute /></>, '/onboarding');
  await fill('input[autocomplete="given-name"]', 'Founder');
  await fill('input[maxlength="200"]', 'My idea');
  await fill('textarea', 'A useful app for teachers that helps organize lessons and collaborate safely with other educators.');
}
async function prepareConnections(idea = 'A useful product for teachers', draftId = 'ven_created') {
  state.responses.set('/v1/ventures/ven_created', { id: draftId, name: 'Saved company', idea, budget_usd: 25 });
  state.responses.set('/v1/ventures/ven_created/integrations', { items: [] });
  await render(<><Onboarding /><CurrentRoute /></>, connectionsRoute);
}
async function clickStart() {
  await act(async () => [...element.querySelectorAll('button')].find(button => button.textContent === 'Start building company')!.click());
}
it('saves the brief then navigates to connections without starting work', async () => {
  state.post.mockResolvedValue({ id: 'ven_created', name: 'My idea' });
  await prepareBrief();
  await submit();
  expect(state.post).toHaveBeenCalledTimes(1);
  expect(state.post).toHaveBeenCalledWith('/v1/ventures', expect.objectContaining({ name: 'My idea' }));
  expect(element.querySelector('[data-current-route]')?.textContent).toBe(connectionsRoute);
  expect(sessionStorage.getItem('foundry.just-launched')).toBeNull();
});
it('preserves a saved draft after upload failure and retries upload without duplicate creation', async () => {
  state.post.mockResolvedValueOnce({ id: 'ven_created', name: 'My idea' }).mockRejectedValueOnce(new Error('Upload failed'));
  await prepareBrief();
  await act(async () => {
    const input = element.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['context'], 'context.txt', { type: 'text/plain' })] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await submit();
  expect(element.textContent).toContain('Upload failed');
  expect(element.textContent).toContain('Your project is saved');
  expect(element.querySelector('[data-current-route]')?.textContent).toBe('/onboarding');
  state.post.mockResolvedValueOnce({});
  await submit();
  expect(state.post.mock.calls.filter(([url]) => url === '/v1/ventures')).toHaveLength(1);
  expect(state.post.mock.calls.filter(([url]) => url === '/v1/ventures/ven_created/files')).toHaveLength(2);
  expect(state.post).toHaveBeenNthCalledWith(3, '/v1/ventures/ven_created/files', expect.any(FormData));
  expect(element.querySelector('[data-current-route]')?.textContent).toBe(connectionsRoute);
});
it('retries a failed draft save without starting anything', async () => {
  state.post.mockRejectedValueOnce(new Error('Save failed')).mockResolvedValueOnce({ id: 'ven_created' });
  await prepareBrief();
  await submit();
  expect(element.textContent).toContain('Save failed');
  expect(element.querySelector('[data-current-route]')?.textContent).toBe('/onboarding');
  await submit();
  expect(state.post.mock.calls.every(([url]) => url === '/v1/ventures')).toBe(true);
  expect(element.querySelector('[data-current-route]')?.textContent).toBe(connectionsRoute);
});
it('resumes the requested company with optional connections and no automatic POST or consent', async () => {
  await prepareConnections();
  expect(element.textContent).toContain('Saved company');
  expect(element.textContent).toContain('No connections? You can still start.');
  expect(state.selectVenture).toHaveBeenCalledWith('ven_created');
  expect(state.post).not.toHaveBeenCalled();
  expect(element.querySelector('a[target="_blank"]')).toBeNull();
});
it('starts only on the explicit button and opens the dashboard for that same company', async () => {
  await prepareConnections('An AI Tutor for students');
  state.post.mockResolvedValueOnce({ status: 'queued', preview_url: null });
  expect(state.post).not.toHaveBeenCalled();
  await clickStart();
  expect(state.post).toHaveBeenCalledTimes(1);
  expect(state.post).toHaveBeenCalledWith('/v1/ventures/ven_created/starter/start', { budget_usd: 0.25, scenario: 'ai_tutor_demo' });
  expect(element.querySelector('[data-current-route]')?.textContent).toBe('/dashboard');
  expect(sessionStorage.getItem('foundry.just-launched')).toBe('ven_created');
});
it('keeps the saved company on a start failure and retries that same company', async () => {
  await prepareConnections();
  state.post.mockRejectedValueOnce(new Error('Server authorization required')).mockResolvedValueOnce({ status: 'queued' });
  await clickStart();
  expect(element.textContent).toContain('Server authorization required');
  expect(element.querySelector('[data-current-route]')?.textContent).toBe(connectionsRoute);
  await clickStart();
  expect(state.post).toHaveBeenCalledTimes(2);
  for (const call of state.post.mock.calls) expect(call).toEqual(['/v1/ventures/ven_created/starter/start', { budget_usd: 0.25 }]);
  expect(element.querySelector('[data-current-route]')?.textContent).toBe('/dashboard');
});
it('never falls back to the current company when the requested draft is missing', async () => {
  await render(<><Onboarding /><CurrentRoute /></>, connectionsRoute);
  expect(element.textContent).toContain('Loading your saved company');
  expect(element.textContent).not.toContain('Start building company');
  expect(state.selectVenture).not.toHaveBeenCalled();
  expect(state.post).not.toHaveBeenCalled();
});
it('rejects a mismatched company response instead of starting the wrong company', async () => {
  await prepareConnections('A useful product', 'ven_test');
  expect(element.textContent).not.toContain('Start building company');
  expect(state.selectVenture).not.toHaveBeenCalled();
  expect(state.post).not.toHaveBeenCalled();
});
