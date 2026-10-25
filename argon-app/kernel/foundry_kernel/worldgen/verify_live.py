# OWNER: ayan
"""Bounded real-browser verification when the native browser launcher is unavailable.

The external browser worker must produce fresh real captures, never fixtures. This
helper does not read credentials; its caller supplies live Settings and the same
cumulative receipt used by verify_captures. It does not promote the result.
"""
from __future__ import annotations
import asyncio
import hashlib
import json
from pathlib import Path
import time
import uuid
from typing import Any
from ..security import redact
from . import live, paths
from .runs import write_json
from .verify import BudgetLLM, RUN_ID


async def verify_live_round(settings: Any, *, bridge_dir: Path, limit_usd: float = 1.70) -> dict[str, Any]:
    bridge_dir = Path(bridge_dir).resolve()
    bridge_dir.mkdir(parents=True, exist_ok=True)
    llm = BudgetLLM(settings, limit_usd=limit_usd, receipt_path=paths.RUNS_DIR / RUN_ID / 'verify-receipt.json',
                    deadline=time.monotonic() + live.TARGET_S)
    original = live.run_capture

    async def real_capture(**kwargs: Any) -> dict[str, Any]:
        if kwargs.get('fake') or kwargs['depts'] != ['engineering']:
            raise live.CaptureError('real engineering capture only')
        root = Path(kwargs['root']).resolve()
        if not root.is_relative_to(paths.LIVE_DIR.resolve()):
            raise live.CaptureError('capture output outside live directory')
        source = kwargs['source']
        source_root = paths.GENERATED_DIR if source == 'generated' else paths.STAGING_DIR
        sha = hashlib.sha256((source_root / 'engineering.ts').read_bytes()).hexdigest()
        request_id = uuid.uuid4().hex
        request = {'id': request_id, 'root': str(root), 'iteration': kwargs['iteration'], 'depts': ['engineering'],
                   'source': source, 'source_sha256': sha}
        temporary = bridge_dir / 'live-capture-request.tmp'
        temporary.write_text(json.dumps(request))
        temporary.replace(bridge_dir / 'live-capture-request.json')
        deadline = min(llm.deadline, time.monotonic() + 60)
        while time.monotonic() < deadline:
            try:
                response = json.loads((bridge_dir / 'live-capture-response.json').read_text())
            except (OSError, ValueError):
                response = {}
            if response.get('id') == request_id:
                if response.get('error'):
                    raise live.CaptureError(redact(str(response['error']), settings))
                report = response['report']
                provenance = report.get('provenance') or {}
                if (provenance.get('source_sha256') != sha or provenance.get('drill') is not False
                        or provenance.get('capture') != 'real' or report.get('building') != 'engineering'):
                    raise live.CaptureError('real capture provenance mismatch')
                write_json(root / 'probes' / str(kwargs['iteration']) / 'engineering.json', report)
                return {'engineering': report}
            await asyncio.sleep(0.2)
        raise live.CaptureError('real-browser capture bridge timed out')

    try:
        live.run_capture = real_capture
        configured = settings.model_copy(update={'web_url': 'http://127.0.0.1:15174', 'llm_mode': 'live'})
        result = await live.start_round(settings=configured, db=None, llm=llm, department_id='engineering',
                                        fake_capture=False, wait=True)
        receipt = {'round': result.model_dump(), 'budget': llm.persist('live_round_' + result.status),
                   'provenance': 'fresh external real-browser capture; no fixtures; no automatic promotion'}
        write_json(paths.RUNS_DIR / RUN_ID / 'live-verification.json', receipt)
        return receipt
    finally:
        live.run_capture = original
