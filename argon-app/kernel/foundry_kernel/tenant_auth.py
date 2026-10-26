"""Exact gateway policy; unknown routes and unscoped operations fail closed.
Only a gateway holding KERNEL_TOKEN may assert x-ycbf-user-id.
"""
import json
import re
from starlette.routing import compile_path
from .errors import KernelError

SUBJECT_RE = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:@|-]{0,254}\Z')
# Exact audited method/path pairs. Not a wildcard/prefix allowlist.
ALLOWED = {
 ('POST','/v1/ventures/{vid}/starter/auth/signup'),
 ('POST','/v1/ventures/{vid}/starter/auth/login'),
 ('POST','/v1/ventures/{vid}/starter/auth/logout'),
 ('GET','/v1/ventures/{vid}/starter/auth/me'),
 ('GET','/v1/ventures/{vid}/starter/provider'),
 ('POST','/v1/ventures/{vid}/starter/provider'),
 ('POST', '/v1/ventures/{vid}/starter/tutor'),
 ('POST', '/v1/ventures/{vid}/starter/start'),
 ('GET', '/v1/ventures/{vid}/starter'),
 ('GET', '/v1/ventures/{vid}/starter/preview'),
 ('GET', '/v1/ventures'), ('POST', '/v1/ventures'),
 ('GET', '/v1/world/manifest'),
 ('GET', '/v1/system/status'),  # Safe hosted bootstrap flags; handler redacts globals.
 ('GET', '/v1/ventures/{vid}'),
 ('POST', '/v1/ventures/{vid}/files'),
 ('POST', '/v1/ventures/{vid}/start'),
 ('POST', '/v1/ventures/{vid}/pause'),
 ('POST', '/v1/ventures/{vid}/resume'),
 ('GET', '/v1/ventures/{vid}/budget'),
 ('GET', '/v1/ventures/{vid}/settings'),
 ('POST', '/v1/ventures/{vid}/settings'),
 ('GET', '/v1/ventures/{vid}/agents'),
 ('GET', '/v1/ventures/{vid}/agents/{agent_id}'),
 ('GET', '/v1/ventures/{vid}/departments'),
 ('GET', '/v1/ventures/{vid}/departments/{dept}'),
 ('POST', '/v1/ventures/{vid}/departments/{dept}/resume'),
 ('GET', '/v1/ventures/{vid}/tickets'),
 ('GET', '/v1/tickets/{tid}'),
 ('POST', '/v1/tickets/{tid}/retry'),
 ('POST', '/v1/tickets/{tid}/cancel'),
 ('GET', '/v1/ventures/{vid}/runs'),
 ('GET', '/v1/runs/{rid}'), ('GET', '/v1/runs/{rid}/logs'),
 ('GET', '/v1/ventures/{vid}/artifacts'),
 ('GET', '/v1/artifacts/{aid}'),
 ('GET', '/v1/ventures/{vid}/marketing/{digest}.pdf'),
 ('GET', '/v1/ventures/{vid}/marketing/workspace'),
 ('POST', '/v1/ventures/{vid}/marketing/generate'),
 ('POST', '/v1/ventures/{vid}/marketing/drafts'),
 ('POST', '/v1/ventures/{vid}/marketing/drafts/{did}/edit'),
 ('POST', '/v1/ventures/{vid}/marketing/drafts/{did}/review'),
 ('POST', '/v1/ventures/{vid}/marketing/drafts/{did}/post'),
 ('GET', '/v1/ventures/{vid}/integrations'),
 ('POST', '/v1/ventures/{vid}/integrations/linkedin/connect'),
 ('POST', '/v1/ventures/{vid}/integrations/linkedin/refresh'),
 ('GET', '/v1/ventures/{vid}/approvals'),
 ('POST', '/v1/approvals/{aid}/decision'),
 ('GET', '/v1/ventures/{vid}/channels'),
 ('GET', '/v1/channels/{cid}/messages'),
 ('POST', '/v1/channels/{cid}/messages'),
 ('POST', '/v1/channels/{cid}/summarize'),
 ('POST', '/v1/ventures/{vid}/agents/{agent_id}/talk'),
 ('POST', '/v1/ventures/{vid}/agents/{agent_id}/voice-ask'),
 ('POST', '/v1/ventures/{vid}/concierge/ask'),
 ('GET', '/v1/answers/{answer_id}'),
 ('GET', '/v1/ventures/{vid}/activity'),
 ('GET', '/v1/ventures/{vid}/stream'),
 ('GET', '/v1/ventures/{vid}/org'),
 ('POST', '/v1/ventures/{vid}/standup'),
 ('GET', '/v1/ventures/{vid}/standups/latest'),
 ('POST', '/v1/ventures/{vid}/player/avatar'),
 ('GET', '/v1/ventures/{vid}/computers'),
 ('GET', '/v1/computers/{computer_id}/screen.png'),
 ('POST', '/v1/computers/{computer_id}/stop'),
 ('GET', '/v1/computer-tasks/{task_id}'),
 ('GET', '/v1/computer-tasks/{task_id}/screens/{step}.png'),
 ('GET', '/preview/{vid}/{ticket_id}/{path:path}'),
 ('POST', '/v1/voice/sessions'),
 ('POST', '/v1/voice/sessions/{session_id}/end'),
}

def denied():
    raise KernelError(404, 'not_found', 'Resource not found')

async def authorize_tenant(request):
    subjects = request.headers.getlist('x-ycbf-user-id')
    if len(subjects) != 1 or not SUBJECT_RE.fullmatch(subjects[0]):
        raise KernelError(401, 'unauthorized', 'A verified gateway principal is required')
    subject = subjects[0]
    request.state.user_id = subject
    route_path, params = None, {}
    for method, candidate in ALLOWED:
        if method != request.method:
            continue
        regex, _, converters = compile_path(candidate)
        matched = regex.fullmatch(request.scope['path'])
        if matched:
            route_path = candidate
            params = {k: converters[k].convert(v) for k, v in matched.groupdict().items()}
            break
    if route_path is None:
        raise KernelError(403, 'forbidden', 'This route is unavailable in gateway mode')
    db, cfg = request.app.state.db, request.app.state.settings
    scope_vid = None

    async def own(vid):
        nonlocal scope_vid
        if not isinstance(vid, str) or not vid:
            denied()
        row = await db.fetch_one('SELECT owner_user_id FROM ventures WHERE id=?', (vid,))
        if row is None or not (row['owner_user_id'] == subject or
            (row['owner_user_id'] is None and cfg.bootstrap_owner_subject == subject)):
            denied()
        if scope_vid is not None and scope_vid != vid:
            denied()
        scope_vid = vid

    async def entity(table, eid):
        row = await db.fetch_one(f'SELECT venture_id FROM {table} WHERE id=?', (eid,))
        if row is None:
            denied()
        if table == 'agents' and row['venture_id'] is None:
            return
        await own(row['venture_id'])

    if 'vid' in params:
        await own(params['vid'])
    mapping = {'tid': 'tickets', 'ticket_id': 'tickets', 'rid': 'runs',
               'cid': 'channels', 'answer_id': 'answers', 'computer_id': 'computers',
               'task_id': 'computer_tasks', 'agent_id': 'agents'}
    if 'aid' in params:
        await entity('approvals' if route_path.startswith('/v1/approvals/') else 'artifacts', params['aid'])
    for key, table in mapping.items():
        if key in params:
            await entity(table, params[key])
    if 'session_id' in params:
        row = await db.fetch_one("SELECT value_json FROM kv WHERE key='voice.sessions'")
        items = json.loads(row['value_json']) if row else []
        item = next((x for x in items if x.get('session_id') == params['session_id']), None)
        if item is None:
            denied()
        await own(item.get('venture_id'))
    refs = {'ticket_id': 'tickets', 'run_id': 'runs', 'agent_id': 'agents',
            'thread_root_id': 'messages', 'answer_id': 'answers'}
    for key, value in request.query_params.multi_items():
        if key in ('venture', 'venture_id', 'vid'):
            await own(value)
        elif key in refs and value:
            await entity(refs[key], value)
    # Only bounded reference-bearing schemas, never credential/upload/talk bodies.
    # Request.body cache is replayed by Starlette BaseHTTPMiddleware downstream.
    if request.method == 'POST' and route_path in {
        '/v1/voice/sessions', '/v1/voice/sessions/{session_id}/end',
        '/v1/channels/{cid}/messages',
    }:
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 262144:
                raise KernelError(413, 'too_large', 'Request too large')
        request._body = bytes(raw)
        try:
            body = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            raise KernelError(422, 'validation_error', 'Invalid JSON') from None
        if not isinstance(body, dict):
            raise KernelError(422, 'validation_error', 'Expected an object')
        if route_path == '/v1/voice/sessions':
            await own(body.get('venture_id'))
        for key, table in refs.items():
            value = body.get(key)
            if value is not None:
                if not isinstance(value, str):
                    raise KernelError(422, 'validation_error', 'Invalid reference')
                await entity(table, value)
        if 'answer_ids' in body:
            values = body['answer_ids']
            if not isinstance(values, list) or len(values) > 1000 or any(not isinstance(x, str) for x in values):
                raise KernelError(422, 'validation_error', 'Invalid references')
            for value in values:
                await entity('answers', value)
