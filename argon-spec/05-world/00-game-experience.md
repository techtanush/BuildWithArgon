# 00 — The Game Experience (player journey)

> **Hackathon context.** The world is our More Dimensions entry and the most visible part of the
> demo: judges must be able to understand it in seconds and try it live in under 3 minutes
> (enter → ask Nova → route → race → talk to an agent with verified sources).

This is the whole "Enter the view" experience from the founder's point of view: what they see,
hear and do, moment by moment. Technical details live in files 01–11 of this folder; this file is
the **experience contract** — if an implementation choice makes any moment below worse, change the
implementation.

## The fantasy

> "My company is a small, sunny town. Everyone who works for me lives here. I can walk up to anyone,
> ask what they're doing, hear them answer in their own voice, see exactly what their answer is based
> on — and race across town to whoever knows more."

Tone: warm, calm, playful, trustworthy. A cozy town, not an ops console. The world never shows
company status — the **people** tell you.

## 1. Entering (dashboard → world, ~6 s)

1. On the dashboard, the founder clicks **Enter the view** (top bar, orange).
2. Loading screen: Foundry logo, a soft illustration of the town, "Opening the doors…", progress
   bar. Tip lines rotate: "Hold V to talk", "Press M for the map", "Every answer shows its sources".
3. Fade in on the plaza at mid-morning light. Birdsong and a fountain (soft ambient); if Lyria
   music is enabled, a gentle acoustic loop.
4. In front of you: **Nova**, the Concierge, beside a yellow kiosk; behind Nova the fountain; beyond,
   the avenue north to **The Arrivals Hall**. Around the ring you can see the silhouettes of all 13
   buildings — tower, dome, lighthouse, greenhouse, town hall…
5. Click to look around (pointer lock). 0.8 s later Nova turns to you, waves, and speaks:
   "Welcome back! I'm Nova. Ask me anything about the company — or I'll point you to whoever knows
   best." Captions appear in the conversation panel. A hint toast lists the controls.

## 2. Talking to Nova (the core interaction)

1. Hold **V**: the mic meter pulses; your words appear live (Web Speech) or "Listening…".
2. Release: Nova tilts their head, eyes glance up — "Nova is thinking…" (≤ 1 s typically).
3. Nova answers in voice; the mouth moves with the words; the line types out in sync.
4. Under the line, **source cards** appear: 🎫 "Ticket · Search UI", ⚖ "Approval · Merge PR #7" —
   each with a short quote. A chip shows **… Checking**, then **✓ Verified**.
5. If someone else knows more, a **route card** slides up: Zara's portrait, "Ask Zara — Builder ·
   The Foundry Works", the reason, and two big buttons: **1 🏁 Race there** · **2 ✨ Take me there**.

Example exchange:
- You: "Catch me up."
- Nova: "Engineering shipped search — 42 of 42 tests — and it's waiting on your merge approval.
  Zara is building expiry highlighting now. Want to go see Zara?" (cards: PR artifact, approval,
  ticket; route card → Zara)

## 3. Getting there

### Race there (the fun way)
1. A bright yellow car rolls up beside you (or you're placed in it); 3-2-1-GO countdown.
2. A glowing chevron ribbon on the road shows the way; large yellow rings mark checkpoints; a chime
   on each; timer top-center; best time under it.
3. The chase camera widens with speed; drift with Space; bump a lamppost and bounce off.
4. Through the last ring at the building's driveway: "Arrived! 0:24.6 — new best!" confetti burst
   (small, tasteful), then a fade straight into the building, facing the agent.

### Take me there (the fast way)
A 0.7 s fade with "Heading to The Foundry Works…", and you're standing 2 m in front of the agent.

### Or just explore
Walk (WASD, Shift to sprint) or take the parked car anywhere. Every building has a glowing coral
ring at its door: **E — Enter The Observatory**.

## 4. Inside a department

1. Inside, the room looks like the reference render: warm wood floor, pale walls, glowing windows,
   rounded furniture, a rug, a cable on the floor, a signature piece (the telescope, the vault door,
   the workbenches).
2. The department's agents stand at their spots, idle-breathing and blinking; as you approach they
   turn their heads to look at you. Yellow rings mark each one.
3. Prompt: **E — Talk to Zara · Builder**. Press E: the camera eases toward Zara, Zara waves:
   "Hey — I'm Zara, I build things here. Ask me what I'm shipping."
4. Ask anything. Answers come from Zara's real work: current ticket, iterations, test counts,
   PRs — with source cards. If Zara doesn't know, Zara says so and suggests who does (mini route
   card).
5. Leave with Esc, E, or by walking away; exit the building through the coral ring at the door.

What each building feels like and who's there: [`04-buildings.md`](04-buildings.md) and the
department deep dives in [`../03-company-kernel/departments/`](../03-company-kernel/departments/).

## 5. Things to do in the town

| Activity | How | What you get |
|---|---|---|
| Ask the Concierge anything | Plaza, V | Company-wide answers + route cards |
| Interview any agent | Walk up, E, V | First-person answers from their records, with sources |
| Hear the latest standup | Town Hall, E at the long table | Each lead's update in their own voice, then Rhea's decisions, with captions and sources |
| Race to a department | Route card / map → Race | Timed checkpoint race, personal best per building |
| Fast travel | Route card / map → Take me there | Instant arrival in front of the agent |
| Open the map | M | Top-down town, search agents/departments, race or travel |
| Meet a new hire | After you approve a hire, they appear in their department's building | Their greeting introduces them and why they were hired |
| Jump back to work | Source card click / "Open in dashboard" / Esc → Back to dashboard | The exact record in the dashboard |

## 6. The map (M)

Darkened overlay with a clean top-down map: the plaza, the ring road, 13 colored building squares
with names, your position arrow and the car. Click a building → its agents with portraits → pick one
→ **Race** / **Take me there**. Type to search ("pricing", "Zara", "bugs").

## 7. Audio

| Sound | Where | Notes |
|---|---|---|
| Agent voices | Conversations, standup playback | ElevenLabs, one distinct voice per agent |
| Ambience | Plaza (fountain, birds), inside (soft room tone) | Low volume, loops |
| Music (MAY) | Plaza | Lyria 30 s loop, ducked while anyone speaks |
| UI | Prompts, checkpoints, arrival | Soft chimes; no harsh sounds |
| Car | Engine hum scaled by speed, tire squeal on handbrake | Subtle |

## 8. HUD (minimal by default)

- Center dot crosshair (on foot); interaction prompt below it.
- Bottom: conversation panel (only during conversations).
- Top-center: race timer (only during races).
- Top-right: "Last suggestion" pill (60 s after a route card), tiny connection dot.
- Esc: pause menu — Resume · Quality (Auto/High/Medium/Low) · Music on/off · Mouse sensitivity ·
  Back to dashboard.

## 9. Accessibility and comfort

- Every voice line is captioned; typing is always available (Enter).
- Mouse sensitivity and FOV sliders; "reduce motion" disables head bob and camera FOV changes.
- Subtitles can be enlarged (pause menu). Colors are not the only signal (icons on cards/chips).

## 10. What the world never does

- Never shows company status (no red buildings, no progress bars on walls, no traffic as work).
- Never lets an agent take a gated action; agents point you to the dashboard approval instead.
- Never invents: if a record doesn't support an answer, the agent says it doesn't know.

## 11. Three scripted moments to polish first

1. **Arrival + Nova's greeting** (first impression).
2. **Ask Nova → route card → Race → arrive facing Zara → Zara answers with verified sources**
   (the core loop).
3. **Town Hall standup playback** (the company talking to itself).
