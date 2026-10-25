# OWNER: tanush
import json

from foundry_kernel.contracts import TtsResponse
from foundry_kernel.ids import utc_now
from tests.tanush.helpers import execute


def venture(client, name='Company'):
    return client.post('/v1/ventures', json={'name': name, 'idea': 'A real product idea', 'founder_name': 'Alex'}).json()['data']['id']


def test_org_runtime_reporting_and_unknown_venture(client):
    vid = venture(client)
    org = client.get(f'/v1/ventures/{vid}/org').json()['data']
    assert org['founder'] == 'Alex' and org['chief_of_staff']['id'] == 'cos.orchestrator'
    assert org['concierge']['id'] == 'concierge' and len(org['departments']) == 13
    assert all(team['lead']['runtime']['jobs'] for team in org['departments'])
    assert client.get('/v1/ventures/missing/org').status_code == 404


def test_standup_trigger_idempotent_and_empty_latest(client):
    vid = venture(client)
    empty = client.get(f'/v1/ventures/{vid}/standups/latest').json()['data']
    assert empty == {'root_message_id': None, 'created_at': None, 'updates': [], 'decisions': None, 'audio': []}
    first = client.post(f'/v1/ventures/{vid}/standup', json={}).json()['data']['ticket_id']
    second = client.post(f'/v1/ventures/{vid}/standup', json={}).json()['data']['ticket_id']
    assert first == second
    ticket = client.get(f'/v1/tickets/{first}').json()['data']
    assert ticket['type'] == 'cos.standup' and ticket['department_id'] == 'chief-of-staff'
    assert client.post('/v1/ventures/missing/standup', json={}).status_code == 404


def test_standup_audio_cache_and_browser_fallback_scoped(client, monkeypatch):
    first, other = venture(client), venture(client, 'Other')
    source = {'root_message_id': 'msg_standup', 'created_at': utc_now(),
              'updates': [{'agent_id': 'eng.builder', 'text': 'Tests are complete.', 'refs': []}],
              'decisions': {'agent_id': 'cos.orchestrator', 'text': 'Review the approval.', 'refs': []}}
    client.portal.call(execute, client.app.state.db, 'INSERT INTO kv(key,value_json,updated_at) VALUES(?,?,?)', (f'standup.latest.{first}', json.dumps(source), utc_now()))
    calls = []
    async def synthesize(**kw):
        calls.append(kw['agent_id'])
        return TtsResponse(provider='browser')
    monkeypatch.setattr('foundry_kernel.api.org.tts.synthesize', synthesize)
    for _ in range(2):
        result = client.get(f'/v1/ventures/{first}/standups/latest').json()['data']
        assert len(result['audio']) == 2 and all(a['audio_url'] is None for a in result['audio'])
    assert calls == ['eng.builder', 'cos.orchestrator']
    assert client.get(f'/v1/ventures/{other}/standups/latest').json()['data']['root_message_id'] is None


def test_venture_composio_identity_matches_integration_contract(client):
    vid = venture(client)
    row = client.portal.call(client.app.state.db.fetch_one, 'SELECT composio_user_id FROM ventures WHERE id=?', (vid,))
    assert row['composio_user_id'] == f'foundry:{vid}'
