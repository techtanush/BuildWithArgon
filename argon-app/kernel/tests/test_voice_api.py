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
