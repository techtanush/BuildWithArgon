# Decisions — tanush

Format: `| ID | Decision | Reason |` rows; IDs `<INITIAL>-NN`.

| ID | Decision | Reason |
| --- | --- | --- |
| T-01 | Follow the team split's per-person log/decision files rather than shared `docs/*.md`. | The original architecture predates the four-lane ownership contract; shared documentation is frozen. |
| T-02 | Use pnpm 10.11.0 for installation and validation in this checkout. | The installed pnpm 11 ignores the seed's `pnpm.onlyBuiltDependencies`; pnpm 10 honors it without editing frozen scaffolding. No dependency versions were changed. |
| T-03 | Read the architecture from `tanush` after verifying it has no differences from `origin/main`. | The user requires all work to stay on `tanush`; reading identical files satisfies the main-spec requirement without switching branches. |
| T-04 | SSE replay reads batches of at most 500 records until caught up. | The spec's 500-record replay bound would otherwise silently omit older events after a long disconnect. Each query remains bounded, while durable replay avoids gaps. |
| T-05 | Use direct file reads and targeted text search here. | `ccc` is uninitialized; its initializer changes `.gitignore`, which is outside this lane's ownership. |
| T-06 | Uploaded PDFs persist only their redacted text extraction, with the original name/MIME/size as metadata. | This enforces redaction for stored text and avoids retaining secrets in PDF metadata or binary streams. Excerpts follow the spec's 12,000-character limit. |
| T-07 | Permit `?last_event_id=` on SSE in addition to `Last-Event-ID` (the header wins). | Browser EventSource cannot set a resume header when a new connection is created for the required exponential backoff. Both paths use the same durable cursor. |
| T-08 | New hires default to `dept_artifact`, as the newer runtime matrix requires; the ticket's engineering/review/QA handler remains mandatory. | The older improvement example names `engineering_build`. Following the new default must never turn a generic document into evidence of a successful build. Live executor integration is requested below. |
| T-09 | Persist approved generated instructions in `kv['agent.design.<id>']`, and load them during prompt composition. | The registration transaction must not leave a hired agent half-configured if a later source-file write fails. The KV record holds the exact approved design and is redacted with the rest of the database. |
| T-10 | Add owned `GET/POST /v1/ventures/{vid}/settings` and `POST /v1/ventures/{vid}/departments/{dept}/resume` routes. | The dashboard spec requires editable settings and ops-pause recovery but the original endpoint table omits their write routes. Budget increases still create spend approvals and leave the cap unchanged until approved. Autopilot/quality preferences live in per-venture `settings_json`, avoiding a frozen Settings change. |
| T-11 | Add `mode: live|fake` to system status. | The dashboard must make fake mode visible so fixture-backed work cannot be mistaken for live provider evidence. |
