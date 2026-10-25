# OWNER: karthik
from types import SimpleNamespace
from foundry_kernel.voice.stt import transcribe

class LLM:
    def __init__(self): self.calls = []
    async def generate(self, job, prompt, **kwargs):
        self.calls.append((job, prompt)); return SimpleNamespace(text=' hello ')

async def test_browser_default(settings):
    llm = LLM()
    result = await transcribe(settings=settings, llm=llm, audio=b'audio', mime='audio/webm')
    assert result.provider == 'none' and not llm.calls

async def test_audio_part(settings):
    settings.stt_primary = 'gemini'; llm = LLM()
    result = await transcribe(settings=settings, llm=llm, audio=b'audio', mime='audio/webm;codecs=opus')
    assert result.provider == 'gemini' and result.text == 'hello'
    job, parts = llm.calls[0]
    assert job == 'transcribe' and parts[0].data == b'audio' and parts[0].mime == 'audio/webm'

async def test_failure_fallback(settings):
    settings.stt_primary = 'gemini'
    class Bad:
        async def generate(self, *a, **kw): raise RuntimeError('secret')
    assert (await transcribe(settings=settings, llm=Bad(), audio=b'audio', mime='audio/webm')).provider == 'none'
