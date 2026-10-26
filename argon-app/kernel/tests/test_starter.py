from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from foundry_kernel.departments.starter import LandingContent, render, require_live, cost_bound, root_for, TYPES, StarterHandler, selected_job
from foundry_kernel.departments import load_handler
from foundry_kernel.api.starter import StartStarter
from foundry_kernel.scheduler import ticket_job

def test_safe_renderer():
    content=LandingContent(title='<script>bad</script>', headline='Exact founder concept', description='Useful <img src=x onerror=bad>', features=['<iframe>'], plan=['Implement'])
    output=render(content)
    assert output.count('<script>') == 1 and '<img' not in output and '<iframe' not in output
    assert '&lt;script&gt;' in output and 'Exact founder concept' in output
    assert 'Private tutor accounts' in output

def test_live_and_cap_fail_closed(settings, monkeypatch):
    with pytest.raises(ValueError): require_live(settings)
    monkeypatch.setattr('foundry_kernel.departments.starter.price_for', lambda m: None)
    with pytest.raises(ValueError): cost_bound()
    with pytest.raises(ValueError): StartStarter(budget_usd=1)
    with pytest.raises(ValueError): root_for(settings, '../escape')

def test_registration():
    for kind in TYPES:
        assert isinstance(load_handler(kind), StarterHandler)
        assert ticket_job({'type':kind}, {}) == selected_job()

def test_endpoint_refuses_fake(client):
    vid=client.post('/v1/ventures',json={'name':'Test','idea':'Exact concept','founder_name':'Test'}).json()['data']['id']
    r=client.post(f'/v1/ventures/{vid}/starter/start',json={})
    assert r.status_code == 409
    data=client.get(f'/v1/ventures/{vid}/starter').json()['data']
    assert data['status']=='not_started' and data['preview_url'] is None
    assert client.get(f'/v1/ventures/{vid}/starter/preview').status_code==404

async def test_deterministic_stages(settings, db):
    content=LandingContent(title='App',headline='Actual idea',description='Prototype',features=['One'],plan=['Build'])
    root=root_for(settings,'ven_test');root.mkdir(parents=True)
    (root/'content.json').write_text(content.model_dump_json())
    ctx=SimpleNamespace(settings=settings,db=db,venture={'id':'ven_test'},run_id='run_test')
    build=await StarterHandler().handle({'id':'tkt_test','type':'starter.build'},ctx)
    assert build.outcome=='done' and (root/'index.html').is_file()
    qa=await StarterHandler().handle({'id':'tkt_test','type':'starter.qa'},ctx)
    assert qa.outcome=='done'
    review=await StarterHandler().handle({'id':'tkt_test','type':'starter.review'},ctx)
    assert review.outcome=='done' and review.artifacts[0].uri.endswith('/starter/preview')
    (root/'index.html').write_text('<script>bad</script>')
    qa=await StarterHandler().handle({'id':'tkt_test','type':'starter.qa'},ctx)
    assert qa.outcome=='blocked'

async def test_real_scheduler_chain_with_fake_provider(db, settings, monkeypatch):
    import asyncio
    from pydantic import SecretStr
    from tests.test_scheduler import company
    from foundry_kernel.api.starter import start, status, preview
    from foundry_kernel.contracts import LLMResult
    from foundry_kernel.models import job
    from foundry_kernel import ledger
    settings.llm_mode='live'
    settings.gemini_api_key=SecretStr('unit-test-not-a-real-key')
    monkeypatch.setattr('foundry_kernel.departments.starter.price_for', lambda m: (0.3, 2.5))
    class FakeProvider:
        calls=0
        async def generate(self, name, prompt, **kw):
            self.calls+=1
            assert 'Track ingredients in a pantry' in prompt
            async with db.tx() as tx:
                await ledger.record(tx, venture_id=kw['venture_id'], run_id=kw['run_id'], kind='model', cost_usd=.001, model=job(name).model)
            return LLMResult(text=LandingContent(title='Pantry',headline='Know your ingredients',description='Pantry concept',features=['Track items'],plan=['Build static prototype']).model_dump_json(), model=job(name).model, interaction_id='unit', cost_usd=.001)
    provider=FakeProvider()
    vid, scheduler=await company(db,settings,llm=provider,status='draft')
    request=SimpleNamespace(app=scheduler.app)
    initial=await start(vid,StartStarter(),request)
    assert initial['data']['status']=='queued'
    again=await start(vid,StartStarter(),request)
    assert len(again['data']['tickets'])==4
    for kind in TYPES:
        ticket=await db.fetch_one('SELECT id FROM tickets WHERE venture_id=? AND type=?',(vid,kind))
        await scheduler.dispatch(ticket['id'])
        await asyncio.gather(*list(scheduler.tasks.values()))
    data=(await status(vid,request))['data']
    assert [t['status'] for t in data['tickets']]==['done']*4, data
    assert data['status']=='ready' and provider.calls==1
    assert len(data['runs'])==4 and len(data['artifacts'])==4
    assert sum(r['model']=='none (deterministic)' for r in data['runs'])==3
    assert (await preview(vid,request)).status_code==200
    msg=await db.fetch_one("SELECT body FROM messages WHERE venture_id=? AND body LIKE 'Landing-page starter built%'",(vid,))
    assert data['preview_url'] in msg['body']
    assert await db.fetch_one("SELECT id FROM events WHERE venture_id=? AND type='artifact.created'",(vid,))
    await scheduler.stop()

def test_known_price_argon_fallback(monkeypatch):
    from foundry_kernel.models import ARGON
    monkeypatch.setattr('foundry_kernel.departments.starter.price_for', lambda model: (2.,10.) if model==ARGON else None)
    assert selected_job()=='starter_content'
    assert cost_bound()==pytest.approx(.08896)

async def test_gateway_starter_is_owned():
    from foundry_kernel.tenant_auth import ALLOWED
    assert ('POST','/v1/ventures/{vid}/starter/start') in ALLOWED
    assert ('GET','/v1/ventures/{vid}/starter') in ALLOWED
    assert ('GET','/v1/ventures/{vid}/starter/preview') in ALLOWED

def test_gateway_isolates_all_starter_routes(settings):
    from pydantic import SecretStr
    from fastapi.testclient import TestClient
    from foundry_kernel.app import create_app
    settings.auth_mode='gateway';settings.kernel_token=SecretStr('unit-gateway-token')
    alice={'Authorization':'Bearer unit-gateway-token','x-ycbf-user-id':'alice'}
    bob={**alice,'x-ycbf-user-id':'bob'}
    with TestClient(create_app(settings)) as client:
        vid=client.post('/v1/ventures',headers=alice,json={'name':'Owned','idea':'Founder idea','founder_name':'Alice'}).json()['data']['id']
        assert client.get(f'/v1/ventures/{vid}/starter',headers=alice).status_code==200
        assert client.get(f'/v1/ventures/{vid}/starter',headers=bob).status_code==404
        assert client.get(f'/v1/ventures/{vid}/starter/preview',headers=bob).status_code==404
        assert client.post(f'/v1/ventures/{vid}/starter/start',headers=bob,json={}).status_code==404
        assert client.post(f'/v1/ventures/{vid}/starter/tutor',headers=bob,json={'question':'x'}).status_code==404
        assert client.get(f'/v1/ventures/{vid}/starter/provider',headers=bob).status_code==404
        assert client.post(f'/v1/ventures/{vid}/starter/provider',headers=bob,json={'api_key':'unit'}).status_code==404
        assert client.post(f'/v1/ventures/{vid}/starter/tutor',headers=alice,json={'question':'x'}).status_code==401
        auth_headers={**alice,'Origin':settings.web_url}
        signup=client.post(f'/v1/ventures/{vid}/starter/auth/signup',headers=auth_headers,json={'email':'learner@example.test','password':'unit-password-123'})
        assert signup.status_code==200 and signup.json()['authenticated']
        assert client.get(f'/v1/ventures/{vid}/starter/auth/me',headers=alice).status_code==200
        assert client.post(f'/v1/ventures/{vid}/starter/auth/logout',headers=auth_headers,json={}).status_code==200
        assert client.post(f'/v1/ventures/{vid}/starter/tutor',headers=alice,json={'question':'x'}).status_code==401

async def test_single_provider_attempt_never_enters_kernel_retry(settings):
    from foundry_kernel.llm.client import LLMClient
    provider=LLMClient(settings)
    create=AsyncMock(side_effect=RuntimeError('unit fake provider failed'))
    provider._client=SimpleNamespace(aio=SimpleNamespace(interactions=SimpleNamespace(create=create)))
    provider._with_retries=AsyncMock(side_effect=AssertionError('must not retry'))
    with pytest.raises(RuntimeError):
        await provider._create({}, 1, None, 'starter_content', single_attempt=True)
    assert create.await_count==1 and provider._with_retries.await_count==0

@pytest.mark.parametrize('mode', ['live', 'fake'])
async def test_prebuilt_real_start_messages_and_runtime_pacing(db, settings, monkeypatch, mode):
    import asyncio
    import json
    from tests.test_scheduler import company
    from foundry_kernel.api.starter import start, status
    from foundry_kernel.departments import starter as module
    provider = SimpleNamespace(generate=AsyncMock(side_effect=AssertionError('prebuilt must not call provider')))
    settings.llm_mode = mode
    vid, scheduler = await company(db, settings, llm=provider, status='draft')
    request = SimpleNamespace(app=scheduler.app)
    await start(vid, StartStarter(scenario='ai_tutor_demo'), request)
    observed = []
    async def inspect_sleep(seconds):
        assert seconds == 2.5
        data = (await status(vid, request))['data']
        assert data['status'] == 'running' and data['preview_url'] is None
        run = await db.fetch_one("SELECT * FROM runs WHERE venture_id=? AND status='running'", (vid,))
        assert run is not None
        message = await db.fetch_one("SELECT * FROM messages WHERE venture_id=? AND body LIKE 'Prebuilt tutor demo:%' ORDER BY rowid DESC LIMIT 1", (vid,))
        assert message and 'No model-generated code' in message['body']
        assert await db.fetch_one("SELECT id FROM events WHERE venture_id=? AND type='message.posted' AND entity_id=?", (vid, message['id']))
        observed.append(message['body'])
    monkeypatch.setattr(module, 'asyncio', SimpleNamespace(sleep=inspect_sleep))
    for kind in TYPES:
        ticket = await db.fetch_one('SELECT id FROM tickets WHERE venture_id=? AND type=?', (vid, kind))
        await scheduler.dispatch(ticket['id'])
        await asyncio.gather(*list(scheduler.tasks.values()))
    data = (await status(vid, request))['data']
    assert data['status'] == 'ready', data
    assert len(observed) == (4 if mode == 'live' else 0)
    messages = await db.fetch_all("SELECT body FROM messages WHERE venture_id=? AND body LIKE 'Prebuilt tutor demo:%'", (vid,))
    assert len(messages) == 4
    assert all(r['model'] == 'none (deterministic)' and r['cost_usd'] == 0 for r in data['runs'])
    artifacts = await db.fetch_all('SELECT * FROM artifacts WHERE venture_id=?', (vid,))
    assert all(json.loads(a['meta_json'])['source'] == 'prebuilt_demo' for a in artifacts)
    preview = next(a for a in artifacts if a['kind'] == 'preview')
    assert 'no model-generated code or content' in preview['content_md']
    provider.generate.assert_not_awaited()
    await scheduler.stop()
