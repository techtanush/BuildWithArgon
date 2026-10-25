# 03 — Continuous Upkeep: Support Issues and PR Feedback

After the first build ships, the company keeps working: new GitHub issues and PR comments become
tickets automatically, and engineering fixes them through the same loop — the founder only
approves merges and public replies.

## Sources

| Source | Detected by | Ticket |
|---|---|---|
| New GitHub issue in the venture repo | `github_watch.py` (every 60 s, see Composio doc) | `support.issue` |
| Human comment on an open Foundry PR | `github_watch.py` | `eng.fix` (payload `{pr_number, comment, url}`) |
| Founder posts a bug in `#all-hands` or `#dept-support` mentioning `@su.triager` | chat handler | `chat.reply` → may create `support.issue` |
| Founder creates a ticket in the dashboard (type `support.issue`) | API | `support.issue` |

## `support.issue` handler (Yuki — Flash-Lite `triage`)

Input: issue title/body/labels/author, product summary (latest `spec` + `plan` artifacts, titles of
recent merged builds). Output JSON:

```json
{"category":"bug"|"question"|"feature_request"|"duplicate"|"spam",
 "severity":"critical"|"high"|"medium"|"low",
 "summary":"one line",
 "repro_steps":["..."],
 "suspected_area":"src/...",
 "reply_draft":"Thanks for reporting ... (≤ 120 words, no promises about dates)",
 "duplicate_of": null}
```

Then:
- `bug` → create `eng.fix` (department engineering, priority 0 if critical/high else 1) with payload
  `{issue_number, summary, repro_steps, suspected_area}`; body includes the issue text.
- `feature_request` → message to `#exec` with refs; `cos.orchestrator` considers it in the next
  `cos.report`.
- `question` → reply draft only.
- Any category with a reply draft → approval `outreach` titled "Reply to issue #N" with payload
  `{issue_number, url, reply_draft}`. On approve → `composio.create_issue_comment` (gated). On
  reject → nothing is posted.
- Artifact `doc` (triage) + message to `#dept-support`.

## `eng.fix`

Same executor as `eng.build` with `mode="fix"` and `fix_context` = failures, review comments, or
issue repro. The fix branch is new (`foundry/<tid8>-fix-<slug>`); a new PR references the issue
("Fixes #N") so merging closes it. Then `eng.review` → `qa.verify` → `merge` gate as usual.

## Loop protection

- One open `eng.fix` per issue number (dedupe by payload `issue_number`).
- If the same issue produces 3 failed `eng.fix` tickets → stop creating fixes, post to `#incidents`,
  assign to `eng.tech-lead` for a design-level look (`eng.design` ticket with the history).
