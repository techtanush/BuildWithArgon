# OWNER: karthik
"""Small bounded HTTP adapter. Never includes response bodies in errors."""
from typing import Any
import httpx

BASE_URL = 'https://api.elevenlabs.io/v1'

async def request_json(method: str, path: str, *, key: str, params: dict | None = None,
                       payload: dict | None = None) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
        response = await client.request(method, BASE_URL + path, headers={'xi-api-key': key},
                                        params=params, json=payload)
        response.raise_for_status()
        value = response.json()
        if not isinstance(value, dict):
            raise ValueError('Invalid provider response')
        return value
