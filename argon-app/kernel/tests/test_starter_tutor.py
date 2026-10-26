import json,time
from types import SimpleNamespace
import pytest
from pydantic import SecretStr
from foundry_kernel.api.starter_tutor import tutor,TutorRequest
from foundry_kernel.departments.starter_widget import attach_widget,SCRIPT,HASH,CSP
from foundry_kernel.contracts import LLMResult
from foundry_kernel.models import job
from foundry_kernel.errors import KernelError

def test_widget_safe_fixed_hash():
    import hashlib,base64
    assert HASH==base64.b64encode(hashlib.sha256(SCRIPT.encode()).digest()).decode()
    assert 'innerHTML' not in SCRIPT and 'textContent' in SCRIPT
    assert "connect-src 'self'" in CSP and "script-src 'sha256-" in CSP
    page=attach_widget('<main></main></body>')
    assert page.count('<script>')==1 and attach_widget(page)==page
    assert 'localStorage' not in SCRIPT and 'sessionStorage' not in SCRIPT
    assert 'type="password"' in page

def test_tutor_input_bounds():
    with pytest.raises(ValueError): TutorRequest(question='x'*2001)
    with pytest.raises(ValueError): TutorRequest(question='x',history=[{'role':'user','text':'x'}]*7)
    with pytest.raises(ValueError): TutorRequest(question='x',history=[{'role':'system','text':'x'}])

async def test_tutor_real_records_fake_provider(db,settings,monkeypatch):
    from tests.test_scheduler import company
    from foundry_kernel import ledger
    monkeypatch.setattr('foundry_kernel.api.starter_tutor.price_for',lambda m:(2.,10.))
    from unittest.mock import AsyncMock
    monkeypatch.setattr('foundry_kernel.api.starter_auth.require_starter_session',AsyncMock(return_value={'id':'unit-user'}))
    settings.llm_mode='live';settings.gemini_api_key=SecretStr('unit-not-real')
    class Fake:
        calls=0
        async def generate(self,name,prompt,**kw):
            self.calls+=1
            assert name=='starter_tutor' and kw['single_attempt']
            assert 'Pantry' not in prompt and 'founder' not in prompt
            async with db.tx() as tx:
                await ledger.record(tx,venture_id=kw['venture_id'],run_id=kw['run_id'],kind='model',model=job(name).model,cost_usd=.001)
            return LLMResult(text='Try dividing both sides by two. What do you get?',interaction_id='unit',model=job(name).model,cost_usd=.001)
    fake=Fake();vid,scheduler=await company(db,settings,llm=fake)
    async with db.tx() as tx:
        await tx.execute("INSERT INTO artifacts(id,venture_id,department_id,kind,title,meta_json,created_at) VALUES('art_tutor',?,'engineering','preview','Preview','{\"starter\":true}','now')",(vid,))
    request=SimpleNamespace(app=scheduler.app)
    result=await tutor(vid,TutorRequest(question='Help me solve 2x=8'),request)
    assert result['model']==job('starter_tutor').model and fake.calls==1
    run=await db.fetch_one('SELECT * FROM runs WHERE id=?',(result['run_id'],))
    assert run['status']=='succeeded' and run['job']=='starter_tutor'
    assert await db.fetch_one('SELECT id FROM ledger WHERE run_id=?',(result['run_id'],))
    key='starter.tutor.guard.'+vid
    async with db.tx() as tx:
        await tx.execute('UPDATE kv SET value_json=? WHERE key=?',(json.dumps({'requests':[time.time()]*10}),key))
    with pytest.raises(KernelError) as exc: await tutor(vid,TutorRequest(question='More'),request)
    assert exc.value.status_code==429 and fake.calls==1
    async with db.tx() as tx:
        await tx.execute('UPDATE kv SET value_json=? WHERE key=?',(json.dumps({'in_flight':'run_busy'}),key))
    with pytest.raises(KernelError): await tutor(vid,TutorRequest(question='More'),request)
    assert fake.calls==1
    await scheduler.stop()


def test_tutor_forms_allowed_but_native_navigation_restricted():
    from foundry_kernel.departments.starter_widget import CSP
    assert "sandbox allow-scripts allow-same-origin allow-forms" in CSP
    assert "form-action 'none'" in CSP
    assert "connect-src 'self'" in CSP
