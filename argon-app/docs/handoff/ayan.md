# Ayan lane handoff, 25 October 2026

This supersedes the earlier failing-test handoff. Do not merge to main as part of this work.

## Implemented and hardened
- Gemini Interactions client with native JSON schema, multimodal input, retries, accounting, and managed-agent integration. Two current live adapter probes passed: structured JSON and image input. Only `llm/client.py` imports the provider SDK.
- Generation/validation/capture/critic/patch pipeline, World Lab API, cancellable 150-second live rounds, and source-bound promotion. Fake captures or fake-LLM runs cannot publish the served world. Validation and capture cancellation terminate child process groups.
- Real first-pass building renders exposed blocked NPC approaches in growth/pivot and undersized signs. Iteration 1 repairs preserve iteration 0; all 13 repaired modules pass static rules and TypeScript. Render evidence and final registration are recorded under the existing worldgen run.
- 29 actual 768x768 portraits rendered using the exact generated FaceSpecs, with identity/provenance receipts. They use procedural character geometry, NOT photorealistic character assets.
- Engineering/support fix → review → QA chains; dependent builds retain predecessor work. Path/symlink containment, strict exit-code handling, acceptance checks and source-bound approvals. Live untrusted host execution fails closed unless the explicit unsafe development opt-in is set.
- Scoped GitHub approvals, opaque-origin preview sandbox, single-use computer action approvals, actual URL checks, and safe computer unavailability handling.
- Cua pinned-SDK adapters, existing local Spaces attachment without provisioning, scoped watch URL support, and honest failed-Stop handling.
- `/computers` viewer: venture/agent selection, screenshot polling, action history, approval-wait status, confirmed Stop, safe Spaces link, cancellation and staleness/error states. No fake computer state or automatic funding/startup.

## Runtime settings
Secrets belong only in ignored local environment files. No secrets were committed.

```
LLM_MODE=live
WEB_URL=http://127.0.0.1:<real renderer port>
ENGINEERING_EXECUTOR=antigravity
LOCAL_SANDBOX=docker
CUA_MODE=off
# after a successful real runtime check:
# CUA_MODE=sandbox
# or attach an existing LOCAL Space, without provisioning:
# CUA_MODE=spaces
# CUA_SPACE_ID=<existing local space name>
```

Optional existing-provider credentials: `GEMINI_API_KEY`, `GITHUB_SANDBOX_TOKEN`, `COMPOSIO_API_KEY`. Do not create or fund paid services. `ALLOW_UNSANDBOXED_EXECUTION=1` is an explicitly unsafe development-only override, not a sandbox.

## Verification boundaries
- Browser-REPL real renderer captures are authentic screenshots and MediaRecorder recordings of actual `playPath` camera paths. They are not fake fixtures and are not falsely labeled Playwright `recordVideo` output. The native Playwright browser launcher is unavailable in this execution sandbox.
- The renderer/assets come from separate Mahin/Karthik checkouts in an isolated verification copy. Their implementation is NOT merged into this branch. Ayan's renderer-owned seed files remain stubs by ownership.
- Native Cua installation/boot is being verified independently. Do not turn Cua on based only on mocked adapter tests; see the final build-log status.
- Live Argon visual-critique/repair checks have a user-approved $2 estimated usage cap. See the run verification receipt; missing scores remain null, never invented.
- Composio/GitHub live venture integration and a real Antigravity push require the corresponding connected account/token; do not claim those external services are verified by unit tests.
- Spaces watch links expire after about one hour and are refreshed on a new attachment. Stored screenshots remain viewable. Remote cloud provisioning is deliberately not implemented or purchased.

## Integration requests
See `docs/contract-requests/ayan.md`, particularly CR-A8 (explicitly requested computer-viewer route), CR-A9 (generated identities in capture), and the earlier frozen-contract requests. Reuse the named `AgentComputerViewer` widget in Tanush's existing `/computers` route rather than replacing their full dashboard route file.

Final test counts, pushed SHA, real-render totals, live-cost receipt and native Cua status are appended to `docs/build-logs/ayan.md` after final verification.
