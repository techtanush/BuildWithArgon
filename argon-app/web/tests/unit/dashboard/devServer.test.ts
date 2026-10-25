// OWNER: tanush
import { describe, expect, it } from 'vitest';
import { createDevConfig } from '../../../src/api/devServer.config';

describe('server-only kernel proxy', () => {
  it('forwards bearer authentication only to the local API and never publishes secrets to browser env', () => {
    const config = createDevConfig({ KERNEL_PORT: '18787', KERNEL_TOKEN: 'local-test-token', GEMINI_API_KEY: 'must-never-be-published' });
    expect(config.server?.host).toBe('127.0.0.1');
    expect(config.server?.proxy?.['/v1']).toMatchObject({ target: 'http://127.0.0.1:18787', headers: { Authorization: 'Bearer local-test-token' } });
    for (const path of ['/health', '/media', '/preview']) {
      expect(config.server?.proxy?.[path]).toMatchObject({ target: 'http://127.0.0.1:18787' });
      expect(config.server?.proxy?.[path]).not.toHaveProperty('headers');
    }
    expect(config.define).toBeUndefined();
    expect(config.envPrefix).toBeUndefined();
    expect(JSON.stringify(config)).not.toContain('must-never-be-published');
    expect(config.plugins).toHaveLength(1);
    expect(config.test?.include).toContain('tests/unit/**/*.test.ts');
  });

  it('keeps the seed target and omits authorization when no token is configured', () => {
    expect(createDevConfig({}).server?.proxy?.['/v1']).toEqual({ target: 'http://127.0.0.1:8787', changeOrigin: true });
  });

  it.each(['0', '-1', '65536', '1.5', '8787/path', 'remote:80', 'NaN'])('rejects an invalid target port: %s', port => {
    expect(() => createDevConfig({ KERNEL_PORT: port })).toThrow('KERNEL_PORT must be an integer');
  });
});

it('authenticates real proxied HTTP/SSE requests while Vite browser env contains no kernel token', async () => {
  const { createServer: createHttpServer } = await import('node:http');
  const { createServer: createViteServer, mergeConfig } = await import('vite');
  const token = 'proxy-regression-credential';
  const upstream = createHttpServer((req, res) => {
    res.setHeader('Content-Type', req.url?.includes('stream') ? 'text/event-stream' : 'application/json');
    res.end(req.url?.includes('stream')
      ? `data: ${JSON.stringify({ authenticated: req.headers.authorization === `Bearer ${token}` })}\n\n`
      : JSON.stringify({ data: { authenticated: req.headers.authorization === `Bearer ${token}` } }));
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address();
  if (!address || typeof address === 'string') throw new Error('Missing upstream address');
  const vite = await createViteServer(mergeConfig(createDevConfig({ KERNEL_PORT: String(address.port), KERNEL_TOKEN: token }), {
    configFile: false,
    logLevel: 'silent',
    server: { port: 0, strictPort: true },
    optimizeDeps: { noDiscovery: true, include: [] },
  }));
  try {
    await vite.listen();
    const web = vite.httpServer?.address();
    if (!web || typeof web === 'string') throw new Error('Missing web address');
    const origin = `http://127.0.0.1:${web.port}`;
    expect(await (await fetch(`${origin}/v1/system/status`)).json()).toEqual({ data: { authenticated: true } });
    expect(await (await fetch(`${origin}/v1/ventures/test/stream`)).text()).toContain('"authenticated":true');
    expect(await (await fetch(`${origin}/@vite/env`)).text()).not.toContain(token);
    expect(await (await fetch(`${origin}/src/api/client.ts`)).text()).not.toContain(token);
  } finally {
    await vite.close();
    await new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
  }
}, 15_000);
