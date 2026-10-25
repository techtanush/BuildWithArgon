# OWNER: karthik
"""Voice routes. Local-only unless the configured bearer credential is supplied."""
import hmac
import io
import math
import re
import wave
from pathlib import Path
from urllib.parse import urlparse
from typing import Annotated
from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.routing import APIRoute
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field
from ..contracts import TtsRequest, VoiceSessionRequest
from ..errors import KernelError
from ..voice import sessions, stt, tts

async def authorize(request: Request) -> None:
    settings = request.app.state.settings
    secret = settings.kernel_token
    is_media = request.url.path.startswith('/media/audio/')
    if is_media and request.client and request.client.host not in {'127.0.0.1', '::1', 'localhost', 'testclient'}:
        raise KernelError(403, 'forbidden', 'Audio media is restricted to loopback.')
    if secret and not is_media:
        expected = 'Bearer ' + secret.get_secret_value()
        supplied = request.headers.get('authorization', '')
        if not hmac.compare_digest(supplied.encode(), expected.encode()):
            raise KernelError(401, 'unauthorized', 'A valid kernel bearer token is required.')
    elif request.client and request.client.host not in {'127.0.0.1', '::1', 'localhost', 'testclient'}:
        raise KernelError(403, 'forbidden', 'Voice access is restricted to loopback.')
    # Reject cross-origin browser requests even when running unauthenticated on loopback.
    origin = request.headers.get('origin')
    if origin:
        actual, configured = urlparse(origin), urlparse(settings.web_url)
        try:
            same_port = actual.port == configured.port
        except ValueError:
            raise KernelError(403, 'forbidden', 'Untrusted request origin.') from None
        local = {'localhost', '127.0.0.1', '::1'}
        matched = actual.scheme == configured.scheme and same_port and (actual.hostname == configured.hostname or actual.hostname in local and configured.hostname in local)
        if not matched:
            raise KernelError(403, 'forbidden', 'Untrusted request origin.')

class VoiceRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()
        async def handler(request):
            try:
                return await original(request)
            except RequestValidationError:
                raise KernelError(422, 'invalid_request', 'The voice request does not match the required schema.') from None
        return handler

router = APIRouter(tags=['voice'], dependencies=[Depends(authorize)], route_class=VoiceRoute)

@router.post('/v1/voice/tts')
async def speak(body: TtsRequest, request: Request):
    settings = request.app.state.settings
    if len(body.text) > settings.tts_max_chars:
        raise KernelError(400, 'invalid_request', 'Speech text exceeds the character limit.')
    if not body.text.strip():
        raise KernelError(400, 'invalid_request', 'Speech text is required.')
    result = await tts.synthesize(settings=settings, db=request.app.state.db, agent_id=body.agent_id, text=body.text)
    return {'data': result.model_dump()}

@router.post('/v1/voice/transcribe')
async def transcribe_audio(request: Request, audio: Annotated[UploadFile, File()]):
    mime = (audio.content_type or '').split(';')[0].lower()
    try:
        content = await audio.read(stt.MAX_AUDIO_BYTES + 1)
    finally:
        await audio.close()
    if not content or len(content) > stt.MAX_AUDIO_BYTES:
        raise KernelError(400, 'invalid_audio', 'Audio must be nonempty and at most 6 MB.')
    if mime not in stt.SUPPORTED_MIMES:
        raise KernelError(400, 'invalid_audio', 'Unsupported audio format.')
    if mime in {'audio/wav', 'audio/x-wav'}:
        try:
            with wave.open(io.BytesIO(content)) as wav:
                duration = wav.getnframes() / wav.getframerate()
            if not math.isfinite(duration) or not .3 <= duration <= 30:
                raise ValueError('duration')
        except (wave.Error, EOFError, ValueError, ZeroDivisionError):
            raise KernelError(400, 'invalid_audio', 'Audio must be a valid clip between 0.3 and 30 seconds.') from None
    else:
        # Compressed clips need authoritative container duration, not a client-supplied header.
        from ..voice.duration import duration_seconds
        duration = duration_seconds(content, mime)
        if duration is None or not .3 <= duration <= 30:
            raise KernelError(400, 'invalid_audio', 'Audio must declare a valid duration between 0.3 and 30 seconds.')
    result = await stt.transcribe(settings=request.app.state.settings, llm=request.app.state.llm, audio=content, mime=mime)
    return {'data': result.model_dump()}

async def _media(request: Request, sha: str, extension: str):
    if not re.fullmatch(r'[a-fA-F0-9]{64}', sha):
        raise KernelError(404, 'not_found', 'Audio was not found.')
    root = Path(request.app.state.settings.data_dir) / 'audio-cache'
    target = root / f'{sha}.{extension}'
    if target.is_symlink() or not target.is_file() or target.resolve().parent != root.resolve():
        raise KernelError(404, 'not_found', 'Audio was not found.')
    return FileResponse(target, media_type='audio/mpeg' if extension == 'mp3' else 'audio/wav',
                        headers={'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff'})

@router.get('/media/audio/{sha}.mp3')
async def mp3(request: Request, sha: str):
    return await _media(request, sha, 'mp3')

@router.get('/media/audio/{sha}.wav')
async def wav(request: Request, sha: str):
    return await _media(request, sha, 'wav')

@router.post('/v1/voice/sessions')
async def create_session(body: VoiceSessionRequest, request: Request):
    result = await sessions.create_session(settings=request.app.state.settings, db=request.app.state.db, request=body)
    return {'data': result.model_dump()}

class EndSummary(BaseModel):
    conversation_id: str | None = Field(default=None, max_length=256)
    duration_s: float = Field(default=0, ge=0, le=86400, allow_inf_nan=False)
    answer_ids: list[str] = Field(default_factory=list, max_length=1000)
    turns: int = Field(default=0, ge=0, le=100000)

@router.post('/v1/voice/sessions/{session_id}/end')
async def end_session(session_id: str, body: EndSummary, request: Request):
    await sessions.end_session(settings=request.app.state.settings, db=request.app.state.db,
                               session_id=session_id, summary=body.model_dump())
    return {'data': {'stored': True}}
