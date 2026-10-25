# Verified API evidence — Tanush

2026-10-25, local credentials stored only in ignored `.env`, mode remains explicitly fake by default.

- Gemini Interactions: seed `LLMClient.generate("talk", ...)` completed against the real provider, nonempty output, 4,180 ms. The real `orchestrator.build_plan` used `orchestrate_plan` and returned a valid 12-ticket dependency plan with no validation errors, repair or skeleton fallback. No external company action was executed. [Official Interactions docs](https://ai.google.dev/gemini-api/docs/interactions.md.txt).
- Composio: authenticated read-only `GET /api/v3/connected_accounts` returned 200. An ACTIVE-filtered query found GitHub, Gmail, LinkedIn, Google Calendar and Google Meet connections. This is project metadata, not a venture authorization or execution test. No connection was changed. [Official endpoint](https://docs.composio.dev/reference/v3/api-reference/connected-accounts/getConnectedAccounts).
- ElevenLabs: real `POST /v1/text-to-speech/<public default voice>` using configured `eleven_flash_v2_5`, text “Connected.” returned 200 and 15,089 audio bytes. Audio was discarded after verification. The supplied restricted key rejects user/voice-list/agent-list reads with `missing_permissions`; this is not an invalid-key error. Live call setup will require the corresponding agent permissions and `ELEVENLABS_AGENT_ID` in Karthik's implementation. [Official speech endpoint](https://elevenlabs.io/docs/api-reference/text-to-speech/convert), [agent listing](https://elevenlabs.io/docs/api-reference/agents/list).

These checks validate credentials/provider shapes. They do not claim Ayan's or Karthik's unmerged adapters are implemented on this branch.
