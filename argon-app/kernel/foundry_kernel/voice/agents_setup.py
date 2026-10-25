# OWNER: karthik
"""Explicit, approved ElevenLabs setup. Default is an offline dry-run."""
import argparse
import asyncio
import hashlib
import json
import re
from .. import gates
from ..config import get_settings
from ..db import Database
from ..errors import GateNotApproved
from .provider import request_json
from .sessions import GROUNDING_RULES


def tool_configuration() -> dict:
    # Official /v1/convai/tools ToolRequestModel / ClientToolConfig schema.
    return {'tool_config': {'type': 'client', 'name': 'ask_company',
        'description': 'Get the grounded answer to every company question. Never invent company facts.',
        'expects_response': True, 'response_timeout_secs': 60,
        'parameters': {'type': 'object', 'properties': {
            'question': {'type': 'string', 'description': "The founder's question"}},
            'required': ['question']}}}


def configuration(llm: str = 'gemini-2.5-flash') -> dict:
    # Omit tts entirely: PATCH must preserve the existing base voice and voice settings.
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,100}', llm):
        raise ValueError('Invalid model name')
    return {'conversation_config': {
        'agent': {'language': 'en', 'first_message': 'Hello. How can I help?',
                  'prompt': {'prompt': GROUNDING_RULES, 'llm': llm, 'tool_ids': []}},
        'turn': {'turn_timeout': 7}, 'conversation': {'max_duration_seconds': 600}},
        'platform_settings': {'auth': {'enable_auth': True}, 'overrides': {
            'conversation_config_override': {'agent': {'prompt': {'prompt': True}, 'first_message': True},
                                             'tts': {'voice_id': True}}}}}


def approval_payload(*, agent_id: str, venture_id: str,
                     llm: str = 'gemini-2.5-flash') -> dict:
    """Offline deterministic payload for gates.request_approval(new_capability).

    The hash explicitly authorizes standalone tool registration ONLY when no exact
    match exists. The selected ID substitutes the sole symbolic tool reference.
    No account credentials or provider responses are included.
    """
    if not isinstance(agent_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', agent_id):
        raise ValueError('An existing configured agent id is required')
    if not isinstance(venture_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', venture_id):
        raise ValueError('A venture id is required')
    plan = {'agent_patch': configuration(llm), 'standalone_tool': tool_configuration(),
            'tool_policy': 'reuse_exact_match_else_create',
            'tool_binding': 'replace prompt.tool_ids with the single resolved ask_company id',
            'base_voice_policy': 'preserve_existing_tts',
            'name_policy': 'preserve_existing_name',
            'verification_policy': 'get_exact_existing_agent_before_tools_and_verify_patch_name_tts_after_update'}
    digest = hashlib.sha256(json.dumps(plan, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {'purpose': 'elevenlabs_agent_update', 'provider': 'elevenlabs',
            'scope': 'shared_foundry_base_agent', 'shared_agent_acknowledged': True,
            'operation': 'update_existing_agent',
            'agent_id': agent_id, 'venture_id': venture_id,
            'configuration_hash': digest, 'configuration': plan}


def _matching_tool(config: dict) -> bool:
    # Responses expand defaults. Normalize ONLY documented neutral defaults; all
    # other extra fields (assignments, constants, dynamic variables) fail closed.
    defaults = {'disable_interruptions': False, 'interruption_mode': 'allow',
        'force_pre_tool_speech': False, 'pre_tool_speech': 'auto', 'assignments': [],
        'tool_call_sound': None, 'tool_call_sound_behavior': 'auto',
        'tool_error_handling_mode': 'auto', 'dynamic_variables': {'dynamic_variable_placeholders': {}},
        'execution_mode': 'immediate'}
    def clean(value):
        if isinstance(value, list): return [clean(v) for v in value]
        if not isinstance(value, dict): return value
        neutral = {'property_kind': 'object', 'description': '', 'dynamic_variable': '',
                   'constant_value': None if value.get('type') == 'object' else '',
                   'is_omitted': False, 'required_constraints': None, 'enum': None,
                   'is_system_provided': False, 'allowed_values': None,
                   'allowed_values_dynamic_variable': ''}
        return {k: clean(v) for k, v in value.items() if k not in neutral or v != neutral[k]}
    trimmed = {k: v for k, v in config.items() if k not in defaults or v != defaults[k]}
    return clean(trimmed) == clean(tool_configuration()['tool_config'])


async def _resolve_tool(key: str) -> str:
    cursor = None
    matches = []
    seen = set()
    while True:
        params = {'search': 'ask_company', 'page_size': 100}
        if cursor: params['cursor'] = cursor
        result = await request_json('GET', '/convai/tools', key=key, params=params)
        for tool in result['tools']:
            if not tool.get('response_mocks') and _matching_tool(tool.get('tool_config', {})):
                matches.append(tool['id'])
        if not result.get('has_more'): break
        cursor = result.get('next_cursor')
        if not cursor or cursor in seen: raise ValueError('Invalid tools pagination')
        seen.add(cursor)
    if matches:
        tool_id = sorted(matches)[0]
    else:
        result = await request_json('POST', '/convai/tools', key=key, payload=tool_configuration())
        tool_id = result.get('id')
    if not isinstance(tool_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', tool_id):
        raise ValueError('Invalid tool identifier')
    return tool_id


def _contains_configuration(actual, expected) -> bool:
    """Allow added server defaults, but never a changed or missing approved field."""
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(
            k in actual and _contains_configuration(actual[k], v) for k, v in expected.items())
    if isinstance(expected, bool):
        return actual is expected
    return actual == expected


async def setup(*, settings, db, approval_id: str | None, apply: bool = False,
                llm: str = 'gemini-2.5-flash', venture_id: str | None = None) -> dict:
    payload = configuration(llm)
    if not apply:
        result = {'dry_run': True, 'configuration': payload, 'standalone_tool': tool_configuration()}
        if venture_id and settings.elevenlabs_agent_id:
            result['approval_payload'] = approval_payload(agent_id=settings.elevenlabs_agent_id,
                                                         venture_id=venture_id, llm=llm)
        return result
    row = await gates.require_approved(db, approval_id, 'new_capability')
    try:
        approved = json.loads(row['payload_json'])
        context = venture_id or row['venture_id']
        expected = approval_payload(agent_id=settings.elevenlabs_agent_id, venture_id=context, llm=llm)
        venture = await db.fetch_one('SELECT id FROM ventures WHERE id = ?', (context,))
        valid = (venture is not None and venture['id'] == context and row['venture_id'] == context
                 and approved == expected)
    except (ValueError, TypeError, KeyError):
        valid = False
    if not valid:
        raise GateNotApproved(approval_id, 'new_capability')
    if not settings.elevenlabs_api_key or settings.llm_mode == 'fake':
        raise ValueError('Live ElevenLabs configuration is required')
    stage = 'existing agent verification'
    try:
        key = settings.elevenlabs_api_key.get_secret_value()
        agent_path = f'/convai/agents/{settings.elevenlabs_agent_id}'
        before = await request_json('GET', agent_path, key=key)
        if before.get('agent_id') != settings.elevenlabs_agent_id:
            raise ValueError('Existing agent identity mismatch')
        tts = before.get('conversation_config', {}).get('tts')
        if not isinstance(tts, dict) or not tts.get('voice_id') or not isinstance(before.get('name'), str):
            raise ValueError('Existing agent configuration cannot be verified')
        stage = 'provider request'
        tool_id = await _resolve_tool(key)
        payload['conversation_config']['agent']['prompt']['tool_ids'] = [tool_id]
        await request_json('PATCH', agent_path, key=key, payload=payload)
        stage = 'readback verification'
        after = await request_json('GET', agent_path, key=key)
        if (after.get('agent_id') != settings.elevenlabs_agent_id
                or after.get('name') != before['name']
                or not _contains_configuration(after, payload)
                or not _contains_configuration(after.get('conversation_config', {}).get('tts'), tts)):
            raise ValueError('Agent configuration readback mismatch')
    except Exception:
        raise ValueError(f'Voice configuration {stage} failed') from None
    return {'agent_id': settings.elevenlabs_agent_id}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--approval-id')
    parser.add_argument('--venture-id')
    parser.add_argument('--llm', default='gemini-2.5-flash', help='Account-supported model; verify via provider console or /convai/llm/list.')
    args = parser.parse_args()
    async def run():
        settings = get_settings()
        if not args.apply:
            return await setup(settings=settings, db=None, approval_id=None, llm=args.llm, venture_id=args.venture_id)
        db = Database(settings.db_path)
        await db.connect()
        try:
            return await setup(settings=settings, db=db, approval_id=args.approval_id, apply=True,
                               llm=args.llm, venture_id=args.venture_id)
        finally:
            await db.close()
    try:
        result = asyncio.run(run())
    except ValueError as exc:
        safe_errors = {f'Voice configuration {stage} failed' for stage in
                       ('existing agent verification', 'provider request', 'readback verification')}
        parser.exit(1, (str(exc) if str(exc) in safe_errors else 'Voice agent setup failed. Check configuration.') + '\n')
    except Exception:
        parser.exit(1, 'Voice agent setup failed. Check configuration, scoped approved new_capability gate and provider access.\n')
    print(json.dumps(result, indent=2))

if __name__ == '__main__': main()
