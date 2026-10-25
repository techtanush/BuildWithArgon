import { afterEach, describe, expect, it, vi } from "vitest";
import { liveApi, mockApi, getWorldApi } from "../../../src/shared/worldApi";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
describe("WorldApi boundaries", () => {
  it("encodes identifiers and sends JSON with a bounded abort signal", async () => {
    const fetcher = vi.fn(async () => response({ data: { text: "ok" } }));
    vi.stubGlobal("fetch", fetcher);
    await liveApi.talk("v/a", "agent?b", { text: "hello", history: [] });
    expect(fetcher).toHaveBeenCalledWith(
      "/v1/ventures/v%2Fa/agents/agent%3Fb/talk",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
        body: JSON.stringify({ text: "hello", history: [] }),
      }),
    );
  });
  it.each([
    null,
    true,
    12,
    "text",
    {},
    { error: { message: "not an envelope" } },
  ])("rejects invalid successful body %j", async (body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(body)),
    );
    await expect(liveApi.answer("id")).rejects.toThrow("missing data envelope");
  });
  it("surfaces API errors without replacing them with invented fixture content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({ error: { message: "Not authorized" } }, 403),
      ),
    );
    await expect(liveApi.talk("v", "a", { text: "x" })).rejects.toThrow(
      "Not authorized",
    );
  });
  it("falls back to offline manifest only and returns independent copies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Error("network");
      }),
    );
    const first = await liveApi.manifest("v");
    expect(first.offline).toBe(true);
    expect(first.manifest.npcs).toHaveLength(29);
    first.manifest.npcs.length = 0;
    expect((await liveApi.manifest("v")).manifest.npcs).toHaveLength(29);
    await expect(liveApi.concierge("v", { text: "hello" })).rejects.toThrow(
      "network",
    );
  });
  it("aborts stalled fetch after twenty seconds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            ),
          ),
      ),
    );
    const result = liveApi.answer("id");
    const assertion = expect(result).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(20001);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("posts multipart audio without a manually wrong content-type", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      response({ data: { text: "speech" } }),
    );
    vi.stubGlobal("fetch", fetcher);
    await liveApi.transcribe(new Blob(["audio"], { type: "audio/webm" }));
    const init = fetcher.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("audio")).toBeInstanceOf(Blob);
    expect(init.headers).toBeUndefined();
  });
  it("keeps mock fixture mutations isolated between consumers", async () => {
    vi.useFakeTimers();
    const firstPromise = mockApi.concierge("v", { text: "q" });
    await vi.runAllTimersAsync();
    const first = await firstPromise;
    first.citations.length = 0;
    const secondPromise = mockApi.concierge("v", { text: "q" });
    await vi.runAllTimersAsync();
    expect((await secondPromise).citations.length).toBeGreaterThan(0);
    expect(getWorldApi("?mock=1").mode).toBe("mock");
  });
});

it("treats a malformed success manifest as offline rather than crashing the engine", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response({ data: null })),
  );
  const result = await liveApi.manifest("v");
  expect(result.offline).toBe(true);
  expect(result.manifest.npcs).toHaveLength(29);
});
