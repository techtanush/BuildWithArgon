# Verified API shapes

Every item marked **VERIFY** in the spec, once confirmed: shape, date, source (docs URL, skill,
or live probe output). Per person:

- [`verified/ayan.md`](verified/ayan.md) — Gemini Interactions API (incl. video input), Antigravity, Composio, Cua, Nano Banana
- [`verified/karthik.md`](verified/karthik.md) — Poly Haven / ambientCG APIs, Rocketbox avatar contents, fbx2gltf output, ElevenLabs (TTS with timestamps, voices), Gemini transcribe/TTS, browser MediaRecorder / SpeechRecognition / speechSynthesis
- [`verified/tanush.md`](verified/tanush.md) — anything the kernel core depends on
- [`verified/mahin.md`](verified/mahin.md) — Three.js add-on paths, WebGL/quality details

## Composio connection review (2026-10-25)
Official reference inspected: https://docs.composio.dev/reference/v3/api-reference/connected-accounts/postConnectedAccountsLink and current v3.1 equivalent. Existing supported v3 request is `{auth_config_id, user_id, callback_url}`; response includes `redirect_url`, `connected_account_id`, `expires_at`, `link_token`. Never expose link_token or config credentials. Connection creation remains behind explicit integration approval. UI presents a real user-clicked new-tab anchor with noopener/noreferrer, not async location.assign. Generic toolkit missing auth config remains a clear setup blocker, no automatic creation or paid activation. Tool execution remains GitHub-only. Live read-only GET confirmed configured API key and an enabled managed GitHub config; no provider POST performed during diagnosis.
