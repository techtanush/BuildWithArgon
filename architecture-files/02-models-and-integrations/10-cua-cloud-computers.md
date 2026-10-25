# 10 — Cloud Computers for Agents (Cua)

> **Hackathon context.** Cloud computers strengthen the managed-agents story (agents that act on
> real desktops, with every step visible and risky steps gated) and Google's "keep people in
> control" judging test. They are P1: if Cua setup threatens the core demo, switch `CUA_MODE=off`.

Some agents need a **real computer**: a desktop with a browser they can see and click, not just an
API. Foundry gives those agents cloud computers through **Cua** — the open-source computer-use
infrastructure at [github.com/trycua/cua](https://github.com/trycua/cua) (MIT for the SDK, Driver
and Lume; Cua Spaces is source-available under FSL-1.1-MIT). Gemini models decide what to do;
Cua provides the computer and the controls.

> Research date 2026-10-25. Parts of Cua's API are not documented publicly (or the docs site was
> unreachable). Everything not quoted from the README is marked **VERIFY**; confirm with
> `cua --help`, the SDK source, or the Cua docs MCP server (`https://vk-mcp.cua.ai/mcp`) and record
> the result in `docs/VERIFIED_API_SHAPES.md`. Only `computers/cua_client.py` touches Cua.

## What Cua provides (from the README)

| Piece | What it is | How Foundry uses it |
|---|---|---|
| **Cua SDK + CLI** (`pip install cua`, `cua` command; Python/TS/Rust) | One API for local VMs, containers and machines running `cua-spacesd` | The kernel creates and drives computers through the Python SDK |
| **Sandboxes** (`cua sb ...`) | gVisor container sandboxes, e.g. `cua sb create ubuntu --name dev`, `cua sb exec dev uname -a`, `cua sb screenshot dev`, `cua sb rm dev` | Default mode: one Linux desktop sandbox per computer-using agent |
| **Cua Spaces** (desktop app) | Full desktops for agents ("Spaces"): macOS VMs on your Mac or Linux images; can run on your Mac, your machines, or **your own Google Cloud / AWS / Modal account**; *Teleport* signed-in apps into a Space; *Multiplayer* shared desktops with per-user cursors | Optional mode: Spaces on the demo Mac or in our Google Cloud project, so the founder can **watch and take over** an agent's desktop |
| **`cua-spacesd`** | In-sandbox daemon on port 3211: processes, files, desktop, streaming (gRPC) | What the SDK talks to inside a Space |
| **Cua Driver** | Lets agents operate native apps/browsers via CLI, MCP or SDK, in the background | Not required; MAY be used for a local "Mac Space" later |
| **Lume** | macOS/Linux VMs on Apple Silicon | Underlies Spaces on the demo Mac |

Verbatim SDK example from the README:

```python
from cua_sandbox import Image, Sandbox

async with Sandbox.ephemeral(Image.linux(), local=True) as sb:
    print((await sb.shell.run("uname -a")).stdout)
```

Install: `curl -fsSL https://cua.ai/install.sh | sh` (CLI) and `pip install cua` (SDK; add to
kernel deps when `CUA_MODE != off`).

## Modes (`CUA_MODE`)

| Mode | Computers are | Needs | Founder can watch | Founder can take over |
|---|---|---|---|---|
| `sandbox` (default) | Cua gVisor Linux sandboxes on the kernel host | Cua CLI/SDK installed; host support for gVisor (VERIFY on macOS — may run inside a VM) | Yes — screenshots in the dashboard | No |
| `spaces` | Cua Spaces (Linux image) on the demo Mac or in our Google Cloud project | Cua Spaces app + `cua auth login` (VERIFY) | Yes — dashboard + Spaces app | Yes — Multiplayer shared desktop |
| `off` | — | — | — | — |

## Which agents get a computer

| Agent | Tasks on the computer | Typical domains (allowlist) |
|---|---|---|
| `mr.competitor-analyst` (Leo) | Visit competitor sites, read pricing/feature pages, screenshot evidence | competitor domains from research + search engine |
| `li.lead-researcher` (Ines) | Browse public company sites and directories for ICP evidence | public sites only; no social networks requiring login |
| `eng.qa` (Ben) | **Visual QA**: open the product preview in a real browser, click through each acceptance flow, screenshot each step | `localhost` preview tunnel / deployed preview only |
| `su.triager` (Yuki) | Reproduce a reported bug by following the repro steps on the preview; attach screenshots | preview only |

All other agents never touch a computer.

## Kernel module `computers/`

```
computers/
  cua_client.py   # ONLY module importing cua: create/get/stop, shell, screenshot, input, open_url
  manager.py      # one computer per (venture, agent); lazy start; idle stop after 10 min
  loop.py         # the computer-use agent loop (below)
  guard.py        # action safety classifier + domain allowlist
  evidence.py     # screenshots -> data/computers/<task_id>/<step>.png, artifact attachments
```

### `cua_client.py` interface

```python
class CuaComputer(Protocol):
    id: str
    async def screenshot(self) -> bytes                     # PNG
    async def click(self, x: int, y: int, button: str = "left", double: bool = False) -> None
    async def type_text(self, text: str) -> None
    async def key(self, keys: str) -> None                  # e.g. "ctrl+l", "Return"
    async def scroll(self, dy: int) -> None
    async def open_url(self, url: str) -> None
    async def shell(self, cmd: str, timeout_s: int = 30) -> tuple[int, str]
    async def stop(self) -> None
```

Implementation strategy (VERIFY each against the SDK):
1. Preferred: SDK-native methods for screenshot/mouse/keyboard if the SDK exposes them.
2. Fallback that only needs the documented `sb.shell.run(...)`: use a Linux desktop image with X11
   and drive it with `xdotool` (`xdotool mousemove X Y click 1`, `xdotool type --delay 20 "..."`,
   `xdotool key ctrl+l`) and capture with `import -window root png:-` (ImageMagick) piped as base64.
   The image must include Xvfb, a lightweight window manager, Chromium, xdotool and ImageMagick;
   build it once (`cua` custom image — VERIFY) or install at first boot with `apt-get` (≈ 60–90 s).
3. Screen size fixed at 1280 × 800 for consistent coordinates.

## The computer-use loop (`computers/loop.py`)

```
input: goal (text), agent, allowed_domains, max_steps (30), success criteria
start: computer = manager.get(venture, agent); open start URL
repeat step = 1..max_steps:
  png = screenshot()
  action = Flash job "computer_step" (screen + goal + plan + last 5 actions)   → JSON action
  verdict = guard(action, current_url, screen_text)                            → allow | gate | block
  if gate:  create approval 'computer_action' (shows screenshot + proposed action); pause task
  if block: record and ask Flash for a different action (max 2), else fail the task
  execute action; record computer_actions row (+ screenshot path)
  every 6 steps, or when Flash returns "stuck": Argon job "computer_plan" (thinking high) reviews
      the last 3 screenshots + history and returns a revised plan
  stop when action.type == "done" (with result) or max_steps reached
output: result JSON + screenshots → artifact (kind per ticket) with meta.screenshots
```

Action schema returned by `computer_step`:

```json
{"type": "click|double_click|type|key|scroll|open_url|wait|done|stuck",
 "x": 640, "y": 412, "text": "...", "keys": "ctrl+l", "dy": -600, "url": "https://...",
 "reason": "<= 20 words", "result": {"...": "only when type == done"}}
```

Model jobs (add to `models.py`):

```python
"computer_step":  Job(FLASH, None, 1_024, timeout_s=30),
"computer_plan":  Job(ARGON, "high", 8_192, timeout_s=600),
"computer_guard": Job(LITE,  None, 256,   timeout_s=10),
```

Image inputs use the same multimodal parts as V2 in the Interactions API doc.

### Guard (`computers/guard.py`)

Rules, checked in order:
1. `open_url` outside `allowed_domains` → **block**.
2. Typing into a password field, any login/sign-up/checkout page, or text that looks like a
   credential/card number → **gate** (`computer_action`). Agents never type real credentials;
   in `spaces` mode the founder can take over the desktop and sign in themselves (Teleport/
   Multiplayer).
3. Submitting forms that contact a person (contact forms, "send", "post", "comment") → **gate**.
4. Downloading or running executables, `shell` commands other than the loop's own capture
   commands → **block**.
5. Otherwise Flash-Lite `computer_guard` classifies `{action, url, visible text excerpt}` as
   `allow|gate|block` with a reason; on error → **gate**.

## Founder visibility and control

- Dashboard **Computers** page: a card per active computer — agent, current task, live screenshot
  (refresh every 1.5 s from `GET /v1/computers/{id}/screen.png`), last 10 actions with reasons,
  **Stop** button; in `spaces` mode a **Take over** button that opens the shared desktop (watch URL
  from Spaces, VERIFY).
- Every action is in `computer_actions`; every task result links its screenshots, so answers that
  cite these artifacts carry visual evidence.
- In the 3D world nothing about computers is shown; in a conversation, if the agent's answer cites
  a computer task, the source card opens that task in the dashboard.

## Fallbacks

`CUA_MODE=off` or a Cua failure (3 in a row) → competitor and lead research fall back to
Antigravity web research / Deep Research; visual QA falls back to the Playwright headless check
(`qa.verify` still runs unit/acceptance tests); bug repro falls back to test-based repro.
