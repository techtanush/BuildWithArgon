// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../../../src/App';
import Landing from '../../../src/entry/Landing';
import LocalSignIn from '../../../src/entry/LocalSignIn';
import { LOCAL_PROFILE_KEY, readLocalProfile } from '../../../src/entry/profile';
import DashboardRoutes from '../../../src/dashboard/routes';

const state = vi.hoisted(() => ({ ventures: [{ id: 'ven_demo', name: 'Demo', founder_name: 'Founder', status: 'draft', spent_usd: 0, budget_usd: 25 }], loading: false }));
vi.mock('../../../src/dashboard/context', () => ({ CompanyProvider: ({ children }: { children: React.ReactNode }) => children, useCompany: () => ({ ...state, venture: state.ventures[0], ventureId: state.ventures[0]?.id, live: 'connecting', selectVenture: vi.fn() }) }));
vi.mock('../../../src/dashboard/pages/Overview', () => ({ default: () => <h1>Overview</h1> }));
vi.mock('../../../src/dashboard/pages/Onboarding', () => ({ default: () => <h1>Onboarding</h1> }));
function Location() { return <output data-location>{useLocation().pathname}</output>; }
function storage() { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key), clear: () => data.clear() }; }
let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('localStorage', storage()); vi.stubGlobal('sessionStorage', storage()); localStorage.clear(); sessionStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(node: React.ReactNode, url = '/') { await act(async () => root.render(<MemoryRouter initialEntries={[url]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{node}<Location /></MemoryRouter>)); }
it('landing primary calls to action enter local demo sign-in rather than world or an invented OAuth flow', async () => {
  await render(<Landing />);
  for (const text of ['Build your company', 'Start building', 'Let’s begin']) expect([...host.querySelectorAll('a')].find(a => a.textContent?.includes(text))?.getAttribute('href')).toBe('/signin');
  expect(host.querySelector('a[href="/view"]')).toBeNull();
  expect(host.textContent).toContain('Illustration');
  expect(host.querySelector('a[href="/dashboard"]')).not.toBeNull();
});
it('optional local profile enters onboarding without any network authentication or password collection', async () => {
  const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
  await render(<Routes><Route path="/signin" element={<LocalSignIn />} /><Route path="/onboarding" element={<h1>Onboarding</h1>} /></Routes>, '/signin');
  expect(host.textContent).toContain('No identity verification');
  expect(host.querySelector('input[type="password"]')).toBeNull();
  expect(host.querySelector('input')?.required).toBe(false);
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(host.querySelector('[data-location]')?.textContent).toBe('/onboarding');
  expect(JSON.parse(localStorage.getItem(LOCAL_PROFILE_KEY)!)).toEqual({ name: '' });
  expect(fetchSpy).not.toHaveBeenCalled();
});
it('reads only a bounded display name, not a credential, and tolerates corrupt storage', () => {
  localStorage.setItem(LOCAL_PROFILE_KEY, 'bad json'); expect(readLocalProfile()).toEqual({ name: '' });
  localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify({ name: 'Ada', token: 'not-used' })); expect(readLocalProfile()).toEqual({ name: 'Ada' });
});
it('dashboard alias retains normal work navigation and makes world entry explicit', async () => {
  await render(<DashboardRoutes />, '/dashboard');
  expect(host.querySelector('h1')?.textContent).toBe('Overview');
  for (const path of ['tickets', 'runs', 'chat', 'approvals', 'artifacts', 'treasury', 'settings', 'computers']) expect(host.querySelector(`a[href="/${path}"]`)).not.toBeNull();
  expect(host.querySelector('a[href="/dashboard"][aria-current="page"]')).not.toBeNull();
  const world = host.querySelector<HTMLAnchorElement>('a[href="/view?venture=ven_demo"]');
  expect(world?.textContent).toContain('Enter World');
  expect(host.querySelector('[data-location]')?.textContent).toBe('/dashboard');
  await act(async () => world!.click());
  expect(host.querySelector('[data-location]')?.textContent).toBe('/view');
});

it.each(['/', '/welcome'])('serves the full public landing at %s', async (url) => {
  await render(<App />, url);
  expect(host.querySelector('h1')?.textContent).toContain('A whole company.');
  expect(host.querySelector('.dashboard-shell')).toBeNull();
});
it('continues safely when optional local profile storage is blocked', async () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('disabled'); }, setItem: () => { throw new Error('disabled'); } });
  await render(<LocalSignIn />, '/signin');
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(host.querySelector('[data-location]')?.textContent).toBe('/onboarding');
});
