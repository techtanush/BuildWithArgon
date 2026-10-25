# OWNER: ayan
"""G-05: static rules (forbidden tokens, imports, id/export, size), FILE-block parsing, and the real tsc check."""
from __future__ import annotations

import pytest

from foundry_kernel.worldgen import paths
from foundry_kernel.worldgen.validate import (
    parse_file_blocks,
    static_check,
    tsc_bin,
    validate,
)
from tests.ayan.conftest import file_block, module


def test_valid_module_passes_static_rules() -> None:
    assert static_check("engineering", module("engineering")) == []


@pytest.mark.parametrize("token", ["fetch(", "eval(", "Function(", "document.", "window.", "globalThis", "localStorage",
                                   "XMLHttpRequest", "WebSocket", "import(", "process.", "Math.random", "setTimeout",
                                   "setInterval", "while (true)", "for (;;)"])
def test_forbidden_tokens(token: str) -> None:
    src = module("engineering").replace("k.entrance(", f"/* {token} */ k.entrance(")
    assert any(token in e for e in static_check("engineering", src))


def test_imports_and_ids() -> None:
    src = module("pivot")
    assert static_check("pivot", "import * as THREE from 'three';\n" + src)
    assert static_check("pivot", src.replace("import type", "import"))
    assert static_check("pivot", src + "\nconst x = require('fs');\n")
    assert any("id: 'engineering'" in e for e in static_check("engineering", src))
    assert any("export default" in e for e in static_check("pivot", src.replace("export default", "export const z =")))
    assert any("bytes" in e for e in static_check("pivot", src + "//" + "x" * 70_000))


def test_parse_file_blocks_truncated_and_stray() -> None:
    text = "\n".join([file_block("intake", module("intake")), file_block("growth", module("growth")),
                      '<<<FILE path="src/evil.ts">>>\nx\n<<<END FILE>>>',
                      '<<<FILE path="web/src/world/buildings/generated/sales.ts">>>\nimport type { KitApi } from'])
    p = parse_file_blocks(text)
    assert sorted(p.modules) == ["growth", "intake"] and p.truncated == ["sales"] and p.stray == ["src/evil.ts"]
    assert "id: 'intake'" in p.modules["intake"]


@pytest.mark.skipif(tsc_bin() is None, reason="web/node_modules not installed")
def test_tsc_on_staging_separates_good_and_bad_modules() -> None:
    good = module("growth")
    bad = module("support").replace("k.entrance({ z: 7.2 });", "k.entrance({ z: 'seven' });")
    try:
        res = validate({"growth": good, "support": bad}, suffix=".pytest")
        assert res["growth"].ok, res["growth"].tsc_errors
        assert res["support"].static_ok and res["support"].tsc_ok is False and "TS2322" in res["support"].tsc_errors
    finally:
        for d in ("growth", "support"):
            (paths.STAGING_DIR / f"{d}.pytest.ts").unlink(missing_ok=True)
