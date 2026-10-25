# OWNER: tanush
"""Company reporting lines and cached, source-linked standup playback."""
from __future__ import annotations

import asyncio
import hashlib
import json

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from ..api_models import Agent, Department, Envelope
from ..contracts import Alignment, StandupLatest
from ..ids import utc_now
from ..records import (
    create_ticket,
    get_row,
    json_loads,
    serialize_agent,
    serialize_department,
)
from ..voice import tts

router = APIRouter(tags=['org'])


class DepartmentTeam(BaseModel):
    department: Department
    lead: Agent | None
    members: list[Agent]


class Organization(BaseModel):
    founder: str
    chief_of_staff: Agent
    departments: list[DepartmentTeam]
    concierge: Agent


class StandupTicket(BaseModel):
    ticket_id: str


class StandupAudio(BaseModel):
    agent_id: str
    audio_url: str | None = None
    alignment: Alignment | None = None


class LatestStandup(StandupLatest):
    audio: list[StandupAudio] = Field(default_factory=list)


@router.get('/v1/ventures/{vid}/org', response_model=Envelope[Organization])
async def organization(vid: str, request: Request):
    db = request.app.state.db
    venture = await get_row(db, 'ventures', vid)
    agents = await db.fetch_all('SELECT * FROM agents WHERE venture_id IS NULL OR venture_id=? ORDER BY generated,id', (vid,))
    serialized = {a['id']: await serialize_agent(db, a, vid) for a in agents}
    teams = []
    for dept in await db.fetch_all('SELECT * FROM departments ORDER BY sort_order'):
        members = [a for a in agents if a['department_id'] == dept['id'] and a['id'] != 'concierge']
        lead = next((a for a in members if a['is_lead']), None)
        teams.append({'department': await serialize_department(db, dept, vid),
                      'lead': serialized[lead['id']] if lead else None,
                      'members': [serialized[a['id']] for a in members if not lead or a['id'] != lead['id']]})
    return {'data': {'founder': venture['founder_name'], 'chief_of_staff': serialized['cos.orchestrator'],
                     'departments': teams, 'concierge': serialized['concierge']}}


@router.post('/v1/ventures/{vid}/standup', response_model=Envelope[StandupTicket])
async def trigger_standup(vid: str, request: Request):
    db = request.app.state.db
    await get_row(db, 'ventures', vid)
    async with db.tx() as tx:
        current = await tx.fetch_one("SELECT id FROM tickets WHERE venture_id=? AND type='cos.standup' AND status IN ('open','in_progress','waiting_approval','blocked') ORDER BY created_at DESC LIMIT 1", (vid,))
        if current:
            return {'data': {'ticket_id': current['id']}}
        ticket = await create_ticket(tx, venture_id=vid, type='cos.standup', department_id='chief-of-staff', title='Company standup', created_by='human')
    return {'data': {'ticket_id': ticket['id']}}


@router.get('/v1/ventures/{vid}/standups/latest', response_model=Envelope[LatestStandup])
async def latest_standup(vid: str, request: Request):
    db, settings = request.app.state.db, request.app.state.settings
    await get_row(db, 'ventures', vid)
    marker = await db.fetch_one('SELECT value_json FROM kv WHERE key=?', (f'standup.latest.{vid}',))
    if marker is None:
        return {'data': {'root_message_id': None, 'created_at': None, 'updates': [], 'decisions': None, 'audio': []}}
    source = json_loads(marker['value_json'], {})
    result = LatestStandup.model_validate(source)
    # One lock per application prevents duplicate provider charges on concurrent playback.
    lock = getattr(request.app.state, 'standup_audio_lock', None)
    if lock is None:
        lock = request.app.state.standup_audio_lock = asyncio.Lock()
    async with lock:
        updates = list(result.updates) + ([result.decisions] if result.decisions else [])
        for update in updates:
            digest = hashlib.sha256(update.text.encode()).hexdigest()
            key = f'standup.audio.{vid}.{result.root_message_id}.{update.agent_id}.{digest}'
            cached = await db.fetch_one('SELECT value_json FROM kv WHERE key=?', (key,))
            if cached:
                result.audio.append(StandupAudio.model_validate(json_loads(cached['value_json'], {})))
                continue
            try:
                response = await tts.synthesize(settings=settings, db=db, agent_id=update.agent_id, text=update.text)
                audio = StandupAudio(agent_id=update.agent_id, audio_url=response.audio_url if response.provider != 'browser' else None, alignment=response.alignment)
            except Exception:  # noqa: BLE001 - unavailable voice keeps captions and browser speech usable
                audio = StandupAudio(agent_id=update.agent_id)
            result.audio.append(audio)
            async with db.tx() as tx:
                await tx.execute('INSERT INTO kv(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at', (key, json.dumps(audio.model_dump()), utc_now()))
    return {'data': result}
