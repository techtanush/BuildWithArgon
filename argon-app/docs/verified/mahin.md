# Verified integration contracts

- All 13 frozen department positions/road graph match the generated local layout.
- Engine consumes `worldApi` only; no API secrets or direct model calls enter frontend code.
- Character consumes Karthik's `LipSync.update/mouth`, `Speech.speak`, and `Stt.startListening` interfaces; borrowed implementation files unchanged.
- Capture supports frozen exterior/interior/portrait camera names and real-time 8s/6s paths.
- Every applicable P1/P2/P3/P4/P5/P6/P7/P8/P10 fallback browser probe passed across 26 pages. P9 and Argon visual/realism critiques are external and not claimed.
- Full local TypeScript and 148 unit tests passed; production bundle succeeded.
- Standalone Playwright runner is environment-blocked; connected-browser checks are recorded in build-logs/mahin.md.
