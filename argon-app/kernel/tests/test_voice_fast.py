from unittest.mock import AsyncMock
import pytest
from foundry_kernel.api import voice_fast
from foundry_kernel.contracts import TalkResponse, AnswerCheck
from tests.test_api_contract import create_venture, data, rows, write


def test_role_fast_path_no_model_and_persisted(client):
    vid = create_venture(client)['id']
    agent = 'intake.brief-lead'
    llm = client.app.state.llm
    llm.generate_json = AsyncMock(side_effect=AssertionError('No model allowed'))
    role = rows(client, 'SELECT role_summary FROM agents WHERE id=?', (agent,))[0]['role_summary']
    result = data(client.post(f'/v1/ventures/{vid}/agents/{agent}/voice-ask', json={'text': 'What is your role?'}))
    assert result['check']['status'] == 'verified'
    assert result['text'] == 'My recorded role is: ' + role
    assert result['citations'][0]['quote'] == role
    assert result['citations'][0]['id'] == agent
    assert result['citations'][0]['kind'] == 'agent'
    saved = data(client.get('/v1/answers/' + result['answer_id']))
    assert saved['text'] == result['text']
    assert saved['check']['status'] == 'verified'
    llm.generate_json.assert_not_called()
    run = rows(client, 'SELECT r.* FROM runs r JOIN answers a ON a.run_id=r.id WHERE a.id=?', (result['answer_id'],))[0]
    assert run['venture_id'] == vid and run['model'] == 'deterministic' and run['status'] == 'succeeded'

@pytest.mark.parametrize('question', ['What is the founder role?', 'What is your role and what should we build?', 'What are you working on?', 'Why should we change strategy?'])
def test_advanced_falls_back(client, monkeypatch, question):
    vid = create_venture(client)['id']
    fallback = AsyncMock(return_value=TalkResponse(answer_id='ans_test', text='Fallback', citations=[], check=AnswerCheck(status='verified'), latency_ms=0))
    monkeypatch.setattr(voice_fast, 'talk', fallback)
    data(client.post(f'/v1/ventures/{vid}/agents/intake.brief-lead/voice-ask', json={'text': question}))
    fallback.assert_awaited_once()
    assert fallback.call_args.kwargs['req'].text == question


def test_voice_role_venture_isolation(client):
    vid = create_venture(client)['id']
    other = create_venture(client, name='Other')['id']
    write(client, 'UPDATE agents SET venture_id=? WHERE id=?', (other, 'intake.brief-lead'))
    assert client.post(f'/v1/ventures/{vid}/agents/intake.brief-lead/voice-ask', json={'text': 'What is your role?'}).status_code == 404
    assert client.post('/v1/ventures/missing/agents/concierge/voice-ask', json={'text': 'What is your role?'}).status_code == 404


def test_concierge_fallback_and_auth(client, monkeypatch):
    from foundry_kernel.contracts import ConciergeResponse
    from pydantic import SecretStr
    vid = create_venture(client)['id']
    fallback = AsyncMock(return_value=ConciergeResponse(answer_id='ans_test', text='Company answer', citations=[], check=AnswerCheck(status='verified'), latency_ms=0))
    monkeypatch.setattr(voice_fast, 'ask', fallback)
    url = f'/v1/ventures/{vid}/agents/concierge/voice-ask'
    data(client.post(url, json={'text': 'Who should help the founder?'}))
    fallback.assert_awaited_once()
    client.app.state.settings.kernel_token = SecretStr('test-voice-token')
    assert client.post(url, json={'text': 'What is your role?'}).status_code == 401


def test_changed_role_never_verified(client, monkeypatch):
    vid = create_venture(client)['id']
    original = voice_fast.build_context_pack
    async def changed(**kwargs):
        pack = await original(**kwargs)
        async with kwargs['db'].tx() as tx:
            await tx.execute("UPDATE agents SET role_summary='Changed role' WHERE id=?", (kwargs['agent_id'],))
        return pack
    fallback = AsyncMock(return_value=TalkResponse(answer_id='ans_fallback', text='Fallback', citations=[], check=AnswerCheck(status='unsupported'), latency_ms=0))
    monkeypatch.setattr(voice_fast, 'build_context_pack', changed)
    monkeypatch.setattr(voice_fast, 'talk', fallback)
    result = data(client.post(f'/v1/ventures/{vid}/agents/intake.brief-lead/voice-ask', json={'text': 'What is your role?'}))
    assert result['answer_id'] == 'ans_fallback'
    fallback.assert_awaited_once()
