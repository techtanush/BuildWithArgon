# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.

"""Price table (01-model-routing.md §Prices). Only Argon's price is published; others -> 0.0 estimated
unless overridden with PRICE_<MODEL_ID_UPPER_SNAKE>_IN / _OUT (USD per 1M tokens)."""
from __future__ import annotations

import os
import re

PRICES_PER_M: dict[str, tuple[float, float]] = {"gemini-4-argon": (2.00, 10.00)}  # intro pricing (guide)
CACHED_INPUT_DISCOUNT = 0.95


def price_for(model: str) -> tuple[float, float] | None:
    key = "PRICE_" + re.sub(r"[^A-Z0-9]+", "_", model.upper()).strip("_")
    p_in, p_out = os.environ.get(key + "_IN"), os.environ.get(key + "_OUT")
    if p_in is not None and p_out is not None:
        try:
            return float(p_in), float(p_out)
        except ValueError:
            pass
    return PRICES_PER_M.get(model)


def estimate(model: str, tokens_in: int, tokens_out: int, cached_in: int = 0) -> tuple[float, bool]:
    """Returns (cost_usd, estimated). Unknown price -> (0.0, True)."""
    price = price_for(model)
    if price is None:
        return 0.0, True
    p_in, p_out = price
    cached_in = min(max(cached_in, 0), tokens_in)
    billable_in = (tokens_in - cached_in) + cached_in * (1 - CACHED_INPUT_DISCOUNT)
    return (billable_in * p_in + tokens_out * p_out) / 1_000_000, False
