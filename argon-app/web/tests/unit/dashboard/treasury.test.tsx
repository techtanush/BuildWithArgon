// OWNER: tanush
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Approval } from "../../../src/shared/contracts";
import { ApprovalCard } from "../../../src/dashboard/components/ApprovalCard";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Treasury, {
  paymentMinor,
  type TreasuryData,
} from "../../../src/dashboard/pages/Treasury";
vi.mock("../../../src/dashboard/pages/AgentWallets", () => ({
  default: () => null,
}));
const state = vi.hoisted(() => ({
  post: vi.fn(),
  treasury: null as TreasuryData | null,
}));
vi.mock("../../../src/api/client", () => ({ get: vi.fn(), post: state.post }));
vi.mock("../../../src/api/hooks", () => ({
  useQuery: (key: string) => ({
    data: key.endsWith("treasury")
      ? state.treasury
      : {
          items: [
            { id: "eng.builder", display_name: "Zara", title: "Builder" },
          ],
        },
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
  state.post.mockReset();
  state.treasury = {
    status: "not_connected",
    provider: "stripe",
    currency: "USD",
    available_balance: null,
    allocations: [],
    reserved_today_minor: 0,
    policy: {
      per_payment_minor: 2500,
      daily_limit_minor: 10000,
      requires_approval: true,
    },
    proposals: [],
  };
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
        <Treasury />
      </MemoryRouter>,
    ),
  );
}
async function change(
  node: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    element
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
it("converts USD decimals exactly and rejects fractions of cents, exponent notation and unsafe numbers", () => {
  expect(paymentMinor("0.29")).toBe(29);
  expect(paymentMinor("10.01")).toBe(1001);
  expect(paymentMinor("25")).toBe(2500);
  expect(paymentMinor("1.2")).toBe(120);
  for (const value of [
    "",
    "0",
    "-1",
    "1e2",
    "0.001",
    "1.999",
    "Infinity",
    "1,000",
    ".5",
    "999999999999999999999999",
  ])
    expect(paymentMinor(value)).toBeNull();
});
it("shows disconnected balance and approved proposals without claiming a payment", async () => {
  state.treasury!.proposals = [
    {
      id: "pay_one",
      venture_id: "ven_test",
      agent_id: "eng.builder",
      amount_minor: 100,
      currency: "USD",
      recipient: "Vendor",
      purpose: "Test invoice",
      idempotency_key: "retry_key",
      status: "approved_pending_provider",
      approval_id: "apr_one",
      created_at: "2026-10-25T12:00:00Z",
      decided_at: null,
    },
  ];
  await render();
  expect(element.textContent).toContain("Stripe not connected");
  expect(element.textContent).toContain("Unavailable");
  expect(element.textContent).toContain("Approval does not move money");
  expect(element.textContent).toContain("Approved · awaiting payment provider");
  expect(
    element.querySelector('a[href="/approvals?id=apr_one"]'),
  ).not.toBeNull();
});
it("records integer cents and reuses the idempotency key after a failed response", async () => {
  state.post
    .mockRejectedValueOnce(new Error("Connection lost"))
    .mockResolvedValueOnce({
      id: "pay_one",
      status: "pending_approval",
      approval_id: "apr_one",
    });
  await render();
  const inputs = element.querySelectorAll("input");
  await change(inputs[0], "0.29");
  await change(inputs[1], "Vendor");
  await change(element.querySelector("textarea")!, "Invoice for a domain");
  await submit();
  await submit();
  expect(state.post).toHaveBeenCalledTimes(2);
  const first = state.post.mock.calls[0],
    second = state.post.mock.calls[1];
  expect(first[0]).toBe("/v1/ventures/ven_test/treasury/proposals");
  expect(first[1]).toMatchObject({
    agent_id: "eng.builder",
    amount_minor: 29,
    currency: "USD",
    recipient: "Vendor",
    purpose: "Invoice for a domain",
  });
  expect(first[1].idempotency_key).toBe(second[1].idempotency_key);
  expect(element.textContent).toContain("No money has moved");
});

it("shows a treasury spend gate as a payment decision rather than an API budget increase", async () => {
  root = createRoot(element);
  const approval: Approval = {
    id: "apr_payment",
    gate_type: "spend",
    title: "Pay invoice",
    summary: "Domain purchase proposal",
    status: "pending",
    requested_by_agent_id: "eng.builder",
    ticket_id: null,
    created_at: "2026-10-25T12:00:00Z",
    decided_at: null,
    decided_by: null,
    decision_note: null,
    payload: {
      purpose: "treasury_payment",
      amount_minor: 1299,
      currency: "USD",
      recipient: "Domain vendor",
      purpose_text: "Annual domain renewal",
    },
  };
  await act(async () =>
    root!.render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <ApprovalCard approval={approval} />
      </MemoryRouter>,
    ),
  );
  expect(element.textContent).toContain("Agent payment proposal · $12.99");
  expect(element.textContent).toContain("Domain vendor");
  expect(element.textContent).toContain("Annual domain renewal");
  expect(element.textContent).toContain("Approval does not move money");
  expect(element.textContent).not.toContain("Requested increase");
  expect(element.textContent).not.toContain("Current budget");
});
