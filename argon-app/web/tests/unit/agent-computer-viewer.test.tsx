// @vitest-environment jsdom
// OWNER: ayan
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentComputerViewerPage, { AgentComputerViewer, safeSpacesWatchUrl } from '../../src/components/AgentComputerViewer';
import type { Computer } from '../../src/shared/contracts';

const machine: Computer = { id: 'cmp_ABC', agent_id: 'eng.qa', provider: 'cua_space', status: 'ready', watch_url: 'https://cua.ai/spaces/example', current_task: { id: 'ctk_ABC', goal: 'Check the checkout page', status: 'waiting_approval', steps: 1 } };
let host: HTMLDivElement, root: Root;
let items: Computer[], stopFails: boolean, listFails: boolean, missingScreen: boolean;
const abortSignals: AbortSignal[] = [];
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (init?.signal) abortSignals.push(init.signal as AbortSignal);
  if (url.endsWith('/stop')) {
    if (stopFails) return { ok: false, status: 503 };
    items = [{ ...machine, status: 'stopped', current_task: null }];
    return { ok: true, json: async () => ({ data: items[0] }) };
  }
  if (url.endsWith('/computers')) {
    if (listFails) return { ok: false, status: 503 };
    return { ok: true, json: async () => ({ data: { items } }) };
  }
  if (url.endsWith('/screen.png')) return { ok: !missingScreen, status: missingScreen ? 404 : 200, blob: async () => new Blob(['image'], { type: 'image/png' }) };
  if (url.includes('/computer-tasks/')) return { ok: true, json: async () => ({ data: { id: 'ctk_ABC', goal: machine.current_task!.goal, status: 'waiting_approval', steps: 1, actions: [{ step: 1, action: { type: 'click', text: '<script>alert(1)</script>' }, reason: 'Checkout requires approval', guard: 'gate', created_at: '2026-10-25T20:00:00Z', screenshot_url: null }] } }) };
  throw new Error(`Unexpected request ${url}`);
});
async function render(ventureId = 'ven_ABC') { await act(async () => { root.render(<AgentComputerViewer ventureId={ventureId} pollIntervalMs={1000} />); }); }
async function click(text: string) {
  const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent === text)!;
  expect(button).toBeTruthy();
  await act(async () => { button.click(); });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); abortSignals.length = 0;
  items = [{ ...machine }]; stopFails = false; listFails = false; missingScreen = false;
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:desktop') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('AgentComputerViewer', () => {
  it('shows actual API state, recorded screen, guarded action history and safe Spaces link', async () => {
    await render();
    expect(host.textContent).toContain('Last reported: ready');
    expect(host.textContent).toContain('Waiting for human approval');
    expect(host.textContent).toContain('Checkout requires approval');
    expect(host.textContent).toContain('Not a live video stream');
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:desktop');
    expect(host.querySelector('a')?.rel).toBe('noopener noreferrer');
  });
  it('polls empty lists so newly started computers appear', async () => {
    items = []; await render(); expect(host.textContent).toContain('No computer reported');
    items = [machine]; await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(host.textContent).toContain('Last reported: ready');
  });
  it('polls screenshots, revokes replaced URLs and cancels on unmount', async () => {
    await render(); await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetchMock.mock.calls.filter(call => String(call[0]).endsWith('/screen.png')).length).toBeGreaterThan(1);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    const before = fetchMock.mock.calls.length;
    await act(async () => { root.unmount(); });
    expect(abortSignals.every(signal => signal.aborted)).toBe(true);
    await vi.advanceTimersByTimeAsync(3000); expect(fetchMock).toHaveBeenCalledTimes(before);
    root = createRoot(host);
  });
  it('stops only the selected computer and uses the confirmed returned state', async () => {
    await render(); await click('Stop computer');
    expect(fetchMock.mock.calls.find(call => String(call[0]).endsWith('/stop'))?.[1]?.method).toBe('POST');
    expect(host.textContent).toContain('Last reported: stopped');
    expect(Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Stop computer')?.disabled).toBe(true);
  });
  it('reports Stop failures without inventing a stopped status', async () => {
    stopFails = true; await render(); await click('Stop computer');
    expect(host.textContent).toContain('Stop failed'); expect(host.textContent).toContain('Last reported: ready');
  });
  it('reports screenshot absence and API errors honestly', async () => {
    missingScreen = true; await render(); expect(host.textContent).toContain('No screenshot available yet'); expect(host.querySelector('img')).toBeNull();
    listFails = true; await click('Refresh'); expect(host.textContent).toContain('HTTP 503'); expect(host.textContent).toContain('Showing last reported state');
  });
  it('does not request or display a made-up computer when venture is missing', async () => {
    await render(''); expect(host.textContent).toContain('Choose a venture'); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('hides unsafe URLs and never shows a Spaces link for a sandbox', async () => {
    items = [{ ...machine, watch_url: 'javascript:alert(1)' }]; await render(); expect(host.querySelector('a')).toBeNull();
    items = [{ ...machine, provider: 'cua_sandbox' }]; await click('Refresh'); expect(host.querySelector('a')).toBeNull();
  });
  it('switches computers without retaining the previous task or desktop', async () => {
    items = [machine, { ...machine, id: 'cmp_SECOND', agent_id: 'research.lead', current_task: null }];
    await render();
    expect(host.textContent).toContain('Checkout requires approval');
    const select = host.querySelector('select')!;
    await act(async () => { select.value = 'cmp_SECOND'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(host.querySelector('img')?.alt).toContain('research.lead');
    expect(host.textContent).not.toContain('Checkout requires approval');
    expect(fetchMock.mock.calls.some(call => String(call[0]) === '/v1/computers/cmp_SECOND/screen.png')).toBe(true);
    expect(abortSignals.some(signal => signal.aborted)).toBe(true);
  });
  it('recovers screenshots after an initial 404 instead of permanently hiding them', async () => {
    missingScreen = true; await render(); expect(host.querySelector('img')).toBeNull();
    missingScreen = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(host.querySelector('img')).not.toBeNull();
    expect(host.textContent).not.toContain('No screenshot available yet');
  });
  it('pauses background polling and resumes when visible', async () => {
    await render(); const before = fetchMock.mock.calls.length;
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); }); expect(fetchMock).toHaveBeenCalledTimes(before);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); }); expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
  });
});
it('rejects non-HTTPS, relative and credential-bearing watch links', () => {
  for (const value of [null, '/spaces/one', 'http://cua.ai', 'javascript:alert(1)', 'https://user:secret@cua.ai']) expect(safeSpacesWatchUrl(value)).toBeUndefined();
  expect(safeSpacesWatchUrl('https://cua.ai/spaces/one')).toBe('https://cua.ai/spaces/one');
});

it('loads the route query and filters by agent without editing frozen routing', async () => {
  await act(async () => { root.render(<MemoryRouter initialEntries={['/computers?ventureId=ven_ABC&agentId=eng.qa']}><AgentComputerViewerPage /></MemoryRouter>); });
  expect(host.textContent).toContain('Last reported: ready');
  expect(fetchMock.mock.calls.some(call => String(call[0]) === '/v1/ventures/ven_ABC/computers')).toBe(true);
});
it('shows a real venture selector when the route has no venture', async () => {
  await act(async () => { root.render(<MemoryRouter initialEntries={['/computers']}><AgentComputerViewerPage /></MemoryRouter>); });
  expect(host.querySelector('input#acv-venture')).not.toBeNull();
  expect(host.textContent).toContain('Agent ID (optional)');
  expect(fetchMock).not.toHaveBeenCalled();
});
