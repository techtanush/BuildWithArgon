// OWNER: mahin — seed version; replace/extend freely but keep the exported names.

// The ONLY way world code talks to the kernel. Live mode uses the API contract; mock mode
// (`?mock=1` or VITE_WORLD_MOCK=1) uses fixtures in src/world/data/mock/ so the world can be built
// and demoed without a running kernel. W-11: if the manifest fetch fails, fall back to
// manifest.fallback.json and report conversations unavailable.
import type {
  AnswerCheck,
  Citation,
  ConciergeResponse,
  LatencySample,
  Manifest,
  StandupLatest,
  SttResponse,
  TalkRequest,
  TalkResponse,
  TtsResponse,
} from "./contracts";
import fallbackManifest from "../world/data/manifest.fallback.json";
import mockTalk from "../world/data/mock/talk.json";
import mockConcierge from "../world/data/mock/concierge.json";
import mockStandup from "../world/data/mock/standup.json";

export interface WorldApi {
  readonly mode: "live" | "mock";
  manifest(
    ventureId: string | null,
  ): Promise<{ manifest: Manifest; offline: boolean }>;
  talk(
    ventureId: string,
    agentId: string,
    req: TalkRequest,
  ): Promise<TalkResponse>;
  concierge(ventureId: string, req: TalkRequest): Promise<ConciergeResponse>;
  tts(agentId: string, text: string): Promise<TtsResponse>;
  transcribe(audio: Blob): Promise<SttResponse>;
  standupLatest(ventureId: string): Promise<StandupLatest>;
  answer(
    answerId: string,
  ): Promise<{
    id: string;
    text: string;
    citations: Citation[];
    check: AnswerCheck;
  }>;
  postLatency(samples: LatencySample[]): Promise<void>;
}

async function call<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = 20000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, { ...init, signal: controller.signal });
    const body = await res.json().catch(() => null);
    if (!res.ok)
      throw new Error(
        typeof body?.error?.message === "string"
          ? body.error.message
          : `HTTP ${res.status}`,
      );
    if (!body || typeof body !== "object" || !("data" in body))
      throw new Error("Invalid API response: missing data envelope");
    return body.data as T;
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error("Request timed out. Please try again.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const liveApi: WorldApi = {
  mode: "live",
  async manifest(ventureId) {
    try {
      const q = ventureId ? `?venture=${encodeURIComponent(ventureId)}` : "";
      const manifest = await call<Manifest>(
        `/v1/world/manifest${q}`,
        undefined,
        2500,
      );
      if (
        !manifest ||
        !Number.isFinite(manifest.version) ||
        !Array.isArray(manifest.npcs) ||
        !Array.isArray(manifest.buildings) ||
        !Array.isArray(manifest.roads?.nodes) ||
        !Array.isArray(manifest.roads?.edges) ||
        !manifest.plaza?.concierge ||
        !manifest.plaza?.spawn
      )
        throw new Error("Invalid world manifest");
      return { manifest, offline: false };
    } catch {
      return {
        manifest: structuredClone(fallbackManifest) as unknown as Manifest,
        offline: true,
      };
    }
  },
  talk: (v, a, req) =>
    call(
      `/v1/ventures/${encodeURIComponent(v)}/agents/${encodeURIComponent(a)}/talk`,
      json(req),
    ),
  concierge: (v, req) =>
    call(`/v1/ventures/${encodeURIComponent(v)}/concierge/ask`, json(req)),
  tts: (agent_id, text) => call("/v1/voice/tts", json({ agent_id, text })),
  transcribe: (audio) => {
    const form = new FormData();
    form.append("audio", audio, "audio.webm");
    return call("/v1/voice/transcribe", { method: "POST", body: form });
  },
  standupLatest: (v) =>
    call(`/v1/ventures/${encodeURIComponent(v)}/standups/latest`),
  answer: (id) => call(`/v1/answers/${encodeURIComponent(id)}`),
  postLatency: async (samples) => {
    await call("/v1/telemetry/latency", json({ samples }));
  },
};

const delay = <T>(v: T, ms = 600) =>
  new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), ms));

export const mockApi: WorldApi = {
  mode: "mock",
  manifest: async () => ({
    manifest: fallbackManifest as unknown as Manifest,
    offline: false,
  }),
  talk: (_v, agentId) =>
    delay({
      ...(mockTalk as unknown as TalkResponse),
      answer_id: `ans_mock_${agentId}`,
    }),
  concierge: () => delay(mockConcierge as unknown as ConciergeResponse),
  tts: () =>
    delay(
      {
        audio_url: null,
        mime: null,
        alignment: null,
        provider: "browser",
        latency_ms: 0,
      } as TtsResponse,
      50,
    ),
  transcribe: () =>
    delay({ text: "", provider: "none", latency_ms: 0 } as SttResponse, 50),
  standupLatest: () => delay(mockStandup as unknown as StandupLatest),
  answer: async (id) => {
    const fixture = id.includes("concierge") ? mockConcierge : mockTalk;
    return {
      id,
      text: fixture.text,
      citations: structuredClone(fixture.citations),
      check: structuredClone(fixture.check) as AnswerCheck,
    };
  },
  postLatency: async () => {},
};

export function getWorldApi(
  search: string = typeof location !== "undefined" ? location.search : "",
): WorldApi {
  const mock =
    new URLSearchParams(search).get("mock") === "1" ||
    import.meta.env?.VITE_WORLD_MOCK === "1";
  return mock ? mockApi : liveApi;
}
