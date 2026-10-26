"""Venture and owner scoped marketing drafts; publication is explicit and single-use."""
import hashlib
import json
import re
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field
from typing import Literal
from .. import gates
from ..ids import new_id, utc_now
from ..records import clean
from ..integrations.composio import ComposioClient, ComposioError
from ..integrations import linkedin_marketing as provider

router = APIRouter(tags=['marketing'])

async def scope(request, vid):
    v = await request.app.state.db.fetch_one('SELECT * FROM ventures WHERE id=?', (vid,))
    if not v: raise HTTPException(404, 'Company not found')
    principal = getattr(request.state, 'user_id', None)
    if principal and v.get('owner_user_id') not in (principal, None): raise HTTPException(404, 'Company not found')
    return v

def key(v, did):
    return f"marketing.draft.{v['id']}.{hashlib.sha256(str(v.get('owner_user_id')).encode()).hexdigest()[:16]}.{did}"

async def save(tx, v, d):
    await tx.execute('INSERT INTO kv(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at', (key(v,d['id']),json.dumps(d),utc_now()))

async def load(db, v, did):
    row = await db.fetch_one('SELECT value_json FROM kv WHERE key=?', (key(v,did),))
    if not row: raise HTTPException(404, 'Draft not found')
    return json.loads(row['value_json'])

class DraftInput(BaseModel):
    artifact_id: str = Field(max_length=100)

class EditInput(BaseModel):
    content: str = Field(min_length=1,max_length=3000)
    visibility: Literal['PUBLIC','CONNECTIONS'] = 'PUBLIC'

class PostInput(BaseModel):
    approval_id: str
    review_hash: str

@router.get('/v1/ventures/{vid}/marketing/workspace')
async def workspace(vid: str, request: Request):
    v = await scope(request,vid); db=request.app.state.db
    artifacts = await db.fetch_all("SELECT a.*,r.model,r.status AS run_status FROM artifacts a LEFT JOIN runs r ON r.id=a.run_id AND r.venture_id=a.venture_id WHERE a.venture_id=? AND a.uri LIKE ? ORDER BY a.created_at DESC LIMIT 20", (vid,f'/v1/ventures/{vid}/marketing/%.pdf'))
    rows=await db.fetch_all('SELECT value_json FROM kv WHERE key LIKE ? ORDER BY updated_at DESC LIMIT 20',(key(v,'')+'%',))
    connection=await db.fetch_one("SELECT status,account_ref FROM integrations WHERE venture_id=? AND provider='linkedin'",(vid,))
    tasks=await db.fetch_all("SELECT id,title,status FROM tickets WHERE venture_id=? AND type='growth.launch_plan' ORDER BY created_at DESC LIMIT 5",(vid,))
    return {'data': {'tasks':tasks,'venture_status':v['status'],'artifacts':artifacts,'drafts':[json.loads(x['value_json']) for x in rows], 'connection':connection, 'setup':'LinkedIn requires an enabled Composio LinkedIn OAuth config with openid, profile, email and w_member_social. This company must connect its own account. No post is sent by generating a draft.'}}

@router.post('/v1/ventures/{vid}/marketing/drafts')
async def create(vid: str, body: DraftInput, request: Request):
    v=await scope(request,vid);db=request.app.state.db
    a=await db.fetch_one('SELECT * FROM artifacts WHERE id=? AND venture_id=?',(body.artifact_id,vid))
    if not a or not str(a.get('uri') or '').startswith(f'/v1/ventures/{vid}/marketing/'): raise HTTPException(404,'Marketing source not found')
    source=a['content_md']; match=re.search(r'(?im)^#{1,4}\s+LinkedIn post\s*\n([\s\S]*?)(?=^#{1,4}\s|\Z)',source)
    content=clean((match.group(1) if match else source).strip(),request.app.state.settings)[:3000]
    d={'id':new_id('draft'),'venture_id':vid,'owner_user_id':v.get('owner_user_id'),'artifact_id':a['id'],'ticket_id':a['ticket_id'],'run_id':a['run_id'],'source_sha256':hashlib.sha256(source.encode()).hexdigest(),'content':content,'visibility':'PUBLIC','status':'draft','approval_id':None,'review_hash':None,'source_mode':'model LinkedIn post' if match else 'marketing output excerpt; edit before posting'}
    async with db.tx() as tx: await save(tx,v,d)
    return {'data':d}

@router.post('/v1/ventures/{vid}/marketing/drafts/{did}/edit')
async def edit(vid: str,did: str,body: EditInput,request: Request):
    v=await scope(request,vid);db=request.app.state.db
    async with db.tx() as tx:
        d=await load(tx,v,did)
        if d['status'] in ('publishing','published','uncertain'): raise HTTPException(409,'Publication is locked; inspect LinkedIn before creating another post.')
        content=re.sub(r'[\x00-\x08\x0b-\x1f\x7f]', '', clean(body.content,request.app.state.settings)).strip()
        if not content: raise HTTPException(422,'Post is empty')
        d.update(content=content,visibility=body.visibility,status='draft',approval_id=None,review_hash=None)
        d.pop('review',None)
        await save(tx,v,d)
    return {'data':d}

@router.post('/v1/ventures/{vid}/marketing/drafts/{did}/review')
async def review(vid: str,did: str,request: Request):
    v=await scope(request,vid);db=request.app.state.db;d=await load(db,v,did)
    if d['status'] in ('publishing','published','uncertain'): raise HTTPException(409,'This post is locked.')
    integration=await db.fetch_one("SELECT * FROM integrations WHERE venture_id=? AND provider='linkedin' AND status='active'",(vid,))
    if not integration: raise HTTPException(409,'Connect LinkedIn for this company first.')
    ownership=json.loads(integration['data_json'] or '{}')
    if ownership.get('linked_for_venture')!=vid or ownership.get('owner_user_id')!=v.get('owner_user_id'):
        raise HTTPException(409,'Reconnect LinkedIn for this company and owner. Another company account cannot be reused.')
    try: identity=await provider.profile(ComposioClient(request.app.state.settings),v['composio_user_id'],integration['account_ref'])
    except ComposioError as e: raise HTTPException(409,e.user_message)
    async with db.tx() as tx:
        current=await load(tx,v,did)
        if current != d: raise HTTPException(409,'Draft changed; review again.')
        d.update(account_ref=integration['account_ref'],user_id=v['composio_user_id'],**identity)
        exact={k:d.get(k) for k in ('id','venture_id','owner_user_id','content','visibility','account_ref','author','source_sha256')}
        d['review']=exact;d['review_hash']=hashlib.sha256(json.dumps(exact,sort_keys=True).encode()).hexdigest()
        d['approval_id']=await gates.request_approval(tx,venture_id=vid,gate_type='outreach',title='Publish reviewed LinkedIn post',summary=f"{identity['name']} · {d['visibility']} · exact content in payload",payload=exact)
        d['status']='review';await save(tx,v,d)
    return {'data':d}

@router.post('/v1/ventures/{vid}/marketing/drafts/{did}/post')
async def publish(vid: str,did: str,body: PostInput,request: Request):
    v=await scope(request,vid);db=request.app.state.db
    async with db.tx() as tx:
        d=await load(tx,v,did)
        if d['status'] in ('published','uncertain','publishing'): return {'data':d}
        if d['status']!='review' or body.approval_id!=d['approval_id'] or body.review_hash!=d['review_hash']: raise HTTPException(409,'Review exact content and account again.')
        approved=await gates.require_approved(tx,body.approval_id,'outreach')
        if approved['venture_id']!=vid or json.loads(approved['payload_json'])!=d['review']: raise HTTPException(409,'Approval mismatch')
        d['status']='publishing';await save(tx,v,d)
    try:
        d['post_url']=await provider.publish(db,ComposioClient(request.app.state.settings),d,body.approval_id)
        d['status']='published'
    except Exception:
        d['status']='uncertain';d['error']='Publication could not be confirmed. Check LinkedIn directly. Automatic retry is disabled.'
    async with db.tx() as tx: await save(tx,v,d)
    return {'data':d}

@router.post('/v1/ventures/{vid}/marketing/generate')
async def generate(vid: str, request: Request):
    """Queue real existing Growth work. Never starts a company or bypasses its budget."""
    from ..records import create_ticket, serialize_ticket
    v=await scope(request,vid);db=request.app.state.db
    async with db.tx() as tx:
        existing=await tx.fetch_one("SELECT * FROM tickets WHERE venture_id=? AND type='growth.launch_plan' AND status IN ('open','in_progress','waiting_approval','blocked') ORDER BY created_at DESC LIMIT 1",(vid,))
        if existing:
            ticket=await serialize_ticket(tx,existing)
        else:
            ticket=await create_ticket(tx,venture_id=vid,type='growth.launch_plan',department_id='growth',assigned_agent_id='gr.growth-planner',title='Create marketing launch plan and LinkedIn draft',body='Create an app-specific marketing launch plan from this company brief, spec, research and actual product evidence. Clearly state missing inputs. Include actionable positioning, channels, launch sequence, measurement, and a polished plain-text LinkedIn post grounded in the real product. Produce the real marketing plan PDF via the normal handler. Draft only: no public posting, spending increase, or integration execution.',payload={'source':'marketing_workspace','publication':'draft_only'},priority=2)
    return {'data':{'ticket_id':ticket['id'],'status':ticket['status'],'venture_status':v['status'],'message':'Queued for the existing Growth scheduler; normal budget and approval gates apply.' if v['status']=='running' else 'Marketing task queued. Start or resume this company from its dashboard to run it; no model has run yet.'}}
