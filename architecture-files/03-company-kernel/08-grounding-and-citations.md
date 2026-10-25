# 08 — Grounding, Citations and the Checker

Every answer an agent gives in the world (or in chat) is built only from records the kernel hands
it, cites those records, and is checked. This is what makes conversations with the company
trustworthy.

## 1. Context pack (`conversation/context_pack.py`)

`build_context_pack(venture_id, agent_id, question) -> ContextPack` assembles **fresh** records
(queried at call time) into a numbered list. Budget: ≤ 24 records, ≤ 30,000 characters total.

Selection, in order (stop when budget reached):
1. The agent itself (row) and its department (row).
2. The agent's current ticket (if any) and its latest run (status, last 20 log lines).
3. The agent's last 5 tickets (any status) with `result_json` summaries.
4. The last 5 artifacts by the agent or its department (title, summary, first 1,500 chars of
   `content_md`, `uri`).
5. Pending approvals requested by the agent or its department.
6. The last 10 messages in `dept-<department>`, the last 5 messages authored by the agent in any
   channel, and any message mentioning the agent.
7. Records whose text matches the question keywords (simple scoring: lowercase tokens ≥ 4 chars,
   stopwords removed; score = count of matched tokens in title×3 + body), across tickets,
   artifacts, approvals, messages of the venture — top 5 not already included.
8. Venture summary (name, idea, status, budget/spent).

Each record is rendered as:

```
[R7] kind=artifact id=art_01JB... title="Pricing research" created=2026-10-26T14:02Z
summary: ...
text: ...(truncated)...
```

`ContextPack` keeps `records: list[{"ref":"R7","kind","id","title","text"}]` for verification.

## 2. Talk prompt (`conversation/talk.py`, job `talk`)

System:

```text
You are {display_name}, {title} at Foundry ({department_name}). Persona: {persona}
You are talking face to face with the founder, {founder_name}, inside the company town.
Answer ONLY from the RECORDS below. Speak naturally in the first person, 1–4 short sentences
(this will be spoken aloud). Do not read out IDs.
If the records don't contain the answer, say you don't know and, if another agent is more likely
to know (see DIRECTORY), suggest them.
Never claim to have done something the records don't show. Never take actions; if asked to
approve/merge/send/spend, explain it needs the founder's approval in the dashboard.
Return ONLY JSON:
{"text":"what you say",
 "citations":[{"ref":"R7","quote":"<exact short substring (≤ 160 chars) copied from that record>"}],
 "suggested_agent_id": null | "<agent id from DIRECTORY>",
 "suggest_reason": null | "<why>"}
Every factual sentence must be supported by at least one citation.
RECORDS:
{rendered records}
DIRECTORY (other agents, one line each: id — name, title, department, what they own):
{directory lines}
CONVERSATION SO FAR:
{last 6 turns}
```

User content: the founder's question.

Post-processing: map `ref` → `{kind, id, label}`; drop citations whose ref doesn't exist (and
record that in the check).

## 3. Concierge (`conversation/concierge.py`)

Same as talk, with persona from `roster.json` and two differences:
1. Its RECORDS are company-wide: venture summary; per-department one-line status (counts by
   status, latest artifact title); pending approvals; last 10 `all-hands`/`exec` messages; and the
   top 8 keyword-matched records across the venture.
2. Before answering, the kernel runs `directory_search(question)` and includes the top 5 candidate
   agents (with why they match) in the prompt. The JSON adds:
   `"route": null | {"agent_id": "..", "reason": ".."}`.

`directory.py`:
- Index (rebuilt every 60 s or on `artifact.created`): for each agent: name, title, role_summary,
  capabilities, department name+mission, titles of its last 10 tickets and artifacts.
- `directory_search(q)`: keyword score (same tokenizer) → top 10 → Flash-Lite `route_rank`
  ("Which of these agents is best to answer: {q}? Return JSON {"ranking":[agent_id...],"reason":..}")
  → top 5. If Flash-Lite fails, use keyword order.

When `route` is present and the agent exists, the API builds `route_card` (see API contract) with
building info from the manifest.

## 4. Checker (`conversation/checker.py`)

### Deterministic stage (synchronous, < 10 ms)
For each citation:
- `ref_exists`: the ref is in the pack → else `unsupported` ("unknown source").
- `quote_match`: normalize both (lowercase, collapse whitespace, strip punctuation at ends);
  the quote must be a substring of the record text → else `partial` ("quote not found verbatim").
- `fresh`: the record still exists in the DB (re-fetch by id) → else `unsupported`.
Answer-level: if the answer has ≥ 1 factual sentence and 0 valid citations → `unsupported`
("no sources"). Sentences that are pure greetings/offers ("Happy to help!") need no citation;
classify with a simple rule: sentences containing a digit, a proper noun from records, or ≥ 8 words
are "factual".

### Model stage (asynchronous, job `check_citation`, when `CHECKER_MODEL_CHECK=true`)
For each (sentence, cited record) pair, ask Flash-Lite:

```text
Does SOURCE support CLAIM? Answer ONLY JSON {"supported":"yes"|"partly"|"no","reason":"<=20 words"}.
CLAIM: ...
SOURCE: ...(record text ≤ 3,000 chars)...
```

Combine: all yes → `verified`; any partly or deterministic `partial` → `partial`; any no →
`unsupported`. Write `answers.check_status`, `check_json`, `checked_at`; emit `answer.checked`.

### UI meaning
- ✓ **Verified** (green) — every claim supported by a cited record.
- ◐ **Partly verified** (amber) — some support missing or quotes paraphrased.
- ⚠ **Unverified** (red) — the answer is shown but marked; source card says why.
- … **Checking** (grey) — model stage in progress.

## 5. Grounding eval

`foundry-eval grounding` (see [`../06-execution/04-evals.md`](../06-execution/04-evals.md)) seeds a
fixed venture state and asks the questions in `evals/grounding/questions.yaml`, scoring answer
correctness (expected facts present) and citation correctness (expected record cited) and the
checker's agreement.
