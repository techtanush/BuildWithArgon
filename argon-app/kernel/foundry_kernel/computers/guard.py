# OWNER: ayan
"""Action safety for computer use (02-models-and-integrations/10-cua-cloud-computers.md §Guard).
Rules, in order: (1) open_url off the allowlist → block; (2) credentials / login / sign-up / checkout →
gate; (3) submitting something that contacts a person → gate; (4) downloads, executables, shell → block;
(5) otherwise Flash-Lite `computer_guard` decides; any classifier error → gate."""
from __future__ import annotations

import re
from typing import Any, Literal
from urllib.parse import urlparse

from pydantic import BaseModel

from ..security import PATTERNS

Verdict = Literal["allow", "gate", "block"]


class GuardVerdict(BaseModel):
    verdict: Verdict
    reason: str = ""


class GuardOut(BaseModel):
    """Classifier output (job `computer_guard`)."""
    verdict: Verdict
    reason: str = ""


KNOWN_TYPES = {"click", "double_click", "type", "key", "scroll", "open_url", "wait", "done", "stuck"}
SAFE_KEYS = {"return", "enter", "tab", "shift+tab", "escape", "esc", "backspace", "delete",
             "left", "right", "up", "down", "home", "end", "pageup", "pagedown", "space", "ctrl+a"}
INERT_TYPES = {"wait", "done", "stuck", "scroll"}
AUTH_URL = re.compile(r"(log-?in|sign-?in|sign-?up|signup|register|auth|oauth|sso|checkout|cart|payment|billing|account/new)",
                      re.IGNORECASE)
AUTH_TEXT = re.compile(r"\b(password|passcode|log ?in|sign ?in|sign ?up|create (an )?account|register|checkout|"
                       r"place (your )?order|payment|credit card|card number|cvv|billing)\b", re.IGNORECASE)
CARD = re.compile(r"\b(?:\d[ -]?){13,19}\b")
CONTACT_URL = re.compile(r"(contact|support/new|feedback|message|compose|comment|reply)", re.IGNORECASE)
CONTACT_TEXT = re.compile(r"\b(send|post|publish|comment|reply|submit|contact|message|email|tweet|subscribe|request a demo)\b",
                          re.IGNORECASE)
EXECUTABLE = re.compile(r"\.(exe|msi|dmg|pkg|app|sh|bash|bat|cmd|ps1|deb|rpm|apk|jar|bin|run|appimage|zip|tar|gz|tgz|7z|rar|iso)"
                        r"(\?|#|$)", re.IGNORECASE)
DOWNLOAD_TEXT = re.compile(r"\b(download|install|run the installer|execute)\b", re.IGNORECASE)


def _host(value: str) -> str:
    value = (value or "").strip().lower()
    if "://" not in value:
        value = "http://" + value
    try:
        return (urlparse(value).hostname or "").rstrip(".")
    except ValueError:
        return ""


def domain_allowed(url: str, allowed_domains: list[str]) -> bool:
    """http(s) only; host equals an allowed domain or is a subdomain of one. localhost only when listed."""
    if any(c in (url or "") for c in ("\\", "\r", "\n", "\t")):
        return False
    try:
        parsed = urlparse((url or "").strip())
        host = (parsed.hostname or "").lower().rstrip(".")
        parsed.port  # reject malformed ports
    except ValueError:
        return False
    if parsed.username is not None or parsed.password is not None or parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").lower().rstrip(".")
    if not host:
        return False
    for entry in allowed_domains:
        d = _host(entry)
        if d and (host == d or host.endswith("." + d)):
            return True
    return False


def _words(action: dict[str, Any]) -> str:
    return " ".join(str(action.get(k) or "") for k in ("reason", "text", "keys", "url"))


def deterministic(action: dict[str, Any], *, current_url: str, screen_text: str,
                  allowed_domains: list[str]) -> GuardVerdict | None:
    """Rules 1–4. Returns None when no rule decides (rule 5 then applies)."""
    kind = str(action.get("type") or "")
    if kind not in KNOWN_TYPES:  # e.g. "shell" — agents never run commands
        return GuardVerdict(verdict="block", reason=f"action type {kind!r} is not allowed")
    words = _words(action)
    # Prohibited downloads cannot become executable through a login/contact approval.
    if kind == "open_url" and EXECUTABLE.search(str(action.get("url") or "")):
        return GuardVerdict(verdict="block", reason="downloading files or executables is not allowed")
    if kind in ("click", "double_click") and DOWNLOAD_TEXT.search(words):
        return GuardVerdict(verdict="block", reason="downloading files or executables is not allowed")
    # 1. domain allowlist
    if kind == "open_url" and not domain_allowed(str(action.get("url") or ""), allowed_domains):
        return GuardVerdict(verdict="block", reason=f"{action.get('url')!r} is outside the allowed domains")
    if kind not in INERT_TYPES and kind != "open_url" and not domain_allowed(current_url, allowed_domains):
        return GuardVerdict(verdict="block", reason="current page is outside the allowed domains")
    if kind == "key" and str(action.get("keys") or "").lower() not in SAFE_KEYS:
        return GuardVerdict(verdict="block", reason="only safe navigation/edit keys are allowed; use open_url for navigation")
    if kind == "type" and re.search(r"(?:https?|file|javascript|data):", str(action.get("text") or ""), re.IGNORECASE):
        return GuardVerdict(verdict="gate", reason="typed URLs require review; use open_url for navigation")
    if kind in INERT_TYPES:
        return GuardVerdict(verdict="allow", reason="no side effects")
    target_url = str(action.get("url") or current_url or "")
    acts = kind in ("click", "double_click", "type") or (kind == "key" and re.search(r"return|enter", str(action.get("keys")), re.IGNORECASE))
    # 2. credentials, login, sign-up, checkout
    if kind == "type":
        text = str(action.get("text") or "")
        if CARD.search(text) or any(p.search(text) for p in PATTERNS):
            return GuardVerdict(verdict="gate", reason="text looks like a credential or card number")
        if re.search(r"\bpassword\b", screen_text or "", re.IGNORECASE) or re.search(r"password|passcode", words, re.IGNORECASE):
            return GuardVerdict(verdict="gate", reason="typing into a password field")
    if acts and (AUTH_URL.search(urlparse(target_url).path or "") or AUTH_TEXT.search(words)):
        return GuardVerdict(verdict="gate", reason="login / sign-up / checkout step needs the founder")
    # 3. contacting a person
    contact_page = bool(CONTACT_URL.search(urlparse(target_url).path or ""))
    if acts and (contact_page or (kind != "type" and CONTACT_TEXT.search(words))):
        return GuardVerdict(verdict="gate", reason="submitting this would contact a person")
    # 4. downloads and executables
    if kind == "open_url" and EXECUTABLE.search(urlparse(str(action.get("url") or "")).path or ""):
        return GuardVerdict(verdict="block", reason="downloading files or executables is not allowed")
    if kind in ("click", "double_click") and DOWNLOAD_TEXT.search(words):
        return GuardVerdict(verdict="block", reason="downloading files or executables is not allowed")
    return None


async def check(action: dict[str, Any], *, current_url: str, screen_text: str, allowed_domains: list[str],
                llm: Any = None, venture_id: str | None = None) -> GuardVerdict:
    verdict = deterministic(action, current_url=current_url, screen_text=screen_text, allowed_domains=allowed_domains)
    if verdict is not None:
        return verdict
    if llm is None:
        return GuardVerdict(verdict="gate", reason="no classifier available")
    prompt = (
        "You are the safety guard for an AI agent using a web browser on behalf of a company. Classify the "
        "proposed action. allow = harmless browsing/reading; gate = needs human approval (logins, sign-ups, "
        "purchases, anything that contacts or posts to a person, sharing data); block = never allowed "
        "(downloads, executables, leaving the allowed domains, anything destructive).\n"
        f"ALLOWED DOMAINS: {', '.join(allowed_domains)}\nCURRENT URL: {current_url}\n"
        f"ACTION: {action}\nVISIBLE TEXT (excerpt): {(screen_text or '')[:1500]}\n"
        'Return ONLY JSON: {"verdict": "allow"|"gate"|"block", "reason": "<= 20 words"}'
    )
    try:
        out, _ = await llm.generate_json("computer_guard", prompt, GuardOut, venture_id=venture_id)
        return GuardVerdict(verdict=out.verdict, reason=out.reason or "classifier")  # type: ignore[attr-defined]
    except Exception as exc:  # noqa: BLE001 - spec: on error → gate
        return GuardVerdict(verdict="gate", reason=f"classifier error: {type(exc).__name__}")
