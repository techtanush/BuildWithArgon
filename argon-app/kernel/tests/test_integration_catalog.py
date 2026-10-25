import httpx
import pytest
from pydantic import SecretStr
from fastapi.testclient import TestClient
from foundry_kernel.app import create_app
from foundry_kernel.integrations.composio import ComposioClient, ComposioError
from .test_composio_api import _venture, _approve

@pytest.mark.asyncio
async def test_catalog_search_cursor_and_safe_logos(settings):
    def handler(req):
        assert req.method == 'GET' and req.url.path == '/api/v3.1/toolkits'
        assert req.url.params['search'] == 'slack' and req.url.params['cursor'] == 'next'
        return httpx.Response(200, json={'items':[
            {'slug':'slack','name':'Slack','meta':{'logo':'https://logos.composio.dev/api/slack','description':'Team chat'}},
            {'slug':'bad','meta':{'logo':'javascript:alert(1)'}}], 'next_cursor':'more','total_items':2})
    c=ComposioClient(settings.model_copy(update={'composio_api_key':SecretStr('test')}),transport=httpx.MockTransport(handler))
    result=await c.toolkit_catalog('slack','next',2)
    assert result['items'][0]['logo'].startswith('https://')
    assert result['items'][1]['logo'] is None
    assert result['next_cursor']=='more'

@pytest.mark.asyncio
async def test_other_toolkit_never_uses_github_auth_config(settings):
    methods=[]
    def handler(req):
        methods.append(req.method)
        assert req.url.params['toolkit_slug']=='slack'
        return httpx.Response(200,json={'items':[{'id':'github-only','toolkit':{'slug':'github'},'status':'ENABLED'}]})
    c=ComposioClient(settings.model_copy(update={'composio_api_key':SecretStr('test')}),transport=httpx.MockTransport(handler))
    with pytest.raises(ComposioError, match='Requires configuration'):
        await c.toolkit_connect_link('slack','foundry:venture','https://example.com/integrations')
    assert methods==['GET']

def test_generic_connect_requires_matching_approval(settings,monkeypatch):
    calls=[]
    async def link(self,toolkit,user_id,callback_url):
        calls.append((toolkit,user_id))
        return {'redirect_url':'https://connect.composio.dev/test','connected_account_id':'ca_test'}
    monkeypatch.setattr(ComposioClient,'toolkit_connect_link',link)
    with TestClient(create_app(settings.model_copy(update={'composio_api_key':SecretStr('test')}))) as client:
        vid=_venture(client)
        path=f'/v1/ventures/{vid}/integrations/slack/connect'
        first=client.post(path,json={}).json()['data']
        assert first['status']=='waiting_approval' and not calls
        _approve(client,first['approval_id'])
        other=client.post(f'/v1/ventures/{vid}/integrations/notion/connect',json={}).json()['data']
        assert other['status']=='waiting_approval' and not calls
        response=client.post(path,json={}); assert response.status_code == 200, response.text; done=response.json()['data']
        assert done['status']=='pending' and calls==[('slack',f'foundry:{vid}')]
        rows=client.get(f'/v1/ventures/{vid}/integrations').json()['data']['items']
        assert any(x['provider']=='slack' and x['status']=='pending' for x in rows)
        second=_venture(client)
        assert client.post(f'/v1/ventures/{second}/integrations/slack/connect',json={}).json()['data']['status']=='waiting_approval'
        assert len(calls)==1

@pytest.mark.asyncio
async def test_status_is_toolkit_and_venture_bound(settings):
    def handler(req):
        return httpx.Response(200,json={'items':[
            {'toolkit':{'slug':'slack'},'user_id':'other','status':'ACTIVE','id':'foreign'},
            {'toolkit':{'slug':'github'},'user_id':'foundry:v','status':'ACTIVE','id':'github'}]})
    c=ComposioClient(settings.model_copy(update={'composio_api_key':SecretStr('test')}),transport=httpx.MockTransport(handler))
    assert await c.toolkit_connection_status('slack','foundry:v') == {'status':'not_connected','account_ref':None}


def test_catalog_keeps_existing_kernel_auth_boundary(settings):
    with TestClient(create_app(settings.model_copy(update={'kernel_token':SecretStr('private-test-token')}))) as client:
        assert client.get('/v1/ventures/any/integrations/catalog').status_code == 401
        assert client.post('/v1/ventures/any/integrations/slack/connect',json={}).status_code == 401


def test_migration_preserves_legacy_rows_and_repeat_application():
    import sqlite3
    from pathlib import Path
    con=sqlite3.connect(':memory:')
    con.execute('PRAGMA foreign_keys=ON')
    con.executescript("""
      CREATE TABLE ventures(id TEXT PRIMARY KEY);
      INSERT INTO ventures VALUES('v');
      CREATE TABLE integrations(id TEXT PRIMARY KEY, venture_id TEXT NOT NULL REFERENCES ventures(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK(provider IN ('github')), status TEXT NOT NULL CHECK(status IN ('not_connected','pending','active','error')),
        account_ref TEXT,data_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(venture_id,provider));
      INSERT INTO integrations VALUES('i','v','github','active','ca_original','{"preserved":true}','created','updated');
    """)
    original=con.execute('SELECT * FROM integrations').fetchall()
    script=(Path(__file__).parents[1]/'foundry_kernel/migrations/0005_integration_catalog.sql').read_text()
    for _ in range(2):
        con.executescript('BEGIN IMMEDIATE;'+script+'COMMIT;')
        assert con.execute('SELECT * FROM integrations').fetchall()==original
        assert con.execute('PRAGMA foreign_key_check').fetchall()==[]
    con.execute("INSERT INTO integrations VALUES('j','v','slack','pending',NULL,'{}','c','u')")
    with pytest.raises(sqlite3.IntegrityError):
        con.execute("INSERT INTO integrations VALUES('k','v','slack','pending',NULL,'{}','c','u')")
    with pytest.raises(sqlite3.IntegrityError):
        con.execute("INSERT INTO integrations VALUES('k','v','https://evil','pending',NULL,'{}','c','u')")
    con.execute("DELETE FROM ventures WHERE id='v'")
    assert con.execute('SELECT COUNT(*) FROM integrations').fetchone()[0]==0
