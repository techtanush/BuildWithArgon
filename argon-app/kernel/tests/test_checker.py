# OWNER: tanush
"""Source checks fail closed and never upgrade dropped or stale source evidence."""
from __future__ import annotations

import asyncio

import pytest

from foundry_kernel.conversation.checker import check_deterministic, check_model
from foundry_kernel.conversation.context_pack import ContextPack, build_context_pack
from foundry_kernel.db import json_dumps
from foundry_kernel.errors import ConflictError
from foundry_kernel.ids import new_id, utc_now
from foundry_kernel.llm.fake import FakeLLM
from tests.test_context_pack import artifact
from tests.test_scheduler import company


async def evidence(db, settings):
    vid, _ = await company(db, settings)
    aid = await artifact(db, vid, body="Pantry pricing is $2 per month.\nThe free plan stores 10 items.")
    pack = await build_context_pack(db=db, venture_id=vid, agent_id="mr.research-lead", question="Pricing?")
    source = next(record for record in pack.records if record["id"] == aid)
    return vid, aid, pack, source


async def answer_row(db, vid, pack, text, citations, check):
    ans = new_id("ans")
    rid = next(r["id"] for r in pack.records if r["kind"] == "run")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO answers(id,venture_id,agent_id,run_id,question,answer,citations_json,check_status,check_json,created_at) VALUES(?,?,'mr.research-lead',?,'Question',?,?,?,?,?)", (ans, vid, rid, text, json_dumps([c.model_dump() for c in citations]), check.status, json_dumps(check.model_dump()), utc_now()))
    return ans


async def test_exact_quotes_allow_case_whitespace_and_edge_punctuation_normalization(db, settings):
    _, aid, pack, source = await evidence(db, settings)
    mapped, check = await check_deterministic(db=db, pack=pack, text="Pricing is $2 per month.", citations=[{"ref": source["ref"], "quote": "  PANTRY   PRICING IS $2 PER MONTH. "}])
    assert check.status == "verified" and mapped[0].id == aid


async def test_unknown_refs_are_dropped_but_failures_remain_visible(db, settings):
    _, _, pack, source = await evidence(db, settings)
    mapped, check = await check_deterministic(db=db, pack=pack, text="Pricing is $2 per month.", citations=[{"ref": source["ref"], "quote": "pricing is $2 per month"}, {"ref": "R999", "quote": "made up"}])
    assert len(mapped) == 1 and check.status == "unsupported"
    assert check.per_citation[1].status == "unsupported"


@pytest.mark.parametrize("quote", ["", "x" * 161, "The invented price is $999"])
async def test_empty_long_or_invented_quotes_cannot_verify_factual_answers(db, settings, quote):
    _, _, pack, source = await evidence(db, settings)
    _, check = await check_deterministic(db=db, pack=pack, text="The price is $999.", citations=[{"ref": source["ref"], "quote": quote}])
    assert check.status == "unsupported"


async def test_changed_deleted_and_cross_venture_records_are_unsupported(db, settings):
    vid, aid, pack, source = await evidence(db, settings)
    raw = [{"ref": source["ref"], "quote": "Pantry pricing is $2 per month."}]
    async with db.tx() as tx:
        await tx.execute("UPDATE artifacts SET content_md='Pricing changed to $5 per month.' WHERE id=?", (aid,))
    _, check = await check_deterministic(db=db, pack=pack, text="Pricing is $2.", citations=raw)
    assert check.status == "unsupported"
    other, _ = await company(db, settings)
    foreign = await artifact(db, other)
    forged = ContextPack(records=[{"ref": "R1", "kind": "artifact", "id": foreign, "title": "Foreign", "text": "Price is $2 per month."}], rendered="", venture_id=vid)
    mapped, check = await check_deterministic(db=db, pack=forged, text="Price is $2.", citations=[{"ref": "R1", "quote": "Price is $2 per month."}])
    assert not mapped and check.status == "unsupported"
    async with db.tx() as tx:
        await tx.execute("DELETE FROM artifacts WHERE id=?", (aid,))
    _, check = await check_deterministic(db=db, pack=pack, text="Pricing is $2.", citations=raw)
    assert check.status == "unsupported"


async def test_factual_answers_need_sources_but_greetings_and_ignorance_do_not(db, settings):
    _, _, pack, _ = await evidence(db, settings)
    for text in ("The price is $2.", "The ticket is done.", "This sentence makes a factual claim about completed work.",
                 "I don't know, but revenue is $5m.", "I don't know and our revenue is $5m.", "Hello, our revenue is $5m."):
        _, check = await check_deterministic(db=db, pack=pack, text=text, citations=[])
        assert check.status == "unsupported"
    for text in ("Hello!", "Happy to help!", "I don't know the price yet."):
        _, check = await check_deterministic(db=db, pack=pack, text=text, citations=[])
        assert check.status == "verified"


async def test_model_check_persists_status_and_emits_answer_event(db, settings):
    vid, _, pack, source = await evidence(db, settings)
    text = "Pantry pricing is $2 per month."
    citations, deterministic = await check_deterministic(db=db, pack=pack, text=text, citations=[{"ref": source["ref"], "quote": text}])
    ans = await answer_row(db, vid, pack, text, citations, deterministic)
    source_run_id = (await db.fetch_one("SELECT run_id FROM answers WHERE id=?", (ans,)))["run_id"]
    source_run_before = await db.fetch_one("SELECT input_text,output_text,model FROM runs WHERE id=?", (source_run_id,))
    llm = FakeLLM(); llm.script("check_citation", [{"supported": "partly", "reason": "Source supports only some of this claim"}])
    final = await check_model(db=db, pack=pack, text=text, citations=citations, llm=llm, settings=settings, venture_id=vid, answer_id=ans)
    row = await db.fetch_one("SELECT * FROM answers WHERE id=?", (ans,))
    assert final.status == row["check_status"] == "partial" and row["checked_at"]
    event = await db.fetch_one("SELECT * FROM events WHERE type='answer.checked' AND entity_id=?", (ans,))
    assert event and ans in event["data_json"]
    assert await db.fetch_one("SELECT input_text,output_text,model FROM runs WHERE id=?", (source_run_id,)) == source_run_before
    checks = await db.fetch_all("SELECT id FROM runs WHERE venture_id=? AND kind='check' AND model<>'deterministic'", (vid,))
    assert len(checks) == 1 and len(await db.fetch_all("SELECT id FROM ledger WHERE run_id=?", (checks[0]["id"],))) == 1


async def test_model_never_upgrades_a_dropped_ref_failure(db, settings):
    vid, _, pack, source = await evidence(db, settings)
    text = "Pantry pricing is $2 per month."
    citations, deterministic = await check_deterministic(db=db, pack=pack, text=text, citations=[{"ref": source["ref"], "quote": text}, {"ref": "fake", "quote": "unknown"}])
    ans = await answer_row(db, vid, pack, text, citations, deterministic)
    llm = FakeLLM(); llm.script("check_citation", [{"supported": "yes", "reason": "yes"}])
    final = await check_model(db=db, pack=pack, text=text, citations=citations, llm=llm, settings=settings, venture_id=vid, answer_id=ans)
    assert final.status == "unsupported" and any(c.status == "unsupported" for c in final.per_citation)


async def test_multi_source_answer_checks_coverage_for_each_claim(db, settings):
    vid, _, pack, source = await evidence(db, settings)
    second = await artifact(db, vid, title="Build results", body="The latest build passed 12 tests.")
    pack = await build_context_pack(db=db, venture_id=vid, agent_id="mr.research-lead", question="Pricing and build results?")
    other = next(r for r in pack.records if r["id"] == second)
    text = "Pricing is $2 per month. The build passed 12 tests."
    citations, deterministic = await check_deterministic(db=db, pack=pack, text=text, citations=[{"ref": next(r["ref"] for r in pack.records if r["id"] == source["id"]), "quote": "Pantry pricing is $2 per month."}, {"ref": other["ref"], "quote": "The latest build passed 12 tests."}])
    ans = await answer_row(db, vid, pack, text, citations, deterministic)
    llm = FakeLLM(); llm.script("check_citation", [{"supported": value, "reason": value} for value in ("yes", "no", "no", "yes")])
    final = await check_model(db=db, pack=pack, text=text, citations=citations, llm=llm, settings=settings, venture_id=vid, answer_id=ans)
    assert final.status == "verified" and len(llm.calls) == 4


async def test_model_call_budget_is_bounded_and_never_silently_marks_unchecked_claims_verified(db, settings):
    vid, _, pack, source = await evidence(db, settings)
    text = " ".join(f"The price in month {i} is $2." for i in range(25))
    citations, deterministic = await check_deterministic(db=db, pack=pack, text=text, citations=[{"ref": source["ref"], "quote": "Pantry pricing is $2 per month."}])
    ans = await answer_row(db, vid, pack, text, citations, deterministic)
    llm = FakeLLM()
    final = await check_model(db=db, pack=pack, text=text, citations=citations, llm=llm, settings=settings, venture_id=vid, answer_id=ans)
    assert final.status == "error" and not llm.calls


async def test_provider_failure_and_cross_venture_answer_cannot_verify(db, settings):
    vid, _, pack, source = await evidence(db, settings)
    text = "Pantry pricing is $2 per month."
    citations, deterministic = await check_deterministic(db=db, pack=pack, text=text, citations=[{"ref": source["ref"], "quote": text}])
    ans = await answer_row(db, vid, pack, text, citations, deterministic)
    class Failing:
        async def generate_json(self, *args, **kwargs):
            raise RuntimeError("provider down")
    result = await check_model(db=db, pack=pack, text=text, citations=citations, llm=Failing(), settings=settings, venture_id=vid, answer_id=ans)
    assert result.status == "error"
    other, _ = await company(db, settings)
    with pytest.raises(ConflictError):
        await check_model(db=db, pack=pack, text=text, citations=citations, llm=Failing(), settings=settings, venture_id=other, answer_id=ans)


async def test_model_check_cancellation_propagates_and_lifespan_cleanup_cancels_tasks(db):
    from foundry_kernel.app import stop_answer_checks
    task = asyncio.create_task(asyncio.Event().wait())
    db._answer_checks = {task}
    await stop_answer_checks(db)
    assert task.cancelled()
