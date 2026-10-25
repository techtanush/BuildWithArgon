# 06 — Navigation: Walking, Driving, Racing, Fast Travel, Map

## Player on foot (`player/Player.ts`)

- Camera: `PerspectiveCamera(fov 70, near 0.05, far 900)`; eye height 1.65.
- Look: `PointerLockControls` from `three/examples/jsm/controls/PointerLockControls.js`; mouse
  sensitivity 0.0022 rad/px; pitch clamp ±80°.
- Move: WASD relative to yaw; walk 4.5 m/s, sprint 8 m/s; acceleration
  `v += (target − v)·(1 − exp(−12·dt))`.
- Head bob while moving: `y = 1.65 + 0.035·sin(stepPhase)`, stepPhase advances `speed · 2.2` rad/s.
- Collision: circle r 0.35 vs colliders (`Collision.resolveCircle`), up to 3 resolution passes.
- Footsteps (MAY): soft step sound every π of stepPhase.

## Interaction detection

Every frame, among interactables in the current scene (NPCs, doors, exit ring, car), pick the
nearest one within 2.2 m (car: 3.0 m) whose direction is within 60° of the camera forward (NPCs:
also allow within 1.2 m regardless of angle). Show the HUD prompt:
`E  Talk to Zara · Builder` / `E  Enter The Foundry Works` / `E  Leave` / `E  Drive`.

## Doors and interiors

- City door ring of building i (from `k.entrance`) → `E` → `SceneManager.switchTo('interior:<dept>',
  spawn=(0, 1.65, 5.4), yaw 0)`.
- Interior exit ring at (0, 0, 6.2) → `E` → back to the city at the building's door ring + 2.5 m
  toward the plaza, facing the plaza.

## Car (`vehicle/Car.ts`)

Arcade kinematic model on the XZ plane (no physics engine).

```
state: x, z, heading ψ (rad, 0 = facing −Z), speed v (m/s)
inputs: throttle (W), brake/reverse (S), steer (A = +1 left, D = −1 right), handbrake (Space)
constants: ACCEL 14, BRAKE 28, REVERSE_ACCEL 8, VMAX 36 (on road/plaza), VMAX_OFFROAD 14,
           VMIN −8, DRAG 0.35, ROLL 1.2, STEER_RATE 1.9, HANDBRAKE_STEER × 1.6, HANDBRAKE_DRAG × 3

each fixed step:
  a = throttle·ACCEL − (brake ? (v > 0.5 ? BRAKE : REVERSE_ACCEL) : 0) − DRAG·v − ROLL·sign(v)
  v = clamp(v + a·dt, VMIN, onRoad ? VMAX : VMAX_OFFROAD)
  if (abs(v) < 0.05 && !throttle && !brake) v = 0
  steerFactor = v / (abs(v) + 6)                      // no turning when stopped; reverse flips
  ψ += steer · STEER_RATE · steerFactor · (handbrake ? 1.6 : 1) · dt
  x += −sin(ψ)·v·dt ; z += −cos(ψ)·v·dt
  collision: circle r 2.0 vs colliders; on hit: push out, v = −0.25·v
```

`onRoad`: point within plaza disc, ring annulus, or any spoke/driveway rectangle.

Model (kit primitives, ≤ 6k tris): body `RoundedBox 2.0 × 0.7 × 4.2` in `#E66A2C`, cabin
`RoundedBox 1.7 × 0.6 × 2.0` (`glass` darkened `#2B3442`), 4 wheels `Cylinder r 0.38 w 0.3`
(`metal_dark`, spin with v), headlights (emissive `#FFF3D0`), taillights (emissive `#FF4A3A` when
braking). Body roll: `rotation.z = −steer · 0.04 · min(1, |v|/20)`.

Chase camera (`vehicle/ChaseCamera.ts`): desired position = car + rotate(ψ)(0, 2.4, 6.5); look at
car + (0, 1.2, 0) + forward·4; smoothing `1 − exp(−6·dt)`; FOV 70 → 78 linearly with speed 0→36.

Enter car: `E` within 3 m of the car's ring → mode `car`. Exit: `E` when |v| < 2 → player placed
2.2 m to the car's left. `R` resets the car to the nearest road node, heading along the road.

## Road graph and A* (`nav/RoadGraph.ts`, `nav/astar.ts`)

- Nodes/edges from the manifest (52 nodes, 65 edges); weights = Euclidean length.
- `nearestNodes(x, z, k=3)`: linear scan (52 nodes).
- `path(fromXZ, toNodeId)`: for each of the 3 nearest nodes `n`, cost = `dist(from, n) +
  A*(n → target)`; pick the cheapest. A* uses the Euclidean heuristic. Return the polyline
  `[from, n, …, target]`. (The plaza has no center node because of the fountain; cars circle the
  plaza edge along the `E_i–E_{i+1}` chords, which clear the lamps at r = 26.)
- Smooth the polyline for display: Catmull-Rom (`THREE.CatmullRomCurve3`, centripetal) sampled
  every 2 m.

Unit tests: a path from the spawn to each D_i exists; from spawn (0, 16) to D0 the path starts at
E6 or E7 and its length is 181 ± 5 m (15 m to the node + 6 plaza chords of 14.36 m + 62 m spoke +
18 m driveway); A* returns the shorter of the two ring directions.

## GPS ribbon (`nav/Gps.ts`)

A flat ribbon mesh 1.2 m wide following the smoothed path, 0.06 m above the road; material
`MeshBasicMaterial` yellow `#F5D90A`, opacity 0.85, with an alpha texture of arrow chevrons whose
UV offset scrolls 1.5 m/s in the travel direction. The ribbon behind the player fades out (shader
alpha by distance along path). Recompute the path when the player is > 12 m from the ribbon.

## Race mode (`nav/Race.ts`)

Start (`race(agentId)` from a route card or map):
1. Resolve target building → door node `D_i`.
2. If on foot: summon the car — place it at the nearest road node to the player, heading along the
   first path segment; put the player in it (fade 250 ms). If inside a building: first exit to the
   city (door), then summon.
3. Compute path; place checkpoints every ~45 m of path length (min 3, max 10), the last one at
   `D_i`. Checkpoint = vertical `TorusGeometry(4.5, 0.25, 12, 48)` facing the path tangent,
   emissive yellow (next one bright, later ones dim at 0.35 opacity).
4. Countdown 3-2-1 (HUD, 0.6 s each, car frozen), then GO; timer starts.
5. Passing within 7 m of the next checkpoint center → chime, next. Order enforced.
6. Reaching the final checkpoint → timer stops; HUD: time, best time (`localStorage
   ['foundry.race.best.<building_id>']`), "New best!" if improved; 1.2 s later: fade → interior of
   the building → spawn facing the target agent (see Fast travel step 3) → auto-engage.
7. `Q` abandons (HUD toast "Race abandoned"); GPS ribbon stays until arrival or `Q` again.

Rival ghost car (MAY): translucent car following the smoothed path at a constant 27 m/s starting at
GO; purely visual.

## Fast travel — "Take me there" (`nav/FastTravel.ts`)

1. Fade to black 300 ms; show a card "Heading to The Foundry Works…" (≥ 400 ms so it reads).
2. Switch to the target building's interior (or the plaza for the Concierge).
3. Place the player 2.0 m in front of the target NPC's slot (along the slot's facing direction),
   yaw facing the NPC, then fade in.
4. 0.5 s later auto-engage the conversation; the agent plays its greeting (cached TTS) unless the
   founder spoke to this agent earlier in this session (then a short "Hi again." line, also cached).

## Map (`hud/MapOverlay.tsx`, key M)

- Full-screen overlay (rgba(20,18,15,0.72) backdrop), centered SVG map 720 × 720 px scaled to the
  town radius 140 m: plaza circle, ring road, spokes, 13 building squares (department color, code,
  building name), a player arrow (position + yaw), and a car icon.
- Click a building → side panel: building name, department, mission, its agents (portrait, name,
  title) → click an agent → buttons **Race there** / **Take me there** / **Cancel**.
- Search box (focus with `/`): matches agent names, titles, department names, building names.
- Close with M or Esc.
