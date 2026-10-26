"""Explicit user-click starter, owned preview and grounded status."""
from typing import Literal
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from ..departments.starter import TYPES, CSP, cost_bound, require_live, root_for
from ..errors import ConflictError, NotFoundError
from ..records import create_ticket, get_row
from .ventures import set_status
router = APIRouter(tags=['starter'])

class StartStarter(BaseModel):
    scenario: Literal["ai_tutor_demo"] | None = None
    budget_usd: float = Field(default=0.25, gt=0, le=0.25, allow_inf_nan=False)

async def status_data(vid, request):
    db = request.app.state.db
    venture = await get_row(db, 'ventures', vid)
    tickets = await db.fetch_all("SELECT id,type,status,result_json FROM tickets WHERE venture_id=? AND type LIKE 'starter.%' ORDER BY created_at,id", (vid,))
    runs = await db.fetch_all("SELECT r.id,r.ticket_id,r.job,r.model,r.status,r.cost_usd,r.error FROM runs r JOIN tickets t ON t.id=r.ticket_id WHERE t.venture_id=? AND t.type LIKE 'starter.%' ORDER BY r.created_at", (vid,))
    artifacts = await db.fetch_all("SELECT id,kind,title,uri,run_id FROM artifacts WHERE venture_id=? AND json_extract(meta_json,'$.starter')=1 ORDER BY created_at", (vid,))
    preview = next((a['uri'] for a in artifacts if a['kind']=='preview'), None)
    status = 'not_started'
    if tickets:
        status = 'ready' if preview else ('blocked' if any(t['status'] in ('failed','blocked','cancelled') for t in tickets) else 'running' if any(t['status']=='in_progress' for t in tickets) else 'queued')
    return dict(venture_id=vid, status=status, venture_status=venture['status'], ticket_id=next((t['id'] for t in tickets if t['type']=='starter.plan'), None), tickets=tickets, runs=runs, artifacts=artifacts, preview_url=preview, message='Status comes from persisted tickets, runs and artifacts. Generic starters are static concept previews, not full applications. The explicitly selected tutor scenario includes its prebuilt tutor interface.')

@router.get('/v1/ventures/{vid}/starter')
async def status(vid: str, request: Request):
    return {'data': await status_data(vid, request)}

@router.post('/v1/ventures/{vid}/starter/start')
async def start(vid: str, body: StartStarter, request: Request):
    db, cfg = request.app.state.db, request.app.state.settings
    await get_row(db, 'ventures', vid)
    existing = await status_data(vid, request)
    if existing['tickets']:
        return {'data': existing}
    try:
        if body.scenario is None:
            require_live(cfg)
        bound = 0.0 if body.scenario else cost_bound()
    except ValueError as exc:
        raise ConflictError(str(exc)) from None
    if bound > body.budget_usd:
        raise ConflictError('Starter token bound exceeds requested budget cap')
    async with db.tx() as tx:
        venture = await get_row(tx, 'ventures', vid)
        if len(venture['idea'].encode()) > 12000:
            raise ConflictError('Starter accepts up to 12000 UTF-8 bytes of founder idea; shorten the idea explicitly, never silently truncate')
        if venture['status'] not in ('draft', 'running'):
            raise ConflictError('Resume venture explicitly before starting starter')
        if venture['spent_usd'] + bound > venture['budget_usd']:
            raise ConflictError('Insufficient remaining venture budget')
        if not await tx.fetch_one("SELECT id FROM tickets WHERE venture_id=? AND type='starter.plan'", (vid,)):
            previous = None
            for kind in TYPES:
                t = await create_ticket(tx, venture_id=vid, type=kind, department_id='engineering', title=kind.replace('.', ': '), body=venture['idea'] if kind=='starter.plan' else '', payload={'budget_usd': body.budget_usd, 'scenario': body.scenario})
                await tx.execute('UPDATE tickets SET max_attempts=1 WHERE id=?', (t['id'],))
                if kind == 'starter.plan':
                    import json
                    from ..ids import utc_now
                    await tx.execute('INSERT INTO kv(key,value_json,updated_at) VALUES(?,?,?)', ('starter.authorization.' + vid, json.dumps({'ticket_id': t['id'], 'budget_usd': body.budget_usd, 'scenario': body.scenario}), utc_now()))
                if previous:
                    await tx.execute('INSERT INTO ticket_deps(ticket_id,depends_on_id) VALUES(?,?)', (t['id'], previous))
                previous = t['id']
            if venture['status']=='draft':
                await set_status(tx, vid, 'running')
    return {'data': await status_data(vid, request)}

@router.get('/v1/ventures/{vid}/starter/preview')
async def preview(vid: str, request: Request):
    db = request.app.state.db
    await get_row(db, 'ventures', vid)
    row = await db.fetch_one("SELECT meta_json FROM artifacts WHERE venture_id=? AND kind='preview' AND json_extract(meta_json,'$.starter')=1", (vid,))
    target = root_for(request.app.state.settings, vid) / 'index.html'
    if not row or not target.is_file():
        raise NotFoundError('starter preview', vid)
    import json, hashlib
    raw = target.read_text()
    if hashlib.sha256(raw.encode()).hexdigest() != json.loads(row['meta_json'])['sha256']:
        raise NotFoundError('starter preview integrity', vid)
    if json.loads(row['meta_json']).get('tutor_included', True):
        from ..departments.starter_widget import attach_widget, CSP as tutor_csp
        raw = attach_widget(raw)
        policy = tutor_csp
    else:
        policy = CSP
    return HTMLResponse(raw, headers={'Content-Security-Policy': policy, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'same-origin'})

from .starter_tutor import tutor
router.add_api_route("/v1/ventures/{vid}/starter/tutor", tutor, methods=["POST"])

from .starter_provider import configured, configure
router.add_api_route("/v1/ventures/{vid}/starter/provider", configured, methods=["GET"])
router.add_api_route("/v1/ventures/{vid}/starter/provider", configure, methods=["POST"])
