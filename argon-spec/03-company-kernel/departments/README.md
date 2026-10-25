# Departments — Deep Dives

> **Hackathon context.** The 13 departments are the managed-agent organization we enter for Best
> use of Managed Agents; Engineering is the core of Problem Statement 1; their buildings make up the
> More Dimensions world. See [`../../README.md`](../../README.md) §Why we're building this.

One file per department (and one for the Concierge). Each covers: mission, team, what each
sub-agent does, the tickets they own, who directs them and whom they direct, handoffs, services,
gates, what they post in group chat, their building and interior, what you can ask them in the
world, failure modes, and acceptance checks.

| File | Department | Lead | Building |
|---|---|---|---|
| [`00-concierge.md`](00-concierge.md) | Concierge (plaza) | Nova | Plaza kiosk |
| [`01-intake.md`](01-intake.md) | D01 Intake | Iris | The Arrivals Hall |
| [`02-office-hours.md`](02-office-hours.md) | D02 Office Hours | Mara | The Clocktower |
| [`03-market-research.md`](03-market-research.md) | D03 Market Research | Priya | The Observatory |
| [`04-outreach.md`](04-outreach.md) | D04 Outreach & Validation | Sofia | The Telegraph House |
| [`05-synthetic-population.md`](05-synthetic-population.md) | D05 Synthetic Population | Noor | The Greenhouse |
| [`06-pivot.md`](06-pivot.md) | D06 Pivot & Decision | Elena | The Rotunda |
| [`07-engineering.md`](07-engineering.md) | D07 Engineering & Build | Kai | The Foundry Works |
| [`08-growth.md`](08-growth.md) | D08 Strategy & Growth | Lucia | The Lighthouse |
| [`09-lead-intel.md`](09-lead-intel.md) | D09 Lead Intelligence | Ines | The Archive |
| [`10-sales.md`](10-sales.md) | D10 Sales | Grace | The Market Hall |
| [`11-finance-people.md`](11-finance-people.md) | D11 Finance & People | Hana | The Bank & Guild |
| [`12-support.md`](12-support.md) | D12 Support & Retention | Yuki | The Harbor House |
| [`13-chief-of-staff.md`](13-chief-of-staff.md) | D13 Chief of Staff | Rhea | Town Hall |

How the departments connect (work flow, left to right):

```
Concierge (answers + routes, reads everything)
Intake ─► Office Hours ─► Intake(spec) ─► Chief of Staff (plan)
                                              │
   ┌──────────────┬──────────────┬────────────┼───────────────┬──────────────┐
Finance      Market Research  Synthetic Pop.  Outreach        Engineering (after decision)
   │              └──────┬───────┘              │                  │
   │                  Pivot & Decision ◄────────┘                  │
   │                     │                                          │
   │               Strategy & Growth ─► Lead Intelligence ─► Sales  │
   │                                                                │
Support ◄── GitHub issues ── product ◄──────────────────────────────┘
Chief of Staff: standups, reports, improvement (hiring) across all
```

Shared rules for every department: answer only from records and cite them; draft but never
perform gated actions; post status/handoffs in group chat; ask other agents before guessing;
use they/them for people.
