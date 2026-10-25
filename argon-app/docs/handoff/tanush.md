<!-- OWNER: tanush -->
# Tanush — final Lane A merge handoff

This is the authoritative handoff for `techtanush/BuildWithArgon`, branch **`tanush`**. It covers the kernel/company backend, dashboard integration, and the additional treasury/wallet work requested by Tanush. No other branch was checked out or changed, and no frozen contract was edited.

Read this document first, then [contract requests](../contract-requests/tanush.md), [decisions](../decisions/tanush.md), [provider evidence](../verified/tanush.md) and the historical [build log](../build-logs/tanush.md). The source contract remains [WORKORDER_TANUSH.md](../../../WORKORDER_TANUSH.md) and the architecture/team split.

## What landed

| Area | Implemented behavior | Evidence |
|---|---|---|
| Kernel core | Typed API/error envelopes, venture lifecycle/uploads, agents/departments/tickets/runs/artifacts/channels/activity, pagination, optional bearer auth, redacted storage, startup recovery | `test_api_contract.py`, `test_db.py`, `test_db_connection.py` |
| Events | After-commit publication, durable SSE replay/resume, global worldgen events, immediate connection announcement, reconnecting browser client | `test_db.py`, `test_stream.py`, dashboard stream/browser tests |
| Approvals and costs | Atomic decisions/re-entry, clarification/pivot/hire/merge/spend gates, idempotent budget increases, per-call budget preflight, provider-ledger deduplication | `test_gates.py`, `test_ledger.py`, `test_coordination.py` |
| Company orchestration | Required company DAG, exact model-matrix jobs, bounded concurrency/retries/dependencies/cancellation, delegations/handoffs, cited asks, requests/redirects, standups/escalation, department pauses, capability design/hiring | `test_scheduler.py`, `test_handlers.py`, `test_coordination.py`; fake end-to-end and improvement loop |
| Grounded conversation | Fresh bounded context packs, real source snapshots, exact quote/scoping/freshness checks, asynchronous claim checks, durable answers/events, directory/route cards, grounded chat and provider-free gated-action refusals | `test_conversation.py`, `test_checker.py`, `test_context_pack.py`, `test_directory.py` |
| World data and org | Deterministic manifest including approved hires; org reporting lines/runtime matrix; standup trigger/latest with cached audio/browser fallback | `test_manifest.py`, `test_org.py` |
| Dashboard wiring | All required pages including World Lab, runtime badges/Org, Call adapter/fallback, live logs/chat/mentions/threads, approvals/evidence, settings, metrics and portrait fallbacks | Dashboard unit tests and six real browser scenarios |
| Evaluation | Fixed fixture loaded through the real venture initializer, injectable answerer, separate gold scorer, every failure retained, raw reports/DB rows, measured metrics and rolling latency | `test_grounding_eval.py`, `test_metrics.py`, committed grounding reports |
| Treasury | Integer-cent USD proposals, per-payment/day limits, atomic reservations, idempotency, exact approval binding, rejection release; approved proposals remain awaiting a provider | `test_treasury.py`; no payout/charge execution exists |
| Agent wallets | Optional Privy provisioning, one stable external identity per venture/agent, approval-first creation, global capacity reservations, concurrent/retry/cancellation recovery, strict provider response validation | `test_agent_wallets.py`, `test_wallet_provider.py`, `test_wallet_config.py` |

The pasted responsibility checklist is covered: agent “Runs on” badges, reporting lines, channels, mentions, threads, typed delegation/ask/handoff/request/standup/escalation, and the dashboard Call panel. Live ElevenLabs sessions/voice/lip-sync remain Karthik's lane; world C-key handling and Town Hall playback remain Mahin's. Engineering/support handlers use this lane's public coordination toolkit when Ayan merges them. Agents coordinate through typed work actions, rather than invented background chatter.

## Final validation

Final combined `make test`: **339 kernel tests**, frontend typecheck, **91 web tests** passed. **All six browser scenarios** passed against the updated running backend. Scoped fatal-error lint and `git diff --check` passed. Configured-secret scanning and `make ownership WHO=tanush` are required before push, with **zero violations**. Both frozen seed suites remain unchanged. The final build-log entry records the command/environment details; the containing commit is the handoff revision.

A local low-disk condition intermittently affected SQLite test setup. Use unique `--basetemp` paths for simultaneous pytest invocations; pytest's shared retention cleanup can also interfere with concurrent runs. The final full suite is run serially. Do not solve disk issues by deleting another person's cache, assets, database or worktree.

## Live evidence and honest limits

- Real Gemini conversation completed. Real Argon planning produced a valid 12-ticket dependency plan without a repair or skeleton fallback.
- The first real grounding report scored **55% fact/citation accuracy**, with nine provider/schema errors. The follow-up unchanged 20-case benchmark after protocol/cancellation/routing fixes scored **85% fact/citation accuracy**, with three error cases, **2/6 route accuracy**, **55% checker agreement**, and zero matches to the defined fabrication guards. Both reports are kept. These remaining failures are not a passing live-quality claim; the fabrication guard is a limited regex check, not proof of universal truthfulness.
- Reports: [first live](../../evals/results/grounding-20261025T190142661980Z.json), [follow-up live](../../evals/results/grounding-20261025T192423222525Z.json), [fake plumbing](../../evals/results/grounding-20261025T190126204609Z.json). Gold expectations never reach the answerer. Prompts were not tuned to gold facts; the follow-up fixes supply the required schema and preserve the public JSON protocol.
- Real Composio metadata reads succeeded and found active project connections for GitHub, Gmail, LinkedIn, Calendar and Meet. Those connections were not silently bound to ventures, and no external message or post was sent.
- Real ElevenLabs speech generation succeeded. The current key lacks user/voice-list/agent-management read permissions; live-call setup needs the appropriate permissions and an `ELEVENLABS_AGENT_ID`.
- Real Privy provisioning succeeded after the credentials were supplied: the actual HTTP API created one approved CFO wallet and returned the same wallet on retry. Intended network policy is Base Sepolia; mainnet/spending flags stayed false. No wallet funding, signing or transaction occurred. The durable verification venture is `ven_01M5T98JPWFNHTHGV0Q44DV937` in the isolated preview database, with provider wallet `hpkdpniglqzvm3q9jxpm8axp`.
- Real engineering/Antigravity/Deep Research/Cua, world generation/live-round execution, assets and live voice depend on their owning branches. Their seed unavailable/fake paths are retained and labelled. No world score, engineering baseline, cash balance, wallet address or successful payment was invented.

## Merge procedure — designated merge session only

These commands are instructions for the session authorized to work on `main`; they were **not executed by this Lane A session**.

1. Require a clean working tree and green owner checks on each branch. Fetch the latest remote tips; record their SHAs. Merge whole branches, rather than cherry-picking a subset of the Lane A checkpoints.

   ```sh
   rtk git fetch origin
   rtk git status --short
   rtk git checkout main
   rtk git pull --ff-only origin main
   rtk git merge --no-ff origin/tanush -m "merge: tanush"
   rtk git merge --no-ff origin/ayan -m "merge: ayan"
   rtk git merge --no-ff origin/mahin -m "merge: mahin"
   rtk git merge --no-ff origin/karthik -m "merge: karthik"
   ```

2. Resolve shared dependency additions as a union. Preserve each lane's implementations; do not replace Tanush's scheduler/coordination with seed files. Regenerate lockfiles after all dependency additions. This lane added no dependency for wallet provisioning: it uses the existing `httpx` dependency.
3. Review every `docs/contract-requests/*.md`. Apply frozen/shared changes only in this merge session. The remaining Lane A requests are listed below. Run the ownership **audit** after merging; per-person branch ownership checks are not meaningful on the combined branch.
4. Migrations apply automatically on database connection. Back up any useful local database before merging. Keep `schema.sql` frozen. Tanush migrations are `0001_tanush_composio_user_scope.sql`, `0002_tanush_treasury.sql`, `0003_tanush_agent_wallets.sql`; preserve the other lanes' number ranges. Namespaced Composio IDs are `foundry:<venture_id>`.
5. Add credentials only to the ignored local environment. Rebuild assets, regenerate OpenAPI types, run the full suites and provider smoke tests, then rerun the unchanged live grounding benchmark. Keep older reports.
6. Rehearse: create venture/upload → brief/plan → concurrent departments → actual engineering review/QA/merge gate → chat/mentions/asks → world route/talk/call → World Lab recorded curve/live round → treasury approval. For wallet provisioning, approve its integration gate and retry the same agent intent; inspect the provider-returned address.
7. Walk the acceptance criteria and fallback drills. Push the combined branch only after the merge session's checks and review are complete.

### Validation/start commands

From `argon-app/kernel`:

```sh
rtk uv sync --extra dev
rtk uv run pytest -q --basetemp=/tmp/foundry-merge-tests -o tmp_path_retention_policy=failed
rtk uv run uvicorn foundry_kernel.app:app --host 127.0.0.1 --port 18787 --timeout-graceful-shutdown 1
```

From `argon-app/web` in another terminal (pnpm **10.11.0** is used because local pnpm 11 rejects the seed's build-script settings):

```sh
rtk proxy npx --yes pnpm@10.11.0 install
rtk proxy npx --yes pnpm@10.11.0 typecheck
rtk proxy npx --yes pnpm@10.11.0 test
rtk proxy env KERNEL_PORT=18787 npx --yes pnpm@10.11.0 exec vite --config src/api/devServer.config.ts --host 127.0.0.1 --port 15173
```

The owned `src/api/devServer.config.ts` reads `KERNEL_PORT` and `KERNEL_TOKEN` on the server only, forwards bearer auth for HTTP/SSE, and does not expose credentials through `define` or browser environment. It provides a working configuration without changing frozen `vite.config.ts`. The default frozen dev command still targets 8787 until T-CR-02 is applied. Port 8787 on this machine belongs to another service and was not killed. Set `WEB_URL` to the running web address for live world capture.

From `argon-app` / the appropriate project folders after all lanes merge:

```sh
rtk make test
rtk proxy python3 scripts/check_ownership.py --audit
# Kernel folder; live calls incur provider usage, so verify credits first.
rtk uv run python -m foundry_kernel.llm.smoke all
rtk uv run foundry-eval grounding --answerer live --concurrency 4
# Web folder, with the kernel running on the generator's configured port:
rtk proxy npx --yes pnpm@10.11.0 gen:api
rtk proxy npx --yes pnpm@10.11.0 typecheck
```

If using 18787, the frozen `gen:api` script's 8787 URL must be updated in the merge session, or invoke `openapi-typescript http://127.0.0.1:18787/openapi.json -o src/api/schema.d.ts` directly. World asset generation and live capture require the completed Ayan/Mahin/Karthik implementations; follow their handoffs before running those commands.

## Critical integration contracts

- Preserve `Database`/`Tx`, after-commit `bus.emit`, `BROKER`, gate signatures, and `ledger.record/over_budget`.
- Preserve `REGISTRY` type-specific engineering/QA/support handlers. A generated hire must never bypass build/tests/review/QA via a generic document artifact.
- `TrackedLLM.generate_json` delegates to the provider's **public** JSON helper and preserves its tuple/schema. The live adapter must record **every attempt**, including failed JSON and repairs. If it records no model charge, the wrapper can only estimate the final returned result; it explicitly logs that earlier attempt usage may be missing. Tool/TTS rows do not suppress a model charge.
- Directory ranking and asynchronous citation checking use separate runs, preserving the original answer's model, input snapshot and output. Cancelling a conversation/check leaves a durable terminal status rather than a stranded running/pending row.
- Global SSE events must remain global. World Lab uses Ayan's exact `/v1/world/worldgen/*` shapes; a 404 is an empty/unavailable state, never a fabricated generation result.
- Treasury `spend` gates use `payload.purpose="treasury_payment"`; handle these separately from model-budget increases. Their approval must not raise the API budget, pause the venture on rejection, or move money. API-budget pending-gate selectors explicitly exclude treasury gates.
- Wallet `integration` gates use `payload.purpose="agent_wallet_create"` and bind venture, agent, wallet intent, provider and intended network. Approving a gate authorizes the subsequent provisioning retry; the gate decision itself makes no provider call.

## Treasury and wallet scope

### Stripe company treasury

Composio supports [Stripe](https://docs.composio.dev/kb/guide/toolkits-stripe). A toolkit connection is not a funded bank account or an agent's independent legal identity. Holding funds/payouts depends on enabled [Stripe Treasury/Connect](https://docs.stripe.com/treasury/connect) capabilities.

This branch implements `GET /v1/ventures/{vid}/treasury` and `POST .../treasury/proposals`. Amounts are integer USD cents. Defaults are $25 per proposal and $100 per UTC day; pending/approved proposals reserve the allowance atomically. The API returns `available_balance:null` and `status:not_connected` until a verified adapter supplies real account state. An approved proposal ends at `approved_pending_provider`. There is no charge, payout or transfer route. The integration lane must bind a real account, verify exact tool schemas/receipts/idempotency, and retain approvals before adding execution.

### Free-tier Privy agent wallets

Privy's [published Developer tier](https://www.privy.io/pricing) is free at 0–499 MAU, with stated signature/volume allowances. This is a conditional provider tier, not a promise of free mainnet gas or permanent unlimited service. The app defaults to a global 50-wallet provisioning cap, creates no signatures/transactions, and never buys funds, enables a paid plan or sponsors gas. Confirm the chosen Privy app's pricing before providing credentials.

- `GET /v1/ventures/{vid}/wallets` exposes public provisioning state only.
- `POST /v1/ventures/{vid}/agents/{agent_id}/wallet` first requests an integration approval; after approval, retrying the same agent creates/recovers its wallet.
- Privy REST uses fixed HTTPS endpoints, server Basic auth, stable hashed external IDs, and provider idempotency. Ambiguous creation recovers by external-ID lookup instead of creating another wallet. No private key or provider credential is returned to the browser or model.
- EVM addresses are **network-agnostic**. `base-sepolia`/chain 84532 describes this app's intended test usage, not a provider-enforced restriction on an address. This app exposes **no funding, signing, RPC, export, mainnet or transfer method**. Do not send real funds to a prototype address.
- Tests use HTTP mocks and verify exact requests, error recovery, scoping, concurrency, approvals and redaction. After credentials were supplied, one real approval → creation → retry smoke test also passed. The real wallet remains represented in the local preview database; its address was provider-returned, not a fixture.

## Credentials — names only

| Variable | Status / purpose |
|---|---|
| `GEMINI_API_KEY` | Supplied locally; real model/planner probes passed |
| `COMPOSIO_API_KEY` | Supplied locally; metadata reads passed; account binding remains per venture |
| `ELEVENLABS_API_KEY` | Supplied locally; real TTS passed; agent permissions still needed for live calls |
| `ELEVENLABS_AGENT_ID` | Karthik's setup script creates/returns this; not a secret |
| `PRIVY_APP_ID` | Supplied locally; real approved creation/retry passed |
| `PRIVY_APP_SECRET` | Supplied locally, server only; real approved creation/retry passed |
| `WALLET_MODE` | `testnet` by default; `off` disables provisioning |
| `WALLET_MAX_COUNT` | 50 by default; runtime caps provisioning at 50 globally |
| `GITHUB_SANDBOX_TOKEN` | Optional private-repo sandbox access |
| `KERNEL_TOKEN` | Optional local bearer auth; use the owned proxy config |

The ignored `argon-app/.env` is 0600 locally. Do not commit it, paste values into this handoff, put them in `VITE_*`, or send them through an agent prompt. Additional Privy literals, the derived Basic credential and the credential-bundle unlock password are redacted from stored text. No Stripe secret is required for the wallet prototype; Stripe execution is not enabled by this branch.

For Tanush's cross-computer sharing request, [the encrypted credential bundle](../credentials/tanush.md) contains the five supplied provider entries, with tested restoration instructions. AES-256-GCM authentication and a scrypt-derived key protect it; roundtrip, tamper rejection and the documented restore into a fresh environment were verified. Its separate unlock password is `CREDENTIAL_BUNDLE_PASSWORD` in the original ignored `.env`. Tanush must provide that password once to each trusted new machine/session; GitHub alone cannot securely supply both ciphertext and its unlock key. No plaintext credential or unlock password is committed. GitHub Actions secrets were not chosen because they cannot be read back by other coding sessions.

## Remaining merge actions

| Request | Status / action |
|---|---|
| T-CR-01 | Frozen TS venture/gate unions must match SQL/API values |
| T-CR-02 | Owned working proxy adapter is included; optionally adopt it in the frozen default config at merge |
| T-CR-03 | Ayan: Deep Research must be an agent interaction with background polling |
| T-CR-04 | Ayan: approved generated-agent instructions/tools must reach the real engineering executor without removing verification |
| T-CR-05 | Ayan/merge: broader Gmail/LinkedIn/Calendar/Meet/Stripe provider binding and action adapters; provider CHECK migration and allowlisted tools; Higgsfield auth remains unverified |
| T-CR-06 | Runtime standup audio is implemented via an owned response subtype; align the frozen Python type at merge |
| T-CR-07 | Ayan: native structured response format, complete/incomplete status checks, output capacity review and per-attempt accounting. Lane A's helper-bypass/schema bugs are fixed; remaining live failures stay visible |

The latest fetched remote heads of the other three lanes still contained their starter work-order changes at the time of this handoff. Do not assume those implementations have landed merely because their public seed interfaces import successfully. Fetch and read their final handoffs before merge.
