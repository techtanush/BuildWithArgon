# Gateway authentication and tenant boundary

Deploy the kernel with `AUTH_MODE=gateway` and a nonempty private `KERNEL_TOKEN`.
Default `AUTH_MODE=local` preserves the existing local/preview contract; it is not
safe for a public shared installation. Gateway mode refuses startup without its
secret. The root server must verify the Clerk JWT signature, issuer, audience /
authorized party and expiry, discard all client identity assertions, then send:

- `Authorization: Bearer <private KERNEL_TOKEN>` (never exposed to browser)
- `x-ycbf-user-id: <verified JWT sub>` (exactly one header)

The kernel accepts subject format `[A-Za-z0-9][A-Za-z0-9_.:@|-]{0,254}` only.
A subject without the private bearer never grants access. `/health` is public;
every other gateway path requires both credentials. Unknown paths/methods fail
closed, including docs/openapi. The kernel does not itself verify Clerk JWTs.

Migration `0102_gateway_tenant_ownership.sql` only adds nullable owner_user_id and
an index; no row replacement, first-user claiming, or foreign-key rebuild.
New gateway ventures bind the trusted request principal, ignoring body owner IDs.
Listing is owner-filtered before cursor pagination. Existing NULL owners are
private unless an operator explicitly sets `BOOTSTRAP_OWNER_SUBJECT` to a known
subject; that exception never rewrites legacy rows or lets other users see them.

## Route audit

The exact method/path allowlist is `foundry_kernel/tenant_auth.py:ALLOWED`.
Audited: all modules in `api.ROUTERS`, plus player_avatar, voice_fast, treasury,
agent_wallets and wallet_payments appended in create_app. Allowed venture paths
check ownership first. Unprefixed tickets, runs/logs, artifacts, approvals,
channels/messages, answers, computers/tasks/screens, preview paths and voice
sessions resolve their database venture. Agent references may use the global
roster only; private agents must share the request venture. Query venture,
ticket/run/agent/message/answer references are checked, including duplicate query
keys. Voice session JSON cannot choose another owner's venture, and session end
checks the persisted session owner and answer IDs. Bounded reference-bearing JSON
is replayed through Starlette, with regression coverage. Authorization never
logs bodies, reads credentials/upload/talk bodies, or returns submitted values.

Explicitly blocked in gateway mode pending additional design/audit:
- Global evals, telemetry, worldgen and raw worldgen files.
- System writes remain blocked. GET /v1/system/status is an explicit bootstrap
  exception exposing provider configured booleans, configured executor and mode
  only; global run IDs/scores/timestamps and operator overrides are suppressed.
- Venture metrics, which currently embed global latency/eval data.
- Unscoped audio media cache, TTS and STT (cache has no tenant ownership model).
- Integration/provider operations, treasury/wallet routes.
- Generic POST ticket creation (arbitrary payload dispatch needs a separate audit).
- Any future root/server/Privy secret configuration route. Per-venture settings
  only change founder/budget/autopilot/quality and remain ownership-checked.

This is not a comprehensive SaaS security certification. Per-account quotas,
rate limiting, signup abuse protection, global spend caps, provider reservation
accounting, background-worker isolation and complete indirect/LLM tool access
audit are NOT implemented by this patch. Existing per-venture budgets are not a
public-signup abuse barrier. Keep fake providers or restricted/invite-only access
until those controls are implemented. No live database or provider was changed
for validation; all tests use temporary data.
