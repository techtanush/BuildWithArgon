// OWNER: tanush
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get, post } from "../../api/client";
import { invalidateQueries, useQuery } from "../../api/hooks";
import type { Agent, ListPage } from "../../shared/contracts";
import { useCompany } from "../context";
import WalletPayments from "./WalletPayments";
import {
  Card,
  Empty,
  ErrorNotice,
  Loading,
  useAction,
} from "../components/Shared";

export interface AgentWallet {
  agent_id: string;
  status: "pending_approval" | "provisioning" | "ready" | "error";
  wallet_id: string | null;
  address: string | null;
  approval_id: string;
  network: "base-sepolia" | "base";
  created_at: string;
  error: string | null;
}
export interface AgentWalletsData {
  provider: "privy";
  configured: boolean;
  network: "base-sepolia" | "base";
  chain_id: 84532 | 8453;
  mainnet_enabled: boolean;
  spending_enabled: boolean;
  wallet_limit: number;
  wallets: AgentWallet[];
}
const labels = {
  pending_approval: "Approval / setup pending",
  provisioning: "Provisioning wallet…",
  ready: "Wallet ready",
  error: "Setup failed · retry available",
};
export default function AgentWallets() {
  const { ventureId } = useCompany(),
    action = useAction();
  const key = ventureId ? `/v1/ventures/${ventureId}/wallets` : null;
  const query = useQuery<AgentWalletsData>(key, () => get(key!));
  const agents = useQuery<ListPage<Agent>>(
    ventureId ? `/v1/ventures/${ventureId}/agents` : null,
    () => get(`/v1/ventures/${ventureId}/agents`),
  );
  const [selected, setSelected] = useState(""),
    [result, setResult] = useState<AgentWallet | null>(null),
    [copied, setCopied] = useState("");
  useEffect(() => {
    if (!selected && agents.data?.items.length)
      setSelected(agents.data.items[0].id);
  }, [agents.data, selected]);
  const active =
    result?.agent_id === selected
      ? result
      : query.data?.wallets.find((wallet) => wallet.agent_id === selected);
  const wallets = [
    ...new Map(
      [...(query.data?.wallets ?? []), ...(result ? [result] : [])].map(
        (wallet) => [wallet.agent_id, wallet],
      ),
    ).values(),
  ];
  async function create() {
    if (!selected) return;
    await action.run(async () => {
      const wallet = await post<AgentWallet>(
        `/v1/ventures/${ventureId}/agents/${encodeURIComponent(selected)}/wallet`,
        {},
      );
      setResult(wallet);
      invalidateQueries(key!);
      invalidateQueries(`/v1/ventures/${ventureId}/approvals`);
    });
  }
  return (
    <Card title="Agent wallets · Privy">
      <div className="notice">
        <strong>
          {query.data
            ? query.data.network === "base"
              ? "Base mainnet · real funds"
              : "Base Sepolia · testnet only"
            : "Wallet network unavailable"}{" "}
          (chain {query.data?.chain_id ?? "not loaded"}).
        </strong>{" "}
        Privy creates a network-agnostic EVM address.{" "}
        {query.data
          ? query.data.spending_enabled
            ? "USDC spending requires a separate founder-approved standing policy."
            : "Spending is disabled by the server configuration."
          : "Spending configuration is not available yet."}{" "}
        Wallet creation approval alone does not authorize payments.
      </div>
      <ErrorNotice
        error={query.error ?? agents.error ?? action.error}
        retry={() => Promise.all([query.refetch(), agents.refetch()])}
      />
      {query.loading ? (
        <Loading />
      ) : (
        query.data && (
          <>
            {query.data.configured ? (
              <p>
                Privy credentials are configured on the server. A founder
                approval is required before a wallet can be provisioned.
              </p>
            ) : (
              <p className="notice">
                <strong>Privy not connected.</strong> Add Privy App ID and App
                Secret on the server, then refresh. Credentials never belong in
                this form.
              </p>
            )}
            <p className="muted">
              Up to {query.data.wallet_limit} agent wallets in this workspace.
              Provider limits and pricing still apply.
            </p>
            <div className="settings-form">
              <label>
                Wallet agent
                <select
                  value={selected}
                  disabled={action.working}
                  onChange={(event) => {
                    setSelected(event.target.value);
                    setResult(null);
                  }}
                >
                  <option value="">Choose an agent</option>
                  {agents.data?.items.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.display_name} · {agent.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="actions">
                <button
                  className="button primary"
                  disabled={
                    action.working ||
                    !query.data.configured ||
                    !selected ||
                    active?.status === "ready" ||
                    active?.status === "provisioning"
                  }
                  onClick={() => void create()}
                >
                  {action.working
                    ? "Setting up wallet…"
                    : active?.status === "provisioning"
                      ? "Provisioning wallet…"
                      : active?.status === "ready"
                        ? "Wallet ready"
                        : active
                          ? "Retry wallet setup"
                          : "Create wallet"}
                </button>
                <button
                  className="button"
                  disabled={action.working}
                  onClick={() => {
                    setResult(null);
                    void query.refetch();
                  }}
                >
                  Refresh wallets
                </button>
              </div>
            </div>
            {active && (
              <div className="notice" role="status">
                <strong>{labels[active.status]}</strong>
                {active.status === "provisioning" ? (
                  <p>
                    Wallet provisioning is in progress. Refresh wallets to check
                    the provider result.
                  </p>
                ) : (
                  active.status !== "ready" && (
                    <p>
                      First approve the wallet request, then retry wallet setup
                      to provision it. Setup in progress may remain pending
                      until the next refresh.
                    </p>
                  )
                )}
                <Link
                  to={`/approvals?id=${encodeURIComponent(active.approval_id)}`}
                >
                  Review wallet approval →
                </Link>
                {active.error && <p>{active.error}</p>}
              </div>
            )}
            {wallets.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th>Status</th>
                      <th>Wallet address</th>
                      <th>Approval</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wallets.map((wallet) => (
                      <tr key={wallet.agent_id}>
                        <td>{wallet.agent_id}</td>
                        <td>{labels[wallet.status]}</td>
                        <td>
                          {wallet.status === "ready" && wallet.address ? (
                            <>
                              <code>{wallet.address}</code>
                              <button
                                className="button small"
                                onClick={() =>
                                  void action.run(async () => {
                                    if (!navigator.clipboard)
                                      throw new Error(
                                        "Copy is unavailable. Select the address to copy it.",
                                      );
                                    await navigator.clipboard.writeText(
                                      wallet.address!,
                                    );
                                    setCopied(wallet.agent_id);
                                  })
                                }
                              >
                                {copied === wallet.agent_id
                                  ? "Copied"
                                  : "Copy address"}
                              </button>
                            </>
                          ) : (
                            "Not provisioned"
                          )}
                        </td>
                        <td>
                          <Link
                            to={`/approvals?id=${encodeURIComponent(wallet.approval_id)}`}
                          >
                            Review approval
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No agent wallets created">
                A wallet address appears only after approval and successful
                provisioning by Privy.
              </Empty>
            )}
            {active?.status === "ready" && ventureId && (
              <WalletPayments
                key={`${ventureId}:${selected}`}
                ventureId={ventureId}
                agentId={selected}
              />
            )}
          </>
        )
      )}
    </Card>
  );
}
