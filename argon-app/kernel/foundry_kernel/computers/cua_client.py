# OWNER: ayan
"""The ONLY module that imports Cua (lazily). Spec: 02-models-and-integrations/10-cua-cloud-computers.md
§cua_client.py. Strategy: SDK-native screenshot/mouse/keyboard when the sandbox exposes them, else drive an
X11 desktop inside the sandbox with xdotool + ImageMagick through the documented `sb.shell.run(...)`.
Every SDK detail below is VERIFY (README example only) — see docs/verified/ayan.md."""
from __future__ import annotations

import asyncio
import base64
import importlib.util
import inspect
import io
import os
import re
import shlex
from typing import Any, Protocol
from urllib.parse import urlparse

SCREEN_W, SCREEN_H = 1280, 800
DISPLAY = ":1"
# VERIFY: packages for the first-boot desktop on the default Linux image (≈ 60–90 s).
BOOTSTRAP = (
    "(command -v xdotool >/dev/null 2>&1 && command -v xclip >/dev/null 2>&1) || (export DEBIAN_FRONTEND=noninteractive; "
    "apt-get update -qq && apt-get install -y -qq xvfb fluxbox xdotool xclip imagemagick chromium >/dev/null 2>&1 "
    "|| apt-get install -y -qq xvfb fluxbox xdotool xclip imagemagick chromium-browser >/dev/null 2>&1); "
    f"pgrep Xvfb >/dev/null || (Xvfb {DISPLAY} -screen 0 {SCREEN_W}x{SCREEN_H}x24 >/dev/null 2>&1 &); "
    f"sleep 1; pgrep fluxbox >/dev/null || (DISPLAY={DISPLAY} fluxbox >/dev/null 2>&1 &); true"
)


class CuaUnavailable(Exception):
    """Cua is not installed, not configured, or the computer could not start."""


class CuaComputer(Protocol):
    id: str

    async def screenshot(self) -> bytes: ...
    async def get_current_url(self) -> str: ...
    async def click(self, x: int, y: int, button: str = "left", double: bool = False) -> None: ...
    async def type_text(self, text: str) -> None: ...
    async def key(self, keys: str) -> None: ...
    async def scroll(self, dy: int) -> None: ...
    async def open_url(self, url: str) -> None: ...
    async def shell(self, cmd: str, timeout_s: int = 30) -> tuple[int, str]: ...
    async def stop(self) -> None: ...


def cua_available() -> tuple[bool, str]:
    """(ok, reason). Import check only — never imports the SDK at module import time."""
    if importlib.util.find_spec("cua_sandbox") is None:
        return False, "Cua SDK not installed (uv sync --extra computers)"
    return True, "cua_sandbox importable"


async def _maybe_await(value: Any) -> Any:
    return await value if inspect.isawaitable(value) else value


class FakeComputer:
    """In-memory computer for tests and dry runs: records actions, renders a PNG of its state."""

    def __init__(self, id: str = "fake") -> None:
        self.id = id
        self.current_url = "about:blank"
        self.actions: list[tuple[str, Any]] = []
        self.stopped = False

    async def get_current_url(self) -> str:
        return self.current_url

    async def screenshot(self) -> bytes:
        from PIL import Image, ImageDraw

        img = Image.new("RGB", (SCREEN_W, SCREEN_H), (236, 240, 245))
        draw = ImageDraw.Draw(img)
        draw.rectangle([0, 0, SCREEN_W, 48], fill=(60, 64, 72))
        draw.text((16, 16), self.current_url, fill=(255, 255, 255))
        draw.text((16, 80), f"fake computer {self.id} — {len(self.actions)} actions", fill=(20, 20, 20))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    async def click(self, x: int, y: int, button: str = "left", double: bool = False) -> None:
        self.actions.append(("double_click" if double else "click", (x, y, button)))

    async def type_text(self, text: str) -> None:
        self.actions.append(("type", text))

    async def key(self, keys: str) -> None:
        self.actions.append(("key", keys))

    async def scroll(self, dy: int) -> None:
        self.actions.append(("scroll", dy))

    async def open_url(self, url: str) -> None:
        self.current_url = url
        self.actions.append(("open_url", url))

    async def shell(self, cmd: str, timeout_s: int = 30) -> tuple[int, str]:
        self.actions.append(("shell", cmd))
        return 0, ""

    async def stop(self) -> None:
        self.stopped = True


class SdkComputer:
    """A Cua sandbox driven through the SDK (VERIFY method names) or xdotool over `sb.shell.run`."""

    def __init__(self, id: str, sandbox: Any, context: Any = None) -> None:
        self.id = id
        self.sb = sandbox
        self._context = context  # the async context manager that owns the sandbox (ephemeral)
        self.current_url = "about:blank"
        self.watch_url: str | None = None

    async def refresh_watch_url(self) -> None:
        viewer = self._native("viewer_url", "get_display_url")
        if viewer is None:
            return
        try:
            value = str(await _maybe_await(viewer()))
            parsed = urlparse(value)
            if parsed.scheme == "https" or (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1", "::1")):
                self.watch_url = value
        except Exception:
            self.watch_url = None  # viewer absence must not break screenshot fallback

    def _native(self, *names: str) -> Any:
        """First SDK-native callable among `names` (e.g. 'screenshot', 'interface.screenshot')."""
        for name in names:
            obj: Any = self.sb
            for part in name.split("."):
                obj = getattr(obj, part, None)
                if obj is None:
                    break
            if callable(obj):
                return obj
        return None

    async def shell(self, cmd: str, timeout_s: int = 30) -> tuple[int, str]:
        res = await asyncio.wait_for(_maybe_await(self.sb.shell.run(cmd, timeout=timeout_s)), timeout=timeout_s)
        code = getattr(res, "returncode", None)
        if code is None:
            code = getattr(res, "exit_code", 0)
        out = (getattr(res, "stdout", "") or "") + (getattr(res, "stderr", "") or "")
        return int(code or 0), out

    async def _x(self, cmd: str) -> None:
        code, out = await self.shell(f"DISPLAY={DISPLAY} {cmd}")
        if code != 0:
            raise CuaUnavailable(f"desktop command failed ({code}): {out[-300:]}")

    async def bootstrap(self) -> None:
        """Ensure an X11 desktop exists when the SDK has no native screenshot (fallback path)."""
        if self._native("screenshot", "screen.screenshot", "interface.screenshot") is None:
            await self.shell(BOOTSTRAP, timeout_s=240)
        elif self._native("get_current_url", "interface.get_current_url") is None:
            code, _ = await self.shell(
                "(command -v xclip >/dev/null && command -v xdotool >/dev/null) || "
                "(export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq xclip xdotool)",
                timeout_s=240)
            if code != 0:
                raise CuaUnavailable("address-bar verification requires xclip and xdotool")

    async def get_current_url(self) -> str:
        """Read the actual address bar, never the last requested URL. Fail closed if unavailable."""
        native = self._native("get_current_url", "interface.get_current_url")
        if native is not None:
            return str(await _maybe_await(native()))
        code, out = await self.shell(
            f"DISPLAY={DISPLAY} sh -c 'command -v xclip >/dev/null || exit 1; "
            "printf \"\" | xclip -selection clipboard; xdotool key ctrl+l ctrl+c; sleep 0.2; "
            "xclip -o -selection clipboard; xdotool key Escape'")
        if code != 0 or not out.strip():
            raise CuaUnavailable("cannot verify the browser address bar")
        return out.strip()

    async def screenshot(self) -> bytes:
        native = self._native("screenshot", "screen.screenshot", "interface.screenshot")
        if native is not None:
            data = await _maybe_await(native())
            if isinstance(data, str):
                data = base64.b64decode(data)
            return bytes(data)
        code, out = await self.shell(f"DISPLAY={DISPLAY} import -window root png:- | base64 -w0")
        if code != 0 or not out.strip():
            raise CuaUnavailable("screenshot failed")
        return base64.b64decode(re.sub(r"\s+", "", out))

    async def click(self, x: int, y: int, button: str = "left", double: bool = False) -> None:
        x, y = max(0, min(int(x), SCREEN_W - 1)), max(0, min(int(y), SCREEN_H - 1))
        native = self._native("mouse.double_click" if double else "mouse.click")
        if native is not None:
            if double:
                await _maybe_await(native(x, y))
            else:
                await _maybe_await(native(x, y, button=button))
            return
        native = self._native("double_click" if double else "left_click", "interface.double_click" if double else "interface.left_click")
        if native is not None and button == "left":
            await _maybe_await(native(x, y))
            return
        btn = {"left": 1, "middle": 2, "right": 3}.get(button, 1)
        await self._x(f"xdotool mousemove {x} {y} click {'--repeat 2 ' if double else ''}{btn}")

    async def type_text(self, text: str) -> None:
        native = self._native("keyboard.type", "type_text", "interface.type_text")
        if native is not None:
            await _maybe_await(native(text))
            return
        await self._x(f"xdotool type --delay 20 -- {shlex.quote(text)}")

    async def key(self, keys: str) -> None:
        native = self._native("keyboard.keypress")
        if native is not None:
            await _maybe_await(native(keys.split("+")))
            return
        native = self._native("hotkey", "interface.hotkey")
        if native is not None:
            await _maybe_await(native(*keys.split("+")))
            return
        await self._x(f"xdotool key -- {shlex.quote(keys)}")

    async def scroll(self, dy: int) -> None:
        native = self._native("mouse.scroll")
        if native is not None:
            # Adapter dy follows wheel/pixel direction: positive down; pinned SDK positive up.
            notches = max(1, abs(int(dy)) // 120)
            await _maybe_await(native(SCREEN_W // 2, SCREEN_H // 2, scroll_y=-notches if dy > 0 else notches))
            return
        clicks = max(1, abs(int(dy)) // 120)
        await self._x(f"xdotool click --repeat {clicks} {5 if dy > 0 else 4}")

    async def open_url(self, url: str) -> None:
        self.current_url = url
        code, _ = await self.shell("pgrep -f 'chromium' >/dev/null")
        if code != 0:  # first launch
            await self.shell(
                f"DISPLAY={DISPLAY} sh -c '(chromium --no-sandbox --no-first-run --window-size={SCREEN_W},{SCREEN_H} "
                f"{shlex.quote(url)} || chromium-browser --no-sandbox {shlex.quote(url)}) >/dev/null 2>&1 &'")
            await self.shell("sleep 3")
            return
        await self.key("ctrl+l")
        await self.type_text(url)
        await self.key("Return")

    async def stop(self) -> None:
        if self._context is not None:
            await self._context.__aexit__(None, None, None)
            self._context = None
        else:
            closer = self._native("destroy", "close", "stop", "aclose")
            if closer is not None:
                await _maybe_await(closer())


async def create_computer(settings: Any, name: str) -> CuaComputer:
    """Start a computer for CUA_MODE. sandbox → ephemeral local Linux sandbox (README example, VERIFY)."""
    mode = getattr(settings, "cua_mode", "off")
    if mode == "off":
        raise CuaUnavailable("CUA_MODE=off")
    ok, reason = cua_available()
    if not ok:
        raise CuaUnavailable(reason)
    try:
        from cua_sandbox import (  # VERIFY: README `Sandbox.ephemeral(Image.linux(), local=True)`
            Image,
            Sandbox,
        )

        if mode == "spaces":
            space_id = getattr(settings, "cua_space_id", None) or os.environ.get("CUA_SPACE_ID", "")
            if not space_id or not re.fullmatch(r"(?:local:)?[A-Za-z0-9_.-]+", space_id):
                raise CuaUnavailable("spaces mode needs CUA_SPACE_ID naming an existing local Space")
            context = Sandbox.connect(space_id, local=True)
        else:
            context = Sandbox.ephemeral(Image.linux(), local=True)
        sandbox = await context.__aenter__()
    except Exception as exc:
        raise CuaUnavailable(f"could not start Cua sandbox: {exc}") from exc
    computer = SdkComputer(space_id if mode == "spaces" else name, sandbox, context)
    try:
        await computer.bootstrap()
        await computer.refresh_watch_url()
    except Exception as exc:
        await computer.stop()
        raise CuaUnavailable(f"desktop bootstrap failed: {exc}") from exc
    return computer
