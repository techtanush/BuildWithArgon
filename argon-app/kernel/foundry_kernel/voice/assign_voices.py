# OWNER: karthik
"""Read the real account voice catalog and assign distinct voices within each building."""
import argparse
import asyncio
import json
import re
from collections import Counter, defaultdict
from ..config import KERNEL_DIR, get_settings
from .provider import request_json
from .tts import atomic_write

def assign(roster: dict, voices: list[dict]) -> dict[str, str]:
    voices = [v for v in voices if re.fullmatch(r'[A-Za-z0-9_-]{1,128}', v.get('voice_id', ''))]
    voices = list({v['voice_id']: v for v in voices}.values())
    used = defaultdict(set)
    count = Counter()
    result = {}
    for agent in roster['agents']:
        building = 'plaza' if agent['id'] == 'concierge' else agent['department_id']
        candidates = [v for v in voices if v['voice_id'] not in used[building]]
        if not candidates:
            raise ValueError('Not enough voices to keep every building distinct; no mapping was written.')
        hints = set(re.findall(r'[a-z]+', agent.get('voice_hint', '').lower()))
        def score(v):
            labels = ' '.join(str(x) for x in v.get('labels', {}).values()) + ' ' + v.get('name', '')
            overlap = len(hints & set(re.findall(r'[a-z]+', labels.lower())))
            return (-overlap, count[v['voice_id']], v['voice_id'])
        chosen = min(candidates, key=score)['voice_id']
        result[agent['id']] = chosen
        used[building].add(chosen); count[chosen] += 1
    return result

async def run(*, settings, write: bool = False) -> dict[str, str]:
    if not settings.elevenlabs_api_key or settings.llm_mode == 'fake':
        raise ValueError('A live ElevenLabs account key is required; no placeholder mapping will be created.')
    value = await request_json('GET', '/voices', key=settings.elevenlabs_api_key.get_secret_value())
    roster = json.loads((KERNEL_DIR / 'data' / 'roster.json').read_text())
    result = assign(roster, value['voices'])
    if write:
        atomic_write(KERNEL_DIR / 'data' / 'voices.json', (json.dumps(result, indent=2) + '\n').encode())
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true', help='Write the verified mapping; default prints a preview.')
    args = parser.parse_args()
    try:
        result = asyncio.run(run(settings=get_settings(), write=args.write))
    except Exception:
        parser.exit(1, 'Voice assignment failed. Check configuration, account access and available voices.\n')
    for agent, voice in result.items():
        print(f'{agent}\t{voice}')

if __name__ == '__main__':
    main()
