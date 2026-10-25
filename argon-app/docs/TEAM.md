# Team

We enter **Problem Statement 2 — More Dimensions** and **Best use of Managed Agents** (ADR-019).

| Person | Branch | Owns | Work order |
|---|---|---|---|
| Tanush | `tanush` | Kernel core + the company (DB, API, scheduler, 11 non-engineering department handlers, coordination, group chat, conversation + citation checker, manifest route, grounding eval) **and the dashboard, incl. the World Lab page** | `WORKORDER_TANUSH.md` |
| Ayan | `ayan` | Models & integrations (LLM client, smoke tests), autonomous engineering loop (executors, Antigravity, Composio/GitHub, support), Cua computers, **the world loop** (one-pass generation, capture with video, realism critique, patch, score, live round + World Lab API, portraits from renders) | `WORKORDER_AYAN.md` |
| Mahin | `mahin` | **The photoreal 3D world**: renderer/lighting/post, PBR kit, city dressing, buildings (fallbacks), player, car, navigation/race/fast travel, realistic avatars, conversation UI/HUD, capture page + probes, performance | `WORKORDER_MAHIN.md` |
| Karthik | `karthik` | **Photoreal asset pipeline** (CC0 textures, HDRIs, models, avatars → manifest) and **voice end to end** (kernel TTS/STT + voice assignment + `/v1/voice/*`; browser mic, STT, speech playback, visemes, lip-sync) — a smaller lane sized for a Claude Pro budget | `WORKORDER_KARTHIK.md` |

Full split, frozen contracts and the merge plan:
[`../../architecture-files/06-execution/07-team-split.md`](../../architecture-files/06-execution/07-team-split.md).
