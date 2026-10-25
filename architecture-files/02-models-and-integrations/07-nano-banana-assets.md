# 07 — Nano Banana 2.1 Assets (portraits, textures, signs)

All image generation happens **offline** in the worldgen step (`foundry_kernel/worldgen/faces.py`
and `textures.py`) and the results are committed under `web/public/generated/`. The running
product never waits on image generation.

Model: `gemini-nano-banana-2.1` (job `portrait` / `texture`). Use `gemini-3.1-flash-lite-image`
only for quick drafts while iterating prompts. Image output parsing: VERIFY V6.

## 1. Agent portraits (29 images)

Output: `web/public/generated/portraits/<agent_id>.png`, 768×768 (or the closest supported size;
resize with Pillow if needed — add `pillow` to kernel deps when implementing).

Prompt template (fill from the agent's FaceSpec, see [`../05-world/05-characters-and-faces.md`](../05-world/05-characters-and-faces.md)):

```text
A friendly stylized 3D character portrait in the style of a soft, clay-like, low-poly animated
film. Head and shoulders, facing the camera, centered, neutral pleasant expression, mouth closed.
Character: {display_name}, {title} at a small software company.
Skin tone: {skin_tone_name}. Hair: {hair_style_name}, {hair_color_name}. Eyes: {eye_color_name}.
Accessory: {accessory_name or "none"}. Clothing: {outfit_name} in {department_color_name}.
Lighting: soft warm window light from the left, gentle fill, subtle rim light.
Background: plain soft {department_color_name} gradient, no text, no logos, no watermark.
```

Consistency: generate all 29 in one batch run; if the API supports reference images, pass the
first approved portrait as a style reference for the rest (VERIFY). Reject and regenerate (max 2
retries) if the image is not square or is mostly one color (mean pixel std < 12).

## 2. Tileable textures (8 images)

Output: `web/public/generated/textures/<name>.png`, 1024×1024. Prompt suffix for all:
`"Seamless tileable texture, orthographic top-down, flat even lighting, no shadows, no
perspective, no text, high detail, physically plausible colors."`

| `name` | Prompt subject | Used by material |
|---|---|---|
| `wood_planks` | warm medium-brown oak floor planks, satin finish, varied boards | `wood_floor` |
| `plaster` | smooth pale blue-grey painted plaster wall, very subtle variation | `plaster_wall` |
| `brick` | muted terracotta brick wall with light mortar | `brick` |
| `roof_tiles` | dark slate roof tiles | `roof` |
| `cobblestone` | light grey plaza cobblestones | `plaza_stone` |
| `asphalt` | clean dark asphalt with fine grain | `road` |
| `grass` | short bright lawn grass, stylized | `grass` |
| `fabric` | soft woven fabric, neutral | `fabric_*` (tinted in shader) |

Validation: tile 2×2 and compute the mean absolute difference across the seams vs. the interior; if
seam diff > 2× interior diff, fix by mirroring edges (`ImageOps` blend of 32 px border) — log it.

**Fallback:** if generation fails, `web/src/world/kit/textures.ts` generates procedural canvas
textures for every name (wood stripes with noise, plaster noise, brick pattern, etc.). The world
must look acceptable with fallbacks alone.

## 3. Building signs (13 images)

Output: `web/public/generated/signs/<department_id>.png`, 1536×384 (4:1). Prompt:

```text
A painted wooden shop sign for a storybook town, the words "{building_name}" in large, perfectly
spelled, legible serif lettering, small subtitle "{department_name}", warm cream background with a
thin {department_color_name} border, slight wood grain, front-on, no perspective, no other text.
```

Validate legibility by asking `gemini-3.8-flash` "What text is on this sign? Reply with the text
only." and comparing case-insensitively to `building_name`; regenerate up to 2 times. Fallback:
canvas-drawn sign with the same text.

## Costs & records

Each image call writes a `ledger` row (`kind='image'`). Prompts and outputs are recorded in
`kernel/data/worldgen/assets/<timestamp>/manifest.json`.
