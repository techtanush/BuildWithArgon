# 05 — Approval Gates

Gates are how the founder stays in control. Each gate is an `approvals` row; the action behind it
runs only when the row is `approved` (`gates.require_approved`).

## Gate catalogue

| `gate_type` | Raised by | When | Payload | Approve → | Reject → |
|---|---|---|---|---|---|
| `clarification` | `oh.skeptic` / `oh.clarifier` (on `review.skeptic`) | Ambiguities with risk ≥ medium | `{"questions":[{"id":"q1","issue":"..","proposed":"..","risk_if_wrong":".."}]}` | Answers (default = proposed) passed to `spec.write` | `spec.write` uses proposed interpretations and notes "founder declined to clarify" |
| `pivot` | `pv.decision-analyst` | Verdict `revise` or `kill` | `{"verdict","reasons":[..],"evidence":[refs],"proposed_revision":".."}` | "Proceed anyway": engineering starts | `revise`: new `brief` (generation+1) with the revision; `kill`: venture `paused` |
| `spend` | `fp.cfo` / ledger | Spent ≥ 100% of budget, or projected > budget | `{"budget_usd","spent_usd","requested_increase_usd","breakdown":[..]}` | Budget raised by requested amount | Venture `paused` |
| `outreach` | `out.outreach-drafter`, `su.triager` | Any message to a real person | `{"channel":"github_comment"|"email_draft","to","subject?","body","url?"}` | GitHub comment posted (email: marked approved; sending not built) | Nothing sent |
| `merge` | `eng.qa` | Verified change ready | see engineering loop §5 | PR squash-merged (or local accept) | PR left open; ticket `done` with note "not merged"; message to `#dept-engineering` |
| `deploy` | (reserved) | Not used in this build (no production deploy) | — | — | — |
| `integration` | API (GitHub connect) | Founder starts GitHub connection | `{"provider":"github","scopes":"Composio-managed"}` | Redirect URL returned | Nothing |
| `new_capability` | `fp.people-ops` | Hiring a generated agent | see improvement loop | Agent registered | Blocked ticket failed |
| `computer_action` | Cua guard (for Leo, Ines, Ben, Yuki) | A computer-use step would log in, sign up, check out, or submit a form that contacts someone | `{"task_id","step","url","action","reason","screenshot_url"}` | Action executes (Spaces: founder may take over instead) | Step skipped; agent finds another way or reports |

## Dashboard behaviour

- Approvals page lists pending gates first, newest first; each card shows title, gate type chip,
  requesting agent (portrait + name), summary, the full payload rendered by type (questions form,
  diff/test summary, reply draft, budget table), and **Approve** / **Reject** buttons plus an
  optional note. Clarification cards render editable answers prefilled with the proposals.
- A badge with the pending count shows in the sidebar and top bar.
- Decisions are immediate (no undo); the card shows who decided and when.

## In the world

Agents never resolve gates. If the founder asks an agent "can you merge it?" the agent answers
from context (e.g., "It's waiting on your approval — it's in the dashboard under Approvals") with a
citation to the approval record. The conversation panel shows a small **"Open in dashboard"** link
for any cited approval (opens the dashboard in a new tab at `/approvals?id=<apr_id>`).

## Expiry

Gates do not expire automatically (`expired` exists for future use).
