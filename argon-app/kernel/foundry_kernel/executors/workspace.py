# OWNER: ayan
"""Product workspaces for the engineering loop (03-company-kernel/02-autonomous-engineering-loop.md §1, §3b step 1)
and the sandboxed command runner (01-architecture/06-security-and-secrets.md §Running generated code).

    uv run python -m foundry_kernel.executors.workspace prepare-cache
copies the product template to data/template-cache/ and runs `npm install` there once."""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from ..config import Settings
from . import fileblocks

TEMPLATE_DIR = Path(__file__).with_name("templates") / "vite-react-ts"
OUTPUT_CAP = 200_000  # bytes of combined stdout/stderr kept per command
COPY_IGNORE = shutil.ignore_patterns("node_modules", ".git", ".foundry", "dist")
TEXT_SKIP_DIRS = {"node_modules", "dist", ".git", ".foundry"}
LOCKFILES = {"package-lock.json", "pnpm-lock.yaml", "yarn.lock"}
TEXT_SUFFIXES = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".html", ".css", ".txt", ".yaml",
                 ".yml", ".svg", ".gitkeep", ""}

# runner(cmd, cwd, timeout_s) -> (returncode, output). Injectable so tests never spawn npm.
Runner = Callable[[list[str], Path, int], Awaitable[tuple[int, str]]]


def workspaces_dir(settings: Settings) -> Path:
    return Path(settings.data_dir) / "workspaces"


def workspace_path(settings: Settings, venture_id: str, ticket_id: str) -> Path:
    for value in (venture_id, ticket_id):
        if not value or value in (".", "..") or not all(c.isalnum() or c in "_-" for c in value):
            raise ValueError("invalid workspace identifier")
    return fileblocks.contained_path(workspaces_dir(settings), f"{venture_id}/{ticket_id}")


def product_main(settings: Settings, venture_id: str) -> Path:
    if not venture_id or not all(c.isalnum() or c in "_-" for c in venture_id):
        raise ValueError("invalid venture identifier")
    return fileblocks.contained_path(Path(settings.data_dir) / "products", f"{venture_id}/main")


def template_cache(settings: Settings) -> Path:
    return Path(settings.data_dir) / "template-cache"


def sandbox_env(cwd: Path) -> dict[str, str]:
    """Stripped env: no secrets ever reach generated code."""
    return {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(cwd), "CI": "1", "NODE_ENV": "test"}


def _cap(text: str) -> str:
    return text if len(text) <= OUTPUT_CAP else "[…truncated…]\n" + text[-OUTPUT_CAP:]


async def _kill_and_reap(proc: asyncio.subprocess.Process) -> None:
    """Commands run in their own session so npm's children cannot outlive timeout/cancellation."""
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    await proc.communicate()
    await proc.wait()


async def subprocess_runner(cmd: list[str], cwd: Path, timeout_s: int) -> tuple[int, str]:
    try:
        proc = await asyncio.create_subprocess_exec(*cmd, cwd=str(cwd), env=sandbox_env(cwd),
                                                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                                                    start_new_session=True)
    except FileNotFoundError as exc:
        return 127, f"command not found: {exc}"
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
    except TimeoutError:
        await asyncio.shield(_kill_and_reap(proc))
        return 124, f"timeout after {timeout_s}s: {' '.join(cmd)}"
    except asyncio.CancelledError:
        await asyncio.shield(_kill_and_reap(proc))
        raise
    return proc.returncode or 0, _cap(out.decode("utf-8", errors="replace"))


def docker_available() -> bool:
    try:
        return subprocess.run(["docker", "info"], capture_output=True, timeout=10, check=False).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def docker_runner(image: str = "node:20-bookworm-slim") -> Runner:
    async def run(cmd: list[str], cwd: Path, timeout_s: int) -> tuple[int, str]:
        wrapped = ["docker", "run", "--rm", "--network", "none", "--memory", "2g", "--cpus", "2",
                   "-e", "CI=1", "-e", "NODE_ENV=test", "-e", "HOME=/ws", "-v", f"{cwd.resolve()}:/ws", "-w", "/ws",
                   image, *cmd]
        return await subprocess_runner(wrapped, cwd, timeout_s)
    return run


async def unavailable_runner(cmd: list[str], cwd: Path, timeout_s: int) -> tuple[int, str]:
    return 126, "required local isolation is unavailable; refusing host execution"


def default_runner(settings: Settings) -> tuple[Runner, str | None]:
    """Live generated code requires Docker by default.

    Unsafe local development only: ALLOW_UNSANDBOXED_EXECUTION=1 explicitly permits
    subprocess execution with host filesystem/network access. A stripped environment
    is not a sandbox. Fake mode and injected test runners remain available offline.
    """
    if settings.local_sandbox == "docker":
        if docker_available():
            return docker_runner(), None
        return unavailable_runner, "LOCAL_SANDBOX=docker but Docker is unavailable; refusing host execution"
    if settings.llm_mode != "fake":
        if os.environ.get("ALLOW_UNSANDBOXED_EXECUTION") != "1":
            return unavailable_runner, ("Live local execution requires Docker; refusing host execution. "
                                        "Unsafe development opt-in: ALLOW_UNSANDBOXED_EXECUTION=1")
        return subprocess_runner, ("UNSAFE development opt-in ALLOW_UNSANDBOXED_EXECUTION=1: "
                                   "generated code has host filesystem and network access")
    return subprocess_runner, None


def git(ws: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", "-c", "user.name=Foundry", "-c", "user.email=foundry@localhost",
                           "-c", "commit.gpgsign=false", *args],
                          cwd=ws, capture_output=True, text=True, env=sandbox_env(ws), timeout=60, check=False)


def create_workspace(settings: Settings, venture_id: str, ticket_id: str, *, base: Path | None = None) -> Path:
    """data/workspaces/<vid>/<tid>/ from `base`, else the product's main, else the template; node_modules symlinked
    to the template cache when it exists; git init + "base" commit (used for files_changed and the review diff)."""
    ws = workspace_path(settings, venture_id, ticket_id)
    if ws.exists():
        shutil.rmtree(ws)
    ws.parent.mkdir(parents=True, exist_ok=True)
    main = product_main(settings, venture_id)
    src = base if base is not None and base.exists() else (main if main.exists() else TEMPLATE_DIR)
    reject_symlinks(src)
    shutil.copytree(src, ws, ignore=COPY_IGNORE)
    cached = template_cache(settings) / "node_modules"
    if cached.exists() and not (ws / "node_modules").exists():
        (ws / "node_modules").symlink_to(cached.resolve(), target_is_directory=True)
    if not (ws / ".gitignore").exists():
        (ws / ".gitignore").write_text("node_modules\ndist\n.foundry\n")
    git(ws, "init", "-q")
    git(ws, "add", "-A")
    git(ws, "commit", "-q", "-m", "base", "--allow-empty")
    return ws


def needs_install(ws: Path) -> bool:
    return not (ws / "node_modules").exists()


def text_files(root: Path) -> list[Path]:
    """Every text file except node_modules, dist, .git, .foundry and lockfiles, sorted by path."""
    out: list[Path] = []
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root)
        if not p.is_file() or not fileblocks.safe_path(str(rel)) or any(part in TEXT_SKIP_DIRS for part in rel.parts) or p.name in LOCKFILES:
            continue
        if p.is_symlink() or not p.resolve().is_relative_to(root.resolve()):
            continue
        if p.suffix.lower() not in TEXT_SUFFIXES:
            continue
        try:
            p.read_text("utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        out.append(p)
    return out


def changed_files(ws: Path) -> list[str]:
    diff = git(ws, "diff", "--name-only", "-z", "HEAD").stdout.split("\0")
    untracked = git(ws, "ls-files", "--others", "--exclude-standard", "-z").stdout.split("\0")
    deleted = git(ws, "ls-files", "--deleted", "-z").stdout.split("\0")
    return sorted((set(diff) | set(untracked) | set(deleted)) - {""})


def overlay_changes(ws: Path, source: Path) -> None:
    """Merge another prerequisite's edits relative to its own base, refusing divergent same-file edits."""
    reject_symlinks(source)
    updates: list[tuple[Path, bytes | None]] = []

    def blob(data: bytes | None) -> str | None:
        return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest() if data is not None else None

    for rel in changed_files(source):
        target = fileblocks.contained_path(ws, rel)
        incoming = fileblocks.contained_path(source, rel)
        base = git(source, "rev-parse", "--verify", f"HEAD:{rel}")
        base_hash = base.stdout.strip() if base.returncode == 0 else None
        old = target.read_bytes() if target.is_file() else None
        new = incoming.read_bytes() if incoming.is_file() else None
        if blob(old) not in (base_hash, blob(new)):
            raise ValueError(f"conflicting prerequisite changes: {rel}; resolve the task dependency before rebuilding")
        updates.append((target, new))
    for target, data in updates:
        if data is None:
            if target.is_file():
                target.unlink()
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)


def diff_text(ws: Path, max_chars: int = 400_000) -> str:
    git(ws, "add", "-A", "-N")  # intent-to-add so new files show in the diff
    text = git(ws, "diff", "HEAD").stdout
    return text if len(text) <= max_chars else text[:max_chars] + "\n[…diff truncated…]"


def reject_symlinks(root: Path) -> None:
    for entry in root.rglob("*"):
        rel = entry.relative_to(root)
        if any(part in TEXT_SKIP_DIRS for part in rel.parts):
            continue
        if entry.is_symlink():
            raise ValueError("symlink in product source")


def source_digest(root: Path) -> str:
    """Bind a local merge approval to the exact source that passed QA, not a mutable directory."""
    reject_symlinks(root)
    digest = hashlib.sha256()
    for entry in sorted(root.rglob("*")):
        rel = entry.relative_to(root)
        if any(part in TEXT_SKIP_DIRS for part in rel.parts) or not entry.is_file():
            continue
        digest.update(str(rel).encode("utf-8") + b"\0")
        data = entry.read_bytes()
        digest.update(str(len(data)).encode("ascii") + b"\0" + data)
    return digest.hexdigest()


def copy_product(ws: Path, dest: Path) -> None:
    """Accept a local build: copy the workspace (without node_modules/.git/.foundry/dist) into data/products/<vid>/main/."""
    reject_symlinks(ws)
    if dest.is_symlink():
        raise ValueError("symlink product destination")
    if dest.exists():
        shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(ws, dest, ignore=COPY_IGNORE, symlinks=False)


def prepare_cache(settings: Settings) -> dict[str, Any]:
    cache = template_cache(settings)
    cache.mkdir(parents=True, exist_ok=True)
    for item in TEMPLATE_DIR.iterdir():
        target = cache / item.name
        if item.is_dir():
            shutil.copytree(item, target, dirs_exist_ok=True)
        else:
            shutil.copy2(item, target)
    res = subprocess.run(["npm", "install", "--no-audit", "--no-fund"], cwd=cache, capture_output=True, text=True,
                         timeout=900, check=False, env=sandbox_env(cache))
    if res.returncode != 0:
        raise SystemExit(f"npm install failed:\n{res.stdout[-4000:]}\n{res.stderr[-4000:]}")
    manifest = json.loads((cache / "package.json").read_text())
    versions = {}
    for name in {**manifest.get("dependencies", {}), **manifest.get("devDependencies", {})}:
        pkg = cache / "node_modules" / name / "package.json"
        if pkg.exists():
            versions[name] = json.loads(pkg.read_text()).get("version")
    (cache / "versions.json").write_text(json.dumps(versions, indent=2) + "\n")
    return versions


def main(argv: list[str]) -> int:
    from ..config import get_settings

    if argv[:1] != ["prepare-cache"]:
        print("usage: python -m foundry_kernel.executors.workspace prepare-cache")
        return 2
    versions = prepare_cache(get_settings())
    print(json.dumps(versions, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
