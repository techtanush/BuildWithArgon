# OWNER: tanush
"""Benchmark scoring is independent of the model and never feeds gold answers back."""
import json

import pytest

from foundry_kernel.evals.grounding_eval import (
    load_fixture,
    run_evaluation,
    score_answer,
    summarize,
)


def test_scoring_every_alternative_group_route_and_fabrication():
    q = {'id': 'case', 'must_include_any': [['39', 'thirty-nine'], ['failed', 'failing']],
         'must_cite_any': ['run_real'], 'expect_route': 'eng.builder', 'must_not_match': [r'(?i)I merged']}
    good = {'text': '39 passed and three failing.', 'citations': [{'id': 'run_real'}],
            'route_card': {'agent_id': 'eng.builder'}, 'check': {'status': 'verified'}}
    row = score_answer(q, good)
    assert row['fact_pass'] and row['citation_pass'] and row['route_pass'] and row['checker_agreement']
    bad = dict(good, text='39 passed. I merged it.', citations=[{'id': 'invented'}], route_card={'agent_id': 'fp.cfo'}, check={'status': 'unsupported'})
    row = score_answer(q, bad)
    assert not row['fact_pass'] and not row['citation_pass'] and not row['route_pass']
    assert row['fabrication'] and row['checker_agreement']


def test_summary_denominators_and_empty_groups():
    rows = [score_answer({'id': 'a', 'must_include_any': [['right']]}, {'text': 'right', 'check': {'status': 'verified'}}),
            score_answer({'id': 'b', 'must_include_any': [['right']], 'expect_route': 'x'}, {'text': 'wrong', 'check': {'status': 'unsupported'}})]
    s = summarize(rows)
    assert s['fact_accuracy'] == .5 and s['route_accuracy'] == 0 and s['route_n'] == 1
    assert s['checker_verified_when_correct'] == s['checker_unsupported_when_incorrect'] == 1
    assert summarize([])['accuracy'] is None


@pytest.mark.asyncio
async def test_fixture_uses_real_initializer_and_exact_records(db, settings):
    vid = await load_fixture(db, settings)
    assert (await db.fetch_one('SELECT name,spent_usd FROM ventures WHERE id=?', (vid,))) == {'name': 'Pantry Pal', 'spent_usd': 6.4}
    assert len(await db.fetch_all('SELECT id FROM channels WHERE venture_id=?', (vid,))) == 16
    assert len(await db.fetch_all('SELECT id FROM tickets WHERE venture_id=?', (vid,))) == 4
    assert (await db.fetch_one("SELECT current_ticket_id FROM agent_state WHERE venture_id=? AND agent_id='eng.builder'", (vid,)))['current_ticket_id'] == 'tkt_EVAL_EXPIRY'
    assert (await db.fetch_one("SELECT output_text FROM runs WHERE id='run_EVAL_EXP1'"))['output_text'].startswith('iteration 1/6: 39 passed')


@pytest.mark.asyncio
async def test_injected_answerer_no_gold_leak_and_persists_failures(tmp_path, settings, db):
    calls = []
    async def answerer(**kw):
        calls.append(set(kw))
        if kw['question'] == 'bad':
            raise RuntimeError('provider unavailable')
        return {'text': 'Known right fact', 'citations': [{'id': 'source'}], 'check': {'status': 'verified'}}
    questions = [{'id': 'right', 'ask': 'concierge', 'question': 'good', 'must_include_any': [['right']], 'must_cite_any': ['source']},
                 {'id': 'wrong', 'ask': 'eng.builder', 'question': 'wrong', 'must_include_any': [['absent']]},
                 {'id': 'error', 'ask': 'concierge', 'question': 'bad', 'must_include_any': [['nope']]}]
    out = tmp_path / 'grounding.json'
    report = await run_evaluation(answerer=answerer, questions=questions, settings=settings, out=out, result_db=db)
    assert report['summary']['n'] == 3 and report['summary']['fact_accuracy'] == pytest.approx(1/3)
    assert report['answerer'] == 'injected' and report['capability_evidence'] is False
    assert all(keys == {'ask', 'question', 'db', 'venture_id', 'settings'} for keys in calls)
    assert 'provider unavailable' in report['cases'][2]['error']
    assert len(await db.fetch_all("SELECT * FROM eval_results WHERE suite='grounding'")) == 3
    assert json.loads(out.read_text()) == report


@pytest.mark.asyncio
async def test_only_unknown_ids_rejected(settings):
    with pytest.raises(ValueError, match='Unknown question IDs'):
        await run_evaluation(settings=settings, questions=[{'id': 'a'}], only=['missing'])


@pytest.mark.asyncio
async def test_failed_live_provider_is_not_capability_evidence(settings, monkeypatch):
    from foundry_kernel.conversation import concierge

    async def unavailable(**kwargs):
        raise RuntimeError('provider unavailable')

    monkeypatch.setattr(concierge, 'ask', unavailable)
    report = await run_evaluation(mode='live', settings=settings, questions=[{'id': 'case', 'ask': 'concierge', 'question': 'What is recorded?', 'must_include_any': [['Known']]}])
    assert report['answerer'] == 'live' and report['capability_evidence'] is False
    assert report['provider_success_n'] == 0
    assert report['summary']['success_n'] == 0 and report['summary']['error_n'] == 1
    assert 'No successful live conversation calls' in report['note']


@pytest.mark.asyncio
@pytest.mark.parametrize('model,capability', [('fake:concierge', False), ('gemini-3.8-flash', True)])
async def test_capability_evidence_requires_successful_nonfake_conversation_run(settings, monkeypatch, model, capability):
    from foundry_kernel.conversation import concierge
    from foundry_kernel.ids import new_id, utc_now

    async def recorded_answer(**kwargs):
        async with kwargs['db'].tx() as tx:
            await tx.execute("INSERT INTO runs(id,venture_id,agent_id,kind,job,model,status,created_at) VALUES(?,?,?,'concierge','concierge',?,'succeeded',?)",
                             (new_id('run'), kwargs['venture_id'], 'concierge', model, utc_now()))
        return {'text': 'Known record', 'citations': [], 'check': {'status': 'verified'}}

    monkeypatch.setattr(concierge, 'ask', recorded_answer)
    report = await run_evaluation(mode='live', settings=settings, questions=[{'id': 'case', 'ask': 'concierge', 'question': 'What is recorded?', 'must_include_any': [['Known']]}])
    assert report['capability_evidence'] is capability
    assert report['provider_success_n'] == int(capability)
    assert report['summary']['success_n'] == 1 and report['summary']['error_n'] == 0


@pytest.mark.asyncio
async def test_concurrent_cases_are_bounded_and_remain_in_question_order(settings):
    import asyncio
    active, peak, entered = 0, 0, 0
    ready = asyncio.Event()
    async def answerer(**kw):
        nonlocal active, peak, entered
        active += 1
        entered += 1
        peak = max(active, peak)
        if entered >= 2:
            ready.set()
        await ready.wait()
        active -= 1
        return {'text': kw['question'], 'check': {'status': 'verified'}}
    questions = [{'id': str(i), 'ask': 'concierge', 'question': 'Known fact', 'must_include_any': [['Known']]} for i in range(6)]
    report = await run_evaluation(answerer=answerer, questions=questions, settings=settings, concurrency=2)
    assert peak == 2
    assert [row['case_id'] for row in report['cases']] == [str(i) for i in range(6)]
    assert report['summary']['fact_accuracy'] == 1 and report['concurrency'] == 2
    with pytest.raises(ValueError, match='concurrency'):
        await run_evaluation(settings=settings, concurrency=9)
