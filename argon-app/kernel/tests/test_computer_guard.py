# OWNER: ayan
"""CU-03: the guard blocks off-allowlist URLs and gates login/sign-up/checkout/contact actions."""
from __future__ import annotations

from typing import Any

import pytest

from foundry_kernel.computers import guard
from foundry_kernel.llm.fake import FakeLLM

ALLOWED = ["acme.com", "localhost"]


async def verdict(action: dict[str, Any], url: str = "https://acme.com/pricing", screen: str = "", llm: Any = None) -> str:
    return (await guard.check(action, current_url=url, screen_text=screen, allowed_domains=ALLOWED,
                              llm=llm or FakeLLM())).verdict


@pytest.mark.parametrize("url,ok", [
    ("https://acme.com/pricing", True), ("https://www.acme.com/", True), ("http://localhost:5173/preview/x/", True),
    ("https://evil.com/acme.com", False), ("https://acme.com.evil.com/", False), ("file:///etc/passwd", False),
    ("javascript:alert(1)", False), ("https://notacme.com/", False),
])
def test_domain_allowed(url: str, ok: bool) -> None:
    assert guard.domain_allowed(url, ALLOWED) is ok


async def test_off_allowlist_open_url_blocked() -> None:
    assert await verdict({"type": "open_url", "url": "https://competitor.io/pricing"}) == "block"


async def test_subdomain_open_url_allowed() -> None:
    assert await verdict({"type": "open_url", "url": "https://docs.acme.com/plans", "reason": "read the docs"}) == "allow"


@pytest.mark.parametrize("action,url,screen", [
    ({"type": "type", "text": "hunter2", "reason": "fill the form"}, "https://acme.com/account", "Email  Password"),
    ({"type": "click", "x": 10, "y": 10, "reason": "click Sign up"}, "https://acme.com/", ""),
    ({"type": "click", "x": 10, "y": 10, "reason": "press continue"}, "https://acme.com/login", ""),
    ({"type": "click", "x": 10, "y": 10, "reason": "go to the next step"}, "https://acme.com/checkout", ""),
    ({"type": "type", "text": "4242 4242 4242 4242", "reason": "enter test data"}, "https://acme.com/", ""),
])
async def test_login_signup_checkout_credentials_gated(action: dict[str, Any], url: str, screen: str) -> None:
    assert await verdict(action, url, screen) == "gate"


async def test_contact_form_gated() -> None:
    assert await verdict({"type": "type", "text": "Hi there", "reason": "write a message"}, "https://acme.com/contact") == "gate"
    assert await verdict({"type": "click", "x": 5, "y": 5, "reason": "click Send"}, "https://acme.com/about") == "gate"
    assert await verdict({"type": "key", "keys": "Return", "reason": "post the comment"}) == "gate"


async def test_downloads_and_shell_blocked() -> None:
    assert await verdict({"type": "open_url", "url": "https://acme.com/files/setup.exe"}) == "block"
    assert await verdict({"type": "click", "x": 1, "y": 1, "reason": "Download the installer"}) == "block"
    assert await verdict({"type": "shell", "text": "rm -rf /"}) == "block"


async def test_inert_actions_allowed_without_classifier() -> None:
    assert (await guard.check({"type": "scroll", "dy": -600}, current_url="https://acme.com", screen_text="",
                              allowed_domains=ALLOWED, llm=None)).verdict == "allow"


async def test_classifier_decides_the_rest() -> None:
    llm = FakeLLM()
    llm.script("computer_guard", [{"verdict": "allow", "reason": "reading"}, {"verdict": "block", "reason": "nope"}])
    action = {"type": "click", "x": 300, "y": 200, "reason": "open the Pricing tab"}
    assert await verdict(action, llm=llm) == "allow"
    assert await verdict(action, llm=llm) == "block"


async def test_classifier_error_gates() -> None:
    class Broken:
        async def generate_json(self, *a: Any, **kw: Any) -> Any:
            raise RuntimeError("provider down")

    action = {"type": "click", "x": 300, "y": 200, "reason": "open the Pricing tab"}
    assert await verdict(action, llm=Broken()) == "gate"
    assert (await guard.check(action, current_url="https://acme.com", screen_text="", allowed_domains=ALLOWED,
                              llm=None)).verdict == "gate"

@pytest.mark.parametrize("url", ["https://acme.com\\@evil.com/", "https://acme.com:bad/", "https://[broken/", "https://user@acme.com/", "https://acme.com\n.evil.com/"])
def test_malformed_domains_fail_closed(url: str) -> None:
    assert not guard.domain_allowed(url, ALLOWED)

async def test_navigation_shortcuts_and_off_domain_actions_blocked() -> None:
    assert await verdict({"type": "key", "keys": "ctrl+l"}) == "block"
    assert await verdict({"type": "click", "x": 5, "y": 5}, url="https://evil.com") == "block"
    assert await verdict({"type": "type", "text": "https://evil.com"}) == "gate"

async def test_download_cannot_be_approved_as_login_action() -> None:
    assert await verdict({"type": "open_url", "url": "https://acme.com/login/setup.exe"}) == "block"
    assert await verdict({"type": "click", "reason": "download installer"}, url="https://acme.com/login") == "block"

@pytest.mark.parametrize("keys", ["ctrl+alt+t", "ctrl+shift+j", "ctrl+shift+i", "F12", "ctrl+v", "ctrl+s", "alt+f2", "", "Return; xterm"])
async def test_key_allowlist_blocks_desktop_escape_and_clipboard_bypasses(keys: str) -> None:
    assert await verdict({"type": "key", "keys": keys, "reason": "read page"}) == "block"

@pytest.mark.parametrize("keys", ["Tab", "shift+Tab", "Escape", "Left", "Home", "PageDown"])
async def test_safe_navigation_keys_remain_available(keys: str) -> None:
    assert await verdict({"type": "key", "keys": keys, "reason": "read page"}) == "allow"
