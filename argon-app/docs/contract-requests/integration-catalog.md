# Provider-backed integration catalog
Approved integration scope extension: allow optional Composio toolkit connections beyond GitHub using the existing integration approval gate, exact venture-bound user ID, exact toolkit auth configuration, and provider consent. Agent tool execution remains GitHub-only.

GET /v1/ventures/{vid}/integrations/catalog forwards provider search/cursor/limit to Composio GET /api/v3.1/toolkits. Returns sanitized public name/slug/description/HTTPS logo/auth schemes with provider total_items and next_cursor. Missing provider configuration is an explicit dependency error, not a static fallback catalog.

POST /v1/ventures/{vid}/integrations/{provider}/connect opens or checks a venture/provider/callback-bound approval. Only approved calls may request a provider connect link using an enabled exact-toolkit auth config. Generic flow never creates auth configs. Missing config is explicitly requires configuration. Existing GitHub routes remain first, unchanged in capability.

POST /v1/ventures/{vid}/integrations/{provider}/refresh checks provider account status with exact toolkit and venture user filtering. Pending link never means active connection. Existing global kernel authentication middleware applies.

Migration 0005 preserves all integration rows/columns/FK/unique constraints and timestamps while replacing GitHub-only provider restriction with a bounded lowercase toolkit slug constraint. Normal transactional migration runner applies once; no API auth bypass or provider-writing migration.

Provider docs verified: https://docs.composio.dev/reference/api-reference/toolkits/get-toolkits
Live read-only verification: 1655 total apps; real logos; cursor page two; search github yields 7 matches including github. No provider writes in QA. No paid plan changes.
