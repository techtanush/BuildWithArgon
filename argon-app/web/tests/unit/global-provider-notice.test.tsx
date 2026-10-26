// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { AuthContext, type AuthState } from '../../src/auth/AuthProvider';
import GlobalProviderNotice, { providerNoticeScope, providerNoticeWorkspace } from '../../src/shared/GlobalProviderNotice';
let root: Root, host: HTMLDivElement;
let ready = true, configured = false, fail = false;
const request = vi.fn(async (url: string, init?: RequestInit) => {
  if (init?.method === 'POST') {
    if (fail) return {ok:false, status:400, json:async()=>({error:{message:'never display server error'}})};
    configured = true;
  }
  return {ok:true,json:async()=>({data:url === '/v1/ventures' ? {items:[{id:'company-a'},{id:'company-b'}]} : url.endsWith('/provider') ? {configured} : {status:ready?'ready':'running'}})};
});
const auth: AuthState = {mode:'demo',loaded:true,signedIn:true,name:'Owner',beginDemo:()=>{},endDemo:()=>{}};
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('fetch',request);request.mockClear();ready=true;configured=false;fail=false;localStorage.clear();sessionStorage.clear();localStorage.setItem('foundry.venture','company-a');host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function render(path='/view',state=auth){await act(async()=>{root.render(<MemoryRouter initialEntries={[path]}><AuthContext.Provider value={state}><GlobalProviderNotice/></AuthContext.Provider></MemoryRouter>);});}
async function click(text:string){await act(async()=>{Array.from(document.querySelectorAll('button')).find(b=>b.textContent===text)!.click();});}
it('resolves explicit accessible world scope without cross-company fallback',()=>{expect(providerNoticeScope('?venture=company-b','company-a',['company-a','company-b'])).toBe('company-b');expect(providerNoticeScope('?venture=private','company-a',['company-a'])).toBeNull();expect(providerNoticeScope('', 'company-b',['company-a','company-b'])).toBe('company-b');});
it('excludes public and authentication pages',()=>{for(const path of ['/','/welcome','/signin','/signup/foo','/auth/callback','/demo','/signout'])expect(providerNoticeWorkspace(path)).toBe(false);expect(providerNoticeWorkspace('/dashboard')).toBe(true);expect(providerNoticeWorkspace('/view')).toBe(true);});
it('does no reads or mutations on landing or unverified auth',async()=>{await render('/');expect(request).not.toHaveBeenCalled();});
it('requires explicitly entered demo or verified session',async()=>{await render('/view',{...auth,signedIn:false});expect(request).not.toHaveBeenCalled();});
it('does not offer setup before ready',async()=>{ready=false;await render();expect(document.querySelector('aside')).toBeNull();expect(request.mock.calls.some(([u])=>u.endsWith('/provider'))).toBe(false);});
it('shows ready owner notice, portal modal with blank password, focus and escape clearing',async()=>{await render();expect(document.body.textContent).toContain('Tutor API key needed');expect(request.mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);await click('Set up API key');const input=document.querySelector('input')!;expect(host.querySelector('input')).toBeNull();expect(input.type).toBe('password');expect(input.value).toBe('');expect(document.activeElement).toBe(input);input.value='fake-test-only';await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(input.value).toBe('');expect(document.querySelector('[role=dialog]')).toBeNull();await click('Set up API key');expect(document.querySelector('input')!.value).toBe('');});
it('clears DOM before fake save, reads boolean status, never stores secret',async()=>{await render('/dashboard');await click('Set up API key');const input=document.querySelector('input')!;input.value='fake-test-only';await act(async()=>document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(input.value).toBe('');expect(document.body.textContent).toContain('Tutor ready · API key saved securely');expect(document.body.textContent).not.toContain('connected');expect(localStorage.getItem('foundry.venture')).toBe('company-a');expect(localStorage.length).toBe(1);expect(sessionStorage.length).toBe(0);await click('Manage API key');expect(document.querySelector('input')!.value).toBe('');});
it('generic errors never echo remote message and leave the field blank',async()=>{fail=true;await render();await click('Set up API key');document.querySelector('input')!.value='fake-test-only';await act(async()=>document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(document.querySelector('input')!.value).toBe('');expect(document.body.textContent).toContain('Could not save the API key. Please try again.');expect(document.body.textContent).not.toContain('never display server error');});
it('uses query scope not stored other-company selection',async()=>{await render('/view?venture=company-b');expect(request.mock.calls.some(([u])=>u==='/v1/ventures/company-b/starter/provider')).toBe(true);expect(request.mock.calls.some(([u])=>u.includes('/company-a/'))).toBe(false);});
it('traps keyboard focus and prevents a stale-company save',async()=>{await render();await click('Set up API key');const buttons=Array.from(document.querySelector('[role=dialog]')!.querySelectorAll('button'));buttons.at(-1)!.focus();await act(async()=>buttons.at(-1)!.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})));expect(document.activeElement).toBe(document.querySelector('input'));localStorage.setItem('foundry.venture','company-b');document.querySelector('input')!.value='fake-test-only';await act(async()=>document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(request.mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);expect(document.querySelector('input')!.value).toBe('');});
