"""Gateway tests use temporary SQLite and fake providers only."""
import sqlite3
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from foundry_kernel.app import create_app
from foundry_kernel.tenant_auth import ALLOWED

TOKEN = 'test-private-gateway-key'
def headers(subject='user_alice'):
    return {'Authorization': 'Bearer ' + TOKEN, 'x-ycbf-user-id': subject}

def create(c, who='user_alice'):
    r = c.post('/v1/ventures', headers=headers(who), json={
        'name': who, 'idea': 'A private idea', 'founder_name': who,
        'owner_user_id': 'user_bob'})
    assert r.status_code == 200, r.text
    return r.json()['data']['id']

@pytest.fixture
def gateway(settings):
    settings.auth_mode = 'gateway'
    settings.kernel_token = SecretStr(TOKEN)
    with TestClient(create_app(settings)) as c:
        yield c

@pytest.mark.parametrize('token', [None, '', '   '])
def test_gateway_requires_secret(settings, token):
    settings.auth_mode = 'gateway'
    settings.kernel_token = SecretStr(token) if token is not None else None
    with pytest.raises(RuntimeError, match='KERNEL_TOKEN'):
        create_app(settings)

@pytest.mark.parametrize('extra', [{}, {'x-ycbf-user-id':'user_alice'},
    {'Authorization':'Bearer wrong','x-ycbf-user-id':'user_alice'},
    {'Authorization':'Bearer '+TOKEN},
    {'Authorization':'Bearer '+TOKEN,'x-ycbf-user-id':'bad subject'},
    {'Authorization':'Bearer '+TOKEN,'x-ycbf-user-id':'a,b'}])
def test_identity_requires_private_bearer_and_valid_subject(gateway, extra):
    assert gateway.get('/v1/ventures', headers=extra).status_code == 401

def test_create_list_ownership_and_pagination(gateway):
    a = create(gateway)
    b = create(gateway, 'user_bob')
    a2 = create(gateway)
    first = gateway.get('/v1/ventures?limit=1', headers=headers()).json()['data']
    assert first['items'][0]['id'] == a2
    last = gateway.get('/v1/ventures', params={'cursor':first['next_cursor']}, headers=headers()).json()['data']
    assert [x['id'] for x in last['items']] == [a]
    assert gateway.get('/v1/ventures/'+b, headers=headers()).status_code == 404
    assert gateway.get('/v1/ventures/'+b, headers=headers('user_bob')).status_code == 200
    with sqlite3.connect(gateway.app.state.settings.db_path) as db:
        assert db.execute('SELECT owner_user_id FROM ventures WHERE id=?',(a,)).fetchone()[0] == 'user_alice'

@pytest.mark.parametrize('method,path', sorted(ALLOWED - {('POST','/v1/ventures'),('GET','/v1/ventures'),('GET','/v1/world/manifest'),('GET','/v1/system/status')}))
def test_all_private_routes_deny_foreign_or_missing_entities(gateway, method, path):
    b = create(gateway, 'user_bob')
    import re
    url = re.sub(r'\{[^}]+\}', lambda m: b if m.group()=='{vid}' else 'missing', path)
    body = {'venture_id':b,'agent_id':'concierge'}
    response = gateway.request(method, url, headers=headers(), json=body)
    assert response.status_code == 404, (method,path,response.text)

def test_voice_body_replayed_and_session_end_owned(gateway):
    a, b = create(gateway), create(gateway,'user_bob')
    payload = {'venture_id':a,'agent_id':'concierge'}
    r = gateway.post('/v1/voice/sessions', headers=headers(), json=payload)
    assert r.status_code == 200, r.text
    sid = r.json()['data']['session_id']
    assert r.json()['data']['dynamic_variables']['venture_id'] == a
    assert gateway.post('/v1/voice/sessions', headers=headers(), json={**payload,'venture_id':b}).status_code == 404
    assert gateway.post(f'/v1/voice/sessions/{sid}/end',headers=headers('user_bob'),json={}).status_code == 404
    assert gateway.post(f'/v1/voice/sessions/{sid}/end',headers=headers(),json={'turns':7}).status_code == 200
    with sqlite3.connect(gateway.app.state.settings.db_path) as db:
        assert '"turns": 7' in db.execute("SELECT value_json FROM kv WHERE key='voice.sessions'").fetchone()[0]

def test_channel_body_replay_and_query_scopes(gateway):
    a,b = create(gateway),create(gateway,'user_bob')
    cid = gateway.get(f'/v1/ventures/{a}/channels',headers=headers()).json()['data']['items'][0]['id']
    r = gateway.post(f'/v1/channels/{cid}/messages',headers=headers(),json={'body':'Private hello','author_name':'Alice'})
    assert r.status_code == 200, r.text
    assert r.json()['data']['body'] == 'Private hello'
    assert gateway.get('/v1/world/manifest',params={'venture':b},headers=headers()).status_code == 404
    assert gateway.get('/v1/world/manifest',params={'venture':a},headers=headers()).status_code == 200
    assert gateway.get(f'/v1/ventures/{a}/runs?ticket_id=missing',headers=headers()).status_code == 404

def test_unscoped_and_new_routes_fail_closed(gateway):
    @gateway.app.get('/v1/new-private-data')
    async def new_route():
        return {'secret':'never exposed'}
    for url in ['/v1/new-private-data','/v1/evals/latest',
                '/v1/world/worldgen/runs','/media/audio/'+'a'*64+'.mp3','/openapi.json']:
        assert gateway.get(url,headers=headers()).status_code == 403
    assert gateway.post('/v1/voice/tts',headers=headers(),json={'text':'secret'}).status_code == 403
    assert gateway.get('/health').status_code == 200

def test_legacy_is_not_claimed_and_bootstrap_is_explicit(settings):
    with TestClient(create_app(settings)) as c:
        vid = c.post('/v1/ventures',json={'name':'Legacy','idea':'Private','founder_name':'Old'}).json()['data']['id']
    settings.auth_mode='gateway'
    settings.kernel_token=SecretStr(TOKEN)
    with TestClient(create_app(settings)) as c:
        assert c.get('/v1/ventures',headers=headers()).json()['data']['items'] == []
        create(c)
        assert c.get('/v1/ventures/'+vid,headers=headers()).status_code == 404
    settings.bootstrap_owner_subject='user_operator'
    with TestClient(create_app(settings)) as c:
        assert c.get('/v1/ventures/'+vid,headers=headers('user_operator')).status_code == 200
        assert c.get('/v1/ventures/'+vid,headers=headers()).status_code == 404
    with sqlite3.connect(settings.db_path) as db:
        assert db.execute('SELECT owner_user_id FROM ventures WHERE id=?',(vid,)).fetchone()[0] is None
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
        assert 'idx_ventures_owner_created' in {r[1] for r in db.execute('PRAGMA index_list(ventures)')}

def test_foreign_existing_channel_and_message_are_hidden(gateway):
    a,b = create(gateway),create(gateway,'user_bob')
    ac = gateway.get(f'/v1/ventures/{a}/channels',headers=headers()).json()['data']['items'][0]['id']
    bc = gateway.get(f'/v1/ventures/{b}/channels',headers=headers('user_bob')).json()['data']['items'][0]['id']
    msg = gateway.post(f'/v1/channels/{bc}/messages',headers=headers('user_bob'),json={'body':'Bob private','author_name':'Bob'}).json()['data']['id']
    assert gateway.get(f'/v1/channels/{bc}/messages',headers=headers()).status_code == 404
    assert gateway.post(f'/v1/channels/{bc}/messages',headers=headers(),json={'body':'intrusion','author_name':'Alice'}).status_code == 404
    assert gateway.post(f'/v1/channels/{ac}/messages',headers=headers(),json={'body':'cross ref','author_name':'Alice','thread_root_id':msg}).status_code == 404
    assert gateway.get(f'/v1/channels/{ac}/messages',headers=headers(),params={'thread_root_id':msg}).status_code == 404

def test_allowlist_matches_actual_registered_router_paths():
    from foundry_kernel.api import ROUTERS, player_avatar, voice_fast
    from foundry_kernel import treasury, agent_wallets, wallet_payments
    modules = [*ROUTERS,player_avatar,voice_fast,treasury,agent_wallets,wallet_payments]
    discovered = {(method, route.path) for module in modules for route in module.router.routes
                  for method in route.methods}
    assert ALLOWED <= discovered
    # No wildcard authorization of future private routes.
    assert ('POST','/v1/ventures/{vid}/tickets') not in ALLOWED
    assert ('GET','/v1/ventures/{vid}/metrics') not in ALLOWED
    assert ('GET','/media/audio/{sha}.mp3') not in ALLOWED


def test_hosted_bootstrap_only_exposes_safe_flags(gateway):
    with sqlite3.connect(gateway.app.state.settings.db_path) as db:
        db.execute("INSERT INTO kv(key,value_json,updated_at) VALUES('executor.override','\"operator-private-value\"','now')")
    response = gateway.get('/v1/system/status',headers=headers())
    assert response.status_code == 200
    data = response.json()['data']
    assert data['worldgen'] == {'last_run_id':None,'final_score':None}
    assert data['executor'] == gateway.app.state.settings.engineering_executor
    assert all(p['last_ok_at'] is None for p in data['providers'].values())
    assert 'operator-private-value' not in response.text
    assert gateway.post('/v1/system/status',headers=headers(),json={}).status_code == 403
