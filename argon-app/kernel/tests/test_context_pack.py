# OWNER: tanush
"""Fresh source selection and verifiable provenance within strict prompt budgets."""
from __future__ import annotations

import pytest

from foundry_kernel.conversation.context_pack import build_context_pack, keywords
from foundry_kernel.errors import ConflictError, NotFoundError
from foundry_kernel.ids import new_id, utc_now
from tests.test_scheduler import add_ticket, company


async def artifact(db, vid, *, title="Pantry pricing", body="Price is $2 per month.", department="market-research", agent="mr.research-lead"):
    aid = new_id("art")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO artifacts(id,venture_id,department_id,agent_id,kind,title,summary,content_md,created_at) VALUES(?,?,?,?, 'research',?,'Recorded research',?,?)", (aid, vid, department, agent, title, body, utc_now()))
    return aid


async def test_pack_is_fresh_scoped_and_has_real_snapshot_provenance(db, settings):
    vid, _ = await company(db, settings)
    other, _ = await company(db, settings)
    own = await artifact(db, vid)
    hidden = await artifact(db, other, title="Private pricing", body="Foreign-venture secret fact")
    pack = await build_context_pack(db=db, venture_id=vid, agent_id="mr.research-lead", question="What is pantry pricing?")
    assert any(record["id"] == own for record in pack.records)
    assert all(record["id"] != hidden for record in pack.records) and "Foreign-venture" not in pack.rendered
    summary = next(record for record in pack.records if record["title"] == "Current venture, budget and company state")
    run = await db.fetch_one("SELECT * FROM runs WHERE id=?", (summary["id"],))
    assert run["input_text"] == summary["text"] and run["model"] == "deterministic" and "no model call performed" in run["output_text"]
    async with db.tx() as tx:
        await tx.execute("UPDATE ventures SET spent_usd=7.25 WHERE id=?", (vid,))
        await tx.execute("UPDATE artifacts SET content_md='The updated price is $3 per month.' WHERE id=?", (own,))
    refreshed = await build_context_pack(db=db, venture_id=vid, agent_id="mr.research-lead", question="What is pricing?")
    assert "7.25" in refreshed.rendered and "updated price is $3" in refreshed.rendered
    assert "updated price is $3" not in pack.rendered


async def test_current_work_latest_logs_and_dependency_knowledge_are_selected(db, settings):
    vid, _ = await company(db, settings)
    ticket = await add_ticket(db, vid, "eng.build", title="Build pantry search")
    run_id = new_id("run")
    async with db.tx() as tx:
        await tx.execute("UPDATE tickets SET status='in_progress' WHERE id=?", (ticket["id"],))
        await tx.execute("INSERT INTO agent_state(venture_id,agent_id,status,current_ticket_id) VALUES(?,?,'working',?)", (vid, "eng.builder", ticket["id"]))
        await tx.execute("INSERT INTO runs(id,venture_id,ticket_id,agent_id,kind,job,model,status,created_at) VALUES(?,?,?,?,'ticket','engineering_build','fake','running',?)", (run_id, vid, ticket["id"], "eng.builder", utc_now()))
        for index in range(25):
            await tx.execute("INSERT INTO run_logs(run_id,ts,level,message) VALUES(?,?,'info',?)", (run_id, utc_now(), f"Progress line {index:02}"))
    aid = await artifact(db, vid, department="engineering", agent="eng.tech-lead", title="Search architecture")
    pack = await build_context_pack(db=db, venture_id=vid, agent_id="eng.builder", question="What are you building?")
    assert {ticket["id"], run_id, aid}.issubset({record["id"] for record in pack.records})
    source = next(record for record in pack.records if record["id"] == run_id)
    assert "Progress line 24" in source["text"] and "Progress line 00" not in source["text"]
    assert len({(r["kind"], r["id"]) for r in pack.records}) == len(pack.records)


async def test_pack_enforces_24_record_and_30000_character_budgets(db, settings):
    vid, _ = await company(db, settings)
    for index in range(35):
        await artifact(db, vid, title=f"Pricing source {index}", body=("Grounded research text " * 1000))
    for index in range(25):
        await add_ticket(db, vid, "research.market", title=f"Research {index}", body="Research scope " * 500)
    pack = await build_context_pack(db=db, venture_id=vid, agent_id="mr.research-lead", question="What are pricing sources?")
    assert len(pack.records) <= 24 and len(pack.rendered) <= 30_000
    assert [record["ref"] for record in pack.records] == [f"R{i}" for i in range(1, len(pack.records) + 1)]
    assert any(r["title"] == "Current venture, budget and company state" for r in pack.records)


async def test_company_wide_pack_matches_cross_department_records_but_never_crosses_ventures(db, settings):
    vid, _ = await company(db, settings)
    aid = await artifact(db, vid, title="Competitor pricing research")
    pack = await build_context_pack(db=db, venture_id=vid, agent_id="concierge", question="Where is competitor pricing?", company_wide=True)
    assert aid in {r["id"] for r in pack.records}
    assert pack.venture_id == vid and "department_ticket_counts" in pack.rendered


async def test_snapshot_uses_existing_conversation_run_and_rejects_foreign_run(db, settings):
    vid, _ = await company(db, settings)
    other, _ = await company(db, settings)
    rid = new_id("run")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO runs(id,venture_id,agent_id,kind,job,model,status,created_at) VALUES(?,?,'eng.builder','talk','talk','fake','running',?)", (rid, vid, utc_now()))
    before = len(await db.fetch_all("SELECT id FROM runs"))
    pack = await build_context_pack(db=db, venture_id=vid, agent_id="eng.builder", question="Budget?", snapshot_run_id=rid)
    assert len(await db.fetch_all("SELECT id FROM runs")) == before
    assert any(r["id"] == rid for r in pack.records)
    with pytest.raises(ConflictError):
        await build_context_pack(db=db, venture_id=other, agent_id="eng.builder", question="Budget?", snapshot_run_id=rid)
    with pytest.raises(NotFoundError):
        await build_context_pack(db=db, venture_id=vid, agent_id="unknown", question="Anything?")


def test_question_keywords_drop_stopwords_and_keep_meaningful_terms():
    assert keywords("What does their pantry pricing research cost?") == {"pantry", "pricing", "research", "cost"}
