# YCBF · You Can Be a Founder

The current YCBF app combines a conventional company dashboard with an optional Three.js workplace, scoped agent conversations, recorded work and artifact notifications, and a searchable Composio toolkit catalog.

## Deploy from this repository

**Read [DEPLOYMENT.md](DEPLOYMENT.md) first.** Import the repository root into Vercel, using `main`. The root workspace, `vercel.json`, and authenticated API gateway are included. The frontend output is `argon-app/web/dist`.

Real hosted sign-in and account creation use Clerk. Configure the documented Clerk keys, authorized frontend origins, backend origin and private kernel token. Missing production auth configuration fails closed; a local display profile is not account authentication.

The Python kernel needs a separate persistent host and data volume. Vercel's static frontend is not a replacement for its scheduler, SQLite/files, provider integrations or computer runtime. A Dockerfile and server environment template are included. No service or paid plan is provisioned by importing this code.

API keys, local databases, existing venture data and runtime credentials are intentionally **not** committed. Transfer private data separately if you need existing ventures on another computer. Legacy ventures need an explicitly configured bootstrap owner in hosted mode.

### Local development

Use Node 22 and the pinned pnpm version in `package.json`:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

See `argon-app/README.md` for the Python kernel and local configuration. Licensed optimized runtime visuals are committed and checked by `argon-app/web/assets-pipeline/runtime-assets.lock.json`; raw archives and conversion caches are not required for the web build.

## Verification and boundaries

The pre-auth integrated UI passed 527 frontend tests, 809 backend tests, TypeScript and production build. The new gateway has separate security tests and hosted tenant tests; see deployment documentation for the latest results and outstanding validation.

Hosted mode deliberately blocks endpoints not yet audited for tenant isolation, including some integration, wallet/provider, world-generation, global metric and unscoped audio operations. **Do not assume hosted feature parity or production-security certification.** Review `argon-app/kernel/GATEWAY_AUTH.md` before hosting real users.

A complete autonomous build/deploy, browser microphone acceptance, and automatic marketing-branch publisher are not claimed verified. Cua remains optional/off for this demo. Card checkout was excluded at the user's request.

## Project sources

- App: [`argon-app/`](argon-app/README.md)
- Deployment: [`DEPLOYMENT.md`](DEPLOYMENT.md)
- Architecture: [`architecture-files/`](architecture-files/README.md)
- Integration/acceptance record: [`argon-app/docs/merge/final-integration.md`](argon-app/docs/merge/final-integration.md)
- Asset attribution: [`argon-app/web/public/assets/CREDITS.md`](argon-app/web/public/assets/CREDITS.md)
