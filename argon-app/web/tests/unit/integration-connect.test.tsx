// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { IntegrationConnect, safeConnectUrl } from '../../src/dashboard/components/IntegrationConnect';
vi.mock('../../src/api/hooks', () => ({ invalidateQueries: vi.fn() }));
let root: Root, host: HTMLDivElement, approved: boolean, missing: boolean;
const request = vi.fn(async (input: string) => {
  if (input.endsWith('/decision')) approved = true;
  if (input.endsWith('/connect') && approved && missing) return { ok: false, status: 502, json: async () => ({ error: { message: 'Requires configuration: enable an auth config for this toolkit. No account has been connected.' } }) };
  return { ok: true, json: async () => ({ data: input.endsWith('/connect') ? { approval_id: 'apr_test', status: approved ? 'pending' : 'waiting_approval', redirect_url: approved ? 'https://connect.composio.dev/test' : null } : {} }) };
});
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', request); request.mockClear(); approved=false; missing=false; host=document.createElement('div'); document.body.append(host); root=createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<IntegrationConnect ventureId="v_test" provider="slack" name="Slack" />)); }
async function click(text: string) { await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === text)!.click()); }
it('first connect shows inline exact-provider review without silently approving', async () => { await render(); await click('Connect Slack'); expect(host.textContent).toContain('Review connection permission: Slack'); expect(host.textContent).toContain('Composio'); expect(host.textContent).toContain('v_test'); expect(approved).toBe(false); expect(host.querySelector('a')).toBeNull(); });
it('only explicit approval yields a real new-tab noopener link with persistent fallback', async () => { await render(); await click('Connect Slack'); await click('Approve & continue'); expect(approved).toBe(true); const link=host.querySelector('a')!; expect(link.href).toBe('https://connect.composio.dev/test'); expect(link.target).toBe('_blank'); expect(link.rel).toBe('noopener noreferrer'); expect(host.textContent).toContain('click this link again'); expect(host.textContent).toContain('Waiting for provider authorization'); });
it('missing auth configuration is an honest setup error not connected success', async () => { missing=true; await render(); await click('Connect Slack'); await click('Approve & continue'); expect(host.textContent).toContain('Requires configuration'); expect(host.querySelector('a')).toBeNull(); });
it('rejects credentials, hostile origins, insecure and malformed URLs', () => { for (const value of ['https://evil.example/x','https://connect.composio.dev.evil/x','http://connect.composio.dev','https://x:y@connect.composio.dev','javascript:alert(1)','https://connect.composio.dev:444/x']) expect(safeConnectUrl(value)).toBeUndefined(); });
