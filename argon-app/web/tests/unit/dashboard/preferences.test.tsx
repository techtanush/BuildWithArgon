// OWNER: tanush
// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Integrations, Settings } from "../../../src/dashboard/pages/Company";

const state = vi.hoisted(() => ({
  responses: new Map<string, unknown>(),
  errors: new Map<string, Error>(),
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock("../../../src/api/client", async (original) => ({
  ...(await original<typeof import("../../../src/api/client")>()),
  get: state.get,
  post: state.post,
}));
vi.mock("../../../src/api/hooks", () => ({
  useQuery: (key: string) => ({
    data: state.responses.get(key),
    error: state.errors.get(key),
    loading: false,
    refetch: async () => {},
  }),
  invalidateQueries: () => {},
}));
vi.mock("../../../src/dashboard/context", () => ({
  useCompany: () => ({ ventureId: "ven_test" }),
}));
let root: Root | undefined, element: HTMLDivElement;
const settings = {
  founder_name: "Tanush",
  budget_usd: 25,
  autopilot_next: false,
  quality_default: "high",
  executor: "local",
  approval_id: null,
};
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  state.responses.clear();
  state.errors.clear();
  state.get.mockReset();
  state.post.mockReset();
  element = document.createElement("div");
  document.body.append(element);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  element.remove();
});
async function render(node: ReactNode) {
  root ??= createRoot(element);
  await act(async () =>
    root!.render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        {node}
      </MemoryRouter>,
    ),
  );
}
it("preserves unsaved preferences when company events refresh server settings", async () => {
  state.responses.set("/v1/ventures/ven_test/settings", settings);
  await render(<Settings />);
  const quality = element.querySelector("select")!;
  await act(async () => {
    quality.value = "low";
    quality.dispatchEvent(new Event("change", { bubbles: true }));
  });
  state.responses.set("/v1/ventures/ven_test/settings", {
    ...settings,
    founder_name: "Server refresh",
    budget_usd: 40,
  });
  await render(<Settings />);
  expect(element.querySelector("input")!.value).toBe("Tanush");
  expect(quality.value).toBe("low");
  state.post.mockResolvedValue({
    ...settings,
    quality_default: "low",
    approval_id: "apr_budget",
  });
  await act(async () =>
    element
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(state.post).toHaveBeenCalledWith("/v1/ventures/ven_test/settings", {
    founder_name: "Tanush",
    budget_usd: 25,
    autopilot_next: false,
    quality_default: "low",
  });
  expect(
    element.querySelector('a[href="/approvals?id=apr_budget"]'),
  ).not.toBeNull();
  expect(
    element.querySelector('input[type="number"]')!.getAttribute("value"),
  ).toBe("25");
});
it("shows unavailable integrations without inventing a connection approval", async () => {
  const unavailable = new Error("Integration service unavailable");
  state.errors.set("/v1/ventures/ven_test/integrations", unavailable);
  state.post.mockRejectedValue(unavailable);
  state.get.mockResolvedValue({ items: [] });
  await render(<Integrations />);
  expect(element.textContent).toContain("Unavailable");
  await act(async () =>
    [...element.querySelectorAll("button")]
      .find((button) => button.textContent === "Connect GitHub")!
      .click(),
  );
  expect(element.textContent).toContain("Integration service unavailable");
  expect(element.textContent).not.toContain(
    "Check Approvals for the GitHub connection request.",
  );
});
it("shows an approval notice only when the server recorded a pending integration gate", async () => {
  state.post.mockRejectedValue(new Error("Approval required"));
  state.get.mockResolvedValue({
    items: [{ id: "apr_connect", gate_type: "integration" }],
  });
  await render(<Integrations />);
  await act(async () =>
    [...element.querySelectorAll("button")]
      .find((button) => button.textContent === "Connect GitHub")!
      .click(),
  );
  expect(element.textContent).toContain(
    "Check Approvals for the GitHub connection request.",
  );
  expect(element.querySelector('[role="alert"]')).toBeNull();
});
