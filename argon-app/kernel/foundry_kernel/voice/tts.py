# OWNER: karthik
"""On-demand TTS, validated alignment and atomic disk cache; no startup spending."""
from __future__ import annotations
import base64
import hashlib
import io
import json
import math
import re
import time
import uuid
import wave
from pathlib import Path
from typing import Any
from ..config import KERNEL_DIR
from ..contracts import Alignment, TtsResponse
from ..llm.client import build_llm_client
from ..security import redact
from .provider import request_json

VOICES_PATH = KERNEL_DIR / 'data' / 'voices.json'

def load_voices() -> dict[str, str]:
    try:
        value = json.loads(VOICES_PATH.read_text())
        return {k: v for k, v in value.items() if isinstance(v, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,128}', v)}
    except (OSError, ValueError, AttributeError):
        return {}

def prepare_text(text: str, limit: int) -> str:
    text = re.sub(r'```.*?```|`[^`]*`', ' a code snippet ', text, flags=re.S)
    text = re.sub(r'\[([^\]]+)\]\(https?://[^)]+\)', r'\1 (the link)', text)
    text = re.sub(r'https?://\S+', 'the link', text)
    text = re.sub(r'\[\d+(?:[ ,\-]+\d+)*\]', '', text)
    text = re.sub(r'[*_#>~]', '', text)
    text = ' '.join(text.split())
    if len(text) > limit:
        cut = text[:limit]
        ends = list(re.finditer(r'[.!?](?:\s|$)', cut))
        text = cut[:ends[-1].start() + 1] if ends else cut
    return text

def alignment_from(value: Any) -> Alignment | None:
    if not value:
        return None
    chars = value['characters']
    starts = value['character_start_times_seconds']
    ends = value['character_end_times_seconds']
    if not chars or len(chars) != len(starts) or len(chars) != len(ends):
        raise ValueError('Invalid alignment length')
    previous = 0.0
    for char, start, end in zip(chars, starts, ends):
        if not isinstance(char, str) or not isinstance(start, (float, int)) or not isinstance(end, (float, int)):
            raise ValueError('Invalid alignment type')
        if not math.isfinite(start) or not math.isfinite(end) or start < previous or end < start:
            raise ValueError('Invalid alignment timing')
        previous = start
    return Alignment(chars=chars, starts=starts, ends=ends)

def atomic_write(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        temporary.write_bytes(value)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)

def _store(settings: Any, digest: str, audio: bytes, mime: str, provider: str,
           alignment: Alignment | None) -> TtsResponse:
    ext = {'audio/mpeg': 'mp3', 'audio/wav': 'wav'}[mime]
    root = Path(settings.data_dir) / 'audio-cache'
    atomic_write(root / f'{digest}.{ext}', audio)
    response = TtsResponse(audio_url=f'/media/audio/{digest}.{ext}', mime=mime,
                           provider=provider, alignment=alignment)
    atomic_write(root / f'{digest}.json', response.model_dump_json().encode())
    return response

def _cached(settings: Any, digest: str) -> TtsResponse | None:
    root = Path(settings.data_dir) / 'audio-cache'
    try:
        response = TtsResponse.model_validate_json((root / f'{digest}.json').read_bytes())
        ext = {'audio/mpeg': 'mp3', 'audio/wav': 'wav'}[response.mime]
        expected = f'/media/audio/{digest}.{ext}'
        audio = root / f'{digest}.{ext}'
        if response.audio_url == expected and audio.is_file() and not audio.is_symlink() and audio.stat().st_size:
            return response
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None

async def synthesize(*, settings: Any, db: Any, agent_id: str, text: str) -> TtsResponse:
    started = time.monotonic()
    def finish(result: TtsResponse) -> TtsResponse:
        return result.model_copy(update={'latency_ms': int((time.monotonic() - started) * 1000)})
    text = prepare_text(redact(text, settings), max(0, settings.tts_max_chars))
    if not text:
        return finish(TtsResponse())
    voice_id = load_voices().get(agent_id)
    digest = hashlib.sha256((f'{voice_id}|{settings.elevenlabs_model_id}|{text}' if settings.elevenlabs_output_format == 'mp3_44100_128' else f'{voice_id}|{settings.elevenlabs_model_id}:{settings.elevenlabs_output_format}|{text}').encode()).hexdigest()
    if voice_id and settings.elevenlabs_output_format.startswith('mp3_'):
        cached = _cached(settings, digest)
        if cached:
            return finish(cached)
        if settings.elevenlabs_api_key and settings.llm_mode != 'fake':
            try:
                value = await request_json('POST', f'/text-to-speech/{voice_id}/with-timestamps',
                    key=settings.elevenlabs_api_key.get_secret_value(),
                    params={'output_format': settings.elevenlabs_output_format},
                    payload={'text': text, 'model_id': settings.elevenlabs_model_id,
                             'voice_settings': {'stability': .45, 'similarity_boost': .8,
                                                'style': .15, 'use_speaker_boost': True}})
                audio = base64.b64decode(value['audio_base64'], validate=True)
                if not audio or len(audio) > 20_000_000:
                    raise ValueError('Invalid audio size')
                alignment = alignment_from(value.get('alignment') or value.get('normalized_alignment'))
                return finish(_store(settings, digest, audio, 'audio/mpeg', 'elevenlabs', alignment))
            except Exception:
                pass  # Provider errors must never expose credentials or interrupt conversation.
    fallback_digest = hashlib.sha256(f'gemini|tts_fallback|{text}'.encode()).hexdigest()
    cached = _cached(settings, fallback_digest)
    if cached:
        return finish(cached)
    if settings.gemini_api_key or settings.llm_mode == 'fake':
        try:
            result = await build_llm_client(settings, db).generate('tts_fallback', text, agent_id=agent_id)
            for audio, mime in result.audio:
                if not audio or len(audio) > 20_000_000:
                    continue
                mime = mime.lower()
                if mime.startswith('audio/l16') or mime.startswith('audio/pcm'):
                    rate_match = re.search(r'rate=(\d+)', mime)
                    rate = int(rate_match.group(1)) if rate_match else 24000
                    if not 8000 <= rate <= 96000:
                        continue
                    stream = io.BytesIO()
                    with wave.open(stream, 'wb') as wav:
                        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(rate); wav.writeframes(audio)
                    audio, mime = stream.getvalue(), 'audio/wav'
                mime = {'audio/mp3': 'audio/mpeg', 'audio/x-wav': 'audio/wav'}.get(mime, mime)
                if mime in ('audio/mpeg', 'audio/wav'):
                    return finish(_store(settings, fallback_digest, audio, mime, 'gemini', None))
        except Exception:
            pass
    return finish(TtsResponse())
