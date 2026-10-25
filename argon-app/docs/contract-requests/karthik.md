# Contract requests — karthik

Format: file, exact change (diff), why, who is affected, workaround used meanwhile.

## K-01: Vite server-side bearer injection (merge owner, required with KERNEL_TOKEN)

File: `web/vite.config.ts` (frozen). API contract Auth already requires this, but seed proxy omits it. Exact intended changes:

```diff
 import { defineConfig } from 'vitest/config';
+import { loadEnv } from 'vite';
-export default defineConfig({
+export default defineConfig(({ mode }) => {
+  const token = process.env.KERNEL_TOKEN || loadEnv(mode, '..', '').KERNEL_TOKEN;
+  const kernelHeaders = token ? { Authorization: 'Bearer ' + token } : {};
+  return {
-      '/v1': { target: 'http://127.0.0.1:8787', changeOrigin: true },
+      '/v1': { target: 'http://127.0.0.1:8787', changeOrigin: true, headers: kernelHeaders },
-});
+  };
+});
```

Affects browser voice and all other `/v1` clients. Never put the token into VITE_ variables, client storage or bundled define values. `/media` stays loopback-only so HTMLAudio does not need a bearer. Current local workaround: KERNEL_TOKEN unset and localhost binding. Protected browser mode is **[blocked]** until the merge owner applies this frozen change.

## K-02: Preserve current frozen session types at merge

The existing local Mahin snapshot predates `VoiceSessionInfo` in `web/src/shared/contracts.ts`. No new contract modification requested: retain the newer canonical frozen types already on upstream karthik `d933ab6aee2ef9c81807d7c0dbab3e2f114d42d2`. A temporary integration copy with these canonical contracts plus Mahin's captured world passed TypeScript and 203 unit tests before final lifecycle fixes. Do not replace newer contracts with stale branch copies.

## Other-lane integration actions

Wire `VoiceCall.ts` to the world C key/dashboard Call button. The voice lab exercises it independently. Set WEB_URL to the actual web origin, including port, for the backend origin guard. Character rendering and original character appearances remain Mahin-owned; no renderer files changed here.
