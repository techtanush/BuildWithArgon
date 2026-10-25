// OWNER: tanush
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { get, post } from "../../api/client";
import { invalidateQueries, useQuery } from "../../api/hooks";
import type { Agent, ListPage } from "../../shared/contracts";
import { useCompany } from "../context";
import { currency } from "../types";
import AgentWallets from "./AgentWallets";
import {
  Card,
  Empty,
  ErrorNotice,
  Loading,
  PageHeader,
  useAction,
} from "../components/Shared";

export interface PaymentProposal {
  id: string;
  venture_id: string;
  agent_id: string;
  amount_minor: number;
  currency: "USD";
  recipient: string;
  purpose: string;
  idempotency_key: string;
  status: "pending_approval" | "approved_pending_provider" | "rejected";
  approval_id: string;
  created_at: string;
  decided_at: string | null;
}
export interface TreasuryData {
  status: "not_connected";
  provider: "stripe";
  available_balance: number | null;
  currency: "USD";
  policy: {
    per_payment_minor: number;
    daily_limit_minor: number;
    requires_approval: true;
  };
  allocations: unknown[];
  reserved_today_minor: number;
  proposals: PaymentProposal[];
}
export function paymentMinor(value: string): number | null {
  const text = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [dollars, cents = ""] = text.split(".");
  const minor = BigInt(dollars) * 100n + BigInt(cents.padEnd(2, "0"));
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
}
const proposalStatus = {
  pending_approval: "Waiting for founder approval",
  approved_pending_provider: "Approved · awaiting payment provider",
  rejected: "Rejected · no money moved",
};
export default function Treasury() {
  const { ventureId } = useCompany(),
    action = useAction();
  const key = ventureId ? `/v1/ventures/${ventureId}/treasury` : null;
  const query = useQuery<TreasuryData>(key, () => get(key!));
  const agents = useQuery<ListPage<Agent>>(
    ventureId ? `/v1/ventures/${ventureId}/agents` : null,
    () => get(`/v1/ventures/${ventureId}/agents`),
  );
  const [agent, setAgent] = useState(""),
    [amount, setAmount] = useState(""),
    [recipient, setRecipient] = useState(""),
    [purpose, setPurpose] = useState(""),
    [validation, setValidation] = useState(""),
    [submitted, setSubmitted] = useState<PaymentProposal | null>(null);
  const retryKey = useRef<string | null>(null);
  useEffect(() => {
    if (!agent && agents.data?.items.length) setAgent(agents.data.items[0].id);
  }, [agents.data, agent]);
  useEffect(() => {
    if (!amount && query.data)
      setAmount((query.data.policy.per_payment_minor / 100).toFixed(2));
  }, [query.data]);
  function edit() {
    retryKey.current = null;
    setValidation("");
    setSubmitted(null);
  }
  async function propose() {
    const minor = paymentMinor(amount),
      policy = query.data?.policy;
    if (
      minor === null ||
      !policy ||
      !agent ||
      !recipient.trim() ||
      !purpose.trim()
    ) {
      setValidation(
        "Choose an agent, a positive USD amount with at most two decimal places, a recipient, and a purpose.",
      );
      return;
    }
    if (
      minor > policy.per_payment_minor ||
      (!retryKey.current &&
        minor + (query.data?.reserved_today_minor ?? 0) >
          policy.daily_limit_minor)
    ) {
      setValidation(
        "This proposal exceeds the per-payment or daily approval policy. Reduce the amount.",
      );
      return;
    }
    setValidation("");
    retryKey.current ??= crypto.randomUUID();
    await action.run(async () => {
      const proposal = await post<PaymentProposal>(`${key}/proposals`, {
        agent_id: agent,
        amount_minor: minor,
        currency: "USD",
        recipient: recipient.trim(),
        purpose: purpose.trim(),
        idempotency_key: retryKey.current,
      });
      setSubmitted(proposal);
      invalidateQueries(key!);
      invalidateQueries(`/v1/ventures/${ventureId}/approvals`);
    });
  }
  return (
    <>
      <PageHeader
        title="Treasury"
        description="Agent payment proposals, with a founder decision before every payment."
      />
      <AgentWallets />
      <div className="notice">
        <strong>Stripe not connected.</strong> This workspace cannot move money.
        Approval does not move money. Approved proposals wait for a payment
        provider.
      </div>
      <ErrorNotice
        error={query.error ?? agents.error ?? action.error ?? validation}
        retry={() => Promise.all([query.refetch(), agents.refetch()])}
      />
      {query.loading ? (
        <Loading />
      ) : (
        query.data && (
          <>
            <div className="kpi-grid">
              <Card title="Available wallet balance">
                <strong className="kpi-value">Unavailable</strong>
                <p>
                  Stripe is not connected. No funded wallet or agent allocations
                  have been verified.
                </p>
              </Card>
              <Card title="Payment approval policy">
                <p>
                  {currency(query.data.policy.per_payment_minor / 100)} per
                  payment
                </p>
                <p>
                  {currency(query.data.policy.daily_limit_minor / 100)} per UTC
                  day
                </p>
                <strong>Every proposal requires founder approval.</strong>
              </Card>
              <Card title="Reserved proposals today">
                <strong className="kpi-value">
                  {currency(query.data.reserved_today_minor / 100)}
                </strong>
                <p>
                  Proposal reservations only. This is not money paid or a wallet
                  balance.
                </p>
              </Card>
            </div>
            <p className="muted">
              Treasury payment limits are separate from the model and tool API
              budget in Settings.
            </p>
            <Card title="Propose an agent payment">
              <form
                className="settings-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void propose();
                }}
              >
                <label>
                  Agent
                  <select
                    value={agent}
                    disabled={action.working}
                    required
                    onChange={(event) => {
                      edit();
                      setAgent(event.target.value);
                    }}
                  >
                    <option value="">Choose an agent</option>
                    {agents.data?.items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.display_name} · {item.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Amount (USD)
                  <input
                    value={amount}
                    inputMode="decimal"
                    placeholder="25.00"
                    maxLength={20}
                    required
                    disabled={action.working}
                    onChange={(event) => {
                      edit();
                      setAmount(event.target.value);
                    }}
                  />
                  <small>
                    Use up to two decimal places. Amounts are stored as exact
                    integer cents.
                  </small>
                </label>
                <label>
                  Recipient
                  <input
                    value={recipient}
                    maxLength={320}
                    required
                    disabled={action.working}
                    onChange={(event) => {
                      edit();
                      setRecipient(event.target.value);
                    }}
                  />
                </label>
                <label>
                  Purpose
                  <textarea
                    value={purpose}
                    maxLength={2000}
                    required
                    disabled={action.working}
                    onChange={(event) => {
                      edit();
                      setPurpose(event.target.value);
                    }}
                  />
                </label>
                <button
                  className="button primary"
                  disabled={
                    action.working ||
                    !agents.data?.items.length ||
                    Boolean(submitted)
                  }
                >
                  {action.working
                    ? "Recording proposal…"
                    : "Request payment approval"}
                </button>
                {submitted && (
                  <div className="notice" role="status">
                    Proposal recorded. {proposalStatus[submitted.status]}. No
                    money has moved.{" "}
                    <Link
                      to={`/approvals?id=${encodeURIComponent(submitted.approval_id)}`}
                    >
                      Review approval →
                    </Link>
                  </div>
                )}
              </form>
            </Card>
            <Card title="Payment proposals">
              {query.data.proposals.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Agent / recipient</th>
                        <th>Amount</th>
                        <th>Purpose</th>
                        <th>Status</th>
                        <th>Decision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.proposals.map((proposal) => (
                        <tr key={proposal.id}>
                          <td>
                            {proposal.agent_id}
                            <small>{proposal.recipient}</small>
                          </td>
                          <td>{currency(proposal.amount_minor / 100)}</td>
                          <td>{proposal.purpose}</td>
                          <td>{proposalStatus[proposal.status]}</td>
                          <td>
                            <Link
                              to={`/approvals?id=${encodeURIComponent(proposal.approval_id)}`}
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
                <Empty title="No payment proposals yet">
                  An agent payment begins with a recorded proposal and an
                  explicit founder decision.
                </Empty>
              )}
            </Card>
          </>
        )
      )}
    </>
  );
}
