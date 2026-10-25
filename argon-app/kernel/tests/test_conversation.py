# OWNER: tanush
"""Real HTTP persistence and source checking around scripted conversation outputs."""
import asyncio
import json

import pytest

from foundry_kernel.ids import new_id, utc_now
from tests.tanush.helpers import execute


def venture(client):
    response=client.post("/v1/ventures",json={"name":"Pantry Pal","idea":"Track pantry items","founder_name":"Tanush"})
    assert response.status_code==200
    return response.json()["data"]["id"]


def write(client,sql,params=()):return client.portal.call(execute,client.app.state.db,sql,params)
def rows(client,sql,params=()):return client.portal.call(client.app.state.db.fetch_all,sql,params)


def test_talk_stores_real_source_and_async_check_then_answer_route(client):
    vid=venture(client);aid=new_id("art")
    write(client,"INSERT INTO artifacts(id,venture_id,department_id,agent_id,kind,title,content_md,created_at) VALUES(?,?,'engineering','eng.builder','report','Recorded test run','Exactly 7 tests passed.',?)",(aid,vid,utc_now()))
    client.app.state.llm.script("talk",[{"text":"Exactly 7 tests passed.","citations":[{"kind":"artifact","id":aid,"quote":"Exactly 7 tests passed."}]}])
    response=client.post(f"/v1/ventures/{vid}/agents/eng.builder/talk",json={"text":"How many tests passed?"})
    assert response.status_code==200,response.text
    data=response.json()["data"]
    assert data["citations"][0]["id"]==aid and data["check"]["status"] in {"pending","verified"}
    async def settle():
        await asyncio.gather(*list(client.app.state.db._answer_checks))
    client.portal.call(settle)
    stored=client.get(f"/v1/answers/{data['answer_id']}").json()["data"]
    assert stored["check"]["status"]=="verified" and stored["text"]=="Exactly 7 tests passed."
    answer=rows(client,"SELECT * FROM answers WHERE id=?",(data["answer_id"],))[0]
    run=rows(client,"SELECT * FROM runs WHERE id=?",(answer["run_id"],))[0]
    assert run["kind"]=="talk" and "context_snapshot" in run["input_text"]
    assert run["output_text"]==stored["text"]
    assert rows(client,"SELECT id FROM events WHERE type='answer.checked' AND entity_id=?",(answer["id"],))


def test_unknown_citation_never_claims_verified_or_exposes_foreign_record(client):
    first,second=venture(client),venture(client);foreign=new_id("art")
    write(client,"INSERT INTO artifacts(id,venture_id,department_id,kind,title,content_md,created_at) VALUES(?,?,'engineering','report','Private','Secret result99',?)",(foreign,second,utc_now()))
    client.app.state.llm.script("talk",[{"text":"We shipped 99 features.","citations":[{"kind":"artifact","id":foreign,"quote":"Secret result99"}]}])
    result=client.post(f"/v1/ventures/{first}/agents/eng.builder/talk",json={"text":"What shipped?"}).json()["data"]
    assert result["check"]["status"]=="unsupported" and result["citations"]==[]
    assert "Secret result99" not in json.dumps(result)


def test_gated_action_refuses_execution_and_cites_pending_approval(client):
    vid=venture(client);apr=new_id("apr")
    write(client,"INSERT INTO approvals(id,venture_id,requested_by_agent_id,gate_type,title,summary,created_at) VALUES(?,?,'eng.qa','merge','Merge the change','Review tests first',?)",(apr,vid,utc_now()))
    response=client.post(f"/v1/ventures/{vid}/agents/eng.builder/talk",json={"text":"Can you merge the change?"})
    assert response.status_code==200,response.text
    result=response.json()["data"]
    assert "dashboard" in result["text"].lower() and result["citations"][0]["id"]==apr
    assert not any(name=="talk" for name,_ in client.app.state.llm.calls)
    assert rows(client,"SELECT status FROM approvals WHERE id=?",(apr,))[0]["status"]=="pending"


def test_concierge_routes_only_to_real_agent_and_real_building(client):
    vid=venture(client)
    client.app.state.llm.script("route_rank",[{"ranking":["mr.research-lead","foreign.agent"],"reason":"Research role"}])
    client.app.state.llm.script("concierge",[{"text":"You can ask the research lead.","citations":[],"route":{"agent_id":"mr.research-lead","reason":"Their role owns market research."}}])
    response=client.post(f"/v1/ventures/{vid}/concierge/ask",json={"text":"Who handles market research?"})
    assert response.status_code==200,response.text
    route=response.json()["data"]["route_card"]
    assert route["agent_id"]=="mr.research-lead" and route["building_id"]=="b-market-research" and route["agent_name"]=="Priya"


def test_history_is_limited_to6_and_question_secrets_are_redacted(client):
    vid=venture(client);secret="ghp_"+"z"*30
    history=[{"role":"user","text":f"Turn{n}"} for n in range(10)]
    response=client.post(f"/v1/ventures/{vid}/agents/eng.builder/talk",json={"text":f"Question {secret}","history":history})
    assert response.status_code==200,response.text
    prompt=next(prompt for name,prompt in client.app.state.llm.calls if name=="talk")
    assert "Turn0" not in prompt and "Turn3" not in prompt and "Turn4" in prompt and "Turn9" in prompt
    assert json.loads(prompt)["source_refs"]  # provider schema derives its allowed citation refs from this pack
    assert secret not in prompt and secret not in json.dumps(rows(client,"SELECT * FROM answers"))


@pytest.mark.parametrize("text",[""," ","a"*4001])
def test_invalid_question_is_rejected_before_provider_call(client,text):
    vid=venture(client)
    response=client.post(f"/v1/ventures/{vid}/agents/eng.builder/talk",json={"text":text})
    assert response.status_code==400 and "error" in response.json()
    assert not client.app.state.llm.calls


def test_unknown_venture_agent_answer_routes_return404(client):
    vid=venture(client)
    for path in (f"/v1/ventures/{vid}/agents/missing/talk","/v1/ventures/ven_missing/agents/eng.builder/talk"):
        response=client.post(path,json={"text":"What is happening?"})
        assert response.status_code==404 and "error" in response.json()
    assert client.get("/v1/answers/ans_missing").status_code==404


@pytest.mark.parametrize("question",[
    "Could you please merge this change?", "Would you mind sending the invitation?",
    "Go ahead and publish this update.", "I need you to hire a specialist.",
    "I'd like you to approve the purchase.", "Please just connect GitHub.",
    "Now email the customer.", "Can you kindly deploy the project?",
    "Increase our spending budget.", "Please raise the budget.",
    "Let's contact the vendor.", "Will you go ahead and register the agent?",
])
def test_action_detection_handles_general_request_grammar(question):
    from foundry_kernel.conversation.talk import action_requested
    assert action_requested(question)


@pytest.mark.parametrize("question",[
    "Who approved the change?", "What happened after the merge?", "How much have we spent?",
    "Can you tell me who sent the invitation?", "Please explain the deployment plan.",
    "Would you summarize the hiring proposal?", "Why is the purchase blocked?",
    "Please do not send anything.",
])
def test_action_detection_preserves_questions_about_recorded_work(question):
    from foundry_kernel.conversation.talk import action_requested
    assert not action_requested(question)


def test_refusing_a_concierge_action_needs_no_provider_even_when_budget_exhausted(client):
    vid=venture(client)
    write(client,"UPDATE ventures SET spent_usd=budget_usd WHERE id=?",(vid,))
    response=client.post(f"/v1/ventures/{vid}/concierge/ask",json={"text":"Could you kindly send this invitation?"})
    assert response.status_code==200,response.text
    assert "Approvals" in response.json()["data"]["text"]
    assert not client.app.state.llm.calls
    stored=rows(client,"SELECT model,status FROM runs WHERE venture_id=? AND kind='concierge'",(vid,))
    assert stored==[{"model":"deterministic","status":"succeeded"}]


def test_conversation_supplies_original_json_schema_and_routing_has_own_run(client):
    from foundry_kernel.llm.fake import FakeLLM
    class SchemaAware(FakeLLM):
        async def generate_json(self,name,prompt,schema,**kwargs):
            if name=="concierge":
                assert '"$defs"' in kwargs["system"] and '"SourceQuote"' in kwargs["system"]
            return await super().generate_json(name,prompt,schema,**kwargs)
    client.app.state.llm=SchemaAware()
    vid=venture(client)
    response=client.post(f"/v1/ventures/{vid}/concierge/ask",json={"text":"What is recorded?"})
    assert response.status_code==200,response.text
    runs=rows(client,"SELECT id,job,output_text FROM runs WHERE venture_id=?",(vid,))
    router=next(row for row in runs if row["job"]=="route_rank")
    spoken=next(row for row in runs if row["job"]=="concierge")
    assert router["id"]!=spoken["id"] and spoken["output_text"]==response.json()["data"]["text"]


def test_directory_only_provider_fallback_cites_real_role_and_is_explicitly_unverified(client):
    from foundry_kernel.llm.fake import FakeLLM
    class Unavailable(FakeLLM):
        async def generate_json(self,name,*args,**kwargs):
            if name=="concierge":raise ValueError("Provider did not return JSON")
            return await super().generate_json(name,*args,**kwargs)
    client.app.state.llm=Unavailable()
    vid=venture(client)
    response=client.post(f"/v1/ventures/{vid}/concierge/ask",json={"text":"Who should I ask about security review?"})
    assert response.status_code==200,response.text
    result=response.json()["data"];route=result["route_card"]
    assert result["check"]["status"]=="unsupported" and "provider failed" in result["check"]["reason"].lower()
    agent=rows(client,"SELECT display_name,title FROM agents WHERE id=?",(route["agent_id"],))[0]
    assert agent["display_name"] in result["text"] and agent["title"] in result["text"]
    assert result["citations"][0]["kind"]=="agent" and result["citations"][0]["id"]==route["agent_id"]
    assert "couldn't generate" in result["text"]


def test_provider_failure_does_not_infer_who_performed_work(client):
    from foundry_kernel.llm.fake import FakeLLM
    class Unavailable(FakeLLM):
        async def generate_json(self,name,*args,**kwargs):
            if name=="concierge":raise ValueError("Provider unavailable")
            return await super().generate_json(name,*args,**kwargs)
    client.app.state.llm=Unavailable()
    vid=venture(client)
    response=client.post(f"/v1/ventures/{vid}/concierge/ask",json={"text":"Who shipped the last release?"})
    assert response.status_code==502 and "error" in response.json()
    assert not rows(client,"SELECT id FROM answers WHERE venture_id=?",(vid,))


async def test_cancelled_conversation_closes_its_run_and_tracking_lock(db,settings):
    from foundry_kernel.contracts import TalkRequest
    from foundry_kernel.conversation.talk import talk
    from foundry_kernel.llm.fake import FakeLLM
    from tests.test_scheduler import company
    vid,_=await company(db,settings)
    entered=asyncio.Event()
    class Blocking(FakeLLM):
        async def generate_json(self,*args,**kwargs):
            entered.set()
            await asyncio.Event().wait()
    task=asyncio.create_task(talk(db=db,llm=Blocking(),settings=settings,venture_id=vid,agent_id="eng.builder",req=TalkRequest(text="What is the current work?")))
    await asyncio.wait_for(entered.wait(),2)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):await task
    row=await db.fetch_one("SELECT id,status,error FROM runs WHERE venture_id=? AND kind='talk'",(vid,))
    assert row["status"]=="cancelled" and "cancelled" in row["error"]
    assert row["id"] not in db._llm_tracking_locks
    assert not await db.fetch_all("SELECT id FROM answers WHERE venture_id=?",(vid,))


def test_dashboard_talk_to_nova_preserves_the_concierge_model_matrix(client):
    vid=venture(client)
    client.app.state.llm.script("concierge",[{"text":"Please ask the research lead.","citations":[],"route":{"agent_id":"mr.research-lead","reason":"They own market research."}}])
    response=client.post(f"/v1/ventures/{vid}/agents/concierge/talk",json={"text":"Who handles market research?"})
    assert response.status_code==200,response.text
    data=response.json()["data"]
    assert data["suggested_agent"]["agent_id"]=="mr.research-lead"
    assert {name for name,_ in client.app.state.llm.calls}>={"concierge","route_rank"}
    assert not any(name=="talk" for name,_ in client.app.state.llm.calls)
