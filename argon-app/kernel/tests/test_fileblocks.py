# OWNER: ayan
"""E-02: file blocks parse and apply safely (03-company-kernel/02-autonomous-engineering-loop.md §3b)."""
from __future__ import annotations

import json

from foundry_kernel.executors import fileblocks
from foundry_kernel.executors.local_loop import sanitize_package_json


def test_parse_multiple_files_and_notes() -> None:
    text = (fileblocks.emit("src/a.ts", "export const a = 1;") + "\n" + fileblocks.emit("tests/a.test.ts", "it('x', () => {});")
            + '\nFOUNDRY_NOTES {"summary":"two files","tests_added":["tests/a.test.ts"],"assumptions":[]}')
    res = fileblocks.parse(text)
    assert [b.path for b in res.blocks] == ["src/a.ts", "tests/a.test.ts"]
    assert res.blocks[0].content == "export const a = 1;"
    assert not res.truncated and res.notes and res.notes["summary"] == "two files"


def test_content_with_markers_inside_strings() -> None:
    content = 'const s = "<<<FILE path=\\"x\\">>> and <<<DELETE path=\\"y\\">>>";\nexport default s;'
    res = fileblocks.parse(fileblocks.emit("src/s.ts", content))
    assert len(res.blocks) == 1 and res.blocks[0].content == content and not res.truncated


def test_delete_markers() -> None:
    res = fileblocks.parse(fileblocks.emit("src/new.ts", "x") + '\n<<<DELETE path="src/old.ts">>>\n')
    assert [(b.path, b.content) for b in res.blocks] == [("src/new.ts", "x"), ("src/old.ts", None)]


def test_truncated_tail_is_dropped() -> None:
    text = fileblocks.emit("src/ok.ts", "ok") + '\n<<<FILE path="src/cut.ts">>>\nexport function half('
    res = fileblocks.parse(text)
    assert [b.path for b in res.blocks] == ["src/ok.ts"]
    assert res.truncated and res.truncated_path == "src/cut.ts"


def test_unsafe_paths_rejected() -> None:
    for bad in ["/etc/passwd", "../x.ts", "src/../../x.ts", ".git/config", "node_modules/a/index.js", ".env",
                ".env.local", "config/.env.production", "certs/server.pem", "id.key", "C:/x.ts", "a\\b.ts", ""]:
        assert not fileblocks.safe_path(bad), bad
    for good in ["src/a.ts", "tests/acceptance/x.test.ts", "package.json", "src/env.ts", "README.md"]:
        assert fileblocks.safe_path(good), good


def test_package_json_strips_unlisted_dependencies() -> None:
    base = json.dumps({"dependencies": {"react": "^18"}, "devDependencies": {"vitest": "^3"}})
    new = json.dumps({"dependencies": {"react": "^18", "lodash": "^4", "zod": "^3"}, "devDependencies": {"vitest": "^3", "jest": "^29"}})
    text, stripped = sanitize_package_json(new, base)
    data = json.loads(text)
    assert sorted(stripped) == ["jest", "lodash"]
    assert set(data["dependencies"]) == {"react", "zod"} and set(data["devDependencies"]) == {"vitest"}


def test_reserved_components_and_control_paths_are_rejected() -> None:
    for bad in [".", "./", "src/.git/config", "src/node_modules/pkg/a.ts", ".foundry/vitest.json", "a\x00b.ts", "a\nb.ts"]:
        assert not fileblocks.safe_path(bad), repr(bad)


def test_contained_path_rejects_symlink_write_and_delete(tmp_path) -> None:
    import pytest

    root = tmp_path / "workspace"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (root / "src").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError, match="symlink"):
        fileblocks.contained_path(root, "src/escape.ts")
