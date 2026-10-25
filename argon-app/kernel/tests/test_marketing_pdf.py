import io
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pypdf import PdfReader

from foundry_kernel.contracts import HandlerResult, NewArtifact
from foundry_kernel.departments import load_handler
from foundry_kernel.departments.base import ArtifactHandler
from foundry_kernel.departments.marketing import MarketingHandler, render_plan_pdf


def test_safe_paginated_pdf():
    data = render_plan_pdf("Plan (real)", "Unique evidence (x) \\ quote\n" * 120 + '<script>evil</script> https://example.com')
    reader = PdfReader(io.BytesIO(data))
    assert len(reader.pages) >= 3
    assert "Unique evidence (x)" in reader.pages[0].extract_text()
    assert "/OpenAction" not in reader.trailer["/Root"]
    assert all("/Annots" not in page for page in reader.pages)
    assert b"/JavaScript" not in data


def test_empty_plan_refused():
    with pytest.raises(ValueError):
        render_plan_pdf("Plan", "  ")


async def test_registered_handler_exports_only_actual_output(monkeypatch, settings):
    original = HandlerResult(outcome="done", artifacts=[NewArtifact(kind="plan", title="Actual launch", content_md="Grounded plan from record art_123. AIza" + "X" * 35)])
    call = AsyncMock(return_value=original)
    monkeypatch.setattr(ArtifactHandler, "handle", call)
    ctx = SimpleNamespace(settings=settings, venture={"id": "ven_test"})
    handler = load_handler("growth.launch_plan")
    assert isinstance(handler, MarketingHandler)
    result = await handler.handle({"type": "growth.launch_plan"}, ctx)
    artifact = result.artifacts[0]
    pdf = settings.data_dir / "marketing-pdfs" / (artifact.meta["pdf_sha256"] + ".pdf")
    assert pdf.is_file()
    text = PdfReader(pdf).pages[0].extract_text()
    assert "art_123" in text and "AIza" not in text
    assert artifact.meta["publication_status"] == "awaiting_github_and_approved_publisher"
    assert artifact.meta["publication_branch"] == "marketing"
    assert not result.approval and not result.new_tickets


async def test_failed_generation_does_not_export(monkeypatch, settings):
    monkeypatch.setattr(ArtifactHandler, "handle", AsyncMock(return_value=HandlerResult(outcome="blocked")))
    result = await MarketingHandler().handle({}, SimpleNamespace(settings=settings))
    assert result.outcome == "blocked"
    assert not (settings.data_dir / "marketing-pdfs").exists()


async def test_download_requires_persisted_venture_artifact(settings):
    import hashlib
    from foundry_kernel.api.artifacts import marketing_pdf
    from foundry_kernel.errors import NotFoundError
    data = render_plan_pdf("Launch", "Recorded content")
    digest = hashlib.sha256(data).hexdigest()
    root = settings.data_dir / "marketing-pdfs"
    root.mkdir(parents=True)
    (root / (digest + ".pdf")).write_bytes(data)
    db = SimpleNamespace(fetch_one=AsyncMock(return_value=None))
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=db, settings=settings)))
    with pytest.raises(NotFoundError):
        await marketing_pdf("other_venture", digest, request)
    db.fetch_one.return_value = {"id": "art_recorded"}
    response = await marketing_pdf("ven_owner", digest, request)
    assert response.body == data and response.media_type == "application/pdf"
    assert db.fetch_one.call_args.args[1][0] == "ven_owner"
    with pytest.raises(NotFoundError):
        await marketing_pdf("ven_owner", "../secret", request)
    (root / (digest + ".pdf")).write_bytes(b"tampered")
    with pytest.raises(NotFoundError):
        await marketing_pdf("ven_owner", digest, request)


async def test_model_job_consumes_records_before_pdf(settings, db):
    from foundry_kernel.llm.fake import FakeLLM
    llm = FakeLLM()
    llm.script("dept_artifact", [{"title": "Launch plan", "summary": "Proposed experiment", "content_md": "## Launch\nBased on art_existing: validate activation before paid acquisition. Proposed metric, not observed."}])
    agent = await db.fetch_one("SELECT * FROM agents WHERE id='gr.growth-planner'")
    ctx = SimpleNamespace(settings=settings, db=db, llm=llm, agent=agent,
        venture={"id": "ven_test", "founder_name": "Founder", "name": "App", "idea": "Useful app"},
        run_id="run_test", approval_result=None,
        context_for=AsyncMock(return_value="art_existing: approved brief and positioning"))
    result = await load_handler("growth.launch_plan").handle({"id": "tkt_test", "type": "growth.launch_plan", "title": "Plan launch", "department_id": "growth"}, ctx)
    assert result.outcome == "done"
    assert llm.calls[0][0] == "dept_artifact"
    assert "art_existing: approved brief" in llm.calls[0][1]
    artifact = result.artifacts[0]
    file = settings.data_dir / "marketing-pdfs" / (artifact.meta["pdf_sha256"] + ".pdf")
    assert "validate activation" in PdfReader(file).pages[0].extract_text()
    assert result.messages[-1].channel_slug == "dept-growth"
