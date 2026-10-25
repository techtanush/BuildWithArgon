# OWNER: frozen contract (change only via docs/contract-requests/<you>.md, applied in the merge session)

"""`foundry-eval engineering|grounding [...]` dispatcher. engineering -> ayan, grounding -> tanush."""
from __future__ import annotations

import importlib
import sys


def main() -> None:
    suite = sys.argv[1] if len(sys.argv) > 1 else ""
    module = {"engineering": "engineering_eval", "grounding": "grounding_eval"}.get(suite)
    if not module:
        print("usage: foundry-eval engineering|grounding [options]")
        raise SystemExit(2)
    importlib.import_module(f"foundry_kernel.evals.{module}").main(sys.argv[2:])
