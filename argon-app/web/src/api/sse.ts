// OWNER: tanush — seed version; replace/extend freely but keep the exported names.

// One EventSource per venture; pub/sub for hooks. Seed: interface only.
import type { SseEvent } from '../shared/contracts';

export type SseListener = (event: SseEvent) => void;

export function subscribe(_ventureId: string, _listener: SseListener): () => void {
  return () => {};
}
