# Mahin integration requests

No frozen interface changes requested.

- Ayan: consume the implemented capture handshake and generated-module registry. User specifically requested https://santheftauto.com/ as generation inspiration. Use inspected reference imagery/game-feel as guidance, not copied assets/code; preserve Foundry's layout and noncombat purpose. Record real Argon provenance and iteration evidence.
- Karthik: populate the licensed asset manifest and replace your voice seed modules. Current renderer supports graceful no-asset and text/browser-speech fallback. Verify one real avatar/voice before scaling to the roster.
- Team: future PR must be made from an authenticated upstream checkout, applying this local patch. Current local Git was initialized from a downloaded branch archive because CLI authentication was absent. Never force-push this history.

## 2026-10-25 realistic character follow-up

User wants realistic, non-pixelated avatars and cited San Theft Auto's Elon Musk character workflow. Its inspected pipeline is concept images -> Meshy textured sculpt -> Blender runtime optimization, not a full walking/facial rig. Follow that asset-first process with ORIGINAL Foundry identities. Do not copy celebrity models/assets.

- Ayan: use Argon to orchestrate the modeling/assembly and render -> critic -> repair loop, using the official 3D workflow guide. Establish provenance and real visual comparisons; do not label the existing fallbacks Argon-generated.
- Karthik: supply one licensed full-body rigged GLB through the existing CharacterAsset contract, with bone names, blink/viseme targets, PBR textures, animations and LODs. Consider NVIDIA Audio2Face-3D for speech-driven animation AFTER the character exists; inference/service/voice timing are in your lane. ARKit/full-face coefficient support would need a separately approved contract extension rather than editing the frozen voice payload here.
- Mahin: retain the existing GLB/AvatarRig rendering consumer and review skin, eyes, hair, proportions, lighting and in-conversation quality against actual references. Current asset manifest is empty.

References: https://github.com/naderkhalil/santheftauto/blob/main/BLENDER_ASSETS.md ; https://github.com/NVIDIA/Audio2Face-3D-Samples ; https://github.com/NVIDIA/Audio2Face-3D-SDK ; https://aistudio.google.com/learn/building-3d-games-and-worlds-with-gemini-4-argon .

### Local renderer preview note (2026-10-25)
No frozen contract changes requested by the visual pass. The dev-only `assetBase` query parameter rebases a read-only loopback manifest for integration testing; production still reads `/assets/manifest.json`. The small original foliage card is a bundled renderer detail with provenance, not an asset-pipeline replacement. At merge, retain Karthik's newer canonical shared voice session types (including VoiceSessionInfo); do not overwrite them with this archive checkout's older frozen shared/contracts.ts. Larger PBR inventory and actual avatar/prop promotion still require integration review.
