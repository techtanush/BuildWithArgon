# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.

from __future__ import annotations

PRICES_PER_M: dict[str, tuple[float, float]] = {"gemini-4-argon": (2.00, 10.00)}  # intro pricing (guide)
CACHED_INPUT_DISCOUNT = 0.95


def estimate(model: str, tokens_in: int, tokens_out: int, cached_in: int = 0) -> tuple[float, bool]:
    """Returns (cost_usd, estimated). Unknown price -> (0.0, True)."""
    price = PRICES_PER_M.get(model)
    if price is None:
        return 0.0, True
    p_in, p_out = price
    billable_in = (tokens_in - cached_in) + cached_in * (1 - CACHED_INPUT_DISCOUNT)
    return (billable_in * p_in + tokens_out * p_out) / 1_000_000, False
