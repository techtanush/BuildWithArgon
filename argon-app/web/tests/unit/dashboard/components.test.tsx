// OWNER: tanush
// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Markdown,
  Portrait,
  runtimeLabels,
  Sources,
} from "../../../src/dashboard/components/Shared";
import CallPanel from "../../../src/dashboard/components/CallPanel";
import { safeUrl } from "../../../src/dashboard/types";
import type {
  Agent,
  AgentRuntime,
  TalkResponse,
} from "../../../src/shared/contracts";
import type {
  VoiceCallHandle,
  VoiceCallOptions,
} from "../../../src/world/conversation/VoiceCall";

const voice = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("../../../src/world/conversation/VoiceCall", () => ({
  startVoiceCall: voice.start,
}));
vi.mock("../../../src/api/sse", () => ({ subscribe: () => () => {} }));
let root: Root | undefined, element: HTMLDivElement;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  element = document.createElement("div");
  document.body.append(element);
  voice.start.mockReset();
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  element.remove();
  vi.restoreAllMocks();
});
async function render(node: ReactNode) {
  root = createRoot(element);
  await act(async () => root!.render(<MemoryRouter>{node}</MemoryRouter>));
}
const agent: Agent = {
  id: "eng.builder",
  department_id: "engineering",
  display_name: "Zara",
  title: "Builder",
  role_summary: "Build verified software",
  model: "gemini-4-argon",
  tools: ["github"],
  persona: "Careful",
  voice_id: null,
  portrait_url: null,
  face: null,
  npc_slot: "engineering.bench-1",
  is_lead: false,
};
const answer: TalkResponse = {
  answer_id: "ans_one",
  text: "The pantry brief is recorded.",
  citations: [
    {
      kind: "artifact",
      id: "art_one",
      quote: "Pantry brief",
      label: "Recorded brief",
    },
  ],
  check: { status: "verified", reason: "Exact quote", per_citation: [] },
  suggested_agent: {
    agent_id: "intake.brief-lead",
    reason: "They own the brief.",
  },
  latency_ms: 12,
};

describe("safe company content", () => {
  it("renders markdown tables and code while treating embedded HTML as text", async () => {
    await render(
      <Markdown
        text={
          '# Findings\n\n| Item | Cost |\n| --- | --- |\n| Milk | $3 |\n\n```html\n<script>window.attack=true</script>\n```\n<img src=x onerror="attack()">'
        }
      />,
    );
    expect(element.querySelectorAll("table tbody tr")).toHaveLength(1);
    expect(element.querySelector("table")?.textContent).toContain("Milk");
    expect(element.querySelectorAll("script,img")).toHaveLength(0);
    expect(element.querySelector("pre")?.textContent).toContain("<script>");
  });
  it("does not turn unsafe or protocol-relative links into navigation", async () => {
    await render(
      <Markdown
        text={
          "[Safe](https://example.com) [Local](/tickets/tkt_one) [Unsafe](javascript:alert) [Hidden](//evil.example)"
        }
      />,
    );
    expect(
      [...element.querySelectorAll("a")].map((link) =>
        link.getAttribute("href"),
      ),
    ).toEqual(["https://example.com", "/tickets/tkt_one"]);
    for (const url of [
      "data:text/html,hello",
      "javascript:alert(1)",
      "//evil.example",
      "/\\evil.example",
      "file:///tmp/key",
    ])
      expect(safeUrl(url)).toBeUndefined();
    expect(safeUrl("/preview/ven_one/tkt_one/index.html")).toBe(
      "/preview/ven_one/tkt_one/index.html",
    );
  });
  it("summarizes the work model, managed surface and tools without duplicate labels", () => {
    const runtime: AgentRuntime = {
      jobs: [
        {
          job: "engineering_build",
          model: "gemini-4-argon",
          thinking_level: "high",
          purpose: "work",
        },
        {
          job: "engineering_fix",
          model: "gemini-4-argon",
          thinking_level: "high",
          purpose: "work",
        },
        {
          job: "talk",
          model: "gemini-3.8-flash",
          thinking_level: null,
          purpose: "conversation",
        },
      ],
      managed_agents: ["antigravity"],
      tools: ["antigravity", "github", "cua"],
      gates: [],
      voice_call: true,
    };
    expect(runtimeLabels(runtime)).toEqual([
      "Argon high",
      "Antigravity sandbox",
      "GitHub",
      "Cua",
    ]);
  });
  it("falls back to initials when a generated portrait cannot load", async () => {
    await render(
      <Portrait agent={{ ...agent, portrait_url: "/missing.png" }} />,
    );
    await act(async () =>
      element.querySelector("img")!.dispatchEvent(new Event("error")),
    );
    expect(element.querySelector("img")).toBeNull();
    expect(element.textContent).toBe("Z");
  });
  it("keeps citations and agent referrals visible", async () => {
    await render(<Sources answer={answer} />);
    expect(element.textContent).toContain("Recorded brief");
    expect(element.textContent).toContain("Pantry brief");
    expect(
      element.querySelector('a[href="/agents/intake.brief-lead"]')?.textContent,
    ).toContain("They own the brief.");
  });
});

describe("dashboard voice-call panel", () => {
  it("reports unavailable voice without removing the text conversation surface", async () => {
    const handle: VoiceCallHandle = {
      status: "unavailable",
      end: vi.fn(async () => {}),
      setMuted: vi.fn(),
    };
    voice.start.mockImplementation(async (options: VoiceCallOptions) => {
      options.onStatus?.("unavailable", "Provider credentials missing");
      return handle;
    });
    await render(
      <CallPanel agent={agent} ventureId="ven_one" onClose={() => {}} />,
    );
    expect(voice.start.mock.calls[0][0]).toMatchObject({
      agentId: "eng.builder",
      ventureId: "ven_one",
      surface: "dashboard",
    });
    expect(element.textContent).toContain(
      "Voice calls unavailable. You can keep typing in the Talk box.",
    );
    expect(element.textContent).not.toContain("credentials");
    const mute = [...element.querySelectorAll("button")].find(
      (button) => button.textContent === "Mute",
    )!;
    expect(mute.disabled).toBe(true);
  });
  it("shows live transcripts and cited answers, supports mute, and closes the call", async () => {
    const end = vi.fn(async () => {}),
      mute = vi.fn(),
      close = vi.fn();
    voice.start.mockResolvedValue({ status: "listening", end, setMuted: mute });
    await render(
      <CallPanel agent={agent} ventureId="ven_one" onClose={close} />,
    );
    const options = voice.start.mock.calls[0][0] as VoiceCallOptions;
    await act(async () => {
      options.onTranscript?.({ role: "user", text: "What is the brief?" });
      options.onTranscript?.({ role: "agent", text: answer.text });
      options.onAnswer?.(answer);
    });
    expect(element.textContent).toContain("What is the brief?");
    expect(element.textContent).toContain("Recorded brief");
    await act(async () =>
      [...element.querySelectorAll("button")]
        .find((button) => button.textContent === "Mute")!
        .click(),
    );
    expect(mute).toHaveBeenCalledWith(true);
    await act(async () =>
      [...element.querySelectorAll("button")]
        .find((button) => button.textContent === "End call")!
        .click(),
    );
    expect(close).toHaveBeenCalledOnce();
    await act(async () => root!.unmount());
    root = undefined;
    expect(end).toHaveBeenCalledOnce();
  });
  it("ends a session that resolves after the panel was closed", async () => {
    let resolve: (value: VoiceCallHandle) => void = () => {};
    voice.start.mockImplementation(
      () =>
        new Promise<VoiceCallHandle>((done) => {
          resolve = done;
        }),
    );
    await render(
      <CallPanel agent={agent} ventureId="ven_one" onClose={() => {}} />,
    );
    await act(async () => root!.unmount());
    root = undefined;
    const end = vi.fn(async () => {});
    await act(async () =>
      resolve({ status: "listening", end, setMuted: () => {} }),
    );
    expect(end).toHaveBeenCalledOnce();
  });
});
