# LinkedIn marketing metadata verification, 2026-10-25
Read-only GET v3.1/auth_configs?toolkit_slug=linkedin confirmed ENABLED ac_OrHC-UHmyaaq in the existing configured project. No configuration was created.
Read-only GET v3/tools?toolkit_slug=linkedin confirmed:
- LINKEDIN_CREATE_LINKED_IN_POST, version 00000000_00: required author:string (person/organization URN), commentary:string. Optional visibility PUBLIC|CONNECTIONS|LOGGED_IN|CONTAINER, distribution object, lifecycleState string default PUBLISHED, isReshareDisabledByAuthor boolean. Scope w_member_social. Response data.response_data can contain share_id.
- LINKEDIN_GET_MY_INFO: empty object arguments; scopes openid/profile/email; response data.response_dict with author_id derived from sub.
Implementation deliberately supports only verified person URNs and PUBLIC/CONNECTIONS. Organization posting is not enabled. Execution pins user_id and connected_account_id. Global Composio execute allowlist remains GitHub-only; only the dedicated gated publisher may post LinkedIn.
No provider POST, personal browser cookies, paid change, or actual publication was performed during verification. Auth config presence is not proof of connected user consent or working publish permission. Missing consent/schema failures stay blocked, never fabricated.
