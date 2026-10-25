// OWNER: tanush
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Metrics } from "../../../src/dashboard/pages/Company";

const responses = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../../../src/api/hooks", () => ({
  useQuery: (key: string) => ({
    data: responses.get(key),
    error: null,
    loading: false,
    refetch: async () => {},
  }),
  invalidateQueries: () => {},
}));
vi.mock("../../../src/dashboard/context", () => ({
  useCompany: () => ({ ventureId: "ven_test" }),
}));
let root: Root | undefined, element: HTMLDivElement;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  responses.clear();
  element = document.createElement("div");
  document.body.append(element);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  element.remove();
});
async function render() {
  root = createRoot(element);
  await act(async () =>
    root!.render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Metrics />
      </MemoryRouter>,
    ),
  );
}

it("keeps fake quality evidence explicit and shows failed builds in the raw table", async () => {
  responses.set("/v1/ventures/ven_test/metrics", {
    engineering: {
      n: 1,
      first_run_pass_rate: 0,
      loop_pass_rate: 0,
      avg_iterations: 3,
      first_pass_n: 1,
      final_pass_n: 1,
      cost_per_shipped_task: null,
      tickets: [
        {
          ticket_id: "tkt_failed",
          title: "PDF export",
          status: "failed",
          first_pass_passed: false,
          final_passed: false,
          iterations: 3,
          tests_passed: 2,
          tests_failed: 1,
          cost_usd: 1.5,
        },
      ],
    },
    grounding: {
      n: 30,
      accuracy: 1,
      citation_accuracy: 1,
      answerer: "fake",
      capability_evidence: false,
    },
    world: { final_score: null },
    latency: { n: 0, p50_ms: null, p90_ms: null, by_stage: {} },
  });
  responses.set("/v1/evals/latest", {
    engineering: null,
    world: null,
    grounding: null,
  });
  await render();
  expect(element.textContent).toContain("fake evaluation");
  expect(element.textContent).toContain(
    "This is not live model quality evidence.",
  );
  expect(
    element.querySelector('a[href="/tickets/tkt_failed"]')?.textContent,
  ).toBe("PDF export");
  expect(element.querySelector("table tbody tr")?.textContent).toContain(
    "Failed",
  );
  expect(
    element.querySelector(
      'svg[aria-label="Engineering hidden acceptance test pass rates"]',
    ),
  ).toBeNull();
});

it("renders baseline comparisons only from recorded hidden-test evidence and preserves failed cases", async () => {
  responses.set("/v1/evals/latest", {
    grounding: null,
    world: null,
    engineering: {
      suite: "engineering",
      created_at: "2026-10-25T12:00:00Z",
      answerer: "live",
      capability_evidence: true,
      items: [
        {
          id: "evl_a",
          case_id: "split-bill",
          condition: "baseline",
          metrics: {
            all_hidden_pass: false,
            hidden_passed: 2,
            hidden_total: 3,
          },
        },
        {
          id: "evl_b",
          case_id: "split-bill",
          condition: "loop",
          metrics: { all_hidden_pass: true, hidden_passed: 3, hidden_total: 3 },
        },
      ],
    },
  });
  await render();
  expect(
    element.querySelector(
      'svg[aria-label="Engineering hidden acceptance test pass rates"]',
    ),
  ).not.toBeNull();
  expect(element.textContent).toContain("Baseline · n=1");
  expect(element.textContent).toContain("Loop · n=1");
  expect(element.textContent).toContain("failures included");
  expect(element.querySelectorAll("table tbody tr")).toHaveLength(2);
  expect(element.querySelector("table tbody tr")?.textContent).toContain(
    "false",
  );
});

it("labels failed live evaluations without claiming fake answers or live capability", async () => {
  responses.set("/v1/ventures/ven_test/metrics", {
    grounding: {
      n: 30,
      accuracy: 0,
      answerer: "live",
      capability_evidence: false,
    },
  });
  await render();
  expect(element.textContent).toContain("Live evidence unavailable");
  expect(element.textContent).toContain(
    "No successful live model call was recorded.",
  );
  expect(element.textContent).not.toContain("Implementation check only");
  expect(element.textContent).toContain(
    "This is not live model quality evidence.",
  );
});
