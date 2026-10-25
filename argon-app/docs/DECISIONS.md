# Decisions

- Architecture decisions ADR-001…ADR-017: [`../../architecture-files/00-overview/04-decisions.md`](../../architecture-files/00-overview/04-decisions.md).
- Per-person decisions during the build: [`decisions/tanush.md`](decisions/tanush.md),
  [`decisions/ayan.md`](decisions/ayan.md), [`decisions/mahin.md`](decisions/mahin.md),
  [`decisions/karthik.md`](decisions/karthik.md).

## Seed decisions (frozen-contract seed)

| ID | Decision | Reason |
|---|---|---|
| SEED-01 | `three` pinned to `0.186.1`, `@types/three` to `0.186.0`, `react-router-dom` to `6.30.6` | Exact versions resolved at T0 (repo layout requires pinning) |
| SEED-02 | `vitest` ^3 instead of ^2 | vitest 2 bundles vite 5 types, which do not typecheck against vite 6 in `vite.config.ts` |
| SEED-03 | pnpm with `onlyBuiltDependencies: ["esbuild"]` | pnpm 10 blocks install scripts by default |
| SEED-04 | `foundry_kernel/world_layout.py` is the single source of the city layout; the web's `manifest.fallback.json` is generated from it (`make manifest`) | Kernel manifest and offline manifest can never drift |
| SEED-05 | `foundry_kernel/security.py` holds `redact()` | Both kernel owners need it from the first hour |
| SEED-06 | `web/src/shared/contracts.ts` hand-mirrors the API objects; `src/api/schema.d.ts` is generated at merge time | Dashboard and world can be typed before the API exists |
| SEED-07 | World ↔ kernel traffic goes only through `web/src/shared/worldApi.ts` with a `?mock=1` fixture mode | The world is buildable and demoable without a kernel (also W-11) |
| SEED-08 | Capture page ↔ capture script handshake frozen in `web/src/world/probes/types.ts` | Worldgen (ayan) and the kit/probes (mahin) are built on different branches |
| SEED-09 | Fourth lane (Karthik, Claude Pro budget): voice end to end (kernel `voice/*` + `api/voice.py` from Ayan; `npc/visemes.ts`, `npc/LipSync.ts`, `conversation/{Mic,Stt,Speech}.ts` from Mahin) and the grounding eval (from Tanush) | Small, self-contained, well-specified pieces with pure-function tests; each is behind an interface the others already call |
| SEED-10 | `kit/props.contract.ts` freezes prop footprints; `LLMResult.audio` carries Gemini TTS output; `check_ownership.py --audit` | Removes the last cross-lane waits (worldgen prompt vs props, Gemini TTS fallback vs LLM client) and proves no file has two owners |
| SEED-11 | PS2 + Managed Agents entry (ADR-019), photoreal look (ADR-018), video critique + World Lab live round (ADR-020): adds `assets/manifest.contract.ts`, World Lab models in the contracts, `api/worldgen.py`, `worldgen/live.py`, `WEB_URL`, capture `playPath` + portrait mode, asset-pipeline deps. Lanes: Karthik takes the asset pipeline (+ voice); the grounding eval returns to Tanush | The world is the centrepiece of our track; assets unblock Mahin early; the eval tests Tanush's own code |
| SEED-12 | `kernel/data/agent_capabilities.json` (frozen) + `03-company-kernel/10-agent-model-matrix.md`: every agent's jobs → models, managed agents, tools, gates; `AgentRuntime` in the contracts. ADR-021 live voice calls: `VoiceSessionRequest/Info`, `conversation/VoiceCall.ts`, LipSync `level` source, `ELEVENLABS_AGENT_ID`/`VOICE_AGENT_MODE`/`PUBLIC_KERNEL_URL`, `@elevenlabs/client@1.26.0` | One source of truth for which agent runs on what; live calls owned by Karthik with frozen interfaces so Mahin/Tanush can wire them now |
