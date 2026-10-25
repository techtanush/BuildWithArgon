# OWNER: tanush
"""Reproducible grounding evaluation; expectations never enter answerer prompts."""
from __future__ import annotations

import argparse
import asyncio
import inspect
import json
import re
import tempfile
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import yaml

from ..config import APP_DIR, Settings
from ..contracts import TalkRequest
from ..db import Database, redact_value
from ..ids import new_id, utc_now
from ..seed import seed_roster

FIXTURE = Path(__file__).parent / 'fixtures' / 'grounding_state.json'
QUESTIONS = APP_DIR / 'evals' / 'grounding' / 'questions.yaml'


async def load_fixture(db: Database, settings: Settings, path: Path = FIXTURE) -> str:
    """Use the real venture initializer, then load the fixed benchmark records."""
    from ..api.ventures import CreateVenture, create
    fixture = json.loads(path.read_text())
    await seed_roster(db, settings)
    v = fixture['venture']
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(settings=settings, db=db)))
    response = await create(CreateVenture(**{k: v[k] for k in ('name', 'idea', 'founder_name', 'budget_usd')}), request)
    original = response['data']['id']
    vid = v['id']
    async with db.tx() as tx:
        await tx.execute('PRAGMA defer_foreign_keys=ON')
        await tx.execute('UPDATE ventures SET id=?,composio_user_id=? WHERE id=?', (vid, f"foundry:{vid}", original))
        for table in ('agent_state', 'channels', 'integrations'):
            await tx.execute(f'UPDATE {table} SET venture_id=? WHERE venture_id=?', (vid, original))
        await tx.execute('UPDATE events SET venture_id=? WHERE venture_id=?', (vid, original))
        await tx.execute('UPDATE ventures SET status=?,spent_usd=?,repo_full_name=?,repo_url=?,created_at=?,updated_at=? WHERE id=?',
                         (v['status'], v['spent_usd'], v['repo_full_name'], v['repo_url'], v['created_at'], v['created_at'], vid))
        for table in ('tickets', 'runs', 'artifacts', 'approvals', 'messages'):
            allowed = {r['name'] for r in await tx.fetch_all(f'PRAGMA table_info({table})')}
            for source in fixture[table]:
                row = dict(source, venture_id=vid)
                for field in ('result', 'payload', 'meta'):
                    if field in row:
                        row[field + '_json'] = json.dumps(row.pop(field))
                if table == 'tickets':
                    row['updated_at'] = row['created_at']
                if table == 'messages':
                    slug = row.pop('channel_slug')
                    channel = await tx.fetch_one('SELECT id FROM channels WHERE venture_id=? AND slug=?', (vid, slug))
                    row['channel_id'] = channel['id']
                if set(row) - allowed:
                    raise ValueError(f'Unknown fixture columns for {table}: {set(row) - allowed}')
                names = list(row)
                await tx.execute(f"INSERT INTO {table}({','.join(names)}) VALUES({','.join('?' for _ in names)})", tuple(row[n] for n in names))
        for ticket in fixture['tickets']:
            if ticket['status'] == 'in_progress' and ticket.get('assigned_agent_id'):
                await tx.execute("UPDATE agent_state SET status='working',current_ticket_id=?,last_active_at=? WHERE venture_id=? AND agent_id=?",
                                 (ticket['id'], ticket['created_at'], vid, ticket['assigned_agent_id']))
    return vid


def score_answer(question: dict, answer: Any) -> dict:
    answer = answer.model_dump() if hasattr(answer, 'model_dump') else dict(answer)
    text = answer.get('text', '')
    groups = question.get('must_include_any', [])
    facts = all(any(str(term).casefold() in text.casefold() for term in group) for group in groups)
    expected_citations = question.get('must_cite_any', [])
    citations = {c.get('id') for c in answer.get('citations', [])}
    cited = not expected_citations or bool(citations.intersection(expected_citations))
    expected_route = question.get('expect_route')
    routed = not expected_route or (answer.get('route_card') or {}).get('agent_id') == expected_route
    fabricated = any(re.search(pattern, text) for pattern in question.get('must_not_match', []))
    status = (answer.get('check') or {}).get('status', 'error')
    truth = facts and cited
    agreement = status == ('verified' if truth else 'unsupported')
    return {'case_id': question['id'], 'fact_pass': facts, 'citation_pass': cited,
            'citation_required': bool(expected_citations), 'route_pass': routed, 'route_required': bool(expected_route),
            'fabrication': fabricated, 'check_status': status, 'checker_agreement': agreement,
            'fact_citation_pass': truth, 'answer': answer}


def summarize(rows: list[dict]) -> dict:
    def rate(values):
        return sum(values) / len(values) if values else None
    routed = [r['route_pass'] for r in rows if r['route_required']]
    correct = [r['check_status'] == 'verified' for r in rows if r['fact_citation_pass']]
    incorrect = [r['check_status'] == 'unsupported' for r in rows if not r['fact_citation_pass']]
    error_n = sum(bool(r.get('error')) or r['check_status'] == 'error' for r in rows)
    return {'n': len(rows), 'success_n': len(rows) - error_n, 'error_n': error_n,
            'accuracy': rate([r['fact_pass'] for r in rows]),
            'fact_accuracy': rate([r['fact_pass'] for r in rows]),
            'citation_accuracy': rate([r['citation_pass'] for r in rows]),
            'route_accuracy': rate(routed), 'route_n': len(routed),
            'fabrication_rate': rate([r['fabrication'] for r in rows]),
            'checker_agreement': rate([r['checker_agreement'] for r in rows]),
            'checker_verified_when_correct': rate(correct), 'checker_unsupported_when_incorrect': rate(incorrect)}


async def persist_results(db: Database, report: dict) -> None:
    async with db.tx() as tx:
        for row in report['cases']:
            metrics = dict(row, answerer=report['answerer'], capability_evidence=report['capability_evidence'],
                           report_id=report['id'], summary=report['summary'])
            await tx.execute('INSERT INTO eval_results(id,suite,case_id,condition,metrics_json,created_at) VALUES(?,?,?,?,?,?)',
                             (new_id('evl'), 'grounding', row['case_id'], 'default', json.dumps(metrics), report['created_at']))


async def run_evaluation(*, mode: str = 'fake', only: list[str] | None = None,
                         answerer: Callable | None = None, settings: Settings | None = None,
                         questions: list[dict] | None = None, out: Path | None = None,
                         result_db: Database | None = None) -> dict:
    settings = settings or Settings(llm_mode=mode)
    questions = questions if questions is not None else yaml.safe_load(QUESTIONS.read_text())
    selected = [q for q in questions if not only or q['id'] in only]
    if only and set(only) - {q['id'] for q in questions}:
        raise ValueError('Unknown question IDs: ' + ', '.join(sorted(set(only) - {q['id'] for q in questions})))
    if not selected:
        raise ValueError('No questions selected')
    with tempfile.TemporaryDirectory(prefix='tanush-grounding-') as folder:
        cfg = settings.model_copy(update={'data_dir': Path(folder), 'llm_mode': mode, 'checker_model_check': mode == 'live'})
        db = Database(cfg.db_path, cfg)
        await db.connect()
        try:
            vid = await load_fixture(db, cfg)
            from ..llm.client import build_llm_client
            llm = build_llm_client(cfg, db)
            async def default_answerer(*, ask, question, db, venture_id, settings):
                from ..conversation.concierge import ask as concierge_ask
                from ..conversation.talk import talk
                req = TalkRequest(text=question)
                if ask == 'concierge':
                    return await concierge_ask(db=db, llm=llm, settings=settings, venture_id=venture_id, req=req)
                return await talk(db=db, llm=llm, settings=settings, venture_id=venture_id, agent_id=ask, req=req)
            fn = answerer or default_answerer
            rows = []
            for q in selected:
                try:
                    # Only the question and destination reach the answerer; gold expectations stay here.
                    answer = fn(ask=q['ask'], question=q['question'], db=db, venture_id=vid, settings=cfg)
                    if inspect.isawaitable(answer):
                        answer = await answer
                    data = answer.model_dump() if hasattr(answer, 'model_dump') else dict(answer)
                    tasks = list(getattr(db, '_answer_checks', set()))
                    if tasks:
                        await asyncio.gather(*tasks, return_exceptions=True)
                    if data.get('answer_id'):
                        record = await db.fetch_one('SELECT check_json FROM answers WHERE id=?', (data['answer_id'],))
                        if record:
                            data['check'] = json.loads(record['check_json'])
                    rows.append(score_answer(q, data))
                except Exception as exc:  # noqa: BLE001 - each failed provider case is retained in the report
                    row = score_answer(q, {'text': '', 'check': {'status': 'error'}, 'citations': []})
                    row.update(error=redact_value(str(exc), cfg), fact_pass=False, citation_pass=False,
                               route_pass=False, checker_agreement=False, fact_citation_pass=False)
                    rows.append(row)
            provider_runs = await db.fetch_one(
                "SELECT COUNT(*) AS n FROM runs WHERE status='succeeded' AND job IN ('talk','concierge') "
                "AND model NOT LIKE 'fake:%'")
            provider_success_n = provider_runs['n']
            capability_evidence = mode == 'live' and answerer is None and provider_success_n > 0
            note = ('Live provider benchmark.' if capability_evidence else
                    'No successful live conversation calls; no model capability evidence.' if mode == 'live' and answerer is None else
                    'Plumbing/scoring check only; fake or injected answers are not model capability evidence.')
            report = {'id': new_id('evl'), 'suite': 'grounding', 'created_at': utc_now(),
                      'answerer': 'injected' if answerer else mode,
                      'capability_evidence': capability_evidence, 'provider_success_n': provider_success_n,
                      'note': note,
                      'summary': summarize(rows), 'cases': rows}
            report = redact_value(report, cfg)
            await persist_results(db, report)
            if result_db is not None:
                await persist_results(result_db, report)
            if out is not None:
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_text(json.dumps(report, indent=2) + '\n')
            return report
        finally:
            checks = list(getattr(db, '_answer_checks', set()))
            for task in checks:
                task.cancel()
            if checks:
                await asyncio.gather(*checks, return_exceptions=True)
            await db.close()


def main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', action='append', help='Question ID; repeat or comma-separate')
    parser.add_argument('--out', type=Path)
    parser.add_argument('--answerer', choices=('live', 'fake'), default='fake')
    args = parser.parse_args(argv)
    only = [item for value in args.only or [] for item in value.split(',')]
    timestamp = datetime.now(UTC).strftime('%Y%m%dT%H%M%S%fZ')
    out = args.out or APP_DIR / 'evals' / 'results' / f'grounding-{timestamp}.json'
    async def execute():
        settings = Settings(llm_mode=args.answerer)
        results = Database(settings.db_path, settings)
        await results.connect()
        try:
            return await run_evaluation(mode=args.answerer, only=only or None, settings=settings, out=out, result_db=results)
        finally:
            await results.close()
    report = asyncio.run(execute())
    print(json.dumps({'path': str(out), 'answerer': report['answerer'], 'capability_evidence': report['capability_evidence'],
                      'provider_success_n': report['provider_success_n'], **report['summary']}))


if __name__ == '__main__':
    import sys
    main(sys.argv[1:])
