// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { AuthContext, type AuthState } from '../../../src/auth/AuthProvider';
import { AuthGuard, AuthEntry, DemoEntry, AccountPage } from '../../../src/auth/AuthPages';
import { resolveAuthMode, safeReturnTo } from '../../../src/auth/policy';
vi.mock('@clerk/react', () => ({ ClerkProvider: ({children}: {children: ReactNode}) => children, useAuth: () => ({ isLoaded: true, isSignedIn: false }), useUser: () => ({user: null}), useClerk: () => ({signOut: vi.fn()}), SignIn: (p: {forceRedirectUrl: string}) => <output data-signin>{p.forceRedirectUrl}</output>, SignUp: (p: {forceRedirectUrl: string}) => <output data-signup>{p.forceRedirectUrl}</output>, UserProfile: () => <p>Managed account</p>, AuthenticateWithRedirectCallback: () => <p>Callback</p> }));
let root: Root, host: HTMLDivElement;
const base: AuthState = {mode: 'clerk', loaded: true, signedIn: false, name: '', beginDemo: vi.fn(), endDemo: vi.fn()};
function Location() { const location = useLocation(); return <output data-location>{location.pathname}{location.search}{location.hash}</output>; }
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host=document.createElement('div');document.body.append(host);root=createRoot(host); });
afterEach(async () => { await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals(); });
async function render(children: ReactNode, state = base, url = '/dashboard') { await act(async()=>root.render(<MemoryRouter initialEntries={[url]}><AuthContext.Provider value={state}>{children}<Location /></AuthContext.Provider></MemoryRouter>)); }
it('production missing config fails closed even on localhost with demo flag', () => {
  expect(resolveAuthMode({dev:false,hostname:'localhost',demoFlag:'true'})).toBe('unconfigured');
  expect(resolveAuthMode({dev:true,hostname:'app.vercel.app',demoFlag:'true'})).toBe('unconfigured');
  expect(resolveAuthMode({dev:true,hostname:'localhost'})).toBe('unconfigured');
  expect(resolveAuthMode({dev:true,hostname:'localhost',demoFlag:'true'})).toBe('demo');
  expect(resolveAuthMode({dev:false,hostname:'app.vercel.app',publishableKey:'pk_live_configured'})).toBe('clerk');
});
it('missing configuration never renders protected content', async()=> { await render(<AuthGuard><p>SECRET WORKSPACE</p></AuthGuard>,{...base,mode:'unconfigured'});expect(host.textContent).toContain('Authentication');expect(host.textContent).toContain('Workspace access is disabled');expect(host.textContent).not.toContain('SECRET WORKSPACE');expect(host.querySelector('a[href="/demo"]')).toBeNull(); });
it('signed out guard preserves world deep-link, venture and fragment',async()=>{await render(<AuthGuard><p>World</p></AuthGuard>,base,'/view?venture=ven_real#desk');expect(host.querySelector('[data-location]')?.textContent).toBe('/signin?returnTo=%2Fview%3Fventure%3Dven_real%23desk');expect(host.textContent).not.toContain('World');});
it('loading session does not mount protected children',async()=>{await render(<AuthGuard><p>SECRET</p></AuthGuard>,{...base,loaded:false});expect(host.textContent).toContain('Checking your secure session');expect(host.textContent).not.toContain('SECRET');});
it('real signed-in session unlocks protected routes',async()=>{await render(<AuthGuard><p>Workspace</p></AuthGuard>,{...base,signedIn:true});expect(host.textContent).toContain('Workspace');});
it('sign in returns to dashboard by default and signup always enters onboarding',async()=>{await render(<AuthEntry/>);expect(host.querySelector('[data-signin]')?.textContent).toBe('/dashboard');expect(host.querySelector('a[href="/signup"]')).not.toBeNull();await render(<AuthEntry signup/>);expect(host.querySelector('[data-signup]')?.textContent).toBe('/onboarding');expect(host.querySelector('a[href="/signin"]')).not.toBeNull();});
it('managed profile is provider-backed',async()=>{await render(<AccountPage/>,{...base,signedIn:true});expect(host.textContent).toContain('Managed account');expect(host.querySelector('a[href="/signout"]')).not.toBeNull();});
it('hosted modes cannot enter local demo',async()=>{await render(<DemoEntry/>);expect(host.querySelector('form')).toBeNull();expect(host.textContent).toContain('Authentication');});
it('demo selection remains explicit, not an automatic signed-in session',async()=>{await render(<AuthGuard><p>SECRET</p></AuthGuard>,{...base,mode:'demo'});expect(host.querySelector('[data-location]')?.textContent).toContain('/signin');expect(host.textContent).not.toContain('SECRET');});
it('only same-origin safe deep links may be restored',()=>{for(const value of ['//evil.test','https://evil.test','/\\evil.test','/signin','/signout','/auth/callback'])expect(safeReturnTo(value)).toBe('/dashboard');expect(safeReturnTo('/tickets/t_1?venture=v_1')).toBe('/tickets/t_1?venture=v_1');});
