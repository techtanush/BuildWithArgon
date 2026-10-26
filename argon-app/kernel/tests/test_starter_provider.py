import json
from types import SimpleNamespace
import pytest
from pydantic import SecretStr
from foundry_kernel.api.starter_provider import configure,configured,load_key
from foundry_kernel.errors import KernelError

async def test_encrypted_key_roundtrip_and_no_echo(db,settings):
    from tests.test_scheduler import company
    vid,scheduler=await company(db,settings)
    settings.kernel_token=SecretStr('unit-owner-token')
    secret='sk-unit-test-not-real-1234567890'
    async def stream(): yield json.dumps({'api_key':secret}).encode()
    req=SimpleNamespace(app=scheduler.app,stream=stream,headers={'content-type':'application/json'})
    assert await configure(vid,req)=={'configured':True}
    assert await configured(vid,req)=={'configured':True}
    row=await db.fetch_one('SELECT value_json FROM kv WHERE key=?',('starter.openai.secret.'+vid,))
    assert secret not in row['value_json']
    assert (await load_key(db,settings,vid)).get_secret_value()==secret
    assert (settings.data_dir/'.secrets'/'starter-master.key').stat().st_mode&0o077==0
    async def bad(): yield b'{"api_key":"do-not-echo-me"}'
    req.stream=bad
    with pytest.raises(KernelError) as err: await configure(vid,req)
    assert 'do-not-echo-me' not in str(err.value)
    async def huge(): yield b'x'*4097
    req.stream=huge
    with pytest.raises(KernelError) as err: await configure(vid,req)
    assert err.value.status_code==413
    await scheduler.stop()

async def test_openai_fixed_transport_ledger(db,settings,monkeypatch):
    from tests.test_scheduler import company
    from foundry_kernel.llm.starter_openai import generate
    vid,scheduler=await company(db,settings)
    async with db.tx() as tx:
        await tx.execute("INSERT INTO runs(id,venture_id,kind,job,model,status,created_at) VALUES('run_openai',?,'talk','starter_tutor','gpt-4o-mini','running','now')",(vid,))
    class Client:
        def __init__(self,**kw): assert kw['follow_redirects'] is False and kw['trust_env'] is False
        async def __aenter__(self): return self
        async def __aexit__(self,*args): pass
        async def post(self,url,**kw):
            assert url=='https://api.openai.com/v1/chat/completions'
            assert kw['json']['max_tokens']==512 and 'tools' not in kw['json']
            return SimpleNamespace(status_code=200,json=lambda:{'model':'gpt-4o-mini-2024-07-18','usage':{'prompt_tokens':100,'completion_tokens':20},'choices':[{'message':{'content':'Practice this equation.'}}]})
    monkeypatch.setattr('foundry_kernel.llm.starter_openai.httpx.AsyncClient',Client)
    result=await generate(db,key=SecretStr('unit-fake-key'),prompt='Tutor question',system='Teach',venture_id=vid,run_id='run_openai')
    assert result.tokens_out==20 and result.model=='gpt-4o-mini-2024-07-18'
    row=await db.fetch_one("SELECT * FROM ledger WHERE run_id='run_openai'")
    assert row['cost_usd']==pytest.approx(.000027)
    await scheduler.stop()

async def test_explicit_prebuilt_scenario_no_model_calls(db,settings):
    import asyncio
    from tests.test_scheduler import company
    from foundry_kernel.api.starter import start,status,StartStarter
    from foundry_kernel.departments.starter import TYPES
    vid,scheduler=await company(db,settings,status='draft')
    req=SimpleNamespace(app=scheduler.app)
    await start(vid,StartStarter(scenario='ai_tutor_demo'),req)
    for kind in TYPES:
        ticket=await db.fetch_one('SELECT id FROM tickets WHERE venture_id=? AND type=?',(vid,kind))
        await scheduler.dispatch(ticket['id']);await asyncio.gather(*list(scheduler.tasks.values()))
    data=(await status(vid,req))['data']
    assert data['status']=='ready',data
    assert all(r['model']=='none (deterministic)' for r in data['runs'])
    assert not scheduler.app.state.llm.calls
    await scheduler.stop()
