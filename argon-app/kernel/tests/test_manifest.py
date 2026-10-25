# OWNER: tanush
import json

from foundry_kernel.contracts import Manifest
from foundry_kernel.ids import utc_now
from tests.tanush.helpers import execute


def venture(client, name):
    return client.post('/v1/ventures', json={'name': name, 'idea': 'A real product idea', 'founder_name': 'Alex'}).json()['data']['id']


def test_manifest_frozen_geometry_and_no_company_state(client):
    data = client.get('/v1/world/manifest').json()['data']
    assert Manifest.model_validate(data).version == 1
    assert len(data['buildings']) == 13 and len(data['roads']['nodes']) == 52 and len(data['roads']['edges']) == 65
    assert all('status' not in npc and 'current_ticket_id' not in npc for npc in data['npcs'])
    assert data['buildings'][0]['plot_center'] == [0, -132]
    assert client.get('/v1/world/manifest?venture=missing').status_code == 404


def test_manifest_includes_only_this_ventures_approved_hires(client):
    first, other = venture(client, 'First'), venture(client, 'Other')
    client.portal.call(execute, client.app.state.db,
        "INSERT INTO agents(id,venture_id,department_id,display_name,title,role_summary,model_job,persona,npc_slot,is_lead,generated,created_at) VALUES(?,?,'engineering','New Builder','Builder','Builds','dept_artifact','Careful','engineering.s4',0,1,?)",
        ('eng.new', first, utc_now()))
    yes = client.get(f'/v1/world/manifest?venture={first}').json()['data']
    no = client.get(f'/v1/world/manifest?venture={other}').json()['data']
    assert next(a for a in yes['npcs'] if a['agent_id'] == 'eng.new')['generated'] is True
    assert 'eng.new' not in json.dumps(no)
