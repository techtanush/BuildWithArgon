import io
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from foundry_kernel.api import player_avatar as avatar
from foundry_kernel.contracts import FaceSpec, LLMResult
from foundry_kernel.models import ARGON, JOBS


def photo(size=(100, 100)):
    out = io.BytesIO()
    Image.new('RGB', size, 'red').save(out, format='PNG')
    return out.getvalue()


def test_image_validation():
    clean = avatar.normalize_photo(photo(), 'image/png')
    with Image.open(io.BytesIO(clean)) as im:
        assert im.format == 'JPEG' and max(im.size) <= 768 and not im.getexif()
    for data, mime, status in [(b'bad', 'image/png', 422), (photo(), 'text/plain', 415), (photo(), 'image/jpeg', 415), (b'x' * (avatar.MAX_IMAGE + 1), 'image/png', 413), (photo((20, 100)), 'image/png', 422)]:
        with pytest.raises(avatar.HTTPException) as error:
            avatar.normalize_photo(data, mime)
        assert error.value.status_code == status


def test_private_parts_and_job():
    assert 'secretpixels' not in str(avatar.PrivateParts([avatar.Part(kind='image', data=b'secretpixels')]))
    assert JOBS['avatar_personalize'].model == ARGON
    assert JOBS['avatar_personalize'].timeout_s == 25
    assert JOBS['avatar_personalize'].max_output_tokens == 2048


def test_route_native_json_consent_and_limit(monkeypatch):
    face = FaceSpec(agent_id='player', skin='#D9A37E', hair_style='short', hair_color='#111111', eye_color='#333333', brow='straight', nose='round', accessory='none', outfit='hoodie', outfit_color='#123456', pants_color='#123456', height=1, build=1, names=dict(skin='color', hair='color', eyes='color', outfit='hoodie', accessory='none'))
    generated = AsyncMock(return_value=(face, LLMResult(text=face.model_dump_json(), interaction_id=None, model=ARGON)))
    tracker = SimpleNamespace(generate_json=generated)
    monkeypatch.setattr(avatar, 'TrackedLLM', type('Tracker', (), {'__init__': lambda self, *a, **kw: None, 'generate_json': generated}))
    monkeypatch.setattr(avatar, 'get_row', AsyncMock(return_value={'id': 'v'}))
    app = FastAPI(); app.include_router(avatar.router)
    app.state.db = object(); app.state.llm = object(); app.state.settings = object()
    with TestClient(app) as client:
        def send(consent='true'):
            return client.post('/v1/ventures/v/player/avatar', files={'image': ('a.png', photo(), 'image/png')}, data={'consent': consent})
        assert send('false').status_code == 400
        assert not generated.called
        result = send()
        assert result.status_code == 200, result.text
        assert result.json()['face']['agent_id'] == 'player'
        assert result.json()['photorealistic'] is False
        args = generated.call_args.args
        assert args[0] == 'avatar_personalize' and args[2] is FaceSpec
        assert args[1][1].mime == 'image/jpeg'
        assert send().status_code == 200
        assert send().status_code == 200
        assert send().status_code == 429


def test_real_tracking_does_not_store_photo(client):
    import base64
    response = client.post('/v1/ventures', json={'name': 'Avatar privacy', 'idea': 'Avatar test', 'founder_name': 'Test'})
    vid = response.json()['data']['id']
    face = FaceSpec(agent_id='player', skin='#D9A37E', hair_style='short', hair_color='#111111', eye_color='#333333', brow='straight', nose='round', accessory='none', outfit='hoodie', outfit_color='#123456', pants_color='#123456', height=1, build=1, names=dict(skin='color', hair='color', eyes='color', outfit='hoodie', accessory='none'))
    calls = []
    class MockArgon:
        async def generate_json(self, job, prompt, schema, **kwargs):
            calls.append((job, prompt, schema))
            return face, LLMResult(text=face.model_dump_json(), interaction_id=None, model=ARGON)
    client.app.state.llm = MockArgon()
    result = client.post(f'/v1/ventures/{vid}/player/avatar', files={'image': ('photo.png', photo(), 'image/png')}, data={'consent': 'true'})
    assert result.status_code == 200, result.text
    rows = client.portal.call(client.app.state.db.fetch_all, 'SELECT input_text FROM runs WHERE job=?', ('avatar_personalize',))
    assert len(rows) == 1
    assert rows[0]['input_text'] == str(calls[0][1])
    assert 'private avatar photo omitted' in rows[0]['input_text']
    encoded = base64.b64encode(calls[0][1][1].data).decode()
    assert encoded not in rows[0]['input_text']
    assert repr(calls[0][1][1].data) not in rows[0]['input_text']


async def test_native_argon_schema_no_provider_call(settings, monkeypatch):
    from foundry_kernel.llm.client import LLMClient
    face = FaceSpec(agent_id='player', skin='#D9A37E', hair_style='short', hair_color='#111111', eye_color='#333333', brow='straight', nose='round', accessory='none', outfit='hoodie', outfit_color='#123456', pants_color='#123456', height=1, build=1, names=dict(skin='color', hair='color', eyes='color', outfit='hoodie', accessory='none'))
    llm = LLMClient(settings)
    created = AsyncMock(return_value=object())
    monkeypatch.setattr(llm, '_create', created)
    monkeypatch.setattr(llm, '_finish', AsyncMock(return_value=LLMResult(text=face.model_dump_json(), interaction_id=None, model=ARGON)))
    await llm.generate_json('avatar_personalize', avatar.PrivateParts([avatar.Part(kind='image', data=photo(), mime='image/png')]), FaceSpec)
    kwargs, timeout, _, job = created.call_args.args
    assert kwargs['model'] == ARGON and job == 'avatar_personalize' and timeout == 25
    assert kwargs['response_format'] == FaceSpec.model_json_schema()
    assert kwargs['response_mime_type'] == 'application/json'
    assert kwargs['generation_config'] == {'thinking_level': 'medium', 'max_output_tokens': 2048}
    assert kwargs['input'][0]['type'] == 'image'


def test_unknown_venture_and_fake_mode_are_honest(client):
    def send(vid):
        return client.post(f'/v1/ventures/{vid}/player/avatar', files={'image': ('photo.png', photo(), 'image/png')}, data={'consent': 'true'})
    assert send('missing').status_code == 404
    venture = client.post('/v1/ventures', json={'name': 'No fake photo', 'idea': 'Test', 'founder_name': 'Test'}).json()['data']
    result = send(venture['id'])
    assert result.status_code == 503
    assert 'fake mode' in result.json()['error']['message']


def test_avatar_route_uses_existing_bearer_auth(settings):
    from foundry_kernel.app import create_app
    from pydantic import SecretStr
    config = settings.model_copy(update={'kernel_token': SecretStr('test-only-not-a-provider-key')})
    with TestClient(create_app(config)) as client:
        result = client.post('/v1/ventures/missing/player/avatar')
        assert result.status_code == 401
        result = client.post('/v1/ventures/missing/player/avatar', headers={'Authorization': 'Bearer test-only-not-a-provider-key'})
        assert result.status_code == 404


async def test_provider_exception_is_sanitized_before_tracking():
    provider = SimpleNamespace(generate_json=AsyncMock(side_effect=ValueError('private-photo-bytes-should-not-be-logged')))
    with pytest.raises(RuntimeError) as error:
        await avatar.PrivateAvatarLLM(provider).generate_json('avatar_personalize', [], FaceSpec)
    assert 'private-photo-bytes' not in str(error.value)
    assert 'configuration and credits' in str(error.value)


@pytest.mark.parametrize('failure_mode', ['create', 'finish'])
def test_native_provider_echo_never_persisted(client, monkeypatch, failure_mode):
    import base64
    import json
    from foundry_kernel.llm.client import LLMClient
    payload = base64.b64encode(photo()).decode()
    marker = 'PRIVATE_IMAGE_ECHO:' + payload
    venture = client.post('/v1/ventures', json={'name': 'Private failure', 'idea': 'Test', 'founder_name': 'Test'}).json()['data']
    native = LLMClient(client.app.state.settings, client.app.state.db)
    if failure_mode == 'create':
        monkeypatch.setattr(native, '_create', AsyncMock(side_effect=ValueError(marker)))
    else:
        interaction = SimpleNamespace(status='failed', output_text=marker, errors=[SimpleNamespace(message=marker)], id='test-failed-id', usage=None)
        monkeypatch.setattr(native, '_create', AsyncMock(return_value=interaction))
    client.app.state.llm = native
    response = client.post(f"/v1/ventures/{venture['id']}/player/avatar", files={'image': ('photo.png', photo(), 'image/png')}, data={'consent': 'true'})
    assert response.status_code == 502
    for table in ('runs', 'run_logs', 'kv', 'events', 'ledger'):
        rows = client.portal.call(client.app.state.db.fetch_all, f'SELECT * FROM {table}')
        stored = json.dumps(rows, default=str)
        assert marker not in stored and payload not in stored, table
    assert payload not in response.text


def test_success_provider_echo_is_sanitized_before_tracking(client):
    import base64
    import json
    payload = base64.b64encode(photo()).decode()
    face = FaceSpec(agent_id='player', skin='#D9A37E', hair_style='short', hair_color='#111111', eye_color='#333333', brow='straight', nose='round', accessory='none', outfit='hoodie', outfit_color='#123456', pants_color='#123456', height=1, build=1, names=dict(skin=payload, hair=payload, eyes=payload, outfit=payload, accessory=payload))
    class EchoingOutput:
        async def generate_json(self, *args, **kwargs):
            return face, LLMResult(text=payload, interaction_id='test-success-id', model=ARGON)
    venture = client.post('/v1/ventures', json={'name': 'Private output', 'idea': 'Test', 'founder_name': 'Test'}).json()['data']
    client.app.state.llm = EchoingOutput()
    response = client.post(f"/v1/ventures/{venture['id']}/player/avatar", files={'image': ('photo.png', photo(), 'image/png')}, data={'consent': 'true'})
    assert response.status_code == 200
    for table in ('runs', 'run_logs', 'events'):
        rows = client.portal.call(client.app.state.db.fetch_all, f'SELECT * FROM {table}')
        assert payload not in json.dumps(rows, default=str)
    assert payload not in response.text
