// OWNER: mahin — seed version; replace/extend freely but keep the exported names.

// Dev-only /view/capture?building=<dept>&mode=exterior|interior&source=staging|generated|fallback
// (05-world/10-render-critique-loop.md §1). Must set window.__foundryProbe (see probes/types.ts).
// Seed: reports "not implemented" so ayan's capture script can be developed against the handshake.
import { useEffect } from 'react';
import '../probes/types';

export default function CapturePage() {
  useEffect(() => {
    window.__foundryProbe = {
      ready: true,
      error: 'capture page not implemented yet (owner: mahin)',
      setCamera: async () => {},
    };
  }, []);
  return <div id="capture-root" style={{ width: 1280, height: 720, background: '#9FC7E8' }} />;
}
