# OWNER: karthik
"""Explicit, approved ElevenLabs setup. Default is an offline dry-run."""
import argparse
import asyncio
import json
import re
from .. import gates
from ..config import get_settings
from ..db import Database
from .provider import request_json
from .sessions import GROUNDING_RULES

def configuration(llm: str = 'gemini-2.5-flash') -> dict:
    return {'name': 'Foundry grounded company voice', 'conversation_config': {
        'agent': {'language': 'en', 'first_message': 'Hello. How can I help?',
                  'prompt': {'prompt': GROUNDING_RULES, 'llm': llm, 'tools': [{
                      'type': 'client', 'name': 'ask_company',
                      'description': 'Get the grounded answer to every company question. Never invent company facts.',
                      'expects_response': True, 'response_timeout_secs': 60,
                      'parameters': {'type': 'object', 'properties': {
                          'question': {'type': 'string', 'description': "The founder's question"}},
                          'required': ['question']}}]}},
        'turn': {'turn_timeout': 7}, 'conversation': {'max_duration_seconds': 600}},
        'platform_settings': {'auth': {'enable_auth': True}, 'overrides': {
            'conversation_config_override': {'agent': {'prompt': {'prompt': True}, 'first_message': True},
                                             'tts': {'voice_id': True}}}}}

async def setup(*, settings, db, approval_id: str | None, apply: bool = False,
                llm: str = 'gemini-2.5-flash') -> dict:
    payload = configuration(llm)
    if not apply:
        return {'dry_run': True, 'configuration': payload}
    await gates.require_approved(db, approval_id, 'new_capability')
    if not settings.elevenlabs_api_key or settings.llm_mode == 'fake':
        raise ValueError('Live ElevenLabs configuration is required')
    key = settings.elevenlabs_api_key.get_secret_value()
    if settings.elevenlabs_agent_id:
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', settings.elevenlabs_agent_id):
            raise ValueError('Invalid configured agent id')
        await request_json('PATCH', f'/convai/agents/{settings.elevenlabs_agent_id}', key=key, payload=payload)
        return {'agent_id': settings.elevenlabs_agent_id}
    result = await request_json('POST', '/convai/agents/create', key=key, payload=payload)
    agent_id = result.get('agent_id')
    if not isinstance(agent_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', agent_id):
        raise ValueError('Invalid provider agent id')
    return {'agent_id': agent_id}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--approval-id')
    parser.add_argument('--llm', default='gemini-2.5-flash', help='Account-supported model; verify via provider console or /convai/llm/list.')
    args = parser.parse_args()
    async def run():
        settings = get_settings()
        if not args.apply:
            return await setup(settings=settings, db=None, approval_id=None, llm=args.llm)
        db = Database(settings.db_path)
        await db.connect()
        try:
            return await setup(settings=settings, db=db, approval_id=args.approval_id, apply=True, llm=args.llm)
        finally:
            await db.close()
    try:
        result = asyncio.run(run())
    except Exception:
        parser.exit(1, 'Voice agent setup failed. Check configuration, approved new_capability gate and provider access.\n')
    print(json.dumps(result, indent=2))

if __name__ == '__main__': main()
