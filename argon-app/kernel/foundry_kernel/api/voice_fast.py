"""Voice-only stored role lookup. Ambiguous questions use ordinary reasoning."""
import json
import time
from fastapi import APIRouter, Depends, Request
from ..api_models import Envelope
from ..contracts import TalkRequest, TalkResponse, ConciergeResponse
from ..conversation.context_pack import build_context_pack
from ..conversation.checker import check_deterministic
from ..conversation.talk import talk, finish_run
from ..conversation.concierge import ask
from ..records import get_row, clean, serialize_run
from ..errors import NotFoundError
from ..ids import new_id, utc_now
from .. import bus
from .voice import authorize, VoiceRoute

router = APIRouter(tags=['voice'], dependencies=[Depends(authorize)], route_class=VoiceRoute)
ROLE_QUESTIONS = frozenset({"what is your role", "what's your role", "what do you do", "what are your responsibilities", "what are you responsible for", "tell me your role", "tell me about your role"})

async def voice_answer(*, db, llm, settings, venture_id, agent_id, req):
    started = time.monotonic()
    await get_row(db, 'ventures', venture_id)
    agent = await get_row(db, 'agents', agent_id)
    if agent['venture_id'] not in (None, venture_id):
        raise NotFoundError('agent', agent_id)
    async def fallback():
        if agent_id == 'concierge':
            return await ask(db=db, llm=llm, settings=settings, venture_id=venture_id, req=req)
        return await talk(db=db, llm=llm, settings=settings, venture_id=venture_id, agent_id=agent_id, req=req)
    question = ' '.join(req.text.strip().casefold().replace('’', "'").rstrip('?.!').split())
    role = agent.get('role_summary')
    # No compound questions, founder targets, truncated quotes, or status inference.
    if question not in ROLE_QUESTIONS or not isinstance(role, str) or not role.strip() or len(role) > 160 or clean(role, settings) != role:
        return await fallback()
    rid, aid, now = new_id('run'), new_id('ans'), utc_now()
    async with db.tx() as tx:
        await tx.execute("INSERT INTO runs(id,venture_id,agent_id,kind,job,model,status,created_at,started_at) VALUES(?,?,?,'talk','talk','deterministic','running',?,?)", (rid, venture_id, agent_id, now, now))
        event = serialize_run(await get_row(tx, 'runs', rid)); event.pop('output_text', None)
        await bus.emit(tx, venture_id=venture_id, type='run.started', entity_kind='run', entity_id=rid, data=event)
    try:
        pack = await build_context_pack(db=db, venture_id=venture_id, agent_id=agent_id, question=req.text, snapshot_run_id=rid)
        source = next(r for r in pack.records if r['kind'] == 'agent' and r['id'] == agent_id)
        text = 'My recorded role is: ' + role
        citations, check = await check_deterministic(db=db, pack=pack, text=text, citations=[{'ref': source['ref'], 'quote': role}])
        if check.status != 'verified':
            await finish_run(db, venture_id, rid, status='failed', error='Stored role changed or could not be verified')
            return await fallback()
        response = TalkResponse(answer_id=aid, text=text, citations=citations, check=check, latency_ms=int((time.monotonic()-started)*1000))
        async with db.tx() as tx:
            await tx.execute('INSERT INTO answers(id,venture_id,agent_id,run_id,question,answer,citations_json,check_status,check_json,created_at,checked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', (aid, venture_id, agent_id, rid, clean(req.text, settings), text, json.dumps([c.model_dump() for c in citations]), check.status, json.dumps(check.model_dump()), now, utc_now()))
            await tx.execute("UPDATE runs SET status='succeeded',output_text=?,output_json=?,completed_at=? WHERE id=?", (text, response.model_dump_json(), utc_now(), rid))
            event = serialize_run(await get_row(tx, 'runs', rid)); event.pop('output_text', None)
            await bus.emit(tx, venture_id=venture_id, type='run.finished', entity_kind='run', entity_id=rid, data=event)
        return response
    except BaseException:
        await finish_run(db, venture_id, rid, status='failed', error='Voice role lookup did not complete')
        raise

@router.post('/v1/ventures/{vid}/agents/{agent_id}/voice-ask', response_model=Envelope[TalkResponse | ConciergeResponse])
async def voice_ask(vid: str, agent_id: str, body: TalkRequest, request: Request):
    return {'data': await voice_answer(db=request.app.state.db, llm=request.app.state.llm, settings=request.app.state.settings, venture_id=vid, agent_id=agent_id, req=body)}
