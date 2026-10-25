# Root import: Vercel frontend + authenticated gateway + persistent kernel

Import **this repository root** into Vercel. Leave Root Directory at the repository root (blank/default), not `argon-app/web`. Root `vercel.json` selects Vite, installs the pinned pnpm workspace, runs `pnpm build`, publishes `argon-app/web/dist`, and routes `/v1`, `/preview`, `/media` to a Node gateway. Other frontend routes use the SPA. The Python kernel cannot run inside an ephemeral Vercel function.

No cloud service, credentials, or deployment is created by these files. Without real Clerk and kernel configuration, hosted access deliberately fails closed. A successful build is not proof of a running backend or configured authentication.

## Required setup from another computer

1. Clone current `main`. Use Node **22.x**, then `corepack enable` and `corepack prepare pnpm@10.28.2 --activate`. Run `pnpm install --frozen-lockfile`, `pnpm test:gateway`, `pnpm build` from the root. There is one root lockfile. Do not reinstall a separate web lockfile.
2. Create/configure a Clerk application yourself. Enable desired sign-in methods and configure its production domain/redirect origins for the final frontend hostname. Obtain that application's publishable and secret keys. Never commit keys.
3. Run the kernel on a persistent host with HTTPS, a durable `/data` volume, and **one** uvicorn process/replica. See below. Use a long random `KERNEL_TOKEN`, shared only by that kernel and the gateway. Ensure the host runs `AUTH_MODE=gateway`; merely setting the gateway variables is not enough.
4. Import the Git repository root in Vercel. Set these project environment variables for each intended deployment environment, then deploy/rebuild:
   - `VITE_CLERK_PUBLISHABLE_KEY`: Clerk public publishable key, included in the frontend build. This is the only public auth variable.
   - `CLERK_SECRET_KEY`: matching Clerk secret key, server only.
   - `CLERK_AUTHORIZED_PARTIES`: comma-separated **exact** allowed frontend origins, e.g. `https://your-app.vercel.app,https://app.example.com`. No trailing slashes, paths, or wildcard preview domains. Add each deliberately authorized preview origin; unknown origins fail closed.
   - `KERNEL_ORIGIN`: dedicated HTTPS kernel origin, e.g. `https://kernel.example.com`. No path, query, fragment, userinfo or arbitrary client-provided upstream URL.
   - `KERNEL_TOKEN`: exactly the private token configured on the kernel. Never name it `VITE_KERNEL_TOKEN` or put it in browser code.
5. Verify signed-out API calls return 401; sign in using Clerk and create a venture. Test two distinct accounts: one must not see or mutate the other's venture. Verify stream reconnects, uploads and voice against the real hosting configuration before announcing production readiness.

## Authentication and trust boundary

The client calls same-origin URLs. Clerk's official frontend SDK manages sign-in. The gateway accepts a Clerk session JWT from `Authorization: Bearer` (preferred if supplied), otherwise the standard `__session` cookie. The official `@clerk/backend` verifier checks JWT signature/expiry with explicitly configured authorized parties. The gateway also requires an allowed `azp` and valid Clerk `user_…` subject. Invalid JWTs return 401. An invalid bearer token never falls back to a cookie. Cookie-authenticated mutations require a matching `Origin` to prevent cross-site request forgery.

Client-supplied identity headers are rejected (403). Browser credentials, cookies, forwarding metadata, hop-by-hop headers and upstream Set-Cookie are not relayed. Only after authentication does the gateway inject `Authorization: Bearer <KERNEL_TOKEN>` and `x-ycbf-user-id: <verified Clerk subject>`. The kernel must validate both the private token and subject and enforce venture ownership. Keep kernel access behind the host firewall/reverse proxy where possible; never expose a local-mode kernel publicly. TLS must terminate at a trusted proxy; do not disable certificate verification.

The gateway only proxies the three declared route families to its fixed configured origin. It rejects traversal and does not follow upstream redirects. Responses are private/no-store. SSE, `Last-Event-ID`, range requests, binary/audio and multipart request bodies are streamed without JSON re-encoding. Uploaded URLs are not accepted as proxy destinations. No token values are logged by the gateway.

## Persistent kernel container

```sh
# Run from repository root. These commands are instructions, not an activated service.
docker build -t foundry-kernel .
cp deployment/kernel.env.example deployment/kernel.env
# Edit the untracked file: real KERNEL_TOKEN, WEB_URL and desired integration keys.
docker volume create foundry-data
docker run -d --name foundry-kernel --restart unless-stopped \
  --env-file deployment/kernel.env \
  -p 127.0.0.1:8787:8787 -v foundry-data:/data foundry-kernel
```

Put an HTTPS reverse proxy in front of loopback port 8787; set `KERNEL_ORIGIN` to that host's HTTPS origin. Keep `/data` attached across replacements and back up its SQLite database and associated files consistently. The volume must be writable by UID 10001. The image defaults to gateway auth and one worker because scheduler/background jobs and SQLite need process continuity. Healthcheck uses `/health`; it is not proof of configured integrations. Do not run multiple replicas/workers against this SQLite volume. Scale-out requires an explicit shared database/job system design.

Live model/voice/integration features require separately supplied provider keys and may incur charges. They are not activated here. `LLM_MODE=fake` is available for deliberately non-live testing. Container builds exclude credentials and local databases. The cloud-computer extra and external executor tooling are not installed by the base image; such optional integrations need separately provisioned dependencies and explicit operator configuration.

## Limits and local development

The function has `maxDuration: 60`; hosting plan/runtime limits still apply. Upstream idle timeout is 55 seconds. SSE cannot be an unlimited connection on a serverless host: clients must reconnect with their cursor/Last-Event-ID; background work must remain on the persistent kernel. Vercel may impose request/response size limits (commonly 4.5 MB for function payloads) even though the application streams bytes. Validate current plan limits; large uploads/audio need an authenticated direct storage flow rather than assuming this proxy bypasses limits. WebSockets and infinite streams are not supported by this gateway.

Local `pnpm dev` is the existing loopback-only Vite development server, not the production Clerk gateway. A local demo must be explicitly opted into on loopback and must never be hosted on Vercel. For standalone gateway integration tests only, `NODE_ENV=development` plus `ALLOW_LOCAL_KERNEL=true`, with no `VERCEL` environment marker, allows an HTTP loopback kernel. The production gateway has **no** anonymous demo fallback, including when auth configuration is absent. Do not use Vite's local owner-token proxy as a public deployment server.

## Checks

`pnpm test:gateway` exercises missing config, missing/invalid JWT, identity spoofing, origin/CSRF protection, traversal, fixed HTTPS origin configuration, credential/header stripping, binary uploads, SSE chunk streaming and Last-Event-ID forwarding. JWT unit fixtures intentionally stub signature verification; production imports the official verifier, and real Clerk end-to-end verification requires your real keys and domain configuration. Backend tenant tests and frontend auth tests are separate suites. Docker/host and real-provider smoke tests must be run where those services are available.

The root Vercel configuration sets `NODEJS_HELPERS=0` to disable automatic body helpers and preserve the raw Node request stream. Do not override it. Reference: https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration

## Current hosted-mode limits

Read `argon-app/kernel/GATEWAY_AUTH.md`: gateway mode fails closed on routes not yet audited for account ownership. This currently limits integration/provider/wallet operations, unscoped audio, world generation and aggregate metrics. Managed account entry and deployment plumbing do **not** imply that every local operator-only feature is enabled for every signed-in account. Private runtime data and keys must be configured/transferred separately; GitHub does not carry the current local database.
