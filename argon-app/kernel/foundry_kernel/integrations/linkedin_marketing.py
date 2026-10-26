"""Narrow LinkedIn adapter. Metadata verified read-only against project on 2026-10-25."""
import re
from .composio import ComposioClient, ComposioError, _unwrap
from .. import gates

POST_TOOL = 'LINKEDIN_CREATE_LINKED_IN_POST'
PROFILE_TOOL = 'LINKEDIN_GET_MY_INFO'

async def account(client, user_id, account_ref):
    status = await client.toolkit_connection_status('linkedin', user_id)
    if status['status'] != 'active' or status['account_ref'] != account_ref:
        raise ComposioError('Connect LinkedIn for this company and refresh before reviewing.')
    return status

async def profile(client, user_id, account_ref):
    await account(client, user_id, account_ref)
    result = await client._request('POST', f'v3/tools/execute/{PROFILE_TOOL}', body={'user_id': user_id, 'connected_account_id': account_ref, 'arguments': {}})
    if result.get('successful') is not True:
        raise ComposioError('LinkedIn profile permission required: reconnect with openid, profile, email and w_member_social.')
    data = _unwrap(result.get('data', {}))
    data = data.get('response_dict', data)
    author = str(data.get('author_id') or '')
    if not re.fullmatch(r'urn:li:person:[A-Za-z0-9_-]+', author):
        raise ComposioError('LinkedIn did not return a verified member author URN. Posting remains disabled.')
    return {'author': author, 'name': str(data.get('name') or author)[:200]}

async def publish(db, client, draft, approval_id):
    approval = await gates.require_approved(db, approval_id, 'outreach')
    import json
    payload = json.loads(approval['payload_json'])
    if approval['venture_id'] != draft['venture_id'] or payload != draft['review']:
        raise ComposioError('The exact content and account must be reviewed again.')
    await account(client, draft['user_id'], draft['account_ref'])
    result = await client._request('POST', f'v3/tools/execute/{POST_TOOL}', body={
        'user_id': draft['user_id'], 'connected_account_id': draft['account_ref'],
        'arguments': {'author': draft['author'], 'commentary': draft['content'], 'visibility': draft['visibility'], 'lifecycleState': 'PUBLISHED'}})
    if result.get('successful') is not True:
        raise ComposioError('Publication could not be confirmed. Check LinkedIn before any manual retry.')
    data = _unwrap(result.get('data', {}))
    urn = str(data.get('share_id') or data.get('id') or '')
    if not re.fullmatch(r'urn:li:(share|ugcPost):[0-9]+', urn):
        raise ComposioError('Publication response has no verified post ID. Check LinkedIn; do not retry automatically.')
    return 'https://www.linkedin.com/feed/update/' + urn + '/'
