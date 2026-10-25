import copy
import json
import pytest
from pydantic import SecretStr
from foundry_kernel.voice import agents_setup as setup
from foundry_kernel.errors import GateNotApproved

class ApprovalDB:
    def __init__(self, payload, *, status='approved', venture='ven_test', exists=True):
        self.row = dict(payload_json=json.dumps(payload), venture_id=venture,
                        status=status, gate_type='new_capability')
        self.exists = exists
    async def fetch_one(self, sql, params=()):
        if 'approvals' in sql: return self.row
        if 'ventures' in sql: return {'id': params[0]} if self.exists else None

def existing_agent():
    return {'agent_id': 'agent_existing', 'name': 'Existing Foundry name',
        'conversation_config': {'tts': {'voice_id': 'original_voice',
            'model_id': 'eleven_v4_turbo', 'stability': 0.5, 'speed': 1}}}


def verified_provider(inner):
    state = existing_agent()
    async def provider(method, path, **kwargs):
        provider.calls.append((method, path))
        if method == 'GET' and path == '/convai/agents/agent_existing':
            return copy.deepcopy(state)
        result = await inner(method, path, **kwargs)
        if method == 'PATCH':
            patch = copy.deepcopy(kwargs['payload'])
            state['conversation_config'].update(patch['conversation_config'])
            state['platform_settings'] = patch['platform_settings']
            # Extra server defaults do not invalidate otherwise exact readback.
            state['conversation_config']['tts']['similarity_boost'] = 0.75
        return result
    provider.calls = []
    return provider


@pytest.fixture
def live(settings):
    settings.llm_mode = 'live'
    settings.elevenlabs_api_key = SecretStr('never-expose-account-secret')
    settings.elevenlabs_agent_id = 'agent_existing'
    return settings

def payload():
    return setup.approval_payload(agent_id='agent_existing', venture_id='ven_test')

async def test_offline_plan_hash_and_dry_run(live, monkeypatch):
    async def no_call(*a, **k): pytest.fail('dry run must be offline')
    monkeypatch.setattr(setup, 'request_json', no_call)
    result = await setup.setup(settings=live, db=None, approval_id=None, venture_id='ven_test')
    assert result['dry_run'] and result['approval_payload'] == payload()
    assert payload() == payload()
    assert payload()['configuration_hash'] != setup.approval_payload(
        agent_id='agent_existing', venture_id='ven_test', llm='gemini-2.0-flash')['configuration_hash']
    assert 'never-expose-account-secret' not in json.dumps(result)
    assert payload()['configuration']['standalone_tool'] == setup.tool_configuration()
    assert payload()['purpose'] == 'elevenlabs_agent_update'

@pytest.mark.parametrize('change', ['purpose','provider','agent_id','venture_id','configuration_hash',
                                  'configuration','scope','shared_agent_acknowledged','operation','denied','wrong_venture','missing_venture','missing_agent'])
async def test_scope_gate_denies_before_any_provider_call(live, monkeypatch, change):
    p = payload()
    db = ApprovalDB(p)
    if change in p: p[change] = 'wrong'; db = ApprovalDB(p)
    elif change == 'denied': db.row['status'] = 'rejected'
    elif change == 'wrong_venture': db.row['venture_id'] = 'ven_other'
    elif change == 'missing_venture': db.exists = False
    elif change == 'missing_agent': live.elevenlabs_agent_id = None
    async def no_call(*a, **k): pytest.fail('denied gate must not call provider')
    monkeypatch.setattr(setup, 'request_json', no_call)
    with pytest.raises(GateNotApproved):
        await setup.setup(settings=live, db=db, approval_id='apr_test', apply=True, venture_id='ven_test')

@pytest.mark.parametrize('reuse', [False, True])
async def test_update_only_and_standalone_tool_after_approval(live, monkeypatch, reuse):
    calls = []
    config = setup.tool_configuration()['tool_config']
    async def provider(method, path, **kwargs):
        calls.append((method,path,kwargs))
        if method == 'GET':
            return {'tools': [{'id':'tool_existing','tool_config':config}] if reuse else [], 'has_more':False}
        if path == '/convai/tools':
            assert kwargs['payload'] == setup.tool_configuration()
            return {'id':'tool_created'}
        assert method == 'PATCH' and path == '/convai/agents/agent_existing'
        return {'agent_id':'agent_existing'}
    wrapped = verified_provider(provider)
    monkeypatch.setattr(setup, 'request_json', wrapped)
    result = await setup.setup(settings=live, db=ApprovalDB(payload()), approval_id='apr_test', apply=True)
    assert result == {'agent_id':'agent_existing'}
    assert wrapped.calls[0] == ('GET','/convai/agents/agent_existing')
    assert wrapped.calls[-1] == ('GET','/convai/agents/agent_existing')
    assert [c[0] for c in calls] == (['GET','PATCH'] if reuse else ['GET','POST','PATCH'])
    patch = calls[-1][2]['payload']
    assert 'tts' not in patch['conversation_config']
    assert 'name' not in patch
    assert patch['conversation_config']['agent']['prompt']['tool_ids'] == ['tool_existing' if reuse else 'tool_created']
    assert 'tools' not in patch['conversation_config']['agent']['prompt']
    assert patch['platform_settings'] == {'auth':{'enable_auth':True}, 'overrides':{
        'conversation_config_override': {'agent': {'prompt':{'prompt':True}, 'first_message':True}, 'tts':{'voice_id':True}}}}
    assert all('/agents/create' not in c[1] for c in calls)

def test_match_rejects_same_name_different_schema_and_normalizes_defaults():
    c = copy.deepcopy(setup.tool_configuration()['tool_config'])
    c.update(interruption_mode='allow', assignments=[], execution_mode='immediate')
    c['parameters']['properties']['question'].update(enum=None, constant_value='', is_omitted=False)
    assert setup._matching_tool(c)
    c['expects_response'] = False
    assert not setup._matching_tool(c)

async def test_provider_error_is_generic(live, monkeypatch):
    async def fail(*a, **k): raise RuntimeError('never-expose-account-secret token-secret')
    monkeypatch.setattr(setup, 'request_json', fail)
    with pytest.raises(ValueError) as exc:
        await setup.setup(settings=live, db=ApprovalDB(payload()), approval_id='apr_test', apply=True)
    assert str(exc.value) == 'Voice configuration existing agent verification failed'
    assert exc.value.__suppress_context__

async def test_paginated_exact_match_ignores_same_name_and_mocked_tools(live, monkeypatch):
    calls = []
    config = setup.tool_configuration()['tool_config']
    wrong = copy.deepcopy(config)
    wrong['parameters']['required'] = []
    async def provider(method,path,**kwargs):
        calls.append((method,path))
        if method == 'GET' and not kwargs['params'].get('cursor'):
            return {'tools':[{'id':'tool_wrong','tool_config':wrong},
                {'id':'tool_mocked','tool_config':config,'response_mocks':[{'response':'invented facts'}]}],
                'has_more':True,'next_cursor':'page2'}
        if method == 'GET':
            assert kwargs['params']['cursor'] == 'page2'
            return {'tools':[{'id':'tool_exact','tool_config':config}], 'has_more':False}
        assert method == 'PATCH'
        assert kwargs['payload']['conversation_config']['agent']['prompt']['tool_ids'] == ['tool_exact']
        return {}
    monkeypatch.setattr(setup,'request_json',verified_provider(provider))
    await setup.setup(settings=live,db=ApprovalDB(payload()),approval_id='apr_test',apply=True)
    assert [m for m,p in calls] == ['GET','GET','PATCH']

@pytest.mark.parametrize('initial', [{}, {'agent_id':'other_agent'}, None])
async def test_missing_or_wrong_existing_agent_prevents_every_write(live, monkeypatch, initial):
    calls = []
    async def provider(method, path, **kwargs):
        calls.append((method,path))
        assert (method,path) == ('GET','/convai/agents/agent_existing')
        if initial is None: raise RuntimeError('404 private provider response account-secret')
        return initial
    monkeypatch.setattr(setup,'request_json',provider)
    with pytest.raises(ValueError, match='^Voice configuration existing agent verification failed$'):
        await setup.setup(settings=live, db=ApprovalDB(payload()), approval_id='apr_test', apply=True)
    assert calls == [('GET','/convai/agents/agent_existing')]

@pytest.mark.parametrize('field', ['id','prompt','llm','tool_ids','auth','prompt_override',
    'first_message_override','voice_override','tts','name','readback_rejected'])
async def test_readback_mismatch_or_rejection_fails_without_configuration_disclosure(live, monkeypatch, field):
    state = existing_agent()
    calls = []
    patched = False
    async def provider(method,path,**kwargs):
        nonlocal patched
        calls.append((method,path))
        if method == 'GET' and path == '/convai/tools':
            return {'tools':[{'id':'tool_existing','tool_config':setup.tool_configuration()['tool_config']}], 'has_more':False}
        if method == 'PATCH':
            patched = True
            state['conversation_config'].update(copy.deepcopy(kwargs['payload']['conversation_config']))
            state['platform_settings'] = copy.deepcopy(kwargs['payload']['platform_settings'])
            return {}
        assert method == 'GET' and path == '/convai/agents/agent_existing'
        if not patched: return copy.deepcopy(state)
        if field == 'readback_rejected': raise RuntimeError('private-secret-provider-error')
        if field == 'id': state['agent_id'] = 'wrong_agent'
        elif field == 'name': state['name'] = 'renamed'
        elif field == 'tts': state['conversation_config']['tts']['voice_id'] = 'changed_voice'
        elif field in ('prompt','llm','tool_ids'):
            state['conversation_config']['agent']['prompt'][field] = 'private-secret-wrong-value'
        elif field == 'auth': state['platform_settings']['auth']['enable_auth'] = False
        else:
            flags = state['platform_settings']['overrides']['conversation_config_override']
            if field == 'prompt_override': flags['agent']['prompt']['prompt'] = False
            elif field == 'first_message_override': flags['agent']['first_message'] = False
            elif field == 'voice_override': flags['tts']['voice_id'] = False
        return state
    monkeypatch.setattr(setup,'request_json',provider)
    with pytest.raises(ValueError, match='^Voice configuration readback verification failed$'):
        await setup.setup(settings=live, db=ApprovalDB(payload()), approval_id='apr_test', apply=True)
    assert calls == [('GET','/convai/agents/agent_existing'),('GET','/convai/tools'),
                     ('PATCH','/convai/agents/agent_existing'),('GET','/convai/agents/agent_existing')]
    assert 'name' not in payload()['configuration']['agent_patch']
