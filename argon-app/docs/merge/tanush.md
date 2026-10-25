<!-- OWNER: tanush -->
# Combined-branch integration runbook

Read this alongside the [Lane A handoff](../handoff/tanush.md). This runbook is for the **designated merge session**; this Lane A session changes and pushes only `tanush`. Tanush has asked that session to finish missing integration work, test the combined product, and leave one clear final handoff. A conflict-free Git merge is only the first checkpoint.

The contract is [the architecture README](../../../architecture-files/README.md), its overview/architecture sections, [team split](../../../architecture-files/06-execution/07-team-split.md), each lane's work order and all four lanes' decisions/contract requests. Resolve disagreements in favor of the spec and record the decision. Preserve frozen seed tests and public signatures; apply justified shared-contract changes in the designated merge session.

## 1. Snapshot: fetch again before using this

Fetched 2026-10-25; reviewed at **20:16 UTC / 13:16 PDT**. These are published remote refs, not a statement about anyone's local progress. The containing documentation commit advances `tanush` beyond the SHA below.

| Ref | Observed SHA | Published state at review |
|---|---|---|
| `origin/main` | `f0384e9` | Frozen seed plus model-matrix/live-voice specifications |
| `origin/tanush` | `be1311d` | A–E backend/dashboard, autonomous USDC payments, evidence and handoff |
| `origin/ayan` | `5d2d31b` | One work-order file differs from main; finished implementation not present in this fetched ref |
| `origin/mahin` | `9324334` | One work-order file differs from main; finished implementation not present in this fetched ref |
| `origin/karthik` | `a425502` | 49 changed files: asset pipeline, browser/kernel voice, tests and per-person documentation |

Read the latest `docs/build-logs/{ayan,mahin,karthik}.md`, `docs/verified/*.md` and `docs/contract-requests/*.md` from their actual fetched refs. Karthik's final handoff is a section in their build log; a separate `docs/handoff/karthik.md` did not exist in this snapshot. Ask for unpublished work to be pushed rather than assuming seed imports prove completion. Do not overwrite a newer implementation with a seed copy. Record the four exact input SHAs in the combined handoff.

## 2. Intended complete engineering workflow

The desired product lets the founder describe a company, then agents plan, write and test working software, inspect it through a real browser, repair defects, review/QA the result, and request approval before merge/deploy. The backend must drive this workflow; a polished dashboard alone is insufficient.

1. Create a venture and explicit acceptance criteria. Argon produces `eng.design` work covering those criteria, with bounded dependencies and the intended agent runtime/model.
2. `eng.build` / `eng.fix` runs the real Antigravity executor or a working local executor. Preserve interaction ID, actual workspace/branch/commit, progress, artifacts, token usage and costs. Approved generated hires must reach this same executor with their approved instructions/tools.
3. Install dependencies and run the generated project's actual build/tests. Capture commands, exit codes and failures. Repair within the spec's iteration limit; exhaustion is an explicit failed/escalated result. A model's statement that tests passed, an invented file list or a `FOUNDRY_RESULT` block is not independent execution evidence.
4. Start a reachable preview. QA clicks the real product using the application Cua adapter when enabled, captures screenshots/actions, compares the result against acceptance criteria, and sends concrete failures back through the fix loop. An explicit headless fallback may be used where specified; it must be labelled as such.
5. Run review and independent QA on the final revision. Require a merge gate bound to the actual output/revision; rejection must prevent publishing/merging. Verify the resulting remote merge, or explicitly record approved local-workspace acceptance when GitHub is unavailable. Apply any separate deploy approval required by the spec.
6. Support reproduces a real issue, opens the fix workflow, and follows the same checks. Do not replace engineering/QA/support with a generic document-producing handler just to complete the company DAG.

Acceptance evidence must connect the same venture/ticket/run to actual code, tests, preview, browser evidence, repair, review, approval and final revision. Lane A's fake company completion tests establish orchestration plumbing, not live engineering completion.

## 3. GitHub via Composio versus sandbox credentials

**Connecting GitHub through Composio can remove the need for a separate sandbox token only when the publishing implementation actually uses Composio's authenticated GitHub tools.** A connection does not automatically give `git` inside Antigravity or a local sandbox credentials.

| Operation/path | Required integration | Proof to collect |
|---|---|---|
| Public repository clone | Anonymous clone can work | Real clone at the requested revision |
| Private repository clone | Tested sandbox credential bridge/token, or an explicitly implemented authorized content-fetch path | Real access to the intended private repository without logging secrets |
| Git push, including to a public repository | Authenticated sandbox Git, or publish through Composio API actions | Actual branch/commit exists remotely; a public repository does not allow anonymous pushes |
| Composio branch/files/PR publishing | Venture-bound approved GitHub connection plus verified action schemas | Actual changed files, branch SHA, PR URL and provider response; no extra PAT needed for this API-only path |
| Local-only engineering | Working workspace/build/preview and approval flow | Real files/tests/preview; label that no remote PR/merge occurred |

**Ayan/merge owner:** choose and implement the path, handle missing auth, and test it. `GITHUB_SANDBOX_TOKEN` is optional depending on that choice; it is neither universally required nor universally redundant. Do not invent a Credentials API bridge or claim its support without checking the current SDK/provider behavior. Restrict access to the intended repository. Keep tokens server-side, redact stored text, and never inject a credential into a prompt, browser bundle, command log or artifact.

## 4. Branch responsibilities and required integration

### Tanush: preserve the backend foundation

Preserve venture APIs, redacted durable storage, transactional after-commit events/SSE replay, exact approvals, ledger/budget checks, scheduler/coordination, grounding/checker, manifest/org/standups, metrics/evals and dashboard adapters. Existing evidence: **423 kernel tests, 98 web tests, typecheck, six browser scenarios**. These are the Lane A counts, not a promised total after all merges.

- Keep `Database`/`Tx`, `bus.emit` after commit, `BROKER`, gates/ledger and the public handler/context signatures compatible with Ayan's implementation. Exercise cancellation, restart recovery, re-entry and duplicate requests in the combined application.
- Keep `REGISTRY`'s frozen seed ticket-type set. Scheduled `wallet.pay` is supplied through the owned `EXTENSION_REGISTRY`; retain both registries and loader behavior. Do not weaken the seed test to add a type or remove payment support when replacing a loader.
- Keep Tanush migrations `0001`–`0004`; other lanes reserve Ayan `0100`–`0199`, Mahin `0200`–`0299`, Karthik `0300`–`0399`. Preserve schema migration order and back up valuable databases first.
- Apply/review [T-CR-01 through T-CR-07](../contract-requests/tanush.md): shared status/gate unions, protected server proxy, Deep Research background interactions, generated-hire executor policy, expanded integrations, standup response type, and native structured output/per-attempt accounting.

### Ayan: real executors, integrations, Cua and World Lab

Read [engineering loop](../../../architecture-files/03-company-kernel/02-autonomous-engineering-loop.md), [managed agents](../../../architecture-files/02-models-and-integrations/03-antigravity-managed-agents.md), [Composio](../../../architecture-files/02-models-and-integrations/04-composio.md) and [Cua](../../../architecture-files/02-models-and-integrations/10-cua-cloud-computers.md).

- Preserve `build_llm_client(settings, db=None)` and `generate`, `generate_json`, `run_agent`, `generate_images`, including `LLMResult.images/audio`, `FakeLLM.script` and fixture/generic-schema behavior. Supply native JSON schema configuration; reject incomplete output; record **every** initial/failed/repair attempt and preflight its API budget. Tool/TTS rows must not suppress model charges.
- Implement real `EngineeringHandler` / QA / `SupportHandler` behavior and the workflow in section 2. Deep Research is an agent interaction with background polling, not an ordinary model string. Keep typed asks/requests/handoffs and pending approvals resumable.
- Implement venture-scoped integration binding using `foundry:<venture_id>`. Existing active project connections must not be silently assigned to every venture. Discover exact provider tools, validate arguments/results, retain real receipts and pass connection/send/post gates. Gmail/LinkedIn/Calendar/Meet are requested capabilities; external sends/public posts require approved recipient/content. Higgsfield remains unverified and optional; unavailable tools must be shown honestly. Stripe proposals alone do not prove money movement.
- Preserve `integrations.github_watch.start/stop(app)` and `computers.manager.start/stop(app)` with safe missing-key behavior. `computers.loop.run_task(...)` returns `ComputerTaskResult`; unavailable computers return `skipped`, not a fake success or an uncaught SDK exception. Ben's QA and Yuki's reproduction should use real evidence where configured.
- Verify host/runtime support before choosing Cua `sandbox`; `spaces` needs its actual CLI/account login. Install the optional computers extra only when used. `CUA_MODE=off` must keep the rest of the product usable. Respect domain/login/contact gates, bound steps, and clean up idle/stopped sessions.
- A remote computer cannot reach a laptop's `127.0.0.1`. Supply an approved reachable preview URL/network route, verify it from that computer, and set `WEB_URL` to the real origin. This coding session's native Computer use for the test-token faucet is **not** application Cua acceptance evidence.
- Implement World Lab's exact `/v1/world/worldgen/latest`, `/runs`, `/runs/{run_id}`, `/files/{path}`, `/live-rounds`, `/live-rounds/{id}` and `/live-rounds/{id}/promote` routes with the prescribed methods/shapes. Emit global `worldgen.progress` with `venture_id=None`. Tanush's dashboard already consumes these contracts; an empty seed router is not a live implementation.
- Generated buildings expose the specified default module and `generatedModules: Partial<Record<string, BuildingModule>>`, plus the registry. Validate, render, capture screenshots/video, critique and patch actual output; store measured score curves and promote the accepted module. Render portraits from approved avatars; do not invent world scores or substitute unrelated headshots for rendered evidence.

### Mahin: world renderer and live company/voice adapters

- Publish the actual world implementation before merge. A local preview or an unpublished worktree is not included by merging the fetched seed ref.
- Use the shared `worldApi` contract for manifest, talk, concierge, TTS/transcription, latest standup and latency. Keep `?mock=1`/offline fixtures explicit. Exercise live `/view?venture=<vid>&goto=<agent_id>`, travel/engagement, route cards/race, source cards and asynchronous answer-check updates. Company status belongs in live conversations, not the 3D geometry.
- Wire Karthik's `startVoiceCall` to C-key conversations; dashboard Call is Tanush's adapter. On `unavailable`, fall back to push-to-talk, then typing on microphone denial. Town Hall consumes real standup content/audio and handles browser fallback honestly.
- Consume Karthik's manifest, material/prop footprints, avatars/FaceSpec, bone/morph metadata and car only when valid. Retain explicit procedural/initials fallbacks for missing assets; do not label them realistic production characters.
- `/view/capture` must expose a usable `window.__foundryProbe` with `setCamera`, `playPath`, readiness, error and result for exterior/interior/portrait modes. `ready:true` with `error:"not implemented"` is a seed placeholder, not capture success. Ayan's screenshot/video/portrait scripts must run against the actual renderer; test performance and dispose render/audio/microphone resources on navigation.

### Karthik: reproducible assets and complete voice lifecycle

At fetched `a425502`, their build-log handoff reports **129 pinned source files**, **128 built binaries**, **16 models**, **13 scanned PBR sets** and **two HDRIs**; source hashes/provenance/credits are committed, binaries intentionally ignored. Their reported lane checks are 54 kernel tests, 60 web tests, typecheck/build; these have not been rerun on the combined branch by this session.

- Run the real asset fetch/build before asset-dependent tests on a clean machine. Preserve lock hashes/licenses and generated manifest; do not commit downloaded binaries. Test the full inventory in Mahin's renderer, not merely metadata parsing.
- **Explicit unfinished work in that handoff:** no production avatars or car in the manifest; FBX conversion/face morph validation blocked. Some prop kinds remain procedural and fidelity/backup-source gaps remain. A WASM sample with damaged morphs is not an approved avatar. Finish a validated converter and visually/runtime-check one avatar before scaling within the download budget; otherwise report the precise fallback and failed acceptance criteria.
- Preserve real timestamp TTS/cache, STT/container bounds, browser fallback, lip-sync and first-sound measurements. Ayan must populate `LLMResult.audio` for Gemini speech fallback. Keep `STT_PRIMARY=browser` until actual English-clip WER/latency acceptance passes.
- Preview the real voice assignment/setup CLIs before applying them; setup requires its approved capability gate. Generate a real `voices.json` and base `ELEVENLABS_AGENT_ID` with account-supported model/overrides. Lane A's existing key passed TTS but lacked voice-list/agent-management permissions; Karthik's published branch had no live credentials/setup evidence. Restore credentials privately and verify permissions rather than assuming live calls are ready.
- Exercise `startVoiceCall`'s `{status,end,setMuted}` contract, session issuance/end, denied mic, cancellation during startup, mute/unmute, interruption, late SDK connection disposal, audible output and route/unmount cleanup. Only short-lived session credentials may reach the browser. Release mic tracks and lip-sync on end.
- The live-call `ask_company` tool must route the correct venture/agent into Tanush's grounded talk/concierge path. Preserve source/citation/check results and navigation cards. The voice provider must not invent company facts outside that path.
- Reconcile K-01 protected-proxy injection with Tanush's already working server-only proxy adapter; implement one consistent default configuration. K-02 requires preserving newer canonical `VoiceSessionInfo` types, not replacing them with older copies.

## 5. Wallet/payment integration must survive the merge

The [wallet handoff/API table](../handoff/tanush.md#privy-agent-wallets-and-autonomous-payments) is authoritative for this extension. Founder creates and funds a wallet with USDC **and ETH on the selected chain**, then approves an exact standing grant once. Agents may then pay allowed recipients within its amount/expiry limits without approval per in-policy transfer. `RuntimeContext.pay`, bounded artifact `payment_requests` and scheduled CFO `wallet.pay` call the same service. Preserve current-run/agent binding and the fake-agent payment block when replacing LLM/handler implementations.

- Base Sepolia is the default; mainnet requires explicit server mode, server authentication and a matching separately approved grant. Do not enable mainnet, buy tokens, activate a paid plan or charge a card as part of merge verification. The supplied Privy app credentials already suffice for this app-controlled wallet path.
- Preserve approval hashes/rechecks, exact request idempotency, atomic reservations, revocation, nonce guards and uncertain-send holds. Do not retry an ambiguous dispatch automatically. A provider hash is `submitted`; canonical transaction/receipt/USDC Transfer proof plus confirmations is needed for `confirmed`.
- Preserve the read-only settlement monitor and recovery API, migrations, SSE events and error/unknown balance states. Model budget, Stripe treasury and USDC grants are distinct budgets/approval purposes. A treasury rejection must not pause the venture or alter model allowance.
- Verified live: one wallet creation/retry and 20 free Base Sepolia test USDC. Last checked ETH was zero. Real funded broadcast/settlement remains unverified; mocked HTTP tests are not a live transfer. Only run a funded live payment when its standing policy and test funds are actually available; record receipt evidence without claiming success early.
- Stripe remains `approved_pending_provider` with unknown balance until a real approved integration supplies account state and executes a validated action. Do not turn that status into `paid` or expose arbitrary signing/bank/card actions while merging.

## 6. Ordered merge and verification

1. Fetch and record remote tips; ensure branch owner checks and logs exist. Use a clean authorized merge checkout and merge whole branches in order **tanush → ayan → mahin → karthik**, as detailed in the [Lane A merge procedure](../handoff/tanush.md#merge-procedure--designated-merge-session-only). If Ayan/Mahin still contain only work orders, the feature work remains required; a no-conflict merge does not implement it.
2. Read all contract requests before resolving shared files. Take the dependency union and regenerate `uv.lock` / `pnpm-lock.yaml`. Keep each owner's implementations, newer canonical voice types, exact endpoint contracts and frozen seed assertions. Consolidate the build logs as required by the team spec. Audit combined ownership rather than running one person's branch check on the union.
3. Back up valuable databases, install/sync dependencies, rebuild ignored assets, then run both full suites plus frontend typecheck/build. Use pnpm **10.11.0** if the host's pnpm 11 rejects the scaffold. Run database migration tests with a fresh DB and an existing seed DB. A local prior test pass is not a combined-branch pass.
4. Restore ignored server credentials through the [encrypted bundle instructions](../credentials/tanush.md); its unlock password must be shared separately once per trusted machine. Never copy example env over an existing populated env. No secret belongs in GitHub plaintext, browser `VITE_*`, prompts or the final handoff. Confirm additional optional auth requirements from the actual selected executor/voice/Cua path.
5. Start kernel/web on free ports with one consistent server proxy, origin and auth configuration. The verified Lane A preview uses backend **18787**, web **15173** because 8787 is occupied locally. Tanush's `web/src/api/devServer.config.ts` handles server-only bearer injection and SSE. Update the default frozen proxy only in the merge checkout. Regenerate OpenAPI types against the **actual** kernel port; frozen `gen:api` targets 8787 until reconciled. Test authenticated HTTP, SSE, voice and capture together.
6. Run provider checks case by case and inspect evidence. **Seed trap:** the seed `llm.smoke` entry point ignores `all` and only runs its basic probe; a successful `python -m foundry_kernel.llm.smoke all` alone does not establish S1–S7. Implement/verify the dispatcher and require named results for all specified cases, including multimodal/video and managed-agent paths. A no-op CLI, empty router or `skipped` computer is not live acceptance.
7. Run section 2 end to end against one bounded real engineering task. Include a deliberate build/UI defect to prove repair, QA independence, gate rejection and approval-bound publishing. Verify GitHub auth using the selected section 3 path. Keep real output evidence tied to the final SHA.
8. Exercise live company chat/coordination, approved hire → exact runtime → real executor, world navigation/talk/source checks, voice fallback/live-call paths, and World Lab capture → video critique → patch → promotion. Rehearse the prescribed live World Lab round twice; keep scores and before/after evidence. Missing photoreal avatars or disabled live calls remain explicit open criteria.
9. Rerun the unchanged live grounding benchmark and retain every raw report. Lane A's latest result is **85% fact/citation accuracy, three errors, 2/6 routing, 55% checker agreement**. Fix schema/incomplete-response and routing/checker issues without leaking gold answers to the model or weakening assertions. These figures are not a passing live-quality claim.
10. Run meaningful failure drills: missing provider keys, rejected/wrong-scope approval, malformed/incomplete JSON, integration outage, Cua off/unreachable preview, mic denial, absent assets/offline world, cancellation/restart/SSE replay, wrong-chain/insufficient wallet funds, unknown transaction receipt and duplicate dispatch. Expected fallback or blocked status must remain explicit; no fabricated success/zero balance/score.
11. Rerun affected checks after fixes, then full suites on the final combined SHA. Inspect diff/secret scans; do not commit env, unlock keys, downloaded assets or unrelated local data. Only the separately authorized merge session pushes its combined branch and updates final merge metadata.

Useful commands, each from the stated directory (use unique test temp paths for concurrent sessions):

```sh
# argon-app/kernel
rtk uv lock
rtk uv sync --extra dev
rtk uv run pytest -q --basetemp=/tmp/foundry-merge-final -o tmp_path_retention_policy=failed
# argon-app/web; build assets before asset-dependent tests
rtk proxy npx --yes pnpm@10.11.0 install
rtk proxy npx --yes pnpm@10.11.0 assets
rtk proxy npx --yes pnpm@10.11.0 typecheck
rtk proxy npx --yes pnpm@10.11.0 test
rtk proxy npx --yes pnpm@10.11.0 build
rtk proxy npx --yes pnpm@10.11.0 exec playwright test
# argon-app
rtk proxy python3 scripts/check_ownership.py --audit
rtk git diff --check
```

Use the actual Playwright server/base-URL configuration; a dashboard-only pass does not replace the world tests. Live provider calls use existing credits and must be bounded; no paid-plan signup or purchase is authorized by this checklist.

## 7. If something is missing, finish it explicitly

The merge session should implement missing cross-branch wiring and required backend behavior in its authorized combined checkout, following the ownership/spec context above. Add a focused regression for consequential fixes, then rerun affected and full checks. Record any necessary shared-contract decision with its exact compatibility impact. Do not silently drop a feature, genericize a handler, disable verification or mark a skipped provider as passed to make the demo green.

Prioritize the real engineering/QA/publish loop, structured output/accounting, grounding and working company APIs; then live-world capture/World Lab and voice/asset integration. External account permissions, unavailable runtimes, missing validated avatars or unfunded testnet gas may remain blockers: state the specific failed requirement, evidence, working fallback and next action. The user asked for no charges; missing access is not authorization to buy a plan or spend real funds.

Finish with a **combined** handoff containing:

- Input branch SHAs and final tested combined SHA, resolved contract requests, migration/dependency/type changes and reproducible start/setup commands.
- A feature matrix with **live verified / automated or mocked only / fallback / blocked**, evidence paths, tested revision and remaining owner/action for each entry.
- Actual backend/web/build/browser/provider/eval results, retained failures and demo steps. Include the complete engineering proof chain and the GitHub auth/publishing path that really worked.
- Wallet chain, grant/funding prerequisites and exact verification limit; optional credential **names/permissions only**, with private restoration instructions.
- Open issues and any unfinished requirements stated plainly. Do not report "ready" for the full product solely because the four Git merges succeeded.


## 25 October combined voice/world integration

See [Karthik + Mahin + Tanush integration handoff](karthik-mahin-tanush.md) for genuine source SHAs, final combined checks, live-provider results, and explicit remaining face/voice/Ayan blockers. This is not authorization to merge main.
