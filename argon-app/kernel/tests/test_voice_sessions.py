# OWNER: karthik
from pydantic import SecretStr
import json
import pytest
from foundry_kernel.contracts import VoiceSessionRequest
from foundry_kernel.voice import sessions, agents_setup
from foundry_kernel.voice.assign_voices import assign
from foundry_kernel.errors import GateNotApproved

class FakeDB:
    def __init__(self): self.items=None
    async def fetch_one(self,sql,params=()):
        if 'ventures' in sql: return {'id':'ven_TEST','name':'Test Venture'}
        if 'approvals' in sql: return None
        return {'value_json':self.items} if self.items else None
    def tx(self): return self
    async def __aenter__(self): return self
    async def __aexit__(self,*args): pass
    async def execute(self,sql,params=()): self.items=params[1] if sql.startswith('INSERT') else params[0]

async def test_unavailable_and_grounding(settings):
    db=FakeDB()
    result=await sessions.create_session(settings=settings,db=db,request=VoiceSessionRequest(agent_id='concierge',venture_id='ven_TEST'))
    assert result.provider=='unavailable'
    assert 'ask_company' in result.overrides.prompt and 'ONLY' in result.overrides.prompt
    assert 'Nova' in result.overrides.prompt and 'Test Venture' in result.overrides.prompt
    await sessions.end_session(settings=settings,db=db,session_id=result.session_id,summary={'turns':2})
    assert json.loads(db.items)[0]['turns']==2

async def test_token_is_not_stored(settings,monkeypatch):
    settings.llm_mode='live';settings.elevenlabs_api_key=SecretStr('account-secret');settings.elevenlabs_agent_id='agent_test'
    async def request(*args,**kwargs): return {'token':'temporary-token'}
    monkeypatch.setattr(sessions,'request_json',request)
    db=FakeDB()
    result=await sessions.create_session(settings=settings,db=db,request=VoiceSessionRequest(agent_id='concierge',venture_id='ven_TEST'))
    assert result.provider=='elevenlabs' and result.conversation_token=='temporary-token'
    assert 'temporary-token' not in db.items and 'account-secret' not in db.items

async def test_setup_defaults_dry_run(settings):
    result=await agents_setup.setup(settings=settings,db=None,approval_id=None)
    assert result['dry_run']
    assert result['configuration']['conversation_config']['agent']['prompt']['tools'][0]['expects_response']
    with pytest.raises(GateNotApproved):
        await agents_setup.setup(settings=settings,db=FakeDB(),approval_id=None,apply=True)

def test_assignment_distinct():
    roster={'agents':[{'id':str(i),'department_id':'eng','voice_hint':'calm'} for i in range(3)]}
    voices=[{'voice_id':f'voice{i}','name':'calm','labels':{}} for i in range(3)]
    assert len(set(assign(roster,voices).values()))==3
    with pytest.raises(ValueError): assign(roster,voices[:2])


@pytest.mark.parametrize('key,agent_id',[(None,None),('account-secret',None),(None,'agent_test')])
async def test_live_missing_credentials_unavailable_without_network(settings,monkeypatch,key,agent_id):
    settings.llm_mode='live'
    settings.elevenlabs_api_key=SecretStr(key) if key else None
    settings.elevenlabs_agent_id=agent_id
    async def never_request(*args,**kwargs):
        pytest.fail('Missing credentials must not trigger a provider request')
    monkeypatch.setattr(sessions,'request_json',never_request)
    db=FakeDB()
    result=await sessions.create_session(settings=settings,db=db,
        request=VoiceSessionRequest(agent_id='concierge',venture_id='ven_TEST'))
    assert result.provider=='unavailable'
    assert result.reason=='Live voice is not configured.'
    assert result.conversation_token is None and result.signed_url is None
    assert 'account-secret' not in db.items


@pytest.mark.parametrize('provider_available',[False,True])
def test_http_session_creation_end_and_credential_nonpersistence(client,settings,monkeypatch,provider_available):
    from foundry_kernel.ids import new_id, utc_now
    venture_id=new_id('ven')
    database=client.app.state.db
    async def seed_venture():
        async with database.tx() as tx:
            await tx.execute('INSERT INTO ventures (id,name,slug,idea,founder_name,composio_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
                (venture_id,'Voice Test',venture_id.lower(),'Test idea','Alex',f'foundry:{venture_id}',utc_now(),utc_now()))
    client.portal.call(seed_venture)
    settings.llm_mode='live'
    settings.elevenlabs_api_key=SecretStr('http-account-secret') if provider_available else None
    settings.elevenlabs_agent_id='agent_http' if provider_available else None
    calls=[]
    async def token_request(method,path,**kwargs):
        assert provider_available, 'Unconfigured HTTP sessions must not call the provider'
        calls.append((method,path))
        return {'token':'http-short-lived-token','conversation_id':'conv-provider'}
    monkeypatch.setattr(sessions,'request_json',token_request)
    response=client.post('/v1/voice/sessions',json={
        'agent_id':'concierge','venture_id':venture_id,'surface':'dashboard'})
    assert response.status_code==200,response.text
    result=response.json()['data']
    assert result['provider']==('elevenlabs' if provider_available else 'unavailable')
    assert result['conversation_token']==('http-short-lived-token' if provider_available else None)
    assert result['dynamic_variables']['venture_id']==venture_id
    assert len(calls)==(1 if provider_available else 0)
    stored=client.portal.call(database.fetch_one,'SELECT value_json FROM kv WHERE key = ?',('voice.sessions',))
    assert 'http-short-lived-token' not in stored['value_json']
    assert 'http-account-secret' not in stored['value_json']
    assert 'conversation_token' not in stored['value_json']
    end_url=f"/v1/voice/sessions/{result['session_id']}/end"
    response=client.post(end_url,json={'conversation_id':'conv-provider','duration_s':1.5,'answer_ids':['ans_test'],'turns':2})
    assert response.status_code==200 and response.json()=={'data':{'stored':True}}
    stored=client.portal.call(database.fetch_one,'SELECT value_json FROM kv WHERE key = ?',('voice.sessions',))
    metric=next(item for item in json.loads(stored['value_json']) if item['session_id']==result['session_id'])
    assert metric['venture_id']==venture_id and metric['turns']==2 and metric['duration_s']==1.5
    assert metric['answer_ids']==['ans_test'] and metric['ended_at']
    assert 'http-short-lived-token' not in stored['value_json'] and 'http-account-secret' not in stored['value_json']
    # End retries do not overwrite the first accepted metrics.
    assert client.post(end_url,json={'turns':99}).status_code==200
    again=client.portal.call(database.fetch_one,'SELECT value_json FROM kv WHERE key = ?',('voice.sessions',))
    assert again==stored
