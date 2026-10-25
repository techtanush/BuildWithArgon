# D03 Market Research — The Observatory

## Mission

Map the market with **cited evidence**: size estimates, segments and pains, competitors, pricing,
trends and risks. Every number has a source.

## Team

| Agent | Name | Role | Model / job | Tools / services | Persona |
|---|---|---|---|---|---|
| `mr.research-lead` (lead) | Priya | Market report | **Deep Research** `deep-research-preview-04-2026` | web research with citations | Curious, energetic, always names the source |
| `mr.competitor-analyst` | Leo | Competitor profiles with screenshots | Flash `dept_artifact`; **Cua computer** (browser) or Antigravity web | Cua sandbox/Space, screenshots | Competitive scout before a match |

## Work

| Ticket | Owner | Output |
|---|---|---|
| `research.market` | Priya | artifact `research`: market definition, size (source + year), segments, top 5 competitors, trends, risks; `meta.sources[]` |
| `research.competitors` | Leo | artifact `research`: table (name, URL, target user, pricing, key features, weaknesses) + "Where we can win"; `meta.screenshots[]` of pricing pages captured on Leo's Cua computer |

Leo's computer task: goal "Capture pricing and key features for {competitors}"; allowed domains =
competitor domains + one search engine; max 30 steps; no sign-ups (guard gates them).

## Directing and being directed

- Directed by: Rhea (plan). Priya delegates competitor depth to Leo:
  "@Leo profile the 5 competitors from my report, pricing pages first (tkt_…)."
- Hands off to: Pivot (Elena) — both artifacts are dependencies of `decision.review`; Growth uses
  them for positioning; Sales for pricing.
- Asked often by: Lucia (positioning proof), Grace (pricing), Mara (common features).

## Gates

`computer_action` if Leo's browser hits a sign-up/login/contact form.

## Group chat

`#dept-market-research`: "Report done: 5 competitors, 3 segments, 12 sources." ·
handoff in `#dept-pivot`: "@Elena research is in (art_…, art_…)."

## In the world

Building: **The Observatory** — round building with a metal dome and a telescope. Interior: round
map table, a big telescope at the north window, chart screens, a star-map rug. Priya at `s1` by
the map table; Leo at `s2` near the screens.

Ask Priya: "How big is this market?" · "Where's that number from?"
Ask Leo: "Who's our scariest competitor?" · "What does Pantry Check charge?" (answer cites the
screenshot-backed artifact; the source card opens the computer task with the screenshot).

## Failure modes

Deep Research timeout (30 min) → Flash fallback report labelled "no live web research". Cua
unavailable → Antigravity web research; no screenshots. Competitor site blocks bots → Leo notes it.

## Acceptance

Both research artifacts with sources; Leo's artifact includes screenshots when Cua is on; grounding
G-03, G-11, G-12 pass.
