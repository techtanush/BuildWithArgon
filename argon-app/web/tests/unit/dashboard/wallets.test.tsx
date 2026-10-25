// OWNER: tanush
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Approval } from "../../../src/shared/contracts";
import { ApprovalCard } from "../../../src/dashboard/components/ApprovalCard";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AgentWallets, {
  type AgentWallet,
  type AgentWalletsData,
} from "../../../src/dashboard/pages/AgentWallets";
const state = vi.hoisted(() => ({
  post: vi.fn(),
  refresh: vi.fn(),
  data: null as AgentWalletsData | null,
}));
vi.mock("../../../src/api/client", () => ({ get: vi.fn(), post: state.post }));
vi.mock("../../../src/api/hooks", () => ({
  useQuery: (key: string) => ({
    data: key.endsWith("wallets")
      ? state.data
      : {
          items: [
            { id: "eng.builder", display_name: "Zara", title: "Builder" },
          ],
        },
    error: null,
    loading: false,
    refetch: state.refresh,
  }),
  invalidateQueries: () => {},
}));
vi.mock("../../../src/dashboard/context", () => ({
  useCompany: () => ({ ventureId: "ven_test" }),
}));
let root: Root | undefined, element: HTMLDivElement;
const pending: AgentWallet = {
  agent_id: "eng.builder",
  status: "pending_approval",
  wallet_id: null,
  address: null,
  approval_id: "apr_wallet",
  network: "base-sepolia",
  created_at: "2026-10-25T12:00:00Z",
  error: null,
};
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  state.post.mockReset();
  state.refresh.mockReset();
  state.data = {
    provider: "privy",
    configured: false,
    network: "base-sepolia",
    chain_id: 84532,
    mainnet_enabled: false,
    spending_enabled: false,
    wallet_limit: 50,
    wallets: [],
  };
  element = document.createElement("div");
  document.body.append(element);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  element.remove();
  vi.unstubAllGlobals();
});
async function render() {
  root = createRoot(element);
  await act(async () =>
    root!.render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <AgentWallets />
      </MemoryRouter>,
    ),
  );
}
async function click(label: string) {
  await act(async () =>
    [...element.querySelectorAll("button")]
      .find((button) => button.textContent === label)!
      .click(),
  );
}
it("requires server configuration and shows no invented address or unlimited free claim", async () => {
  await render();
  expect(element.textContent).toContain("Privy not connected");
  expect(element.textContent).toContain(
    "Add Privy App ID and App Secret on the server",
  );
  expect(element.textContent).toContain("testnet only");
  expect(element.querySelector("code")).toBeNull();
  expect(
    [...element.querySelectorAll("button")].find(
      (button) => button.textContent === "Create test wallet",
    )!.disabled,
  ).toBe(true);
  expect(element.textContent).not.toContain("unlimited");
  expect(state.post).not.toHaveBeenCalled();
});
it("records a real integration gate, then displays only the provisioned provider address", async () => {
  state.data!.configured = true;
  const address = "0x1234567890abcdef1234567890abcdef12345678";
  state.post.mockResolvedValueOnce(pending).mockResolvedValueOnce({
    ...pending,
    status: "ready",
    wallet_id: "privy_mock_test_wallet",
    address,
  });
  const copy = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: copy },
    configurable: true,
  });
  await render();
  await click("Create test wallet");
  expect(state.post).toHaveBeenCalledWith(
    "/v1/ventures/ven_test/agents/eng.builder/wallet",
    {},
  );
  expect(
    element.querySelector('a[href="/approvals?id=apr_wallet"]'),
  ).not.toBeNull();
  expect(element.querySelector("code")).toBeNull();
  await click("Retry wallet setup");
  expect(element.querySelector("code")!.textContent).toBe(address);
  expect(element.textContent).toContain("Mainnet and spending are disabled");
  await click("Copy address");
  expect(copy).toHaveBeenCalledWith(address);
});
it("shows server errors without manufacturing a wallet and offers refresh", async () => {
  state.data!.configured = true;
  state.post.mockRejectedValue(
    new Error("Add Privy App ID and App Secret on the server"),
  );
  await render();
  await click("Create test wallet");
  expect(element.querySelector('[role="alert"]')!.textContent).toContain(
    "Add Privy App ID and App Secret on the server",
  );
  expect(element.querySelector("code")).toBeNull();
  await click("Refresh wallets");
  expect(state.refresh).toHaveBeenCalled();
});

it("makes wallet integration approval limited to testnet provisioning", async () => {
  root = createRoot(element);
  const approval: Approval = {
    id: "apr_wallet",
    gate_type: "integration",
    status: "pending",
    title: "Create wallet",
    summary: "Provision a test wallet",
    payload: {
      purpose: "agent_wallet_create",
      provider: "privy",
      agent_id: "eng.builder",
      wallet_intent_id: "wallet_one",
      network: "base-sepolia",
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
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <ApprovalCard approval={approval} />
      </MemoryRouter>,
    ),
  );
  expect(element.textContent).toContain("Privy agent test wallet");
  expect(element.textContent).toContain("Agent: eng.builder");
  expect(element.textContent).toContain(
    "Mainnet, funding, signing, and spending are disabled",
  );
  expect(element.textContent).toContain(
    "Approval authorizes wallet provisioning only",
  );
});

it("shows provider provisioning separately from approval and disables duplicate setup", async () => {
  state.data!.configured = true;
  state.data!.wallets = [{ ...pending, status: "provisioning" }];
  await render();
  const setup = [...element.querySelectorAll("button")].find(
    (button) => button.textContent === "Provisioning wallet…",
  )!;
  expect(setup.disabled).toBe(true);
  expect(element.textContent).toContain("Wallet provisioning is in progress");
  expect(element.textContent).not.toContain("First approve the wallet request");
  expect(element.querySelector("code")).toBeNull();
  await click("Refresh wallets");
  expect(state.refresh).toHaveBeenCalled();
  expect(state.post).not.toHaveBeenCalled();
});
