// OWNER: tanush
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, get, post } from '../../../src/api/client';

afterEach(() => vi.unstubAllGlobals());

describe('dashboard HTTP boundary', () => {
  it('unwraps a successful response and keeps API credentials out of browser headers', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: 'ven_one' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect(await get('/v1/ventures/ven_one')).toEqual({ id: 'ven_one' });
    expect(fetch).toHaveBeenCalledWith('/v1/ventures/ven_one', { method: 'GET' });
  });

  it('encodes JSON and preserves falsy values in the data envelope', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: false }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect(await post('/v1/ventures/ven_one/pause', { active: false, budget: 0 })).toBe(false);
    expect(fetch).toHaveBeenCalledWith('/v1/ventures/ven_one/pause', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"active":false,"budget":0}',
    });
  });

  it('sends multipart uploads intact so the browser supplies its boundary', async () => {
    const data = new FormData();
    data.append('files[]', new Blob(['Context']), 'brief.txt');
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { items: [] } }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await post('/v1/ventures/ven_one/files', data);
    expect(fetch).toHaveBeenCalledWith('/v1/ventures/ven_one/files', { method: 'POST', body: data });
  });

  it('exposes the structured error details needed by approval and retry UI', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: {
      code: 'conflict', message: 'This approval already has a decision', details: { approval_id: 'apr_one' },
    } }), { status: 409 })));
    const error = await post('/v1/approvals/apr_one/decision', { decision: 'approve' }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'conflict', message: 'This approval already has a decision', details: { approval_id: 'apr_one' } });
  });

  it('turns non-JSON provider failures into useful HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 })));
    await expect(get('/v1/system/status')).rejects.toMatchObject({ status: 502, code: 'http_error', message: 'HTTP 502' });
  });

  it.each(['<html>wrong server</html>', '{"items":[]}'])('rejects a malformed success envelope (%s)', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    await expect(get('/v1/ventures')).rejects.toBeInstanceOf(ApiError);
  });

  it('retains a network failure so the page can offer Retry', async () => {
    const network = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(network));
    await expect(get('/v1/ventures')).rejects.toBe(network);
  });
});
