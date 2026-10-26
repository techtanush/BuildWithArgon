import { afterEach, describe, it, expect, vi } from "vitest";
import {
  ConversationController,
  sourceRoute,
} from "../../../src/world/conversation/ConversationController";
import { mockApi, liveApi, type WorldApi } from "../../../src/shared/worldApi";
import type { ManifestNpc, TalkResponse } from "../../../src/shared/contracts";
import manifest from "../../../src/world/data/manifest.fallback.json";
import talk from "../../../src/world/data/mock/talk.json";
const npc = manifest.npcs.find(
  (n) => n.agent_id !== "concierge",
) as ManifestNpc;
const response = talk as TalkResponse;
const voice = () => ({
  started: Promise.resolve(performance.now()),
  done: Promise.resolve(),
  stop: vi.fn(),
});
function api(): WorldApi {
  return {
    ...mockApi,
    talk: vi.fn(async () => structuredClone(response)),
    tts: vi.fn(async () => ({
      audio_url: null,
      mime: null,
      alignment: null,
      provider: "browser" as const,
      latency_ms: 0,
    })),
    postLatency: vi.fn(async () => {}),
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("conversation orchestration", () => {
  it("sends capped per-agent history, preserves it after reopening", async () => {
    const service = api();
    const c = new ConversationController({
      api: service,
      ventureId: "v",
      speak: voice,
    });
    c.open(npc);
    for (let i = 0; i < 5; i++) await c.send(`question ${i}`);
    expect(service.talk).toHaveBeenLastCalledWith(
      "v",
      npc.agent_id,
      expect.objectContaining({ history: expect.any(Array) }),
    );
    const calls = vi.mocked(service.talk).mock.calls;
    expect(calls[4][2].history).toHaveLength(6);
    expect(c.state.turns).toHaveLength(6);
    c.close();
    c.open(npc);
    expect(c.state.turns).toHaveLength(6);
    c.dispose();
  });
  it("ignores stale answers after leaving", async () => {
    let resolve!: (r: TalkResponse) => void;
    const service = api();
    service.talk = () => new Promise((r) => (resolve = r));
    const c = new ConversationController({
      api: service,
      ventureId: "v",
      speak: voice,
    });
    c.open(npc);
    const pending = c.send("hello");
    c.close();
    resolve(response);
    await pending;
    expect(c.state.phase).toBe("idle");
    expect(c.state.response).toBeNull();
    expect(service.tts).not.toHaveBeenCalled();
    c.dispose();
  });
  it("transcribes a hold and sends actual transcript", async () => {
    const service = api();
    const c = new ConversationController({
      api: service,
      ventureId: "v",
      speak: voice,
      listen: async () => ({
        stop: async () => ({
          text: "my question",
          provider: "browser",
          latency_ms: 10,
        }),
        cancel: vi.fn(),
      }),
    });
    c.open(npc);
    await c.startPushToTalk();
    expect(c.state.phase).toBe("listening");
    await c.stopPushToTalk();
    expect(service.talk).toHaveBeenCalledWith("v", npc.agent_id, {
      text: "my question",
      history: [],
    });
    c.dispose();
  });
  it("polls pending evidence without claiming verified itself", async () => {
    vi.useFakeTimers();
    const service = api();
    service.talk = async () => ({
      ...response,
      check: { status: "pending", per_citation: [], reason: "" },
    });
    service.answer = vi.fn(async () => ({
      id: response.answer_id,
      text: response.text,
      citations: response.citations,
      check: response.check,
    }));
    const c = new ConversationController({
      api: service,
      ventureId: "v",
      speak: voice,
      pollIntervalMs: 20,
    });
    c.open(npc);
    await c.send("check");
    expect(c.state.response?.check.status).toBe("pending");
    await vi.advanceTimersByTimeAsync(21);
    expect(c.state.response?.check.status).toBe("verified");
    c.dispose();
  });
  it("exposes encoded local source routes, never arbitrary links", () => {
    expect(sourceRoute({ kind: "ticket", id: "a/b" })).toBe("/tickets/a%2Fb");
    expect(sourceRoute({ kind: "message", id: "a&b" })).toBe(
      "/chat?message=a%26b",
    );
    expect(sourceRoute({ kind: "file", id: "https://evil.test" })).toBeNull();
  });
  it("falls back to text/browser speech when TTS fails", async () => {
    const service = api();
    service.tts = async () => {
      throw Error("offline");
    };
    const c = new ConversationController({
      api: service,
      ventureId: "v",
      speak: voice,
    });
    c.open(npc);
    await c.send("hello");
    expect(c.state.voiceUnavailable).toBe(true);
    expect(c.state.response?.text).toBe(response.text);
    expect(c.state.phase).toBe("engaged");
    c.dispose();
  });
  it("uses the documented answer endpoint", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: { id: "a", check: response.check } }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    await liveApi.answer("a/b");
    expect(fetcher).toHaveBeenCalledWith(
      "/v1/answers/a%2Fb",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

describe("greetings and cancellation boundaries", () => {
  it("greets explicitly, caches repeated text, and keeps factual history clean", async () => {
    const service = api();
    const say = vi.fn(voice);
    const c = new ConversationController({
      api: service,
      ventureId: "v",
      speak: say,
    });
    c.open(npc);
    expect(service.tts).not.toHaveBeenCalled();
    await c.greet("Welcome.");
    await c.greet("Welcome.");
    expect(service.tts).toHaveBeenCalledTimes(1);
    expect(c.state.turns).toHaveLength(0);
    c.close();
    c.open(npc);
    await c.greet();
    expect(c.state.caption).toBe("Hi again.");
    c.dispose();
  });
  it("retains greeting text if TTS and local speech fail", async () => {
    const service = api();
    service.tts = async () => {
      throw Error("offline");
    };
    const c = new ConversationController({
      api: service,
      ventureId: "v",
      speak: () => {
        throw Error("no device");
      },
    });
    c.open(npc);
    await c.greet("Hello.");
    expect(c.state.caption).toBe("Hello.");
    expect(c.state.voiceUnavailable).toBe(true);
    expect(c.state.phase).toBe("engaged");
    c.dispose();
  });
  it("does not play stale greeting audio after close", async () => {
    const service = api();
    let resolve!: (value: Awaited<ReturnType<WorldApi["tts"]>>) => void;
    service.tts = () => new Promise((r) => (resolve = r));
    const say = vi.fn(voice);
    const c = new ConversationController({
      api: service,
      ventureId: "v",
      speak: say,
    });
    c.open(npc);
    const greeting = c.greet("Hello.");
    c.close();
    resolve({
      audio_url: null,
      mime: null,
      alignment: null,
      provider: "browser",
      latency_ms: 0,
    });
    await greeting;
    expect(say).not.toHaveBeenCalled();
    expect(c.state.phase).toBe("idle");
    c.dispose();
  });
  it("cancels a microphone session whose permission resolves after close", async () => {
    let resolve!: (value: {
      stop: () => Promise<{
        text: string;
        provider: "none";
        latency_ms: number;
      }>;
      cancel: () => void;
    }) => void;
    const cancel = vi.fn();
    const c = new ConversationController({
      api: api(),
      ventureId: "v",
      listen: () => new Promise((r) => (resolve = r)),
    });
    c.open(npc);
    const start = c.startPushToTalk();
    c.close();
    resolve({
      stop: async () => ({ text: "", provider: "none", latency_ms: 0 }),
      cancel,
    });
    await start;
    expect(cancel).toHaveBeenCalledOnce();
    expect(c.state.phase).toBe("idle");
    c.dispose();
  });
  it("blocks factual requests when offline and ignores unrelated evidence events", async () => {
    const service = api();
    const c = new ConversationController({
      api: service,
      ventureId: "v",
      offline: true,
      speak: voice,
    });
    c.open(npc);
    await c.send("question");
    expect(service.talk).not.toHaveBeenCalled();
    expect(c.state.error).toContain("offline");
    c.applyCheck("other", {
      status: "verified",
      per_citation: [],
      reason: "x",
    });
    expect(c.state.response).toBeNull();
    c.dispose();
  });
});

describe("speech cancellation", () => {
  it("settles send when a borrowed speech stop never resolves done", async () => {
    const stop = vi.fn();
    let voiceStarted!: () => void;
    const started = new Promise<void>((r) => (voiceStarted = r));
    const c = new ConversationController({
      api: api(),
      ventureId: "v",
      speak: () => {
        voiceStarted();
        return {
          started: Promise.resolve(performance.now()),
          done: new Promise<void>(() => {}),
          stop,
        };
      },
    });
    c.open(npc);
    const sending = c.send("hello");
    await started;
    c.close();
    await sending;
    expect(stop).toHaveBeenCalledOnce();
    expect(c.state.phase).toBe("idle");
    c.dispose();
  });
});

it("rejects oversized typed questions before HTTP and excludes failed history", async () => {
  const service = api();
  const c = new ConversationController({ api: service, ventureId: "v", audioEnabled: false });
  c.open(npc);
  await c.send("a".repeat(4001));
  expect(service.talk).not.toHaveBeenCalled();
  expect(c.state.error).toContain("4,000");
  vi.mocked(service.talk).mockRejectedValueOnce(new Error("Provider unavailable"));
  await c.send("failed question");
  expect(c.state.error).toBe("Provider unavailable");
  await c.send("retry question");
  expect(service.talk).toHaveBeenLastCalledWith("v", npc.agent_id, {text: "retry question", history: []});
  c.dispose();
});
