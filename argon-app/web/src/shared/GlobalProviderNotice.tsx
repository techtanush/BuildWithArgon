import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useAppAuth } from '../auth/AuthProvider';
import { get } from '../api/client';
import './GlobalProviderNotice.css';

async function providerStatus(endpoint: string): Promise<{configured: boolean}> {
  const response = await fetch(`${endpoint}/provider`, {credentials: 'same-origin'});
  if (!response.ok) throw new Error('Provider status unavailable');
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || typeof (value as {configured?: unknown}).configured !== 'boolean') throw new Error('Invalid provider status');
  return value as {configured: boolean};
}

const readSelection = () => { try { return localStorage.getItem('foundry.venture'); } catch { return null; } };
export function providerNoticeScope(search: string, selected: string | null, ids: string[]): string | null {
  const explicit = new URLSearchParams(search).get('venture');
  // Never substitute another company for an explicit but inaccessible scope.
  if (explicit !== null) return ids.includes(explicit) ? explicit : null;
  return selected && ids.includes(selected) ? selected : ids[0] ?? null;
}
export function providerNoticeWorkspace(path: string): boolean {
  return !/^\/(?:$|welcome(?:\/|$)|signin(?:\/|$)|signup(?:\/|$)|auth(?:\/|$)|signout(?:\/|$)|demo(?:\/|$))/.test(path);
}

export default function GlobalProviderNotice() {
  const auth = useAppAuth();
  const location = useLocation();
  const enabled = auth.loaded && auth.signedIn && auth.mode !== 'unconfigured' && providerNoticeWorkspace(location.pathname);
  const [ids, setIds] = useState<string[]>([]);
  const [selected, setSelected] = useState(readSelection);
  useEffect(() => {
    if (!enabled) { setIds([]); return; }
    let live = true;
    const load = async () => { try { const data = await get<{ items: { id: string }[] }>('/v1/ventures'); if (live) setIds(data.items.map(v => v.id)); } catch { if (live) setIds([]); } };
    void load();
    const poll = window.setInterval(() => void load(), 5000);
    // CompanyProvider is route-local and persists its active scope here. Storage
    // events alone do not fire in the tab that changed the dashboard selection.
    const selection = window.setInterval(() => setSelected(readSelection()), 200);
    const update = () => setSelected(readSelection());
    window.addEventListener('storage', update);
    return () => { live = false; clearInterval(poll); clearInterval(selection); window.removeEventListener('storage', update); };
  }, [enabled]);
  const search = location.pathname === '/view' || location.pathname.startsWith('/view/') ? location.search : '';
  const scope = enabled ? providerNoticeScope(search, selected, ids) : null;
  return scope ? <ScopedNotice key={scope} ventureId={scope} search={search} /> : null;
}

function ScopedNotice({ ventureId, search }: { ventureId: string; search: string }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const endpoint = `/v1/ventures/${encodeURIComponent(ventureId)}/starter`;
  const currentScope = () => providerNoticeScope(search, readSelection(), [ventureId]) === ventureId && (new URLSearchParams(search).has('venture') || !readSelection() || readSelection() === ventureId);
  const clear = () => { if (input.current) input.current.value = ''; };
  const close = () => { clear(); setOpen(false); setError(''); action.current?.focus(); };
  useEffect(() => {
    alive.current = true;
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const starter = await get<{ status: string }>(endpoint);
        if (!alive.current) return;
        if (starter.status !== 'ready') { clear(); setOpen(false); setReady(false); setConfigured(null); return; }
        const provider = await providerStatus(endpoint);
        if (alive.current) { setReady(true); setConfigured(typeof provider.configured === 'boolean' ? provider.configured : null); }
      } catch { if (alive.current) { clear(); setOpen(false); setReady(false); setConfigured(null); } }
      finally { loading = false; }
    };
    void load(); const timer = window.setInterval(() => void load(), 5000);
    return () => { alive.current = false; clearInterval(timer); clear(); };
  }, [endpoint]);
  useEffect(() => {
    if (!open) return;
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* optional browser API */ }
    clear(); input.current?.focus();
    return clear;
  }, [open]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || !currentScope()) { clear(); return; }
    const api_key = input.current?.value.trim() ?? '';
    clear();
    if (!api_key) { setError('Enter an API key.'); input.current?.focus(); return; }
    setSaving(true); setError('');
    try {
      const saved = await fetch(`${endpoint}/provider`, {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({api_key})});
      if (!saved.ok) throw new Error('Secure configuration failed');
      const result = await providerStatus(endpoint);
      if (alive.current && currentScope()) { setConfigured(result.configured === true); close(); }
    } catch { if (alive.current) setError('Could not save the API key. Please try again.'); }
    finally { if (alive.current) setSaving(false); }
  }
  function keydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') ?? []);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }
  if (!ready || configured === null || !currentScope()) return null;
  return createPortal(<>
    <aside className="global-provider-notice" aria-label="Tutor API key status">
      <span role="status">{configured ? 'Tutor ready · API key saved securely' : 'Tutor API key needed'}</span>
      <button ref={action} onClick={() => { setError(''); setOpen(true); }}>{configured ? 'Manage API key' : 'Set up API key'}</button>
    </aside>
    {open && <div className="global-provider-overlay" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="global-provider-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="global-provider-title" aria-describedby="global-provider-help" onKeyDown={keydown}>
        <h2 id="global-provider-title">{configured ? 'Manage API key' : 'Set up API key'}</h2>
        <p id="global-provider-help">Your OpenAI API key is encrypted on the server. Saving does not validate it or contact a provider. Only this company’s owner can manage it.</p>
        <form onSubmit={save} autoComplete="off">
          <label htmlFor="global-provider-key">OpenAI API key</label>
          <input ref={input} id="global-provider-key" type="password" autoComplete="new-password" spellCheck={false} disabled={saving} />
          {error && <p role="alert">{error}</p>}
          <div className="global-provider-actions"><button type="button" onClick={close}>Cancel</button><button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save API key'}</button></div>
        </form>
      </div>
    </div>}
  </>, document.body);
}
