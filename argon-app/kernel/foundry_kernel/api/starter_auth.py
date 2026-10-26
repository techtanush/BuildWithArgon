"""Real preview accounts, never a replacement for the owner's gateway identity."""
import asyncio
import hashlib
import hmac
import ipaddress
import re
import secrets
import time
from urllib.parse import urlsplit

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, SecretStr, field_validator
from ..errors import KernelError

router = APIRouter(tags=['starter-auth'])
COOKIE = 'starter_session'
TTL = 86400

class Credentials(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    email: str
    password: SecretStr

    @field_validator('email')
    @classmethod
    def email_valid(cls, value):
        value = value.strip().lower()
        if len(value) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
            raise ValueError('Invalid email')
        return value

    @field_validator('password')
    @classmethod
    def password_valid(cls, value):
        if not 12 <= len(value.get_secret_value()) <= 128:
            raise ValueError('Password must contain 12 to 128 characters')
        return value

class EmptyBody(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)

def loopback(value):
    try:
        return ipaddress.ip_address(value).is_loopback
    except ValueError:
        return False

def same_origin(request, allow_referer=False):
    configured = urlsplit(str(request.app.state.settings.web_url))
    expected = f'{configured.scheme}://{configured.netloc}'
    origins = request.headers.getlist('origin')
    actual = origins[0] if len(origins) == 1 else None
    if not origins and allow_referer:
        refs = request.headers.getlist('referer')
        if len(refs) == 1:
            ref = urlsplit(refs[0])
            actual = f'{ref.scheme}://{ref.netloc}'
    if configured.scheme not in ('http', 'https') or not configured.netloc or actual != expected:
        raise KernelError(403, 'invalid_origin', 'Same-origin request required')

async def owned(request, vid):
    cfg = request.app.state.settings
    if not cfg.kernel_token:
        raise KernelError(403, 'owner_auth_required', 'Authenticated preview operator required')
    if cfg.auth_mode == 'local':
        # Existing private local-operator trust mode, NOT a manufactured Clerk identity.
        auth = request.headers.getlist('authorization')
        scheme, _, token = auth[0].partition(' ') if len(auth) == 1 else ('', '', '')
        if (not loopback(getattr(cfg, 'kernel_host', '')) or not request.client
                or not loopback(request.client.host) or scheme.lower() != 'bearer'
                or not hmac.compare_digest(token.encode(), cfg.kernel_token.get_secret_value().encode())):
            raise KernelError(403, 'owner_auth_required', 'Authenticated loopback preview operator required')
        same_origin(request, allow_referer=request.method == 'GET')
        row = await request.app.state.db.fetch_one('SELECT id FROM ventures WHERE id=?', (vid,))
        if not row:
            raise KernelError(404, 'not_found', 'Resource not found')
        return
    subject = getattr(request.state, 'user_id', None)
    if cfg.auth_mode != 'gateway' or not subject:
        raise KernelError(403, 'owner_auth_required', 'Preview accounts require the authenticated owner gateway')
    row = await request.app.state.db.fetch_one('SELECT owner_user_id FROM ventures WHERE id=?', (vid,))
    if not row or not (row['owner_user_id'] == subject or (row['owner_user_id'] is None and cfg.bootstrap_owner_subject == subject)):
        raise KernelError(404, 'not_found', 'Resource not found')

async def body_json(request, model):
    same_origin(request)
    if request.headers.get('content-type', '').split(';')[0].strip().lower() != 'application/json':
        raise KernelError(415, 'unsupported_media_type', 'application/json required')
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 4096:
            raise KernelError(413, 'too_large', 'Request too large')
    try:
        return model.model_validate_json(bytes(raw))
    except Exception:
        raise KernelError(422, 'invalid_credentials', 'Invalid account form; use an email and a 12 to 128 character password') from None

def derive(password, salt):
    return hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32)

async def rate_limit(db, vid):
    now = int(time.time())
    async with db.tx() as tx:
        row = await tx.fetch_one('SELECT * FROM starter_auth_limits WHERE venture_id=?', (vid,))
        start = row['window_start'] if row and now - row['window_start'] < 300 else now
        count = row['attempts'] if row and start == row['window_start'] else 0
        if count >= 10:
            raise KernelError(429, 'rate_limited', 'Too many account attempts; try again later')
        await tx.execute('INSERT INTO starter_auth_limits VALUES(?,?,?) ON CONFLICT(venture_id) DO UPDATE SET window_start=excluded.window_start,attempts=excluded.attempts', (vid, start, count + 1))

def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()

def result(user=None):
    return JSONResponse({'authenticated': user is not None, **({'user': {'id':user['id'], 'email':user['email']}} if user else {})}, headers={'Cache-Control':'no-store'})

async def issue(request, vid, user):
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    async with request.app.state.db.tx() as tx:
        await tx.execute('DELETE FROM starter_auth_sessions WHERE expires_at<=?', (now,))
        old = request.cookies.get(COOKIE)
        if old:
            await tx.execute('DELETE FROM starter_auth_sessions WHERE token_hash=? AND venture_id=?', (token_hash(old), vid))
        await tx.execute('INSERT INTO starter_auth_sessions VALUES(?,?,?,?)', (token_hash(token), vid, user['id'], now + TTL))
    response = result(user)
    response.set_cookie(COOKIE, token, max_age=TTL, httponly=True, samesite='lax', secure=urlsplit(str(request.app.state.settings.web_url)).scheme == 'https', path=f'/v1/ventures/{vid}/starter/')
    return response

async def require_starter_session(request: Request, venture_id: str):
    await owned(request, venture_id)
    token = request.cookies.get(COOKIE, '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
        raise KernelError(401, 'app_session_required', 'Sign in to the preview app first')
    row = await request.app.state.db.fetch_one('SELECT u.id,u.email FROM starter_auth_sessions s JOIN starter_auth_users u ON u.id=s.user_id AND u.venture_id=s.venture_id WHERE s.token_hash=? AND s.venture_id=? AND s.expires_at>?', (token_hash(token), venture_id, int(time.time())))
    if not row:
        raise KernelError(401, 'app_session_required', 'Sign in to the preview app first')
    return row

@router.post('/v1/ventures/{vid}/starter/auth/signup')
async def signup(vid: str, request: Request):
    await owned(request, vid)
    body = await body_json(request, Credentials)
    db = request.app.state.db
    await rate_limit(db, vid)
    salt = secrets.token_bytes(32)
    hashed = await asyncio.to_thread(derive, body.password.get_secret_value(), salt)
    user = {'id': secrets.token_hex(16), 'email': body.email}
    async with db.tx() as tx:
        if await tx.fetch_one('SELECT id FROM starter_auth_users WHERE venture_id=? AND email=?', (vid, body.email)):
            raise KernelError(409, 'account_unavailable', 'Unable to create account; try signing in')
        await tx.execute('INSERT INTO starter_auth_users VALUES(?,?,?,?,?)', (user['id'], vid, body.email, salt, hashed))
    return await issue(request, vid, user)

@router.post('/v1/ventures/{vid}/starter/auth/login')
async def login(vid: str, request: Request):
    await owned(request, vid)
    body = await body_json(request, Credentials)
    db = request.app.state.db
    await rate_limit(db, vid)
    user = await db.fetch_one('SELECT * FROM starter_auth_users WHERE venture_id=? AND email=?', (vid, body.email))
    hashed = await asyncio.to_thread(derive, body.password.get_secret_value(), user['salt'] if user else bytes(32))
    matches = hmac.compare_digest(hashed, user['password_hash'] if user else bytes(32))
    if not user or not matches:
        raise KernelError(401, 'invalid_credentials', 'Email or password is incorrect')
    return await issue(request, vid, user)

@router.post('/v1/ventures/{vid}/starter/auth/logout')
async def logout(vid: str, request: Request):
    await owned(request, vid)
    await body_json(request, EmptyBody)
    async with request.app.state.db.tx() as tx:
        await tx.execute('DELETE FROM starter_auth_sessions WHERE token_hash=? AND venture_id=?', (token_hash(request.cookies.get(COOKIE, '')), vid))
    response = result()
    response.delete_cookie(COOKIE, path=f'/v1/ventures/{vid}/starter/', httponly=True, samesite='lax', secure=urlsplit(str(request.app.state.settings.web_url)).scheme == 'https')
    return response

@router.get('/v1/ventures/{vid}/starter/auth/me')
async def me(vid: str, request: Request):
    return result(await require_starter_session(request, vid))
