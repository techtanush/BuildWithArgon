# OWNER: karthik
from pydantic import SecretStr
import base64
from types import SimpleNamespace
import pytest
from foundry_kernel.voice import tts

async def test_no_key_is_browser(settings):
    settings.llm_mode = 'live'
    assert (await tts.synthesize(settings=settings, db=None, agent_id='concierge', text='Hi')).provider == 'browser'

async def test_timestamps_cache(settings, monkeypatch):
    settings.llm_mode = 'live'; settings.elevenlabs_api_key = SecretStr('secret-value')
    monkeypatch.setattr(tts, 'load_voices', lambda: {'concierge': 'realVoice'})
    calls = []
    async def request(*args, **kwargs):
        calls.append(kwargs)
        return {'audio_base64': base64.b64encode(b'fake-mp3').decode(), 'alignment': {
            'characters': ['H', 'i'], 'character_start_times_seconds': [0, .1], 'character_end_times_seconds': [.1, .2]}}
    monkeypatch.setattr(tts, 'request_json', request)
    a = await tts.synthesize(settings=settings, db=None, agent_id='concierge', text='Hi')
    b = await tts.synthesize(settings=settings, db=None, agent_id='concierge', text='Hi')
    assert a.provider == b.provider == 'elevenlabs'
    assert a.alignment.chars == ['H', 'i']
    assert a.audio_url == b.audio_url and len(calls) == 1

async def test_fallback_pcm(settings, monkeypatch):
    settings.llm_mode = 'live'; settings.elevenlabs_api_key = SecretStr('secret-value'); settings.gemini_api_key = SecretStr('gemini-secret')
    monkeypatch.setattr(tts, 'load_voices', lambda: {'concierge': 'realVoice'})
    order = []
    async def request(*args, **kwargs):
        order.append('elevenlabs'); raise RuntimeError('secret error')
    class LLM:
        async def generate(self, *args, **kwargs):
            order.append('gemini'); return SimpleNamespace(audio=[(b'\x00\x00' * 20, 'audio/L16;rate=24000')])
    monkeypatch.setattr(tts, 'request_json', request)
    monkeypatch.setattr(tts, 'build_llm_client', lambda *a: LLM())
    result = await tts.synthesize(settings=settings, db=None, agent_id='concierge', text='Hi')
    assert order == ['elevenlabs', 'gemini']
    assert result.provider == 'gemini' and result.mime == 'audio/wav' and result.alignment is None

async def test_malformed_provider_falls_back(settings, monkeypatch):
    settings.llm_mode = 'live'; settings.elevenlabs_api_key = SecretStr('secret-value')
    monkeypatch.setattr(tts, 'load_voices', lambda: {'concierge': 'realVoice'})
    async def request(*a, **kw): return {'audio_base64': '!'}
    monkeypatch.setattr(tts, 'request_json', request)
    assert (await tts.synthesize(settings=settings, db=None, agent_id='concierge', text='Hi')).provider == 'browser'

@pytest.mark.parametrize('value', [
 {'characters': ['a'], 'character_start_times_seconds': [float('nan')], 'character_end_times_seconds': [1]},
 {'characters': ['a'], 'character_start_times_seconds': [1], 'character_end_times_seconds': [0]},
 {'characters': ['a'], 'character_start_times_seconds': [], 'character_end_times_seconds': [1]},
])
def test_alignment_rejects_invalid(value):
    with pytest.raises(ValueError): tts.alignment_from(value)

def test_prepare_text():
    assert tts.prepare_text('**Hello** [1] https://example.com `code`', 100) == 'Hello the link a code snippet'
    assert tts.prepare_text('Hello. ' + 'x' * 100, 15) == 'Hello.'
