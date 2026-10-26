# OWNER: tanush
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from foundry_kernel.departments import marketing_research as research


async def test_retrieval_stores_actual_text_hash_and_blocks_redirect(monkeypatch):
    monkeypatch.setattr(research, 'public_url', AsyncMock())
    html = '<title>Official tutoring evidence</title><script>FAKE SECRET</script><p>' + 'Actual tutoring research evidence. ' * 20 + '</p>'
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, headers={'content-type': 'text/html'}, text=html))) as client:
        source = await research.fetch_source(client, research.SOURCE_URLS[0], 1)
    assert source['id'] == 'S1' and source['url'] == research.SOURCE_URLS[0]
    assert 'Actual tutoring research evidence.' in source['excerpt']
    assert 'FAKE SECRET' not in source['excerpt']
    assert len(source['body_sha256']) == 64 and source['fetched_utc']
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(302, headers={'location': 'http://127.0.0.1/'}))) as client:
        with pytest.raises(ValueError, match='redirects'):
            await research.fetch_source(client, research.SOURCE_URLS[0], 1)


async def test_source_security_rejects_nonseed_and_private_dns(monkeypatch):
    for url in ('http://localhost/', 'https://127.0.0.1/', 'https://evil.invalid/'):
        with pytest.raises(ValueError):
            await research.public_url(url)
    monkeypatch.setattr(research.socket, 'getaddrinfo', lambda *a, **k: [(2, 1, 6, '', ('127.0.0.1', 443))])
    with pytest.raises(ValueError, match='not public'):
        await research.public_url(research.SOURCE_URLS[0])


def test_exact_quotes_and_url_subset_required():
    sources = [{'id': 'S1', 'url': research.SOURCE_URLS[0], 'excerpt': 'This is a real exact source quotation.'}, {'id': 'S2', 'url': research.SOURCE_URLS[1], 'excerpt': 'Another actual source quotation here.'}]
    content = '## Assumptions\n[S1] [S2]\n' + 'Proposed test, not observed traction. ' * 20
    plan = research.ResearchPlan(title='Plan', summary='Evidence', content_md=content, verified_quotes=[{'source_id': s['id'], 'quote': s['excerpt']} for s in sources])
    research.validate_plan(plan, sources)
    plan.content_md += '\nhttps://invented.invalid'
    with pytest.raises(ValueError, match='unverified'):
        research.validate_plan(plan, sources)
    plan.content_md = content
    plan.verified_quotes[0].quote = 'Invented source quotation never retrieved.'
    with pytest.raises(ValueError, match='exactly'):
        research.validate_plan(plan, sources)


async def test_failed_source_gate_does_not_call_model(monkeypatch):
    monkeypatch.setattr(research, 'post_as', AsyncMock())
    monkeypatch.setattr(research, 'SOURCE_URLS', ())
    llm = SimpleNamespace(generate=AsyncMock())
    ctx = SimpleNamespace(llm=llm, settings=SimpleNamespace(), run_id='run_test')
    monkeypatch.setattr(research, 'clean', lambda value, _: value)
    result = await research.researched_plan({'id': 'tkt_test'}, ctx)
    assert result.outcome == 'blocked'
    assert len(result.artifacts) == 1 and result.artifacts[0].kind == 'research'
    llm.generate.assert_not_called()


async def test_one_model_attempt_native_schema_and_durable_reservation(monkeypatch, settings, db):
    from foundry_kernel.contracts import LLMResult
    from foundry_kernel.ids import utc_now
    from foundry_kernel.departments.marketing import MarketingHandler
    monkeypatch.setattr(research, 'post_as', AsyncMock())
    source_text = 'Actual retrieved tutoring evidence, not a product traction claim.'
    async def fake_source(client, url, number):
        return {'id': f'S{number}', 'url': url, 'title': 'Official source', 'excerpt': source_text,
                'text_sha256': 'a' * 64, 'fetched_utc': utc_now()}
    monkeypatch.setattr(research, 'fetch_source', fake_source)
    async with db.tx() as tx:
        await tx.execute("INSERT INTO ventures(id,name,slug,idea,founder_name,status,budget_usd,composio_user_id,created_at,updated_at) VALUES('ven_research','Tutor','tutor-test','Adaptive learning','Founder','running',1,'user-test',?,?)", (utc_now(), utc_now()))
    content = '## Assumptions\nProposed experiments, not observed traction. [S1] [S2]\n' + 'Test one channel and measure learning outcomes. ' * 15 + '\n## LinkedIn post\nA draft for the tutor.'
    output = research.ResearchPlan(title='Researched plan', summary='Proposed experiments', content_md=content,
        verified_quotes=[{'source_id': 'S1', 'quote': source_text}, {'source_id': 'S2', 'quote': source_text}])
    llm = SimpleNamespace(generate=AsyncMock(return_value=LLMResult(text=output.model_dump_json(), model='test-argon', interaction_id='test-id', cost_usd=.01)))
    ctx = SimpleNamespace(settings=settings, db=db, llm=llm, venture={'id': 'ven_research', 'name': 'Tutor', 'idea': 'AI tutoring for adaptive learning'},
                          run_id='run_test', context_for=AsyncMock(return_value='Approved idea, no traction yet.'))
    ticket = {'id': 'tkt_research', 'type': 'growth.launch_plan', 'payload': {'research': True, 'budget_usd': .25}}
    result = await MarketingHandler().handle(ticket, ctx)
    assert result.outcome == 'done'
    assert len(result.artifacts) == 2 and result.artifacts[1].uri.endswith('.pdf')
    assert result.artifacts[1].meta['model'] == 'test-argon'
    assert llm.generate.call_args.kwargs['single_attempt'] is True
    assert llm.generate.call_args.kwargs['response_schema']['type'] == 'object'
    assert llm.generate.call_args.args[0] == 'marketing_research_plan'
    repeated = await MarketingHandler().handle(ticket, ctx)
    assert repeated.outcome == 'blocked' and llm.generate.call_count == 1


@pytest.mark.parametrize('idea,expected', [
    ('AI customer support chatbot for online retailers', False),
    ('Inventory planning for independent shops', False),
    ('AI tutor for algebra homework', True),
    ('Adaptive learning for students', False),
    ('Education scheduling calendar for students', False),
    ('HR learning management SaaS', False),
])
def test_precise_marketing_scope(idea, expected):
    assert research.is_tutor_brief({'name': 'Tutor competitor tracker', 'idea': idea}) is expected


async def test_brief_only_pdf_no_sources_single_attempt(monkeypatch, settings, db):
    from foundry_kernel.contracts import LLMResult
    from foundry_kernel.ids import utc_now
    from foundry_kernel.departments.marketing import MarketingHandler
    from pypdf import PdfReader
    messages = AsyncMock()
    monkeypatch.setattr(research, 'post_as', messages)
    fetch = AsyncMock(side_effect=AssertionError('Non-education must not fetch tutor sources'))
    monkeypatch.setattr(research, 'fetch_source', fetch)
    now = utc_now()
    async with db.tx() as tx:
        await tx.execute("INSERT INTO ventures(id,name,slug,idea,founder_name,status,budget_usd,composio_user_id,created_at,updated_at) VALUES('ven_brief','ShopHelper','shop-helper','AI customer support chatbot for retail','Founder','running',1,'test',?,?)", (now, now))
    content = '## Assumptions\n' + 'Hypothesis: retail founders may want help triaging support. Validate through interviews before building or promoting. ' * 8 + '\n## LinkedIn post\nA proposed retail support concept; tell us about your workflow.'
    plan = research.BriefPlan(title='ShopHelper launch draft', summary='Brief-based hypotheses, not verified research', content_md=content)
    llm = SimpleNamespace(generate=AsyncMock(return_value=LLMResult(text=plan.model_dump_json(), model='fake-argon-test', interaction_id='fake-only', cost_usd=.01)))
    ctx = SimpleNamespace(settings=settings, db=db, llm=llm, venture={'id': 'ven_brief', 'name': 'ShopHelper', 'idea': 'AI customer support chatbot for retail'}, run_id='run_fake_brief', context_for=AsyncMock(return_value='Founder wants retail support triage.'))
    ticket = {'id': 'tkt_brief', 'type': 'growth.launch_plan', 'payload': {'research': True, 'budget_usd': .25}}
    result = await MarketingHandler().handle(ticket, ctx)
    assert result.outcome == 'done', result.note
    assert len(result.artifacts) == 1
    artifact = result.artifacts[0]
    assert artifact.kind == 'plan' and artifact.uri.endswith('.pdf')
    assert artifact.meta['research_mode'] == 'brief_based'
    assert artifact.meta['source_refs'] == [] and artifact.meta['source_count'] == 0 and artifact.meta['needs_sources'] is True
    assert artifact.meta['model'] == 'fake-argon-test'
    assert artifact.content_md.startswith(research.BRIEF_NOTICE)
    pdf = PdfReader(settings.data_dir / 'marketing-pdfs' / (artifact.meta['pdf_sha256'] + '.pdf'))
    assert research.BRIEF_NOTICE in pdf.pages[0].extract_text()
    assert 'verified_quotes' not in llm.generate.call_args.kwargs['response_schema']['properties']
    assert llm.generate.call_args.kwargs['single_attempt'] is True
    assert 'ShopHelper' in llm.generate.call_args.args[1]
    assert 'Based on retrieved' not in ' '.join(str(c) for c in messages.call_args_list)
    fetch.assert_not_called()
    repeated = await MarketingHandler().handle(ticket, ctx)
    assert repeated.outcome == 'blocked' and llm.generate.call_count == 1


async def test_brief_preflight_blocks_unknown_price_without_model(monkeypatch):
    monkeypatch.setattr(research, 'post_as', AsyncMock())
    monkeypatch.setattr(research, 'clean', lambda text, _: text)
    monkeypatch.setattr(research, 'price_for', lambda _: None)
    ctx = SimpleNamespace(settings=SimpleNamespace(model_overrides={}), venture={'name': 'Retail', 'idea': 'Support chatbot'},
                          context_for=AsyncMock(return_value='Retail brief'), llm=SimpleNamespace(generate=AsyncMock()))
    result = await research.brief_based_plan({'id': 'fake', 'payload': {'budget_usd': .25}}, ctx)
    assert result.outcome == 'blocked'
    ctx.llm.generate.assert_not_called()
