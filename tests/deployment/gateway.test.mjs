import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGateway, readConfig, routeRequest, filterHeaders } from '../../deployment/gateway.mjs';
const env = { CLERK_SECRET_KEY: 'sk_test_fixture', KERNEL_TOKEN: 'private-kernel-fixture', KERNEL_ORIGIN: 'https://kernel.example', CLERK_AUTHORIZED_PARTIES: 'https://app.example' };
const verifyToken = async (token, opts) => {
  assert.deepEqual(opts.authorizedParties, ['https://app.example']);
  if (token !== 'valid') throw new Error('invalid JWT');
  return { sub: 'user_verified', azp: 'https://app.example' };
};
async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => {server.close(r); server.closeAllConnections();}) };
}
async function withGateway(fn, overrides = {}) {
  const app = await serve(createGateway({ env, verifyToken, ...overrides }));
  try { await fn(app.url); } finally { await app.close(); }
}
test('missing deployment configuration fails closed', async () => {
  await withGateway(async url => { assert.equal((await fetch(url + '/v1/me')).status, 503); }, { env: {} });
});
test('no auth and invalid JWT are 401, never contact upstream', async () => {
  await withGateway(async url => {
    for (const headers of [{}, {authorization: 'Bearer invalid'}, {cookie: '__session=invalid'}]) assert.equal((await fetch(url + '/v1/me', {headers})).status, 401);
  }, {request() { assert.fail('must not proxy unauthenticated request'); }});
});
test('identity spoof and foreign origins are forbidden', async () => {
  await withGateway(async url => {
    for (const extra of [{'x-ycbf-user-id':'user_attacker'}, {'x-owner-id':'someone'}, {origin:'https://evil.example'}]) {
      assert.equal((await fetch(url + '/v1/me', {headers: {authorization:'Bearer valid', ...extra}})).status, 403);
    }
  });
});
test('cookie mutations require matching Origin and cookie duplication fails', async () => {
  await withGateway(async url => {
    assert.equal((await fetch(url + '/v1/me', {method:'POST', headers:{cookie:'__session=valid'}})).status, 403);
    assert.equal((await fetch(url + '/v1/me', {headers:{cookie:'__session=valid; __session=valid'}})).status, 401);
  });
});
test('JWT authorized party and subject checked even when verifier returns claims', async () => {
  for (const claims of [{sub:'user_ok',azp:'https://evil.example'}, {sub:'bad\r\nheader',azp:'https://app.example'}, {sub:'user_ok'}]) {
    await withGateway(async url => assert.equal((await fetch(url + '/v1/me', {headers:{authorization:'Bearer valid'}})).status, 401), {verifyToken:async()=>claims});
  }
});
test('traversal, arbitrary hosts, duplicate route and unknown routes rejected', () => {
  for (const route of ['/v1/../secret','/v1/%2e%2e/secret','/v1/%252e%252e/secret','/v1/a%5cb','https://evil.example/v1','//evil.example/v1','/admin','/v1/a?__route=/v1/a&__route=/v1/b']) {
    assert.throws(()=>routeRequest(route), undefined, route);
  }
  assert.equal(routeRequest('/api/gateway?__route=/v1/stream&cursor=abc'), '/v1/stream?cursor=abc');
});
test('upstream configuration allows HTTP loopback only explicitly outside Vercel', () => {
  for (const origin of ['http://kernel.example','https://user:pass@kernel.example','https://kernel.example/path','http://127.0.0.1:8787','https://localhost']) assert.throws(()=>readConfig({...env,KERNEL_ORIGIN:origin}));
  assert.equal(readConfig({...env,KERNEL_ORIGIN:'http://127.0.0.1:8787',NODE_ENV:'development',ALLOW_LOCAL_KERNEL:'true'}).origin.hostname,'127.0.0.1');
  assert.throws(()=>readConfig({...env,KERNEL_ORIGIN:'http://127.0.0.1:8787',NODE_ENV:'development',ALLOW_LOCAL_KERNEL:'true',VERCEL:'1'}));
});
test('hop-by-hop, nominated headers, cookies and credentials stripped', () => {
  assert.deepEqual(filterHeaders({connection:'x-secret', 'x-secret':'hidden', authorization:'secret',cookie:'secret','set-cookie':['hidden'],'x-user-id':'fake','last-event-id':'42',range:'bytes=0-99'}), {'last-event-id':'42',range:'bytes=0-99'});
});
test('verified cookie and bearer proxy preserve upload bytes, audio, SSE, cursor, not credentials', async () => {
  const payload = Buffer.from([0, 255, 1, 2, 13, 10, 65]);
  let count = 0;
  const upstream = await serve(async (req,res) => {
    count++;
    assert.equal(req.headers.authorization,'Bearer private-kernel-fixture');
    assert.equal(req.headers['x-ycbf-user-id'],'user_verified');
    assert.equal(req.headers.cookie,undefined);
    assert.equal(req.headers['last-event-id'],'event-7');
    const chunks=[]; for await (const chunk of req) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), payload);
    assert.equal(req.headers['content-type'],'audio/webm');
    assert.equal(req.url,'/v1/stream?cursor=7');
    res.setHeader('Content-Type','text/event-stream');
    res.setHeader('Set-Cookie','upstream=private');
    res.write('id: event-8\ndata: first\n\n');
    setTimeout(()=>res.end('data: second\n\n'),20);
  });
  try {
    await withGateway(async url => {
      for (const auth of [{authorization:'Bearer valid'}, {cookie:'__session=valid',origin:'https://app.example'}]) {
        const response = await fetch(url+'/api/gateway?__route=/v1/stream&cursor=7', {method:'POST',headers:{...auth,'content-type':'audio/webm','last-event-id':'event-7'},body:payload});
        assert.equal(response.status,200);
        assert.equal(response.headers.get('set-cookie'),null);
        assert.equal(response.headers.get('content-type'),'text/event-stream');
        assert.equal(response.headers.get('cache-control'),'private, no-store');
        const reader=response.body.getReader();
        assert.match(new TextDecoder().decode((await reader.read()).value),/first/);
        let rest=''; for (;;) {const x=await reader.read();if(x.done)break;rest+=new TextDecoder().decode(x.value);}
        assert.match(rest,/second/);
      }
    }, {env:{...env,KERNEL_ORIGIN:upstream.url,NODE_ENV:'development',ALLOW_LOCAL_KERNEL:'true'}});
    assert.equal(count,2);
  } finally {await upstream.close();}
});
test('official Clerk verifier rejects forged JWT and verifies locally signed RS256 JWT', async () => {
  const { verifyToken: clerkVerify } = await import('@clerk/backend');
  const { generateKeyPairSync, sign } = await import('node:crypto');
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const now=Math.floor(Date.now()/1000);
  const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const body=encode({alg:'RS256',typ:'JWT',kid:'test-key'})+'.'+encode({iss:'https://clerk.example',sub:'user_cryptographic',azp:'https://app.example',iat:now,nbf:now-1,exp:now+60,sid:'sess_test'});
  const token=body+'.'+sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url');
  const options={jwtKey:publicKey.export({type:'spki',format:'pem'}),authorizedParties:['https://app.example']};
  assert.equal((await clerkVerify(token,options)).sub,'user_cryptographic');
  await assert.rejects(()=>clerkVerify(body+'.'+Buffer.alloc(256).toString('base64url'),options));
  await assert.rejects(()=>clerkVerify(token,{...options,authorizedParties:['https://other.example']}));
});
