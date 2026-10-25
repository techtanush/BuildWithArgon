"""Trusted conversation snippets constrain native citation output without replacing checks."""
from __future__ import annotations

import json

from foundry_kernel.conversation.context_pack import ContextPack
from foundry_kernel.conversation.talk import ConversationOutput, trusted_source_quotes
from foundry_kernel.llm.client import _native_json_schema


def test_trusted_source_quotes_are_literal_and_native_schema_rejects_poison() -> None:
    snapshot = json.dumps({"venture": {"name": "Foundry", "status": "active", "budget_usd": 25}})
    pack = ContextPack(records=[
        {"ref": "R1", "kind": "agent", "id": "a1", "title": "Tech Lead",
         "text": "display_name: Mira\ntitle: Tech Lead\nrole_summary: Builds systems\nstatus: active"},
        {"ref": "R2", "kind": "run", "id": "r1", "title": "State", "text": snapshot},
    ], rendered="", venture_id="v1")
    quotes = trusted_source_quotes(pack)

    assert quotes["R1"][0] == "role_summary: Builds systems"
    assert "title: Tech Lead" in quotes["R1"]
    assert any('"name": "Foundry"' == quote for quote in quotes["R2"])
    assert all(quote in next(r["text"] for r in pack.records if r["ref"] == ref) and len(quote) <= 160
               for ref, values in quotes.items() for quote in values)

    prompt = json.dumps({"source_refs": ["R1", "R2"], "source_quotes": quotes})
    schema = _native_json_schema("talk", prompt, ConversationOutput)
    enum = schema["$defs"]["SourceQuote"]["properties"]["quote"]["enum"]
    assert "title: Tech Lead" in enum
    assert 'title="Tech Lead"' not in enum and "poisoned source" not in enum
