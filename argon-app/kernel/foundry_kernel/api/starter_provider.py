"""Encrypted venture-scoped tutor key. Never log, echo, or validate it with a paid call."""
import base64
import json
import os
import re
from pathlib import Path
from fastapi import Request
from pydantic import BaseModel, ConfigDict, SecretStr
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from ..errors import KernelError
from ..records import get_row
from ..ids import utc_now

class ProviderInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    api_key: SecretStr


def cipher(settings, create=True):
    root=Path(settings.data_dir)/'.secrets'
    if root.is_symlink(): raise KernelError(503,'secret_store_unavailable','Secure credential storage unavailable')
    root.mkdir(mode=0o700,parents=True,exist_ok=True);root.chmod(0o700)
    target=root/'starter-master.key'
    if not create and not target.exists(): raise KernelError(503,'secret_store_unavailable','Restore the server credential encryption key before using saved providers')
    if target.is_symlink(): raise KernelError(503,'secret_store_unavailable','Secure credential storage unavailable')
    try:
        fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    except FileExistsError: pass
    else:
        with os.fdopen(fd,'wb') as stream: stream.write(os.urandom(32))
    if target.stat().st_mode&0o077: raise KernelError(503,'secret_store_unavailable','Secure credential storage permissions require repair')
    return AESGCM(target.read_bytes())

async def configured(vid: str, request: Request):
    db=request.app.state.db
    await get_row(db,'ventures',vid)
    row=await db.fetch_one('SELECT key FROM kv WHERE key=?',('starter.openai.secret.'+vid,))
    return {'configured':bool(row)}

async def configure(vid: str, request: Request):
    db,cfg=request.app.state.db,request.app.state.settings
    await get_row(db,'ventures',vid)
    # Require an authenticated deployment, never expose a key collector on unauthenticated local mode.
    if not cfg.kernel_token: raise KernelError(403,'authentication_required','Configure owner authentication before storing a provider key')
    if request.headers.get('content-type','').split(';')[0].strip().lower() != 'application/json':
        raise KernelError(415,'unsupported_media_type','Provider configuration requires application/json')
    raw=bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw)>4096: raise KernelError(413,'too_large','Provider request exceeds size limit')
    try:
        body=ProviderInput.model_validate_json(bytes(raw))
        secret=body.api_key.get_secret_value()
        if not re.fullmatch(r'sk-[A-Za-z0-9_-]{16,500}',secret): raise ValueError()
    except Exception:
        raise KernelError(422,'invalid_provider_key','Enter a valid OpenAI API key in the secure provider form') from None
    nonce=os.urandom(12)
    encrypted=cipher(cfg).encrypt(nonce,secret.encode(),('starter.openai:'+vid).encode())
    value=base64.b64encode(nonce+encrypted).decode()
    async with db.tx() as tx:
        await tx.execute('INSERT INTO kv(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at',('starter.openai.secret.'+vid,json.dumps({'ciphertext':value}),utc_now()))
    return {'configured':True}

async def load_key(db,settings,vid):
    row=await db.fetch_one('SELECT value_json FROM kv WHERE key=?',('starter.openai.secret.'+vid,))
    if not row: return None
    raw=base64.b64decode(json.loads(row['value_json'])['ciphertext'])
    return SecretStr(cipher(settings,create=False).decrypt(raw[:12],raw[12:],('starter.openai:'+vid).encode()).decode())
