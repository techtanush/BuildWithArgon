# 02 — Gemini Interactions API Client (`llm/client.py`)

`foundry_kernel/llm/client.py` is the **only** module that imports `google.genai`. Everything else
calls `LLMClient`. This isolates every VERIFY item in one file.

## Step 0 (T+0): install the official Gemini API skills for your coding agent

From Google's guide — run in `argon-app/` so the coding agent writes current Argon/Interactions code:

```bash
npx skills add google-gemini/gemini-skills --skill gemini-api-dev
npx skills add google-gemini/gemini-skills --skill gemini-live-api-dev
agy plugin install https://github.com/google-gemini/gemini-skills   # only if using Antigravity CLI
```

Then read the installed `gemini-api-dev` skill and confirm the shapes marked VERIFY below. Write
what you confirm into `docs/VERIFIED_API_SHAPES.md`.

## What the guide confirms (copy these patterns exactly)

**Basic call** (Interactions API, `google-genai` ≥ 2.3.0, key from `GEMINI_API_KEY` env var):

```python
from google import genai
client = genai.Client()
interaction = client.interactions.create(
    model="gemini-4-argon",
    input="...",
    generation_config={"thinking_level": "medium"},   # "low" | "medium" | "high"
)
print(interaction.output_text)
```

**Long decode** (> 65,536 output tokens):

```python
interaction = client.interactions.create(
    model="gemini-4-argon",
    input="...",
    background=True,
    generation_config={"max_output_tokens": 262144, "thinking_level": "high"},
)
while interaction.status in ("in_progress", "queued"):
    time.sleep(5)
    interaction = client.interactions.get(id=interaction.id)
print(interaction.output_text)
```

**Managed agent (Antigravity):**

```python
interaction = client.interactions.create(
    agent="antigravity-preview-09-2026",
    agent_config={"type": "antigravity", "model": "gemini-4-argon"},
    input="...",
    environment="remote",
)
```

Also from the guide: server-side state via `previous_interaction_id`; credentials via
`client.credentials.create`; sandbox network allowlist via
`environment={"type": "remote", "network": {"allowlist": [...]}}`; increase HTTP timeouts to
15–20 minutes for `"high"` thinking or use `background=True`; implicit caching is automatic.

## VERIFY list (confirm on the day; adapt only inside `client.py`)

| # | Question | Assumed default in this spec |
|---|---|---|
| V1 | How to pass a system instruction | Prepend to `input` as `"### SYSTEM\n...\n\n### TASK\n..."` |
| V2 | Multimodal input (images, audio) format for `input` | A list of parts: `[{"type":"text","text":..}, {"type":"image","mime_type":"image/png","data":<base64>}]` |
| V3 | Structured JSON output parameter | Not used; JSON requested in prompt + parsed by `jsonout.py` |
| V4 | Usage fields on the interaction (tokens in/out, cached) | `interaction.usage` with `input_tokens`, `output_tokens`, `cached_tokens`; else estimate chars/4 |
| V5 | Does `background=True` work with `agent=` (Antigravity)? | Yes; poll with `client.interactions.get` |
| V6 | How image outputs are returned (Nano Banana) | Output parts with `inline_data` / base64 + mime; helper `extract_images()` |
| V7 | `previous_interaction_id` parameter placement | Top-level kwarg on `interactions.create` |
| V8 | Credentials API signature | `client.credentials.create(name=..., value=..., ...)` returns an id referenced in `environment` |
| V9 | Async client | Not assumed; sync client wrapped with `asyncio.to_thread` |
| V10 | Whether Flash / Flash-Lite accept `thinking_level` | Not sent for non-Argon models |
| V11 | Deep Research invocation | `interactions.create(agent="deep-research-preview-04-2026", input=..., background=True)` |
| V12 | Audio input for `gemini-3.5-transcribe` | Same parts list as V2 with `{"type":"audio","mime_type":"audio/webm","data":..}` |

## Client interface

```python
@dataclass
class Part:
    kind: Literal["text", "image", "audio"]
    text: str | None = None
    data: bytes | None = None
    mime: str | None = None

@dataclass
class LLMResult:
    text: str
    interaction_id: str | None
    model: str
    tokens_in: int
    tokens_out: int
    cached_in: int
    cost_usd: float
    estimated_cost: bool
    latency_ms: int
    raw_status: str
    images: list[tuple[bytes, str]]   # (bytes, mime) — image jobs only

class LLMClient:
    def __init__(self, settings: Settings, db: Database, fake: "FakeLLM | None" = None): ...

    async def generate(self, job: str, prompt: str | list[Part], *, system: str | None = None,
                       previous_interaction_id: str | None = None,
                       run_id: str | None = None, venture_id: str | None = None,
                       agent_id: str | None = None, department_id: str | None = None,
                       on_progress: Callable[[str], Awaitable[None]] | None = None) -> LLMResult:
        """Routes to _call_sync (normal) or _call_background (Job.background=True)."""

    async def generate_json(self, job: str, prompt: str | list[Part], schema: type[BaseModel],
                            **kw) -> tuple[BaseModel, LLMResult]:
        """generate(); parse with jsonout.parse_model(schema). On failure, one repair call:
        'Your previous output was not valid JSON for this schema: <schema json>. Return ONLY the
        corrected JSON.' with previous_interaction_id set. Second failure -> raise LLMOutputError."""

    async def run_agent(self, *, agent: str, agent_config: dict, prompt: str,
                        environment: str | dict, run_id: str | None = None,
                        venture_id: str | None = None, background: bool = True,
                        on_progress=None) -> LLMResult: ...

    async def generate_images(self, job: str, prompt: str, n: int = 1,
                              reference_images: list[Part] = []) -> LLMResult: ...
```

## Behaviour requirements

1. **Model resolution:** `Job = models.job(job)`. `generation_config` includes `thinking_level`
   only when `Job.model == "gemini-4-argon"` and `Job.thinking_level` is set; includes
   `max_output_tokens` when set. Never include deprecated params.
2. **System prompt (V1 default):**
   `input = f"### SYSTEM\n{system}\n\n### TASK\n{prompt}"` for text; for part lists, prepend a
   text part with the system block.
3. **Background polling:** poll every `LONG_DECODE_POLL_SECONDS` (default 5). Every 30 s call
   `on_progress(f"long decode running {elapsed}s")`. Abort after `LONG_DECODE_MAX_MINUTES`
   (default 45): mark run failed with `timeout`.
4. **HTTP timeout:** `Job.timeout_s` for sync calls; for Argon `high` sync calls use 1200 s
   (guide: 15–20 min). Configure via the SDK's HTTP options (VERIFY exact option name; fallback:
   run the sync call in a thread with `asyncio.wait_for`).
5. **Retries:** on HTTP 429/500/502/503/504 or connection errors: retry up to 4 times with
   2, 4, 8, 16 s backoff (+ jitter ±20%). No retry on 400/401/403/404.
6. **Accounting:** after every call, insert a `ledger` row (`kind='model'`) and, if `run_id` is
   given, update the run's `tokens_in/out`, `cost_usd`, `interaction_id`, `model`. Emit
   `ledger.updated`. Update `ventures.spent_usd`.
7. **Logging:** write `run_logs` lines: `"→ <job> model=<m> thinking=<t> chars_in=<n>"`,
   `"← <job> tokens_in=<n> tokens_out=<n> <ms>ms"`. Never log the full prompt (store prompts for
   worldgen/eval in their data folders instead).
8. **Redaction:** outputs pass through `redact()` before storage.
9. **Fake mode:** when `LLM_MODE=fake` (tests, offline UI work) `FakeLLM` returns deterministic
   canned outputs per job from `kernel/tests/fixtures/fake_llm/<job>.json` (a list; cycles), with
   realistic token counts. The whole UI must be explorable in fake mode.
10. **Health:** record `kv['provider.gemini.last_ok_at']` / `last_error` for `/v1/system/status`.

## `jsonout.py`

```python
def extract_json(text: str) -> Any:
    """1) strip ```json fences; 2) try json.loads on whole text; 3) find the first '{' or '['
    and the matching last '}' or ']' and json.loads that slice; 4) raise ValueError."""

def parse_model(text: str, schema: type[T]) -> T:
    return schema.model_validate(extract_json(text))
```

## Smoke tests for this module (run at T+0:30; record results in `docs/BUILD_LOG.md`)

| ID | Command | Pass |
|---|---|---|
| S1 | `uv run python -m foundry_kernel.llm.smoke basic` | Argon returns text for "Reply with OK" in < 30 s |
| S2 | `uv run python -m foundry_kernel.llm.smoke json` | `generate_json` returns a valid `{"ok": true}` model |
| S3 | `uv run python -m foundry_kernel.llm.smoke long` | background call with `max_output_tokens=100000` producing ≥ 70k tokens of a numbered list completes; record minutes elapsed |
| S4 | `uv run python -m foundry_kernel.llm.smoke image` | Argon describes a PNG (V2 confirmed) |
| S5 | `uv run python -m foundry_kernel.llm.smoke audio` | transcribe a 4 s WAV fixture (V12 confirmed) — decides STT path |
| S6 | `uv run python -m foundry_kernel.llm.smoke agent` | Antigravity agent runs `echo hello` in its sandbox and reports output |
| S7 | `uv run python -m foundry_kernel.llm.smoke banana` | one 1024×1024 PNG saved (V6 confirmed) |

`llm/smoke.py` implements these subcommands. Each prints PASS/FAIL, latency, tokens.
