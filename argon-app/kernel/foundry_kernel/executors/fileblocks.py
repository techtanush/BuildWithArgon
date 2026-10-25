# OWNER: ayan
"""FILE-block protocol between Argon and the workspace (03-company-kernel/02-autonomous-engineering-loop.md
§3b "File block format"). Argon emits whole files:

    <<<FILE path="src/lib/pantry.ts">>>
    ...content...
    <<<END FILE>>>
    <<<DELETE path="src/old.ts">>>

then one `FOUNDRY_NOTES {...}` line. A block whose `<<<END FILE>>>` is missing (truncated output) is dropped
and the parse is marked `truncated`."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Any

FILE_RE = re.compile(r'<<<FILE path="([^"]+)">>>\n(.*?)\n<<<END FILE>>>', re.MULTILINE | re.DOTALL)
DELETE_RE = re.compile(r'<<<DELETE path="([^"]+)">>>')
OPEN_RE = re.compile(r'<<<FILE path="([^"]+)">>>')
NOTES_RE = re.compile(r"^FOUNDRY_NOTES (\{.*\})\s*$", re.MULTILINE)

BLOCKED_PREFIXES = (".git/", "node_modules/")
BLOCKED_NAMES = re.compile(r"^(\.env.*|.*\.pem|.*\.key)$", re.IGNORECASE)


@dataclass
class FileBlock:
    path: str
    content: str | None  # None = delete


@dataclass
class ParseResult:
    blocks: list[FileBlock] = field(default_factory=list)
    truncated: bool = False
    truncated_path: str | None = None
    notes: dict[str, Any] | None = None


def safe_path(path: str) -> bool:
    """Reject absolute paths, `..`, `.git/`, `node_modules/`, `.env*`, `*.pem`, `*.key` (security doc §Running generated code)."""
    if not path or path.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:", path) or "\\" in path:
        return False
    p = PurePosixPath(path)
    if any(part in ("..", "") for part in p.parts) or path.startswith("./.."):
        return False
    norm = str(p)
    if norm.startswith(BLOCKED_PREFIXES) or norm in (".git", "node_modules"):
        return False
    return not any(BLOCKED_NAMES.match(part) for part in p.parts)


def parse(text: str) -> ParseResult:
    out = ParseResult()
    spans: list[tuple[int, int, FileBlock]] = []
    for m in FILE_RE.finditer(text):
        spans.append((m.start(), m.end(), FileBlock(m.group(1), m.group(2))))
    for m in DELETE_RE.finditer(text):
        if not any(s <= m.start() < e for s, e, _ in spans):  # a DELETE marker inside file content is content
            spans.append((m.start(), m.end(), FileBlock(m.group(1), None)))
    spans.sort(key=lambda s: s[0])
    out.blocks = [b for _, _, b in spans]
    # truncated: an opening marker after the last complete block (outside any complete block) without its END
    last_end = max((e for _, e, _ in spans), default=0)
    for m in OPEN_RE.finditer(text):
        if m.start() >= last_end:
            out.truncated, out.truncated_path = True, m.group(1)
            break
    notes = NOTES_RE.findall(text[last_end:]) or NOTES_RE.findall(text)
    if notes:
        try:
            parsed = json.loads(notes[-1])
            out.notes = parsed if isinstance(parsed, dict) else None
        except ValueError:
            out.notes = None
    return out


def emit(path: str, content: str | None) -> str:
    """Format one block (used for CODE_CONTEXT and tests)."""
    if content is None:
        return f'<<<DELETE path="{path}">>>'
    return f'<<<FILE path="{path}">>>\n{content}\n<<<END FILE>>>'
