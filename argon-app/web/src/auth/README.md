# Managed account boundary

YCBF uses the official `@clerk/react` 6.18.1 SDK (verified npm package exports and Clerk React quickstart). Sign-in, sign-up, email verification, recovery, profile management and session termination are provider-managed. There is no custom password collection or browser-stored production identity.

Deployment prerequisites:
- Build-time `VITE_CLERK_PUBLISHABLE_KEY` for the intended Clerk application. This is the only Clerk value exposed to the browser.
- Configure the same application's production domain / allowed origins and sign-in `/signin`, sign-up `/signup`, and callback `/auth/callback` as applicable in Clerk.
- Configure server-side Clerk JWT verification and authorized frontend origins in the gateway, per root `DEPLOYMENT.md`. Never put a Clerk secret, KERNEL_TOKEN, or provider credentials in Vite variables.
- Redeploy after build-time configuration changes. Missing frontend config displays a setup-required screen and never mounts protected workspace/world content. Unconfigured auth is not a successful live authentication test.

The managed SDK's standard same-origin `__session` cookie accompanies ordinary `fetch` and `EventSource` requests to the gateway. The gateway must verify it; the client route guard is UX, not an authorization boundary. The root gateway also supports an SDK bearer token. No client-supplied founder name or venture selection is proof of identity.

`/signup/*` goes to `/onboarding` after account creation; `/signin/*` goes to `/dashboard` or a safe same-origin protected deep link. `/account/*` is managed by Clerk; `/signout` ends the provider session. Existing venture URL parameters and workspace selection are preserved.

A local display-profile demo is available only when all are true: Vite DEV, exact loopback hostname, `VITE_ENABLE_LOCAL_DEMO=true`, and an explicit `/demo` submission. It is an in-memory preview session, not persisted authentication, and cannot be enabled in a production build or on a Vercel hostname. Configured Clerk always wins over demo. No runtime process was restarted to enable this option.
