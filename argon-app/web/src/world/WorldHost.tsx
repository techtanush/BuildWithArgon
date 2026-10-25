// OWNER: mahin — seed version; replace/extend freely but keep the exported names.

// Mounts Engine + Hud (05-world/01-world-overview.md). Seed: placeholder that proves the data path.
import { useEffect, useState } from 'react';
import { getWorldApi } from '../shared/worldApi';
import type { Manifest } from '../shared/contracts';

export default function WorldHost() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const venture = new URLSearchParams(location.search).get('venture');
    getWorldApi().manifest(venture).then((r) => { setManifest(r.manifest); setOffline(r.offline); });
  }, []);
  return (
    <main style={{ padding: 32 }}>
      <h1>The view (world not built yet — owner: mahin)</h1>
      <p>{manifest ? `${manifest.buildings.length} buildings, ${manifest.npcs.length} NPCs` : 'Loading manifest…'}</p>
      {offline && <p>Conversations unavailable (kernel offline) — using the fallback manifest.</p>}
    </main>
  );
}
