# OWNER: karthik
from pydantic import SecretStr
import io
import wave

def wav(seconds=1):
    buf=io.BytesIO()
    with wave.open(buf,'wb') as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(8000); f.writeframes(b'\0\0' * int(seconds*8000))
    return buf.getvalue()

def test_tts_limit(client):
    response=client.post('/v1/voice/tts',json={'agent_id':'concierge','text':'x'*601})
    assert response.status_code == 400 and 'error' in response.json()

def test_media_bad_sha(client):
    assert client.get('/media/audio/not-a-sha.mp3').status_code == 404

def test_media_symlink(client,settings,tmp_path):
    cache=settings.data_dir/'audio-cache';cache.mkdir(exist_ok=True)
    secret=tmp_path/'secret'; secret.write_text('not audio')
    (cache/('a'*64+'.mp3')).symlink_to(secret)
    assert client.get('/media/audio/'+'a'*64+'.mp3').status_code == 404

def test_auth_and_origin(client,settings):
    settings.kernel_token=SecretStr('kernel-secret')
    assert client.post('/v1/voice/tts',json={'agent_id':'x','text':'hi'}).status_code == 401
    headers={'Authorization':'Bearer kernel-secret','Origin':'https://evil.example'}
    assert client.post('/v1/voice/tts',json={'agent_id':'x','text':'hi'},headers=headers).status_code == 403
    headers['Origin']='http://127.0.0.1:5173'
    assert client.post('/v1/voice/tts',json={'agent_id':'x','text':'hi'},headers=headers).status_code == 200

def test_wav_upload(client):
    assert client.post('/v1/voice/transcribe', files={'audio':('voice.wav',wav(),'audio/wav')}).json()['data']['provider'] == 'none'
    assert client.post('/v1/voice/transcribe', files={'audio':('voice.wav',wav(31),'audio/wav')}).status_code == 400
    assert client.post('/v1/voice/transcribe', files={'audio':('voice.wav',b'broken','audio/wav')}).status_code == 400


def test_mp4_and_unknown_cluster_webm_uploads(client):
    from tests.test_voice_duration import mp4, multi_cluster_webm
    for payload,mime in [(mp4(),'audio/mp4'),(mp4(fragmented=True),'audio/mp4'),
                         (multi_cluster_webm([0,1000]),'audio/webm')]:
        response=client.post('/v1/voice/transcribe',files={'audio':('voice',payload,mime)})
        assert response.status_code==200, response.text
        assert response.json()['data']['provider']=='none'
    for payload,mime in [(mp4(31),'audio/mp4'),(mp4(31,fragmented=True),'audio/mp4'),
                         (multi_cluster_webm([0,1000,31000]),'audio/webm')]:
        response=client.post('/v1/voice/transcribe',files={'audio':('voice',payload,mime)})
        assert response.status_code==400
        assert response.json()['error']['code']=='invalid_audio'


def test_unsupported_ogg_rejected_explicitly(client):
    response=client.post('/v1/voice/transcribe',files={'audio':('voice.ogg',b'OggS','audio/ogg')})
    assert response.status_code==400
    assert response.json()['error']['message']=='Unsupported audio format.'


def test_voice_openapi_response_envelopes(client):
    schema=client.get('/openapi.json').json()
    envelopes={
        '/v1/voice/tts':('TtsEnvelope','TtsResponse'),
        '/v1/voice/transcribe':('SttEnvelope','SttResponse'),
        '/v1/voice/sessions':('VoiceSessionEnvelope','VoiceSessionInfo'),
        '/v1/voice/sessions/{session_id}/end':('VoiceSessionEndEnvelope','VoiceSessionEndData'),
    }
    for path,(envelope,payload) in envelopes.items():
        responses=schema['paths'][path]['post']['responses']
        assert responses['200']['content']['application/json']['schema']=={'$ref':f'#/components/schemas/{envelope}'}
        assert schema['components']['schemas'][envelope]['properties']['data']=={'$ref':f'#/components/schemas/{payload}'}
        assert 'data' in schema['components']['schemas'][envelope]['required']
        assert responses['422']['content']['application/json']['schema']=={'$ref':'#/components/schemas/VoiceErrorEnvelope'}
    error=schema['components']['schemas']['VoiceError']
    assert set(error['properties'])=={'code','message','details'}
    assert set(error['required'])=={'code','message','details'}
    for ext,mime in [('mp3','audio/mpeg'),('wav','audio/wav')]:
        response=schema['paths'][f'/media/audio/{{sha}}.{ext}']['get']['responses']['200']
        assert response['content'][mime]['schema']=={'type':'string','format':'binary'}
        assert 'application/json' not in response['content']


def test_voice_schema_errors_are_sanitized_envelopes(client):
    marker='private-input-key-and-content'
    cases=[
        ('/v1/voice/tts',{}),
        ('/v1/voice/tts',{'json':{'agent_id':'concierge'}}),
        ('/v1/voice/tts',{'json':{'agent_id':'concierge','text':{marker:marker}}}),
        ('/v1/voice/tts',{'content':'{"text":"'+marker+'",', 'headers':{'content-type':'application/json'}}),
        ('/v1/voice/transcribe',{}),
        ('/v1/voice/transcribe',{'files':{'audio':(None,marker)}}),
        ('/v1/voice/transcribe',{'json':{'audio':marker}}),
        ('/v1/voice/sessions',{}),
        ('/v1/voice/sessions',{'json':{'agent_id':'concierge','venture_id':'ven_TEST','surface':marker}}),
        ('/v1/voice/sessions/vcs_TEST/end',{}),
        ('/v1/voice/sessions/vcs_TEST/end',{'json':{'turns':{marker:marker}}}),
        ('/v1/voice/sessions/vcs_TEST/end',{'json':{'duration_s':-1}}),
    ]
    expected={'error':{'code':'invalid_request','message':'The voice request does not match the required schema.','details':{}}}
    for path,kwargs in cases:
        response=client.post(path,**kwargs)
        assert response.status_code==422,(path,response.text)
        assert response.json()==expected
        assert marker not in response.text
        assert 'detail' not in response.json()


def test_voice_semantic_error_statuses_unchanged(client):
    for response,code in [
        (client.post('/v1/voice/tts',json={'agent_id':'concierge','text':'x'*601}),400),
        (client.post('/v1/voice/tts',json={'agent_id':'concierge','text':' '}),400),
        (client.post('/v1/voice/transcribe',files={'audio':('bad.wav',b'broken','audio/wav')}),400),
        (client.get('/media/audio/not-a-sha.mp3'),404),
        (client.post('/v1/voice/sessions/vcs_UNKNOWN/end',json={}),404),
    ]:
        assert response.status_code==code
        assert set(response.json())=={'error'}
        assert set(response.json()['error'])=={'code','message','details'}
