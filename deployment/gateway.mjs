import http from 'node:http';
import https from 'node:https';
import { pipeline } from 'node:stream/promises';

const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const IDENTITY = /^(x-(ycbf|user|owner|tenant|clerk|auth)(-|$)|x-forwarded-user$|remote-user$)/i;
const isLoopback = h => ['localhost', '127.0.0.1', '[::1]'].includes(h);
class GatewayError extends Error { constructor(status) { super('Gateway request rejected'); this.status = status; } }
const reject = status => { throw new GatewayError(status); };

export function readConfig(env) {
  if (!env.CLERK_SECRET_KEY || !env.KERNEL_TOKEN || !env.KERNEL_ORIGIN || !env.CLERK_AUTHORIZED_PARTIES) reject(503);
  const local = env.NODE_ENV === 'development' && !env.VERCEL && env.ALLOW_LOCAL_KERNEL === 'true';
  const origin = new URL(env.KERNEL_ORIGIN);
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) reject(503);
  if (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:' && isLoopback(origin.hostname))) reject(503);
  if (isLoopback(origin.hostname) && !local) reject(503);
  const authorizedParties = env.CLERK_AUTHORIZED_PARTIES.split(',').map(s => s.trim()).filter(Boolean);
  if (!authorizedParties.length) reject(503);
  for (const party of authorizedParties) {
    const u = new URL(party);
    if (u.origin !== party || (u.protocol !== 'https:' && !(local && u.protocol === 'http:' && isLoopback(u.hostname)))) reject(503);
  }
  return { origin, authorizedParties, secretKey: env.CLERK_SECRET_KEY, kernelToken: env.KERNEL_TOKEN };
}

export function routeRequest(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('/') || rawUrl.startsWith('//')) reject(400);
  const raw = new URL(rawUrl, 'https://gateway.invalid');
  const routes = raw.searchParams.getAll('__route');
  if (routes.length > 1) reject(400);
  const route = routes.length ? routes[0] : rawUrl.split('?')[0];
  if (!/^\/(v1|preview|media)(\/|$)/.test(route)) reject(404);
  let decoded = route;
  for (let i = 0; i < 5; i++) {
    if (decoded.includes('\\') || decoded.includes('?') || decoded.includes('#') || /[\x00-\x20\x7f]/.test(decoded) || decoded.split('/').some(p => p === '..' || p === '.')) reject(400);
    let next;
    try { next = decodeURIComponent(decoded); } catch { reject(400); }
    if (next === decoded) break;
    decoded = next;
    if (i === 4) reject(400);
  }
  // Inspect the original path too: URL normalizes literal dot segments.
  if (/(^|\/)\.{1,2}(\/|\?|$)/.test(rawUrl.split('?')[0])) reject(400);
  raw.searchParams.delete('__route');
  return route + (raw.searchParams.size ? '?' + raw.searchParams.toString() : '');
}

export function filterHeaders(headers, response = false) {
  const connection = String(headers.connection || '').toLowerCase().split(',').map(s => s.trim());
  return Object.fromEntries(Object.entries(headers).filter(([key]) => {
    const k = key.toLowerCase();
    return !HOP.has(k) && !connection.includes(k) && !['host', 'authorization', 'cookie', 'set-cookie', 'content-length'].includes(k) && !k.startsWith('x-forwarded-') && !k.startsWith('x-vercel-') && !IDENTITY.test(k) && (!response || !k.startsWith('access-control-'));
  }));
}

export async function authorize(req, config, verifyToken) {
  if (Object.keys(req.headers).some(k => IDENTITY.test(k))) reject(403);
  const origin = req.headers.origin;
  if (origin && !config.authorizedParties.includes(origin)) reject(403);
  const authorization = req.headers.authorization;
  let token;
  if (authorization) {
    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    if (!match) reject(401);
    token = match[1];
  } else {
    const cookies = String(req.headers.cookie || '').split(';').map(s => s.trim()).filter(s => s.startsWith('__session='));
    if (cookies.length !== 1) reject(401);
    token = cookies[0].slice('__session='.length);
    if (!['GET', 'HEAD'].includes(req.method) && !origin) reject(403);
  }
  if (!token) reject(401);
  let claims;
  try { claims = await verifyToken(token, { secretKey: config.secretKey, authorizedParties: config.authorizedParties }); } catch { reject(401); }
  if (!claims || typeof claims.sub !== 'string' || !/^user_[A-Za-z0-9_-]+$/.test(claims.sub) || !config.authorizedParties.includes(claims.azp)) reject(401);
  return claims.sub;
}

export function createGateway({ verifyToken, env = process.env, request = (url, options, cb) => (url.protocol === 'https:' ? https : http).request(url, options, cb) }) {
  return async function gateway(req, res) {
    try {
      const config = readConfig(env);
      const route = routeRequest(req.url);
      const subject = await authorize(req, config, verifyToken);
      const target = new URL(route, config.origin);
      if (target.origin !== config.origin.origin) reject(400);
      const headers = filterHeaders(req.headers);
      headers.authorization = `Bearer ${config.kernelToken}`;
      headers['x-ycbf-user-id'] = subject;
      headers['accept-encoding'] = 'identity';
      await new Promise((resolve, rejectPromise) => {
        const upstream = request(target, { method: req.method, headers }, async reply => {
          res.statusCode = reply.statusCode || 502;
          for (const [k, v] of Object.entries(filterHeaders(reply.headers, true))) if (v !== undefined) res.setHeader(k, v);
          res.setHeader('Cache-Control', 'private, no-store');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.flushHeaders?.();
          try { await pipeline(reply, res); resolve(); } catch (e) { rejectPromise(e); }
        });
        upstream.setTimeout(55000, () => upstream.destroy(new Error('Upstream timeout')));
        upstream.on('error', rejectPromise);
        req.on('aborted', () => upstream.destroy());
        res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
        pipeline(req, upstream).catch(rejectPromise);
      });
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const status = error instanceof GatewayError ? error.status : 502;
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: ({ 400: 'Invalid request', 401: 'Authentication required', 403: 'Forbidden', 404: 'Not found', 503: 'Deployment is not configured' })[status] || 'Upstream unavailable' }));
    }
  };
}
