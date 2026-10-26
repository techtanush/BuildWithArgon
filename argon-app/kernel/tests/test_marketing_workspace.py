import json
import pytest
from foundry_kernel.api.marketing import key
from foundry_kernel.integrations.linkedin_marketing import publish
from foundry_kernel.errors import GateNotApproved

def test_draft_owner_and_venture_scope():
 assert key({'id':'a','owner_user_id':'one'},'d') != key({'id':'a','owner_user_id':'two'},'d')
 assert key({'id':'a','owner_user_id':'one'},'d') != key({'id':'b','owner_user_id':'one'},'d')

@pytest.mark.asyncio
async def test_publish_requires_gate(db):
 with pytest.raises(GateNotApproved):
  await publish(db,None,{},None)

def test_routes_are_exact():
 from foundry_kernel.tenant_auth import ALLOWED
 assert ('POST','/v1/ventures/{vid}/marketing/drafts/{did}/post') in ALLOWED
 assert ('POST','/v1/ventures/{vid}/integrations/linkedin/connect') in ALLOWED
 assert ('POST','/v1/ventures/{vid}/integrations/{provider}/connect') not in ALLOWED

def test_real_source_edit_and_cross_venture_rejection(client):
 from tests.test_api_contract import create_venture, write
 from foundry_kernel.ids import utc_now
 a=create_venture(client); b=create_venture(client,name='Other')
 vid=a['id']; base=f'/v1/ventures/{vid}/marketing'
 source='## Launch plan\nActual output.\n\n## LinkedIn post\nPantry Pal helps you track pantry expiry.\n'
 write(client,'INSERT INTO artifacts(id,venture_id,department_id,kind,title,content_md,uri,created_at) VALUES(?,?,?,?,?,?,?,?)',('art_marketing_test',vid,'growth','plan','Actual plan',source,f'{base}/'+'a'*64+'.pdf',utc_now()))
 response=client.post(base+'/drafts',json={'artifact_id':'art_marketing_test'})
 assert response.status_code==200,response.text
 d=response.json()['data'];assert d['content']=='Pantry Pal helps you track pantry expiry.'
 assert d['approval_id'] is None and d['review_hash'] is None
 assert client.post(f"/v1/ventures/{b['id']}/marketing/drafts",json={'artifact_id':'art_marketing_test'}).status_code==404
 assert client.post(f"/v1/ventures/{b['id']}/marketing/drafts/{d['id']}/edit",json={'content':'stolen'}).status_code==404
 r=client.post(f"{base}/drafts/{d['id']}/edit",json={'content':'Edited exact text','visibility':'CONNECTIONS'})
 assert r.status_code==200 and r.json()['data']['approval_id'] is None
 assert client.post(f"{base}/drafts/{d['id']}/post",json={'approval_id':'missing','review_hash':'missing'}).status_code==409
 assert client.post(f"{base}/drafts/{d['id']}/review").status_code==409

@pytest.mark.asyncio
async def test_publish_url_and_exact_bound_account(db,monkeypatch):
 from foundry_kernel.integrations import linkedin_marketing as adapter
 class Client:
  async def toolkit_connection_status(self,toolkit,user):
   assert toolkit=='linkedin' and user=='foundry:test'
   return {'status':'active','account_ref':'ca_test'}
  async def _request(self,method,path,body):
   assert body['connected_account_id']=='ca_test'
   assert body['arguments']=={'author':'urn:li:person:abc','commentary':'Exact text','visibility':'PUBLIC','lifecycleState':'PUBLISHED'}
   return {'successful':True,'data':{'response_data':{'share_id':'urn:li:share:123'}}}
 async def approved(*args): return {'venture_id':'test','payload_json':'{"exact": true}'}
 monkeypatch.setattr(adapter.gates,'require_approved',approved)
 draft={'venture_id':'test','review':{'exact':True},'user_id':'foundry:test','account_ref':'ca_test','author':'urn:li:person:abc','content':'Exact text','visibility':'PUBLIC'}
 assert await publish(db,Client(),draft,'approval')=='https://www.linkedin.com/feed/update/urn:li:share:123/'
 draft['review']={'different':True}
 with pytest.raises(adapter.ComposioError): await publish(db,Client(),draft,'approval')

def test_explicit_post_is_single_use_and_uncertain_never_retries(client,monkeypatch):
 from tests.test_api_contract import create_venture, write
 from foundry_kernel.ids import utc_now
 from foundry_kernel.integrations import linkedin_marketing as adapter
 a=create_venture(client);vid=a['id'];base=f'/v1/ventures/{vid}/marketing'
 write(client,'INSERT INTO artifacts(id,venture_id,department_id,kind,title,content_md,uri,created_at) VALUES(?,?,?,?,?,?,?,?)',('art_publish_test',vid,'growth','plan','Plan','## LinkedIn post\nActual draft',base+'/'+'a'*64+'.pdf',utc_now()))
 write(client,'INSERT INTO integrations(id,venture_id,provider,status,account_ref,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',('int_test',vid,'linkedin','active','ca_scoped',json.dumps({'owner_user_id':None,'linked_for_venture':vid}),utc_now(),utc_now()))
 async def profile(*args): return {'name':'Verified Member','author':'urn:li:person:verified'}
 calls=[]
 async def publish_mock(*args):
  calls.append(1)
  raise RuntimeError('response lost')
 monkeypatch.setattr(adapter,'profile',profile);monkeypatch.setattr(adapter,'publish',publish_mock)
 d=client.post(base+'/drafts',json={'artifact_id':'art_publish_test'}).json()['data']
 d=client.post(f"{base}/drafts/{d['id']}/review").json()['data']
 payload={'approval_id':d['approval_id'],'review_hash':d['review_hash']}
 assert client.post(f"{base}/drafts/{d['id']}/post",json=payload).status_code==409
 assert calls==[]
 assert client.post(f"/v1/approvals/{d['approval_id']}/decision",json={'decision':'approve','decided_by':'Founder'}).status_code==200
 for _ in range(2):
  result=client.post(f"{base}/drafts/{d['id']}/post",json=payload)
  assert result.status_code==200 and result.json()['data']['status']=='uncertain'
 assert len(calls)==1
 assert client.post(f"{base}/drafts/{d['id']}/edit",json={'content':'Changed'}).status_code==409

def test_generate_queues_real_task_idempotently_without_starting_company(client):
 from tests.test_api_contract import create_venture
 v=create_venture(client);base=f"/v1/ventures/{v['id']}/marketing"
 one=client.post(base+'/generate');two=client.post(base+'/generate')
 assert one.status_code==200 and two.status_code==200
 a=one.json()['data'];assert a['ticket_id']==two.json()['data']['ticket_id']
 assert a['venture_status']=='draft'
 task=client.get('/v1/tickets/'+a['ticket_id']).json()['data']
 assert task['type']=='growth.launch_plan' and task['assigned_agent_id']=='gr.growth-planner'
 assert task['runs']==[] and task['artifacts']==[]
 assert client.get(f"/v1/ventures/{v['id']}").json()['data']['status']=='draft'
