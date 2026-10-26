"""Isolated temporary SQLite only: no providers, live DB, or network."""
import hashlib
from pathlib import Path
from types import SimpleNamespace
import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from httpx import AsyncClient, ASGITransport
from pydantic import SecretStr
from foundry_kernel.api import starter_auth as auth
from foundry_kernel.errors import KernelError

@pytest.fixture
async def harness(db):
    async with db.tx() as tx:
        for vid, owner in [('va','owner'),('vb','other')]:
            await tx.execute('INSERT INTO ventures(id,name,slug,idea,founder_name,composio_user_id,created_at,updated_at,owner_user_id) VALUES(?,?,?,?,?,?,?,?,?)', (vid,vid,vid,'test','test','test','now','now',owner))
    app = FastAPI()
    app.state.db = db
    app.state.settings = SimpleNamespace(auth_mode='gateway', kernel_token=SecretStr('fake-only'), bootstrap_owner_subject=None, web_url='https://preview.example')
    @app.middleware('http')
    async def fake_verified_gateway(request: Request, call_next):
        request.state.user_id = request.headers.get('x-test-owner', 'owner')
        return await call_next(request)
    @app.exception_handler(KernelError)
    async def error(request, exc):
        return JSONResponse({'error':exc.code},status_code=exc.status_code)
    app.include_router(auth.router)
    async with AsyncClient(transport=ASGITransport(app=app), base_url='https://preview.example', headers={'Origin':'https://preview.example'}) as client:
        yield client, db, app

BASE='/v1/ventures/va/starter/auth/'
CREDS={'email':'Learner@example.com','password':'fake-test-password-123'}

async def test_account_lifecycle_hashed_storage(harness):
    c, db, app = harness
    r=await c.post(BASE+'signup',json=CREDS)
    assert r.status_code == 200 and r.json()['user']['email']=='learner@example.com'
    cookie=r.headers['set-cookie']
    assert all(x in cookie for x in ['HttpOnly','Secure','SameSite=lax','Max-Age=86400','Path=/v1/ventures/va/starter/'])
    token=c.cookies.get(auth.COOKIE)
    user=await db.fetch_one('SELECT * FROM starter_auth_users')
    session=await db.fetch_one('SELECT * FROM starter_auth_sessions')
    assert len(user['salt'])==32 and len(user['password_hash'])==32
    assert session['token_hash']==hashlib.sha256(token.encode()).hexdigest()
    assert CREDS['password'] not in str(user) and token not in str(session)
    assert (await c.get(BASE+'me')).json()['authenticated']
    assert (await c.post(BASE+'logout',json={})).json()=={'authenticated':False}
    c.cookies.set(auth.COOKIE,token,path='/v1/ventures/va/starter/')
    assert (await c.get(BASE+'me')).status_code==401
    c.cookies.clear()
    assert (await c.post(BASE+'login',json={**CREDS,'password':'fake-wrong-password'})).status_code==401
    assert (await c.post(BASE+'login',json=CREDS)).status_code==200
    assert (await c.get(BASE+'me')).status_code==200

@pytest.mark.parametrize('payload',[{**CREDS,'extra':'secret'}, {**CREDS,'password':123}, {**CREDS,'password':'short'}, {**CREDS,'email':2}])
async def test_strict_no_echo(harness,payload):
    c,_,_=harness
    r=await c.post(BASE+'signup',json=payload)
    assert r.status_code==422
    assert 'password' not in r.text and 'secret' not in r.text

async def test_csrf_content_type_owner_and_scope(harness):
    c,db,app=harness
    assert (await c.post(BASE+'signup',json=CREDS,headers={'Origin':'https://evil.example'})).status_code==403
    assert (await c.post(BASE+'signup',content='{}',headers={'Content-Type':'text/plain'})).status_code==415
    assert (await c.post(BASE+'signup',json=CREDS,headers={'x-test-owner':'other'})).status_code==404
    assert (await c.post(BASE+'signup',json=CREDS)).status_code==200
    token=c.cookies.get(auth.COOKIE)
    c.cookies.clear()
    r=await c.get('/v1/ventures/vb/starter/auth/me',headers={'x-test-owner':'other','Cookie':f'{auth.COOKIE}={token}'})
    assert r.status_code==401
    app.state.settings.auth_mode='local'
    assert (await c.get(BASE+'me')).status_code==403

async def test_expiry_rate_and_rotation(harness):
    c,db,app=harness
    await c.post(BASE+'signup',json=CREDS)
    token=c.cookies.get(auth.COOKIE)
    await c.post(BASE+'login',json=CREDS)
    assert c.cookies.get(auth.COOKIE)!=token
    assert not await db.fetch_one('SELECT * FROM starter_auth_sessions WHERE token_hash=?',(auth.token_hash(token),))
    async with db.tx() as tx:
        await tx.execute('UPDATE starter_auth_sessions SET expires_at=0')
    assert (await c.get(BASE+'me')).status_code==401
    for _ in range(8):
        assert (await c.post(BASE+'login',json={**CREDS,'password':'fake-wrong-password'})).status_code==401
    assert (await c.post(BASE+'login',json=CREDS)).status_code==429

async def test_missing_origin_and_oversize(harness):
    c,_,_=harness
    c.headers.pop('origin')
    assert (await c.post(BASE+'signup',json=CREDS)).status_code==403
    c.headers['origin']='https://preview.example'
    assert (await c.post(BASE+'signup',json={**CREDS,'password':'x'*5000})).status_code==413

async def test_local_operator_real_bearer_loopback_origin(harness):
    c,db,app=harness
    app.state.settings.auth_mode='local'
    app.state.settings.kernel_host='127.0.0.1'
    assert (await c.post(BASE+'signup',json=CREDS)).status_code==403
    c.headers['Authorization']='Bearer wrong-fake-token'
    assert (await c.post(BASE+'signup',json=CREDS)).status_code==403
    c.headers['Authorization']='Bearer fake-only'
    assert (await c.post(BASE+'signup',json=CREDS,headers={'Origin':'https://evil.example'})).status_code==403
    assert (await c.post(BASE+'signup',json=CREDS)).status_code==200
    assert (await c.get(BASE+'me')).status_code==200
    c.headers.pop('Origin')
    assert (await c.get(BASE+'me')).status_code==403
    c.headers['Referer']='https://preview.example/v1/ventures/va/starter/preview'
    assert (await c.get(BASE+'me')).status_code==200
    # Referer is never sufficient for state-changing requests.
    assert (await c.post(BASE+'logout',json={})).status_code==403
    c.headers['Origin']='https://preview.example'
    assert (await c.post(BASE+'logout',json={})).status_code==200
    assert (await c.get(BASE+'me')).status_code==401
    app.state.settings.kernel_host='0.0.0.0'
    assert (await c.post(BASE+'login',json=CREDS)).status_code==403
    app.state.settings.kernel_host='127.0.0.1'
    async with AsyncClient(transport=ASGITransport(app=app,client=('192.0.2.1',1234)),base_url='https://preview.example',headers=dict(c.headers)) as remote:
        assert (await remote.post(BASE+'login',json=CREDS)).status_code==403
    app.state.settings.kernel_token=None
    assert (await c.post(BASE+'login',json=CREDS)).status_code==403
