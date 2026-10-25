# 02 — Onboarding (`/onboarding`)

> **Prior art in the old repo** — `src/components/Onboarding.tsx` (step flow, drag-and-drop queue with per-file status) and `backend/factory/.../demo.py` → `upload()` (filename sanitizing, size cap, excerpts) are directly adaptable. What may and may not be reused: [`../reference/foundry-existing-repo-notes.md`](../reference/foundry-existing-repo-notes.md).

Shown when there is no venture, or via "New venture" in the venture switcher. Four steps in a
centered card (max-width 720), progress dots at the top.

| Step | Fields | Validation | API |
|---|---|---|---|
| 1. You | Founder name | 2–60 chars | — (kept in state) |
| 2. Idea | Venture name; idea (textarea, 50–4,000 chars, placeholder with an example); budget (USD, default 25) | required | — |
| 3. Context | Drag-and-drop up to 8 files (`.md .txt .pdf .csv .json`, ≤ 15 MB each); list with per-file status | type/size | `POST /v1/ventures` (creates the venture) then `POST /v1/ventures/{vid}/files` |
| 4. Connect & launch | GitHub card (optional; Connect opens the integration gate flow) and **Launch company** button | — | `POST /v1/ventures/{vid}/start` → navigate to `/` |

Behaviour:
- Venture is created at the start of step 3 (so uploads have a target); going back keeps it.
- PDF text extraction for `files.excerpt`: use `pypdf` (add to kernel deps) — first 12,000 chars;
  `.md/.txt/.csv/.json` read as UTF-8 (errors ignored).
- After launch, the Overview shows a one-time banner: "Your company is starting. Intake is reading
  your idea. Press **Enter the view** to meet the team."
- The selected venture id is stored in `localStorage['foundry.venture']`.
