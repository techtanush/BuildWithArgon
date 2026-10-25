# OWNER: ayan
"""Validation of generated building modules (05-world/09 §Validation, acceptance G-05):
FILE-block parsing, static rules (imports, forbidden tokens, id/export, size) and `tsc --noEmit -p
tsconfig.worldgen.json` over web/src/world/buildings/staging/. Staging is flat (modules import '../../kit/types')."""
from __future__ import annotations

import asyncio
import json
import re
import tempfile
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from . import paths

MAX_BYTES = 60 * 1024
FILE_RE = re.compile(r'<<<FILE path="([^"]+)">>>\n(.*?)\n<<<END FILE>>>', re.DOTALL)
FILE_START_RE = re.compile(r'<<<FILE path="([^"]+)">>>')
FORBIDDEN = ["fetch(", "eval(", "Function(", "document.", "window.", "globalThis", "localStorage", "XMLHttpRequest",
             "WebSocket", "import(", "process.", "Math.random", "setTimeout", "setInterval", "while (true)", "for (;;)"]
IMPORT_OK = re.compile(r"^import\s+type\s*\{[^}]*\}\s*from\s*'\.\./\.\./kit/types';?\s*$", re.MULTILINE)
IMPORT_ANY = re.compile(r"^\s*import\b|\brequire\s*\(", re.MULTILINE)
TSC_LINE = re.compile(r"^(?P<file>[^\s(][^(]*)\((?P<line>\d+),(?P<col>\d+)\): error (?P<code>TS\d+): (?P<msg>.*)$")


@dataclass
class Parsed:
    modules: dict[str, str]  # dept id -> source
    truncated: list[str]  # dept ids whose block started but never ended
    stray: list[str]  # FILE paths outside generated/


@dataclass
class Validation:
    dept: str
    static_ok: bool
    errors: list[str] = field(default_factory=list)
    tsc_ok: bool | None = None
    tsc_errors: str = ""

    @property
    def ok(self) -> bool:
        return self.static_ok and self.tsc_ok is True


def parse_file_blocks(text: str) -> Parsed:
    modules: dict[str, str] = {}
    stray: list[str] = []
    for path, body in FILE_RE.findall(text or ""):
        m = re.fullmatch(re.escape(paths.GENERATED_PATH_PREFIX) + r"([a-z][a-z-]*)\.ts", path.strip())
        if m:
            modules[m.group(1)] = body.strip("\n") + "\n"
        else:
            stray.append(path)
    started = {m.group(1) for m in FILE_START_RE.finditer(text or "")}
    truncated = []
    for path in started:
        m = re.fullmatch(re.escape(paths.GENERATED_PATH_PREFIX) + r"([a-z][a-z-]*)\.ts", path.strip())
        if m and m.group(1) not in modules:
            truncated.append(m.group(1))
    return Parsed(modules=modules, truncated=sorted(truncated), stray=stray)


def static_check(dept: str, source: str) -> list[str]:
    errors: list[str] = []
    if len(source.encode()) > MAX_BYTES:
        errors.append(f"module is {len(source.encode())} bytes (max {MAX_BYTES})")
    imports = IMPORT_ANY.findall(source)
    ok_imports = IMPORT_OK.findall(source)
    if len(ok_imports) != 1 or len(imports) != 1:
        errors.append("imports: exactly one `import type { ... } from '../../kit/types';` and nothing else is allowed")
    for tok in FORBIDDEN:
        if tok in source:
            errors.append(f"forbidden token `{tok}`")
    if not re.search(r"""\bid\s*:\s*['"]""" + re.escape(dept) + r"""['"]""", source):
        errors.append(f"missing `id: '{dept}'`")
    if "export default" not in source:
        errors.append("missing `export default`")
    return errors


def tsc_bin() -> list[str] | None:
    local = paths.WEB_DIR / "node_modules" / ".bin" / "tsc"
    return [str(local)] if local.exists() else None


def run_tsc(timeout: int = 300) -> tuple[bool | None, dict[str, list[str]], str]:
    """Type-check the staging dir. Returns (ok, errors by staging file name, raw output); ok None = tsc missing."""
    cmd = tsc_bin()
    if cmd is None:
        return None, {}, "tsc not installed — run `pnpm install` in argon-app/web"
    proc = subprocess.run([*cmd, "--noEmit", "-p", "tsconfig.worldgen.json"], cwd=paths.WEB_DIR, capture_output=True,
                          text=True, timeout=timeout, check=False)
    out = (proc.stdout + proc.stderr).strip()
    by_file: dict[str, list[str]] = {}
    for line in out.splitlines():
        m = TSC_LINE.match(line.strip())
        if m:
            by_file.setdefault(Path(m.group("file")).name, []).append(
                f"line {m.group('line')}:{m.group('col')} {m.group('code')}: {m.group('msg')}")
    return proc.returncode == 0, by_file, out[-8000:]


def stage(modules: dict[str, str], *, suffix: str = "") -> dict[str, Path]:
    """Write modules to the flat staging dir as <dept><suffix>.ts (the capture page loads source=staging)."""
    paths.STAGING_DIR.mkdir(parents=True, exist_ok=True)
    out = {}
    for dept, src in modules.items():
        p = paths.STAGING_DIR / f"{dept}{suffix}.ts"
        p.write_text(src)
        out[dept] = p
    return out


def validate(modules: dict[str, str], *, suffix: str = "", typecheck: bool = True) -> dict[str, Validation]:
    """Static rules for every module; modules that pass are staged and type-checked together."""
    results = {d: Validation(dept=d, static_ok=not (errs := static_check(d, src)), errors=errs) for d, src in modules.items()}
    passing = {d: modules[d] for d, v in results.items() if v.static_ok}
    if not passing:
        return results
    staged = stage(passing, suffix=suffix)
    if not typecheck:
        return results
    ok, by_file, raw = run_tsc()
    # Errors in the shared kit or compiler configuration invalidate every candidate.
    # Errors in another staged building must not invalidate an otherwise good module.
    shared = [msg for name, msgs in by_file.items()
              if not any(p.name == name for p in paths.STAGING_DIR.glob("*.ts"))
              for msg in msgs]
    for dept, path in staged.items():
        v = results[dept]
        if ok is None:
            v.tsc_ok, v.tsc_errors = False, raw
            continue
        errs = [*by_file.get(path.name, []), *shared]
        v.tsc_ok = not errs and (ok or bool(by_file))
        if ok is False and not by_file:  # tsc failed without per-file errors (config problem) -> blame everyone
            v.tsc_ok = False
            errs = [raw[-2000:]]
        v.tsc_errors = "\n".join(errs)
    return results


async def validate_async(modules: dict[str, str], timeout_s: float = 30, *, suffix: str = "",
                         typecheck: bool = True) -> dict[str, Validation]:
    """Cancellable, bounded typecheck of only these candidates, staged for later capture.

    A private tsconfig prevents unrelated stale staging files from consuming the live budget.
    Timeout/cancellation kills and reaps the compiler process group. Cancellation propagates.
    """
    from .capture import _terminate_process

    results = validate(modules, suffix=suffix, typecheck=False)
    staged = {d: paths.STAGING_DIR / f"{d}{suffix}.ts" for d, v in results.items() if v.static_ok}
    if not staged or not typecheck:
        return results
    cmd = tsc_bin()
    if cmd is None:
        for d in staged:
            results[d].tsc_ok = False
            results[d].tsc_errors = "tsc not installed — run `pnpm install` in argon-app/web"
        return results
    with tempfile.TemporaryDirectory(prefix="foundry-worldgen-tsc-") as scratch:
        config = Path(scratch) / "tsconfig.json"
        config.write_text(json.dumps({"extends": str((paths.WEB_DIR / "tsconfig.worldgen.json").resolve()),
                                      "include": [], "files": [str(p.resolve()) for p in staged.values()]}))
        proc = await asyncio.create_subprocess_exec(*cmd, "--noEmit", "-p", str(config), cwd=paths.WEB_DIR,
                                                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                                                    start_new_session=True)
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
        except TimeoutError:
            await _terminate_process(proc)
            for d in staged:
                results[d].tsc_ok = False
                results[d].tsc_errors = f"typecheck timed out after {timeout_s}s"
            return results
        except asyncio.CancelledError:
            await asyncio.shield(_terminate_process(proc))
            raise
        raw = out.decode(errors="replace").strip()
        by_file: dict[str, list[str]] = {}
        for line in raw.splitlines():
            match = TSC_LINE.match(line.strip())
            if match:
                by_file.setdefault(Path(match.group("file")).name, []).append(line.strip())
        candidate_names = {p.name for p in staged.values()}
        shared = [msg for name, msgs in by_file.items() if name not in candidate_names for msg in msgs]
        for d, p in staged.items():
            errors = [*by_file.get(p.name, []), *shared]
            if proc.returncode != 0 and not by_file:
                errors.append(raw[-8000:] or f"tsc exited {proc.returncode}")
            results[d].tsc_ok = not errors and (proc.returncode == 0 or bool(by_file))
            results[d].tsc_errors = "\n".join(errors)
        return results
