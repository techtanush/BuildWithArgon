# Asset pipeline (owner: karthik)

Spec: `architecture-files/05-world/12-photoreal-look.md` §3–4. Contract:
`web/src/world/assets/manifest.contract.ts` (frozen).

```
pnpm assets:fetch   # download everything in assets.lock.json -> public/assets/raw/ (gitignored)
pnpm assets:build   # optimize -> public/assets/{textures,models,hdri,characters,vehicles}/ (gitignored)
                    #           + public/assets/manifest.json + public/assets/CREDITS.md (committed)
pnpm assets         # both
```

`assets.lock.json` is the only hand-edited file: which Poly Haven / ambientCG / Rocketbox asset fills
which material key, prop kind, HDRI slot and avatar, at what resolution, with its sha256.
