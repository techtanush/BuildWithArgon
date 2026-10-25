# 09 — Environment Variables and API Keys

Copy [`../templates/env.example`](../templates/env.example) to `argon-app/.env.example` and to
`argon-app/.env`; fill in `.env`. `config.py` loads `../.env` relative to `kernel/`.

## Keys to obtain before T+0

| Key | Where | Needed for | Without it |
|---|---|---|---|
| `GEMINI_API_KEY` | Google team at kickoff (pre-provisioned account / credits) or AI Studio → API keys | Every model call | Run in `LLM_MODE=fake` (UI only) |
| `COMPOSIO_API_KEY` | composio.dev → project → Settings → API keys | GitHub connection, repos, PRs, issues | No-GitHub mode (local builds) |
| `GITHUB_SANDBOX_TOKEN` | github.com → Settings → Developer settings → Fine-grained tokens. Repository access: all repos of the account used for ventures (or create repos first); permissions: Contents RW, Pull requests RW, Metadata R | Antigravity sandboxes pushing branches | Executor falls back to local |
| `ELEVENLABS_API_KEY` | elevenlabs.io → Profile → API keys | Agent voices + lip-sync timestamps | Gemini TTS → browser speech |
| Cua CLI/SDK (no key for local sandboxes) | `curl -fsSL https://cua.ai/install.sh \| sh`; `uv sync --extra computers`; for Spaces: install the Cua Spaces app and run `cua auth login` (VERIFY) | Cloud computers for Leo, Ines, Ben, Yuki | `CUA_MODE=off` fallbacks |

## Full variable list

| Variable | Default | Description |
|---|---|---|
| `KERNEL_HOST` | `127.0.0.1` | Bind address (never 0.0.0.0) |
| `KERNEL_PORT` | `8787` | |
| `KERNEL_TOKEN` | *(empty)* | If set, required as bearer on `/v1/*` |
| `DATA_DIR` | `../data` | Relative to `kernel/` |
| `WEB_PUBLIC_DIR` | `../web/public` | Where generated assets go |
| `LLM_MODE` | `live` | `live` or `fake` |
| `GEMINI_API_KEY` | — | Read by `google-genai` automatically |
| `LONG_DECODE_POLL_SECONDS` | `5` | |
| `LONG_DECODE_MAX_MINUTES` | `45` | |
| `ENGINEERING_EXECUTOR` | `antigravity` | `antigravity` or `local` |
| `ANTIGRAVITY_AGENT` | `antigravity-preview-09-2026` | |
| `MAX_BUILD_ITERATIONS` | `6` | Repair loop cap per ticket attempt |
| `LOCAL_SANDBOX` | `subprocess` | `subprocess` or `docker` |
| `LOCAL_TEST_TIMEOUT_SECONDS` | `180` | |
| `SCHEDULER_TICK_SECONDS` | `1.0` | |
| `SCHEDULER_CONCURRENCY` | `4` | Global concurrent tickets |
| `TICKET_TIMEOUT_SECONDS` | `1800` | |
| `ENG_TICKET_TIMEOUT_SECONDS` | `3600` | |
| `DEFAULT_BUDGET_USD` | `25` | Per venture |
| `COMPOSIO_API_KEY` | — | |
| `COMPOSIO_BASE_URL` | `https://backend.composio.dev/api/` | |
| `GITHUB_SANDBOX_TOKEN` | — | Only given to Antigravity via Credentials API |
| `GITHUB_POLL_SECONDS` | `60` | Support loop |
| `ELEVENLABS_API_KEY` | — | |
| `ELEVENLABS_MODEL_ID` | `eleven_flash_v2_5` | |
| `ELEVENLABS_OUTPUT_FORMAT` | `mp3_44100_128` | |
| `TTS_MAX_CHARS` | `600` | |
| `STT_PRIMARY` | `browser` | Set to `gemini` if smoke test S5 passes |
| `CHECKER_MODEL_CHECK` | `true` | Async model-based citation check |
| `STANDUP_MINUTES` | `30` | Standup cadence while a venture is active |
| `ESCALATE_MINUTES` | `20` | Blocked time before escalating to the Chief of Staff |
| `CUA_MODE` | `sandbox` | `sandbox`, `spaces` or `off` (cloud computers) |
| `CUA_IMAGE` | `ubuntu` | Desktop image name for sandboxes (VERIFY available images) |
| `CUA_MAX_STEPS` | `30` | Max computer-use steps per task |
| `CUA_IDLE_STOP_MINUTES` | `10` | Stop idle computers |
| `SLACK_MIRROR_CHANNEL` | *(empty)* | Optional Slack channel for the one-way mirror (via Composio) |
| `PRICE_<MODEL>_IN` / `_OUT` | — | Optional USD per 1M tokens overrides |

Web (`argon-app/web/.env`, **no secrets**):

| Variable | Default | Description |
|---|---|---|
| `VITE_DEFAULT_QUALITY` | `auto` | `high`, `medium`, `low`, `auto` |
| `VITE_SHOW_FPS` | `false` | FPS counter in the world |

## Startup check

`app.py` lifespan logs a table of which providers are configured (never the values) and stores it
for `/v1/system/status`. Missing keys never crash startup; the affected features degrade as listed.
