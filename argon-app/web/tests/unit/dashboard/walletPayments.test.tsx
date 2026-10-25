// OWNER: tanush
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Approval } from "../../../src/shared/contracts";
import { ApprovalCard } from "../../../src/dashboard/components/ApprovalCard";
import WalletPayments, {
  exactUnits,
  formatUnits,
  type SpendingPolicy,
  type WalletPayment,
  type WalletPaymentsData,
  type WalletBalance,
} from "../../../src/dashboard/pages/WalletPayments";
const state = vi.hoisted(() => ({
  post: vi.fn(),
  refresh: vi.fn(),
  data: null as WalletPaymentsData | null,
  balance: null as WalletBalance | null,
}));
vi.mock("../../../src/api/client", () => ({ get: vi.fn(), post: state.post }));
vi.mock("../../../src/api/hooks", () => ({
  useQuery: (key: string) => ({
    data: key.endsWith("/payments") ? state.data : state.balance,
    error: null,
    loading: false,
    refetch: state.refresh,
  }),
  invalidateQueries: () => {},
}));
vi.mock("../../../src/dashboard/context", () => ({
  useCompany: () => ({ venture: { founder_name: "Tanush" } }),
}));
let root: Root | undefined, element: HTMLDivElement;
const address = "0x1234567890abcdef1234567890abcdef12345678",
  base = "/v1/ventures/ven_test/agents/eng.builder/wallet";
function policy(): SpendingPolicy {
  return {
    id: "policy_one",
    wallet_id: "wallet_one",
    chain_id: 84532,
    recipients: [address],
    per_payment_minor: 500,
    daily_limit_minor: 1000,
    total_limit_minor: 2500,
    max_gas_fee_wei: "1000000000000000",
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    status: "active",
    approval_id: "apr_policy",
    policy_hash: "hash_exact",
    created_at: "2026-10-25T12:00:00Z",
  };
}
function payment(status: WalletPayment["status"]): WalletPayment {
  return {
    id: "payment_one",
    policy_id: "policy_one",
    recipient: address,
    amount_minor: 29,
    purpose: "Agent service",
    idempotency_key: "test_retry_key",
    status,
    tx_hash:
      status === "submitted" || status === "confirmed" ? "0xtransaction" : null,
    error: null,
    created_at: "2026-10-25T12:00:00Z",
    updated_at: "2026-10-25T12:00:00Z",
  };
}
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  state.post.mockReset();
  state.refresh.mockReset();
  const balances = {
    status: "ready" as const,
    native_balance_wei: "1230000000000000",
    usdc_balance_units: "290001",
    usdc_contract: "0xusdc_contract",
    error: null,
  };
  state.data = {
    wallet: { wallet_id: "wallet_one", address, status: "ready" },
    chain_id: 84532,
    network: "base-sepolia",
    payments_enabled: true,
    balance: balances,
    policies: [policy()],
    payments: [],
  };
  state.balance = {
    ...balances,
    wallet_id: "wallet_one",
    address,
    chain_id: 84532,
    network: "base-sepolia",
    payments_enabled: true,
    asset: "USDC",
    native_asset: "ETH",
    funding_instructions:
      "Use Base Sepolia ETH and the exact USDC contract shown.",
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
        <WalletPayments ventureId="ven_test" agentId="eng.builder" />
      </MemoryRouter>,
    ),
  );
}
async function change(label: string, value: string) {
  const node = [...element.querySelectorAll("label")]
    .find((item) => item.textContent!.startsWith(label))!
    .querySelector<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("input,textarea,select")!;
  await act(async () => {
    if (node instanceof HTMLSelectElement) {
      node.value = value;
      node.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      Object.getOwnPropertyDescriptor(
        node instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        "value",
      )!.set!.call(node, value);
      node.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}
async function submit(index: number) {
  await act(async () =>
    element
      .querySelectorAll("form")
      [
        index
      ].dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
async function click(text: string) {
  await act(async () =>
    [...element.querySelectorAll("button")]
      .find((button) => button.textContent === text)!
      .click(),
  );
}
it("converts cents and gas exactly without floating point or fractional cents", () => {
  expect(exactUnits("0.29", 2)).toBe("29");
  expect(exactUnits("0.001", 18)).toBe("1000000000000000");
  for (const value of ["0", "1e3", "-1", "0.001", "Infinity"])
    expect(exactUnits(value, 2)).toBeNull();
  expect(formatUnits("290001", 6)).toBe("0.290001");
  expect(formatUnits(null, 18)).toBe("Unavailable");
});
it("displays measured funding balances and honest missing RPC data", async () => {
  await render();
  expect(element.textContent).toContain("0.00123");
  expect(element.textContent).toContain("0.290001");
  expect(element.textContent).toContain("Use Base Sepolia ETH");
  await click("Refresh balances");
  expect(state.refresh).toHaveBeenCalled();
});
it("never substitutes a zero balance when the provider cannot read balances", async () => {
  state.balance = {
    ...state.balance!,
    status: "error",
    native_balance_wei: null,
    usdc_balance_units: null,
    error: "RPC unavailable",
  };
  await render();
  expect(element.textContent).toContain("RPC unavailable");
  expect(element.textContent).toContain("Unavailable");
  expect(element.textContent).not.toContain("0.290001");
});
it("requests the exact standing policy and can revoke it immediately", async () => {
  state.post
    .mockResolvedValueOnce({
      ...policy(),
      id: "policy_pending",
      status: "pending_approval",
    })
    .mockResolvedValueOnce({ ...policy(), status: "revoked" });
  await render();
  const localExpiry = new Date(Date.now() + 86400000)
    .toISOString()
    .slice(0, 16);
  await change("Allowed recipient addresses", address);
  await change("Policy expiry", localExpiry);
  await submit(0);
  expect(state.post).toHaveBeenNthCalledWith(1, `${base}/policies`, {
    chain_id: 84532,
    recipients: [address],
    per_payment_minor: 500,
    daily_limit_minor: 1000,
    total_limit_minor: 2500,
    max_gas_fee_wei: "1000000000000000",
    expires_at: new Date(localExpiry).toISOString(),
  });
  expect(
    element.querySelector('a[href="/approvals?id=apr_policy"]'),
  ).not.toBeNull();
  await click("Revoke policy · stop new payments");
  expect(state.post).toHaveBeenLastCalledWith(
    `${base}/policies/policy_one/revoke`,
    {},
  );
  expect(
    [...element.querySelectorAll("button")].find(
      (button) => button.textContent === "Transfer USDC",
    )!.disabled,
  ).toBe(true);
});
it("reuses transfer idempotency on retry and distinguishes submitted from confirmed receipt", async () => {
  state.post
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockResolvedValueOnce(payment("submitted"))
    .mockResolvedValueOnce(payment("confirmed"));
  await render();
  await change("Transfer recipient", address);
  await change("Transfer amount", "0.29");
  await change("Payment purpose", "Agent service");
  await submit(1);
  await submit(1);
  expect(state.post.mock.calls[0][0]).toBe(`${base}/payments`);
  expect(state.post.mock.calls[0][1]).toMatchObject({
    policy_id: "policy_one",
    amount_minor: 29,
    recipient: address,
    purpose: "Agent service",
  });
  expect(state.post.mock.calls[0][1].idempotency_key).toBe(
    state.post.mock.calls[1][1].idempotency_key,
  );
  expect(element.textContent).toContain("Submitted · awaiting confirmation");
  expect(element.textContent).not.toContain("Confirmed on chain");
  await click("Refresh receipt");
  expect(state.post).toHaveBeenLastCalledWith(
    `${base}/payments/payment_one/refresh`,
    {},
  );
  expect(element.textContent).toContain("Confirmed on chain");
});
it("keeps uncertain outcomes distinct from paid and follows server mainnet configuration", async () => {
  state.data = {
    ...state.data!,
    network: "base",
    chain_id: 8453,
    payments: [payment("uncertain")],
  };
  await render();
  expect(element.textContent).toContain("Base mainnet · real funds");
  expect(element.textContent).toContain(
    "Uncertain · check receipt before any new payment",
  );
  expect(element.textContent).not.toContain("Confirmed on chain");
});
it("shows the full autonomous spending scope before founder approval", async () => {
  root = createRoot(element);
  const approval: Approval = {
    id: "apr_policy",
    gate_type: "integration",
    status: "pending",
    title: "USDC policy",
    summary: "Review exact scope",
    payload: {
      purpose: "agent_wallet_spending",
      agent_id: "eng.builder",
      chain_id: 84532,
      policy_hash: "hash_exact",
      policy: policy(),
    },
    requested_by_agent_id: "eng.builder",
    ticket_id: null,
    created_at: "2026-10-25T12:00:00Z",
    decided_at: null,
    decided_by: null,
    decision_note: null,
  };
  await act(async () =>
    root!.render(
      <MemoryRouter>
        <ApprovalCard approval={approval} />
      </MemoryRouter>,
    ),
  );
  expect(element.textContent).toContain("Autonomous USDC spending policy");
  expect(element.textContent).toContain(address);
  expect(element.textContent).toContain("$5.00 per payment");
  expect(element.textContent).toContain("$10.00 daily");
  expect(element.textContent).toContain("$25.00 lifetime");
  expect(element.textContent).toContain("hash_exact");
  expect(element.textContent).toContain(
    "without a new approval for each payment",
  );
});
