# WORK ORDER — Karthik (branch `karthik`)

**Lane D: the photoreal assets, and voice end to end.** You give the world its realism and the
agents their voices:

- **The asset pipeline (first — Mahin needs it early):** a reproducible pipeline that downloads
  real scanned CC0 texture sets and HDRIs (Poly Haven, ambientCG), real CC0 prop/furniture/street
  models, realistic rigged human avatars (Microsoft Rocketbox, MIT) and a car, optimizes them for
  the browser, and writes the **asset manifest** the 3D world reads. This is what makes the town
  look like a team of artists built it instead of a WebGL demo (ADR-018).
- **Voice in the browser:** push-to-talk recording, speech-to-text, playing an agent's voice, and
  the lip-sync that moves their mouth in time with the words.
- **Voice in the kernel:** ElevenLabs text-to-speech with timestamps (plus Gemini/browser fallbacks
  and caching), Gemini transcription, voice assignment for the 29 agents, and `/v1/voice/*`.

**Our entry (ADR-019):** Problem Statement 2 — More Dimensions + Best use of Managed Agents. Your
assets decide how real the town looks to judges and to Argon's critic.

This lane is deliberately **smaller** than the other three (you're on Claude Pro). Every piece is
self-contained, has a precise spec and is tested with plain scripts/unit tests — no 3D scene code,
no scheduler, no long Argon runs.

---

## 0. Working on a Claude Pro budget — read this first

- **One step per session.** Start a fresh Claude Code session for each step below (A1, A2, B, C, D),
  paste the step's prompt from §9, finish it, commit, push. Don't carry one long conversation all
  night.
- **Read only what's listed.** The spec is big; the reading list below is the part you need. Point
  your agent at specific files instead of letting it explore the repo.
- **Tests over clicking.** Write the unit test first, then the code; run only your tests while
  iterating (`pnpm vitest run tests/unit/voice tests/unit/assets`, `uv run pytest -q tests/karthik tests/test_voice*`).
- **Use `/compact` when a session gets long**, and stop a session once its step is committed.
- **If you run out of usage:** commit what passes, push, and write in `docs/build-logs/karthik.md`
  what's left. Every step is independent, so whoever runs the merge session can finish a step from
  your notes.

## 1. Read first — on `main`, before writing any code

All files are on every branch under `architecture-files/`.

**Everyone reads (≈ 20 min):**
1. `architecture-files/README.md` — the top section ("Why we're building this") and the reading
   order table.
2. `00-overview/01-product-vision.md`, `00-overview/02-hackathon-context.md`, and ADR-018/019 in
   `00-overview/04-decisions.md`.
3. `06-execution/07-team-split.md` — who owns what and how the four branches merge. **This work
   order is the Karthik column of that document.**
4. `06-execution/06-agent-operating-rules.md`.

**Your sections:**
5. Steps A1/A2: **`05-world/12-photoreal-look.md` §1, §3, §4, §7, §10**, the frozen
   `web/src/world/assets/manifest.contract.ts`, `web/src/world/kit/props.contract.ts`,
   `web/src/world/kit/types.ts` (`MaterialKey`, `PropKind`), `web/src/world/npc/FaceSpec.ts` (`SKIN`).
6. Steps B/C: `05-world/05-characters-and-faces.md` §Lip-sync (viseme table, three drivers,
   smoothing, unit tests), `05-world/07-npc-conversation.md` §State machine, §Audio, §Latency,
   `02-models-and-integrations/06-speech-to-text.md`.
7. Step D: `02-models-and-integrations/05-elevenlabs-voice.md` (whole), `09-env-and-keys.md` (voice
   rows), `01-architecture/04-api-contract.md` §Voice, `01-architecture/06-security-and-secrets.md` §Secrets.
8. `argon-app/AGENTS.md` and the seed files you own (they start with `OWNER: karthik`).

The spec is the contract. If this work order and the spec ever disagree, follow the spec and log it
in `argon-app/docs/decisions/karthik.md`.

## 2. Setup

```bash
git fetch origin && git checkout karthik
cd argon-app && cp .env.example .env     # add ELEVENLABS_API_KEY and GEMINI_API_KEY if you have them
cd kernel && uv sync --extra dev && uv run pytest -q     # 11 passed
cd ../web && pnpm install && pnpm typecheck && pnpm test  # 7 passed
```

No keys needed for steps A–C. Step D works with the browser fallback and mocked HTTP; get an
ElevenLabs key (free tier is fine) for the live check. Disk: the raw asset download is up to
~600 MB (gitignored).

## 3. What you own (edit only these)

**Web** (`argon-app/web/`):
- `assets-pipeline/**` (`assets.lock.json`, `fetch.ts`, `build.ts`, helpers under `lib/`, README)
- `public/assets/**` — built output (binaries are gitignored; `manifest.json` and `CREDITS.md`
  are committed)
- `src/world/npc/visemes.ts`, `src/world/npc/LipSync.ts`
- `src/world/conversation/Mic.ts`, `src/world/conversation/Stt.ts`, `src/world/conversation/Speech.ts`
- `tests/unit/assets/**`, `tests/unit/voice/**` (vitest), `tests/voice-lab/**` (dev-only page at
  `http://localhost:5173/tests/voice-lab/index.html`)

**Kernel** (`argon-app/kernel/`):
- `foundry_kernel/voice/*` (`tts.py`, `stt.py`, new `assign_voices.py`, helpers), `foundry_kernel/api/voice.py`
- `data/voices.json` (generated by `assign_voices`)
- `tests/karthik/**` (add an empty `__init__.py`), `tests/test_voice*.py`, FakeLLM fixtures
  `tests/fixtures/fake_llm/transcribe.json` and `tts_fallback.json`
- migrations `0300`–`0399` named `NNNN_karthik_<what>.sql` (you probably need none)

**Docs:** `argon-app/docs/{build-logs,decisions,verified,contract-requests}/karthik.md`.

## 4. Never touch

Everything else. In particular: frozen contracts (`manifest.contract.ts`, `props.contract.ts`,
`kit/types.ts`, `FaceSpec.ts`, `schema.sql`, `contracts.py`, `config.py`, `security.py`,
`web/src/shared/contracts.ts`), Mahin's world files (kit,
`Character.ts`, `ConversationController.ts`, HUD, `shared/worldApi.ts`), Tanush's kernel and
dashboard, Ayan's (`llm/*`, `models.py`, engineering, worldgen, `scripts/**`). Need a change there?
→ write it in `docs/contract-requests/karthik.md` and work around it in your own files. Check
before every push: `make ownership WHO=karthik` (from `argon-app/`).

## 5. What you can rely on

| You need | Use | Seed behaviour |
|---|---|---|
| Manifest types | `web/src/world/assets/manifest.contract.ts` (`AssetManifest`, `PbrTextureSet`, `MaterialBinding`, `ModelAsset`, `HdriAsset`, `CharacterAsset`, `VehicleAsset`, `EMPTY_MANIFEST`) | Final |
| Prop sizes | `web/src/world/kit/props.contract.ts` (`PROP_FOOTPRINTS`) | Final — normalize every prop model to these |
| Material keys / prop kinds | `web/src/world/kit/types.ts` | Final |
| Pipeline tools (already in `package.json`) | `@gltf-transform/{core,functions,extensions,cli}`, `meshoptimizer`, `sharp`, `fbx2gltf`, `tsx`; scripts `pnpm assets:fetch`, `pnpm assets:build`, `pnpm assets` | Installed by `pnpm install` |
| Voice types | `web/src/shared/contracts.ts`: `Alignment`, `TtsResponse`, `SttResponse`; `contracts.py`: `Alignment`, `TtsRequest`, `TtsResponse`, `SttResponse`, `LLMResult.audio` | Final |
| Settings | `config.get_settings()`: `elevenlabs_api_key`, `elevenlabs_model_id`, `elevenlabs_output_format`, `tts_max_chars`, `stt_primary`, `data_dir`, `gemini_api_key` | Final |
| Gemini calls (transcribe, TTS fallback) | `llm.client.build_llm_client(settings)` → `generate("transcribe", [Part(kind="audio", ...)])`; `generate("tts_fallback", text)` → `LLMResult.audio` (Ayan) | Minimal client; audio support confirmed by Ayan's smoke tests (see `docs/verified/ayan.md` on the `ayan` branch, or test it yourself) |
| Redaction | `security.redact(text)` | Final |
| Roster (for voice assignment) | `kernel/data/roster.json` (`voice_hint` per agent) | Final |

## 6. What others rely on from you (keep these names, signatures and paths)

- **Assets — Mahin's renderer reads them:** `web/public/assets/manifest.json` valid against
  `AssetManifest`; every URL in it resolves under `/assets/…` after `pnpm assets`; texture map URLs
  use `{res}` with the listed `resolutions`; models normalized (metres, origin at floor centre, +Z
  front) and scaled to `PROP_FOOTPRINTS`; avatars expose `bones` names and any viseme/blink morph
  targets exactly as listed. `pnpm assets` must rebuild everything from `assets.lock.json` on a
  clean checkout (W-13), and `public/assets/CREDITS.md` must list every asset and license.
- **Web voice — Mahin calls these:**
  - `npc/visemes.ts`: `VISEMES`, `REST`, `type Viseme`, `type MouthShape`, `visemeForChar(ch)`,
    `charIndexAt(alignment, t)`.
  - `npc/LipSync.ts`: `class LipSync { mouth; speaking; start(source); onBoundary(); stop(); update(dt) }`,
    `type LipSyncSource` (`alignment` | `analyser` | `boundary`).
  - `conversation/Speech.ts`: `speak(text, tts | null, { lipSync?, onCaption?, voiceHint? }) → { started, done, stop }`.
  - `conversation/Mic.ts`: `class Mic { static supported(); recording; start(); stop(); cancel() }`.
  - `conversation/Stt.ts`: `startListening({ transcribe, prefer?, lang? }) → { stop(), cancel() }`,
    `stop()` resolves `{ text, provider, latency_ms }`.
- **Kernel — Tanush calls these:** `voice.tts.synthesize(*, settings, db, agent_id, text) -> TtsResponse`
  and `voice.stt.transcribe(*, settings, llm, audio, mime) -> SttResponse`. They **never raise** for
  missing keys or provider errors: fall back down the chain and finally return
  `provider="browser"` / `"none"`.
- **HTTP (Mahin's world calls them):** `POST /v1/voice/tts`, `POST /v1/voice/transcribe`,
  `GET /media/audio/{sha}.mp3` exactly as in `04-api-contract.md` (envelope `{"data": …}`).

## 7. Build steps

After each step: tests green → append `T+hh:mm step — result` to `docs/build-logs/karthik.md` →
commit → `make ownership WHO=karthik` → push `karthik`. **Push A1 as soon as it works** — Mahin
runs your pipeline from your branch to get real assets early.

### Step A1 — Asset pipeline: textures, HDRIs, props (~1.5–2 h)
1. Probe the Poly Haven API (asset list by type/category, file URLs per resolution/format) and
   ambientCG's API; record the exact shapes in `docs/verified/karthik.md` (the spec marks them VERIFY).
2. `assets.lock.json`: choose one scanned texture set per material key per the table in
   `12-photoreal-look.md` §4 (record `tileMeters` from the asset's real-world size), one exterior
   HDRI (late afternoon, partly cloudy, sun ~25°) and one interior HDRI, and one CC0 model per
   `PropKind` where a good one exists (the rest stay procedural — say which in the lock file), plus
   street furniture (bench, street lamp, bin, bollard, planter, bike rack). Prefer realistic,
   well-known assets; never anything stylized or low-poly-looking.
3. `fetch.ts`: download everything in the lock file into `public/assets/raw/` (skip files already
   present with the right sha256; retry with backoff; backup source per texture).
4. `build.ts`: textures → WebP at 2048 and 1024 (sharp), named `…/<id>/<map>_{res}.webp`; models →
   glTF-Transform: normalize to metres, origin at floor centre, +Z front, scale to
   `PROP_FOOTPRINTS`, simplify LOD0 ≤ 15 k tris + LOD1/LOD2, resize embedded textures, meshopt
   compress → `public/assets/models/<id>.glb`; HDRIs copied (1k–2k `.hdr`); write `manifest.json`
   (materials bindings with realistic tints for the pastel keys, props, streetFurniture, hdris) and
   `CREDITS.md`.
5. `tests/unit/assets/manifest.test.ts`: the committed manifest type-checks as `AssetManifest`,
   every prop id/material texture id it references exists in the manifest, every model bbox is
   within 5% of its `PROP_FOOTPRINTS` entry, every credit has a license.
**Done when:** `pnpm assets` on a clean checkout produces `public/assets/**` + a valid manifest, the
test passes, and Mahin can point at it.

### Step A2 — Asset pipeline: avatars and the car (~1–1.5 h)
1. Inspect the Microsoft Rocketbox repository: avatar list, file layout, formats, whether files are
   in Git LFS, which avatars have facial blendshapes, which animations exist; record in
   `docs/verified/karthik.md`. Pick **35 adult avatars** (29 + 6 spares) with varied skin tones,
   ages, builds and clothing (business, casual, technical); add them to the lock file.
2. Fetch the selected FBX files only (never clone the whole repo); convert with `fbx2gltf`; with
   glTF-Transform: ≤ 25 k tris LOD0 + LOD1, texture resize, meshopt; write
   `public/assets/characters/<id>.glb`. Read the skeleton and morph targets and fill
   `CharacterAsset` (`bones.head/neck/spine/jaw/eyeL/eyeR/armL/armR`, `visemes` and `blink` morph
   names if present, `outfitMaterial` = the clothing material, `animations` clip names,
   `skinTone` = nearest `SKIN` index by sampling the skin texture, `hair`, `build`, `heightM`).
   Write a per-avatar inspection report into the build log.
3. One realistic car: a CC0 model if available, otherwise a CC-BY model with credit (VERIFY
   license); normalize (metres, +Z forward), fill `VehicleAsset` (wheel node names, paint material).
4. Extend `manifest.test.ts`: every character has head/neck/spine bones and a skin tone; 29+
   characters present; vehicle present or explicitly absent.
**Done when:** the manifest lists ≥ 29 avatars with bones, the car, and `pnpm assets` still rebuilds
cleanly.

### Step B — Visemes and lip-sync (pure TypeScript, ~1–1.5 h)
1. `visemes.ts`: `visemeForChar` per the table in `05-world/05` (lowercase, NFD + strip diacritics,
   digits → C, whitespace/punctuation → Rest); `charIndexAt` = binary search for
   `starts[k] ≤ t < ends[k]`, else −1.
2. `LipSync.ts`: the three drivers —
   - `alignment`: `t = audio.currentTime`; target = viseme of `chars[k]`; blend 30% toward the next
     char's viseme within 40 ms of `ends[k]`;
   - `analyser`: RMS of time-domain data (fftSize 1024) → `open = clamp((rms − 0.02)·0.9, 0, 0.07)`,
     `width = 0.075 − open·0.2`;
   - `boundary`: each `onBoundary()` opens a 180 ms window with `open = 0.03 + 0.03·|sin(2π·9·t)|`;
   smoothing `value += (target − value)·(1 − exp(−25·dt))`; `stop()` eases to Rest over 120 ms.
   Keep the time source injectable (e.g. an optional `now()` in the constructor) so tests are
   deterministic. (Mahin maps `mouth.open` to the avatar's jaw bone and visemes to morph targets.)
3. `tests/unit/voice/visemes.test.ts` and `lipsync.test.ts`: mapping table, `"é" → E`, digits,
   binary search over a fixture alignment (edges: before first, between chars, after last),
   smoothing converges, boundary window opens and closes, stop eases to Rest.
**Done when:** `pnpm vitest run tests/unit/voice` and `pnpm typecheck` are green.

### Step C — Mic, speech-to-text, speech playback (browser, ~1.5–2 h)
1. `Speech.ts`: if `tts?.audio_url` → play it in an `HTMLAudioElement`; with `tts.alignment` drive
   `lipSync.start({ kind: 'alignment', audio, alignment })`, without it route the audio through a
   WebAudio `AnalyserNode` and use `kind: 'analyser'`. Otherwise (`null` or `provider: 'browser'`) →
   `speechSynthesis` with `onboundary → lipSync.onBoundary()` and `kind: 'boundary'`. Resolve
   `started` at first sound (for latency), `done` at the end; `stop()` cancels and calls
   `lipSync.stop()`.
2. `Mic.ts`: `getUserMedia({ audio: true })` once, `MediaRecorder` webm/opus, hard stop at 30 s,
   `stop()` returns the Blob; `start()` rejects clearly when denied (the UI then offers typing, C-04).
3. `Stt.ts`: `startListening({ transcribe, prefer })`. Server path: record with `Mic`, on `stop()`
   call `transcribe(blob)`; if the server answers `provider: "none"` or fails, use the browser path.
   Browser path: `SpeechRecognition`/`webkitSpeechRecognition` running while the key is held
   (final transcript only). Always resolve; empty text means "offer typing". Measure `latency_ms`
   from key release to transcript.
4. `tests/voice-lab/index.html` + a small script: "hold to talk", a text box, "speak", and a canvas
   drawing the mouth (`open`/`width`) so you can see lip-sync without the 3D world.
5. Unit tests for the pure parts (state handling, fallbacks) with small fakes; record browser API
   findings in `docs/verified/karthik.md`.
**Done when:** in the voice lab, holding the button records, releasing returns a transcript (or a
clear "type instead"), and "speak" plays with a moving mouth in every driver mode you can test.

### Step D — Kernel voice (~1.5–2 h)
1. Probe ElevenLabs (`GET /v1/voices`, one text-to-speech-with-timestamps call); record the exact
   request/response shapes in `docs/verified/karthik.md` (the spec marks them VERIFY).
2. `voice/tts.py` `synthesize(...)`: text prep, ≤ `TTS_MAX_CHARS`, cache key sha256(voice_id + model +
   text) → `data/audio-cache/<sha>.mp3` + alignment JSON; ElevenLabs with timestamps → `Alignment`;
   fallback chain per `05-elevenlabs-voice.md` §Fallback chain (Gemini `tts_fallback` via
   `LLMResult.audio` → browser). Never log or return the key; `redact()` any error text you store.
3. `voice/stt.py` `transcribe(...)`: Gemini `transcribe` job with an audio `Part`; `provider="none"`
   when `STT_PRIMARY=browser` or on failure. Decide `STT_PRIMARY` in `docs/decisions/karthik.md`.
4. `voice/assign_voices.py` (`uv run python -m foundry_kernel.voice.assign_voices`): list voices,
   pick one per agent from `voice_hint` per §Voice assignment, distinct within a building; write
   `kernel/data/voices.json` (`{agent_id: voice_id}`) and commit it if you have a key.
5. `api/voice.py`: `POST /v1/voice/tts` (`TtsRequest` → `TtsResponse`, 400 over the char limit),
   `POST /v1/voice/transcribe` (multipart `audio`, ≤ 30 s), `GET /media/audio/{sha}.mp3` (validate
   `sha` is 64 hex chars; serve from `data/audio-cache/`). Use the error envelope from the API contract.
6. `tests/test_voice_tts.py`, `test_voice_stt.py`, `test_voice_api.py`: cache hit, fallback order,
   char limit, bad sha → 404, no key → `provider="browser"`. Mock HTTP by monkeypatching your own
   small request function — never call ElevenLabs from tests.
**Done when:** tests green; with a key, `curl -XPOST localhost:8787/v1/voice/tts -H 'content-type: application/json' -d '{"agent_id":"concierge","text":"Welcome back!"}'`
returns an `audio_url` that plays and an alignment; the voice lab plays it with alignment lip-sync.

## 8. Definition of done

- Acceptance (`06-execution/02-acceptance-criteria.md`): **W-13** (asset pipeline reproducible,
  manifest valid, credits complete), **C-08** (voice fallbacks: no ElevenLabs key → Gemini TTS or
  browser voice, mouth still moves), the voice parts of **C-03** and **C-09** (STT and TTS timings
  exposed for Mahin's latency samples), and the viseme unit tests from `03-testing-strategy.md`.
- `pnpm typecheck && pnpm test` and `uv run pytest -q` green (seed tests included).
- `make ownership WHO=karthik` clean; branch pushed (no asset binaries committed).
- `docs/build-logs/karthik.md` ends with a **Handoff** section: which steps are done, the asset
  inventory (textures, HDRIs, props covered vs procedural, avatars with/without blendshapes,
  car), download/build sizes and times, `STT_PRIMARY` decision, whether `voices.json` is committed,
  ElevenLabs shapes verified, anything left, and what the merge session should run (`pnpm assets`,
  `assign_voices`).

## 9. Prompts for your coding agent (one session per step)

Start every session with:

> You are building lane D (Karthik) of Foundry × Argon on branch `karthik`: the photoreal asset
> pipeline and voice. Read `WORKORDER_KARTHIK.md` §0–§6 and only the spec files it lists for the
> step below. Edit only files owned by karthik (`make ownership WHO=karthik` from `argon-app/`);
> never edit frozen contracts — write requests in `argon-app/docs/contract-requests/karthik.md`.
> Keep the names, signatures and paths in §6. Write tests first, run only the relevant tests while
> iterating, then the full `pnpm typecheck && pnpm test` / `uv run pytest -q`. Never commit
> downloaded asset binaries. When the step is done: append to `argon-app/docs/build-logs/karthik.md`,
> commit, and push `karthik`.

Then add one line:

- Step A1: "Do Step A1 (asset pipeline: textures, HDRIs, props). Spec: `05-world/12-photoreal-look.md` §1, §3, §4; contracts `web/src/world/assets/manifest.contract.ts`, `web/src/world/kit/props.contract.ts`."
- Step A2: "Do Step A2 (avatars and the car). Spec: `05-world/12-photoreal-look.md` §3, §4, §7; contract `web/src/world/assets/manifest.contract.ts` (`CharacterAsset`, `VehicleAsset`); `web/src/world/npc/FaceSpec.ts` (`SKIN`)."
- Step B: "Do Step B (visemes + lip-sync). Spec: `05-world/05-characters-and-faces.md` §Lip-sync."
- Step C: "Do Step C (Speech, Mic, Stt, voice lab). Spec: `02-models-and-integrations/06-speech-to-text.md`, `05-world/07-npc-conversation.md` §Audio."
- Step D: "Do Step D (kernel voice). Spec: `02-models-and-integrations/05-elevenlabs-voice.md`, `06-speech-to-text.md`, `01-architecture/04-api-contract.md` §Voice."
