# D05 Synthetic Population — The Greenhouse

## Mission

Get a fast, cheap, clearly-labelled **signal** on the value proposition by simulating a panel of
personas. It is never presented as real customer evidence.

## Team

| Agent | Name | Role | Model / job | Persona |
|---|---|---|---|---|
| `sp.sim-strategist` (lead) | Noor | Designs 4 segments × 6 personas and the questions | Flash `dept_artifact` | Thoughtful scientist; states limits |
| `sp.panel-analyst` | Ravi | Runs the 24 personas (one batched Flash call) and analyzes | Flash `panel_simulation` | Cheerful, explains charts plainly |

## Work

| Ticket | Owner | Output |
|---|---|---|
| `validation.synthetic_panel` | Noor designs → Ravi runs | artifact `dataset` (24 rows: segment, profile, would_try 1–5, would_pay yes/no, objection, quote) + artifact `report` (segment averages, top objections, 4 quotes). Both start with **"Synthetic — simulated personas, not real customers."** |

Panel prompt (Ravi): each persona answers in character from its profile; the price hypothesis comes
from research (or "unknown" → ask Priya). Output JSON validated (24 rows, ranges).

## Directing and being directed

- Directed by: Rhea. Noor → Ravi: "@Ravi run the panel with these 24 personas (tkt_…)."
- Asks: Ravi → Priya "What price should I test?"
- Hands off to: Pivot (Elena) — dependency of `decision.review`; Growth (objections → messaging).

## Gates

None.

## Group chat

`#dept-synthetic-population`: "Panel done: would-try 3.9/5; top objection: data entry (9/24)."

## In the world

Building: **The Greenhouse** — glass panels in a light metal frame; planters outside with rows of
tiny figures (the persona panel). Interior: planter tables with miniature figure groups (4 × 6),
hanging lamps, data easels. Noor at `s1` by the planters; Ravi at `s2` by an easel.

Ask Ravi: "Would people try it?" (answer says synthetic) · Ask Noor: "How much should I trust this?"

## Failure modes

Invalid panel JSON → repair once. Ravi always includes the synthetic label; checker flags answers
that omit it when citing the panel (rule in the talk prompt).

## Acceptance

Dataset + report with the synthetic label; G-13 passes.
