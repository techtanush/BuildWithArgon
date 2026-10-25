# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.

"""Tolerant JSON extraction for model output (02-gemini-interactions-api.md §jsonout.py)."""
from __future__ import annotations

import json
import re
from typing import Any, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class LLMOutputError(Exception):
    """Model output could not be parsed/validated after one repair attempt."""


def _balanced(s: str, start: int) -> str | None:
    """The shortest balanced {...} / [...] slice starting at `start` (string-aware), or None."""
    open_ch = s[start]
    close_ch = "}" if open_ch == "{" else "]"
    depth, in_str, esc = 0, False, False
    for i in range(start, len(s)):
        c = s[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return s[start:i + 1]
    return None


def extract_json(text: str) -> Any:
    """1) strip ```json fences; 2) json.loads the whole text; 3) the first '{'/'[' to the matching last '}'/']';
    4) the first balanced object/array; else ValueError."""
    s = (text or "").strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", s, re.DOTALL)
    if fence:
        s = fence.group(1).strip()
    try:
        return json.loads(s)
    except ValueError:
        pass
    starts = [i for i in (s.find("{"), s.find("[")) if i != -1]
    if not starts:
        raise ValueError("no JSON found")
    start = min(starts)
    end = max(s.rfind("}"), s.rfind("]"))
    if end > start:
        try:
            return json.loads(s[start:end + 1])
        except ValueError:
            pass
    chunk = _balanced(s, start)
    if chunk is None:
        raise ValueError("no complete JSON value found")
    return json.loads(chunk)


def parse_model(text: str, schema: type[T]) -> T:
    return schema.model_validate(extract_json(text))
