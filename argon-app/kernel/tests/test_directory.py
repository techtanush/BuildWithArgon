# OWNER: tanush
"""Directory candidates stay within the venture and provider rankings are constrained."""
import pytest

from foundry_kernel.conversation.directory import directory_search
from foundry_kernel.ids import new_id, utc_now
from foundry_kernel.llm.fake import FakeLLM


@pytest.fixture
async def directory_venture(db):
    vid=new_id("ven");now=utc_now()
    async with db.tx() as tx:
        await tx.execute("INSERT INTO ventures(id,name,slug,idea,founder_name,composio_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",(vid,"Demo",vid,"Useful idea","Tanush",vid,now,now))
    return vid


async def test_keyword_routing_and_bad_model_fallback(db,directory_venture):
    llm=FakeLLM();llm.script("route_rank",["not valid JSON"])
    results=await directory_search("Who handles customer support bugs?",db=db,venture_id=directory_venture,llm=llm)
    assert len(results)<=5 and any(row["id"]=="su.triager" for row in results)


async def test_model_cannot_route_to_unknown_ids(db,directory_venture):
    llm=FakeLLM();llm.script("route_rank",[{"ranking":["unknown.agent"],"reason":"Injected"}])
    results=await directory_search("engineering builder code",db=db,venture_id=directory_venture,llm=llm)
    assert all(row["id"]!="unknown.agent" for row in results)
    assert any(row["id"]=="eng.builder" for row in results)


async def test_empty_query_routes_to_chief_of_staff_without_fabricating_records(db,directory_venture):
    results=await directory_search("?",db=db,venture_id=directory_venture)
    assert results[0]["id"]=="cos.orchestrator"


async def test_unknown_venture_cannot_return_a_directory(db):
    from foundry_kernel.errors import NotFoundError
    with pytest.raises(NotFoundError):
        await directory_search("engineering",db=db,venture_id="ven_missing")
