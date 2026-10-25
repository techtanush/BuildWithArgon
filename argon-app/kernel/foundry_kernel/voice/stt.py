# OWNER: karthik
"""Transcription through the frozen LLM interface, with browser fallback."""
import time
from typing import Any
from ..contracts import Part, SttResponse
from ..security import redact

MAX_AUDIO_BYTES = 6_000_000
SUPPORTED_MIMES = {'audio/webm', 'audio/wav', 'audio/x-wav', 'audio/mp4'}

async def transcribe(*, settings: Any, llm: Any, audio: bytes, mime: str) -> SttResponse:
    started = time.monotonic()
    response = SttResponse(text='')
    mime = mime.split(';')[0].strip().lower()
    if settings.stt_primary != 'gemini' or not audio or len(audio) > MAX_AUDIO_BYTES or mime not in SUPPORTED_MIMES:
        return response
    if not settings.gemini_api_key and settings.llm_mode != 'fake':
        return response
    try:
        result = await llm.generate('transcribe', [Part(kind='audio', data=audio, mime=mime)],
            system='Transcribe the speech verbatim. Return only the transcript text.')
        text = redact(result.text.strip(), settings)
        if text:
            response = SttResponse(text=text, provider='gemini')
    except Exception:
        pass
    response.latency_ms = int((time.monotonic() - started) * 1000)
    return response
