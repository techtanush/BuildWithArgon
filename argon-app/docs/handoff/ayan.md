# Handoff — ayan's lane → the team (Cua cloud computers)

Everything in lane B (models, world loop, live round, engineering loop, integrations) is built and committed on
`ayan` — status, results and merge-time env values are in [`docs/build-logs/ayan.md`](../build-logs/ayan.md) §Handoff.
**The one thing left for a teammate is turning on Cua cloud computers.** The code is done and tested with a fake
computer; what's missing is a booted local sandbox on a real machine (the one-time runtime download kept failing on
our network). Until then `CUA_MODE=off` and every computer-using ticket completes through its fallback (CU-05).

## What already exists (don't rebuild it)

| Piece | File | State |
|---|---|---|
| Cua adapter (only module importing Cua) | `kernel/foundry_kernel/computers/cua_client.py` | Written against the README API; **SDK method names not yet checked against a live sandbox** |
| Lifecycle (one computer per venture+agent, idle stop) | `computers/manager.py` | Tested with `FakeComputer` |
| Computer-use loop (Flash steps, Argon re-plan every 6) | `computers/loop.py` → `run_task(...)` never raises | Tested |
| Guard (allowlist block, login/contact → `computer_action` gate) | `computers/guard.py` | Tested (CU-03) |
| Evidence (screenshots under `data/computers/<task>/<step>.png`) | `computers/evidence.py` | Tested |
| API (`/v1/ventures/{vid}/computers`, `/v1/computers/{id}/screen.png`, `/stop`, `/v1/computer-tasks/{id}`…) | `api/computers.py` | Tested |
| Tests | `tests/test_computer_guard.py`, `tests/ayan/test_computers_loop.py`, `tests/ayan/test_computers_api.py` | Green |

Spec: `architecture-files/02-models-and-integrations/10-cua-cloud-computers.md`. Acceptance: CU-01…CU-05.

## Known facts (verified 2026-10-25)

- Cua CLI 0.9.0 + Lume install fine (`curl -fsSL https://cua.ai/install.sh | sh`; pick **Cua Spaces** if the
  installer asks Spaces vs Driver — Driver is not used).
- **Version pin matters:** `cua-sandbox` 0.9.1 only works with the native `cua` **0.5.0**. `cua` 0.9.0 changed
  `embedded()` and both `cua-sandbox` 0.9.0 and 0.9.1 crash with `TypeError: embedded() got an unexpected keyword
  argument 'fleet'/'fleet_from_env'`. The pin is in `kernel/pyproject.toml`:
  `computers = ["cua==0.5.0", "cua-sandbox==0.9.1"]`.
- With that pair the SDK reaches the local runtime, starts `lume serve` and downloads Colima (OK). It then pulls the
  built-in Linux disk `runtime-gvisor` from
  `https://ghcr.io/v2/trycua/runtime-gvisor/blobs/sha256:0fa448f22f97…` into `~/.cua/runtimes/linux/disk/`. That
  download does **not resume**; on our Wi-Fi it died 3× at 224–477 MB (`error decoding response body`). Use a fast,
  stable connection; it is a one-time download.
- The SDK (0.9.1) has `Sandbox.ephemeral(image, local=True)`, `Sandbox.screenshot()`, `get_dimensions()`,
  `shell.run(...)`, and `check_local_support(image)`.

## Steps (≈ 20 min on a good connection)

```bash
cd argon-app/kernel
uv sync --extra dev --extra computers          # installs the pinned pair
uv run python - <<'EOF'
import asyncio, cua_sandbox as c
async def main():
    async with c.Sandbox.ephemeral(c.Image.linux(), local=True) as sb:
        r = await sb.shell.run("uname -a")
        print("uname:", getattr(r, "stdout", r))
        print("shell result fields:", [n for n in dir(r) if not n.startswith("_")])
        for name in ("mouse", "keyboard", "shell", "screen"):
            o = getattr(sb, name, None)
            if o is not None: print(name, "->", [m for m in dir(o) if not m.startswith("_")])
        png = await sb.screenshot()
        print("screenshot:", type(png).__name__, len(png), await sb.get_dimensions())
asyncio.run(main())
EOF
```
(Save it as a file if your terminal mangles the indentation when pasting.) First run is silent while it downloads.

1. **It prints a `uname:` line** → the sandbox works (CU-01 half). Now align `cua_client.py` with the printed output:
   - `SdkComputer` looks up SDK-native screenshot / click / type / key / scroll at runtime and otherwise falls back to
     `xdotool` + ImageMagick over `shell.run` — map the real `mouse`/`keyboard` method names it printed;
   - fix the shell result field names if they're not `returncode|exit_code`, `stdout`, `stderr`;
   - pass `settings.cua_image` to the image if needed (currently `Image.linux()`).
2. `cd .. && sed -i '' 's/^CUA_MODE=.*/CUA_MODE=sandbox/' .env` (or edit `.env`), restart the kernel (`make kernel`).
3. **CU-01:** a computer starts and returns a screenshot — open the dashboard Computers page or
   `GET /v1/ventures/<vid>/computers` then `/v1/computers/<id>/screen.png`.
4. **CU-02:** run a live venture (Leo's `research.competitors`) and check the artifact has screenshots attached
   (≤ 30 steps). **CU-04:** Computers page shows live screenshots, action log, Stop works.
5. Keep `uv run pytest -q tests/test_computer_guard.py tests/ayan/test_computers_*.py` green; record the confirmed SDK
   shapes in `docs/verified/<you>.md` and the result in your build log.

## If it still won't boot

- `cua doctor` reports what the local runtime is missing.
- Leave `CUA_MODE=off` for the demo. Fallbacks (already wired): competitor/lead research → Antigravity web / Deep
  Research; Ben's visual QA → recorded as skipped, unit + acceptance tests still run; Yuki's repro → test-based. Nothing
  else depends on Cua.
- `spaces` mode is not implemented (raises `CuaUnavailable` → task skipped). Only do it if the "founder takes over the
  desktop" beat is wanted: implement it in `cua_client.create_computer` and set `watch_url`.

## Open items handed over with this (ownership)

`computers/*` and `api/computers.py` are ayan-owned files; whoever does this in the merge session (or on `main` after
the merge) may edit them. Gated computer actions resume through the scheduler — see
[`docs/contract-requests/ayan.md`](../contract-requests/ayan.md) CR-A4.
