// OWNER: tanush
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { get, post } from "../../api/client";
import { invalidateQueries, useQuery } from "../../api/hooks";
import { currency } from "../types";
import {
  Card,
  Empty,
  ErrorNotice,
  Loading,
  useAction,
} from "../components/Shared";

export interface SpendingPolicy {
  id: string;
  wallet_id: string;
  chain_id: 84532 | 8453;
  recipients: string[];
  per_payment_minor: number;
  daily_limit_minor: number;
  total_limit_minor: number;
  max_gas_fee_wei: string;
  expires_at: string;
  status: "pending_approval" | "active" | "rejected" | "revoked" | "expired";
  approval_id: string;
  policy_hash: string;
  created_at: string;
}
export interface WalletPayment {
  id: string;
  policy_id: string;
  recipient: string;
  amount_minor: number;
  purpose: string;
  idempotency_key: string;
  status:
    | "preparing"
    | "dispatching"
    | "submitted"
    | "confirmed"
    | "reverted"
    | "failed"
    | "uncertain";
  tx_hash: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}
export interface WalletPaymentsData {
  wallet: { wallet_id: string; address: string; status: string };
  chain_id: 84532 | 8453;
  network: "base-sepolia" | "base";
  payments_enabled: boolean;
  balance: {
    status: "ready" | "error";
    native_balance_wei: string | null;
    usdc_balance_units: string | null;
    usdc_contract: string | null;
    error: string | null;
  };
  policies: SpendingPolicy[];
  payments: WalletPayment[];
}
export interface WalletBalance {
  wallet_id: string;
  address: string;
  chain_id: 84532 | 8453;
  network: string;
  payments_enabled: boolean;
  status: "ready" | "error";
  native_balance_wei: string | null;
  usdc_balance_units: string | null;
  usdc_contract: string | null;
  error: string | null;
  asset: "USDC";
  native_asset: "ETH";
  funding_instructions: string;
}
export function exactUnits(value: string, decimals: number): string | null {
  const text = value.trim();
  if (
    !new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(text) ||
    text.length > 80
  )
    return null;
  const [whole, fraction = ""] = text.split(".");
  const units =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0"));
  return units > 0n ? String(units) : null;
}
export function formatUnits(value: string | null, decimals: number): string {
  if (value === null || !/^\d+$/.test(value)) return "Unavailable";
  const raw = value.padStart(decimals + 1, "0"),
    fraction = raw.slice(-decimals).replace(/0+$/, "");
  return `${raw.slice(0, -decimals)}${fraction ? `.${fraction}` : ""}`;
}
function cents(value: string): number | null {
  const units = exactUnits(value, 2);
  return units !== null && BigInt(units) <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(units)
    : null;
}
const paymentLabels: Record<WalletPayment["status"], string> = {
  preparing: "Preparing · not submitted",
  dispatching: "Dispatching · outcome not yet known",
  submitted: "Submitted · awaiting confirmation",
  confirmed: "Confirmed on chain",
  reverted: "Reverted on chain",
  failed: "Failed",
  uncertain: "Uncertain · check receipt before any new payment",
};
export default function WalletPayments({
  ventureId,
  agentId,
}: {
  ventureId: string;
  agentId: string;
}) {
  const base = `/v1/ventures/${ventureId}/agents/${encodeURIComponent(agentId)}/wallet`,
    action = useAction();
  const query = useQuery<WalletPaymentsData>(`${base}/payments`, () =>
    get(`${base}/payments`),
  );
  const balance = useQuery<WalletBalance>(`${base}/balance`, () =>
    get(`${base}/balance`),
  );
  const [recipients, setRecipients] = useState(""),
    [perPayment, setPerPayment] = useState("5.00"),
    [daily, setDaily] = useState("10.00"),
    [total, setTotal] = useState("25.00"),
    [gas, setGas] = useState("0.001"),
    [expiry, setExpiry] = useState("");
  const [policyResult, setPolicyResult] = useState<SpendingPolicy | null>(null),
    [policyId, setPolicyId] = useState(""),
    [recipient, setRecipient] = useState(""),
    [amount, setAmount] = useState(""),
    [purpose, setPurpose] = useState(""),
    [transferResult, setTransferResult] = useState<WalletPayment | null>(null),
    [validation, setValidation] = useState(""),
    [copied, setCopied] = useState(false);
  const retryKey = useRef<string | null>(null);
  useEffect(() => {
    setPolicyResult(null);
    setTransferResult(null);
  }, [query.data]);
  const policies = [
    ...new Map(
      [
        ...(query.data?.policies ?? []),
        ...(policyResult ? [policyResult] : []),
      ].map((item) => [item.id, item]),
    ).values(),
  ];
  const payments = [
    ...new Map(
      [
        ...(query.data?.payments ?? []),
        ...(transferResult ? [transferResult] : []),
      ].map((item) => [item.id, item]),
    ).values(),
  ];
  const activePolicies = policies.filter(
    (policy) =>
      policy.status === "active" && Date.parse(policy.expires_at) > Date.now(),
  );
  const selectedPolicy =
    activePolicies.find((policy) => policy.id === policyId) ??
    activePolicies[0];
  const funds = balance.data ?? query.data?.balance;
  function refresh() {
    invalidateQueries(base);
    invalidateQueries(`/v1/ventures/${ventureId}/approvals`);
  }
  function editTransfer() {
    retryKey.current = null;
    setTransferResult(null);
    setValidation("");
  }
  async function requestPolicy() {
    const addresses = recipients.split(/[\s,]+/).filter(Boolean),
      per = cents(perPayment),
      day = cents(daily),
      lifetime = cents(total),
      gasWei = exactUnits(gas, 18),
      expires = new Date(expiry);
    if (
      !addresses.length ||
      addresses.length > 32 ||
      addresses.some((address) => !/^0x[0-9a-fA-F]{40}$/.test(address)) ||
      per === null ||
      day === null ||
      lifetime === null ||
      !gasWei ||
      Number.isNaN(expires.getTime()) ||
      expires.getTime() <= Date.now() ||
      expires.getTime() > Date.now() + 30 * 86400000
    ) {
      setValidation(
        "Enter valid EVM recipient addresses, positive exact USD limits, a gas ceiling, and an expiry within the next 30 days.",
      );
      return;
    }
    if (
      per > 2500 ||
      day > 10000 ||
      lifetime > 100000 ||
      BigInt(gasWei) > 1000000000000000n
    ) {
      setValidation(
        "Maximum limits: $25 per payment, $100 per day, $1,000 lifetime, and 0.001 ETH gas per payment.",
      );
      return;
    }
    if (per > day || day > lifetime) {
      setValidation(
        "Daily limit must cover the per-payment limit, and lifetime limit must cover the daily limit.",
      );
      return;
    }
    setValidation("");
    await action.run(async () => {
      const policy = await post<SpendingPolicy>(`${base}/policies`, {
        chain_id: query.data!.chain_id,
        recipients: addresses,
        per_payment_minor: per,
        daily_limit_minor: day,
        total_limit_minor: lifetime,
        max_gas_fee_wei: gasWei,
        expires_at: expires.toISOString(),
      });
      setPolicyResult(policy);
      refresh();
    });
  }
  async function transfer() {
    const minor = cents(amount);
    if (
      !selectedPolicy ||
      minor === null ||
      !selectedPolicy.recipients.some(
        (address) => address.toLowerCase() === recipient.trim().toLowerCase(),
      ) ||
      !purpose.trim()
    ) {
      setValidation(
        "Select an active policy, an allowed recipient, an exact positive USDC amount, and a purpose.",
      );
      return;
    }
    if (minor > selectedPolicy.per_payment_minor) {
      setValidation("Amount exceeds this policy’s per-payment limit.");
      return;
    }
    setValidation("");
    retryKey.current ??= crypto.randomUUID();
    await action.run(async () => {
      const payment = await post<WalletPayment>(`${base}/payments`, {
        policy_id: selectedPolicy.id,
        recipient: recipient.trim(),
        amount_minor: minor,
        purpose: purpose.trim(),
        idempotency_key: retryKey.current,
      });
      setTransferResult(payment);
      refresh();
    });
  }
  return (
    <section aria-label="Autonomous wallet payments">
      <h2>Agent spending · USDC</h2>
      <ErrorNotice
        error={query.error ?? balance.error ?? action.error ?? validation}
        retry={() => Promise.all([query.refetch(), balance.refetch()])}
      />
      {query.loading ? (
        <Loading />
      ) : (
        query.data && (
          <>
            <div className="notice">
              <strong>
                {query.data.network === "base"
                  ? "Base mainnet · real funds"
                  : "Base Sepolia · test funds"}{" "}
                (chain {query.data.chain_id}).
              </strong>{" "}
              {query.data.payments_enabled
                ? "Agents can transfer USDC autonomously within a founder-approved standing policy."
                : "Payments are disabled by the server configuration."}{" "}
              Revoking a policy blocks new payments; it cannot undo a submitted
              transaction.
            </div>
            <Card title="Funding and live balances">
              <p>
                Wallet address: <code>{query.data.wallet.address}</code>{" "}
                <button
                  className="button small"
                  onClick={() =>
                    void action.run(async () => {
                      if (!navigator.clipboard)
                        throw new Error(
                          "Clipboard unavailable. Select the address to copy it.",
                        );
                      await navigator.clipboard.writeText(
                        query.data!.wallet.address,
                      );
                      setCopied(true);
                    })
                  }
                >
                  {copied ? "Address copied" : "Copy funding address"}
                </button>
              </p>
              <p>
                ETH for gas:{" "}
                <strong>
                  {funds?.status === "ready"
                    ? formatUnits(funds.native_balance_wei, 18)
                    : "Unavailable"}
                </strong>
              </p>
              <p>
                USDC:{" "}
                <strong>
                  {funds?.status === "ready"
                    ? formatUnits(funds.usdc_balance_units, 6)
                    : "Unavailable"}
                </strong>
              </p>
              {funds?.error && <p role="alert">{funds.error}</p>}
              <p>
                USDC token contract:{" "}
                <code>{funds?.usdc_contract ?? "Unavailable"}</code>
              </p>
              <p>
                {balance.data?.funding_instructions ??
                  "Fund this address only on the server-selected chain, with ETH for gas and the exact USDC token contract shown above. No funding transaction is initiated here."}
              </p>
              <button className="button" onClick={() => void balance.refetch()}>
                Refresh balances
              </button>
            </Card>
            <Card title="Founder standing spending policy">
              <p>
                One approval authorizes subsequent payments inside the exact
                recipient, amount, gas, chain, and time limits below. Payments
                do not each request another approval.
              </p>
              <form
                className="settings-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void requestPolicy();
                }}
              >
                <label>
                  Allowed recipient addresses
                  <textarea
                    value={recipients}
                    required
                    disabled={action.working}
                    onChange={(event) => setRecipients(event.target.value)}
                    placeholder="One EVM address per line"
                    maxLength={1500}
                  />
                </label>
                <label>
                  Per-payment limit (USD)
                  <input
                    value={perPayment}
                    required
                    disabled={action.working}
                    inputMode="decimal"
                    onChange={(event) => setPerPayment(event.target.value)}
                  />
                </label>
                <label>
                  Daily limit (USD)
                  <input
                    value={daily}
                    required
                    disabled={action.working}
                    inputMode="decimal"
                    onChange={(event) => setDaily(event.target.value)}
                  />
                </label>
                <label>
                  Lifetime limit (USD)
                  <input
                    value={total}
                    required
                    disabled={action.working}
                    inputMode="decimal"
                    onChange={(event) => setTotal(event.target.value)}
                  />
                </label>
                <label>
                  Maximum gas fee (ETH per payment)
                  <input
                    value={gas}
                    required
                    disabled={action.working}
                    inputMode="decimal"
                    onChange={(event) => setGas(event.target.value)}
                  />
                </label>
                <label>
                  Policy expiry (your local time)
                  <input
                    type="datetime-local"
                    value={expiry}
                    required
                    disabled={action.working}
                    onChange={(event) => setExpiry(event.target.value)}
                  />
                </label>
                <p>
                  Chain is fixed by the server: {query.data.network} ·{" "}
                  {query.data.chain_id}.
                </p>
                <button
                  className="button primary"
                  disabled={action.working || !query.data.payments_enabled}
                >
                  Request standing policy approval
                </button>
              </form>
              {policyResult?.status === "pending_approval" && (
                <p role="status">
                  Standing policy awaits founder approval.{" "}
                  <Link
                    to={`/approvals?id=${encodeURIComponent(policyResult.approval_id)}`}
                  >
                    Review spending policy →
                  </Link>
                </p>
              )}
              {policies.map((policy) => (
                <div className="notice" key={policy.id}>
                  <strong>{policy.status}</strong>
                  <p>
                    {currency(policy.per_payment_minor / 100)} per payment ·{" "}
                    {currency(policy.daily_limit_minor / 100)} daily ·{" "}
                    {currency(policy.total_limit_minor / 100)} lifetime ·
                    expires {new Date(policy.expires_at).toLocaleString()}
                  </p>
                  <p>Recipients: {policy.recipients.join(", ")}</p>
                  <Link
                    to={`/approvals?id=${encodeURIComponent(policy.approval_id)}`}
                  >
                    Review policy approval
                  </Link>
                  {["active", "pending_approval"].includes(policy.status) && (
                    <button
                      className="button"
                      disabled={action.working}
                      onClick={() =>
                        void action.run(async () => {
                          const updated = await post<SpendingPolicy>(
                            `${base}/policies/${encodeURIComponent(policy.id)}/revoke`,
                            {},
                          );
                          setPolicyResult(updated);
                          refresh();
                        })
                      }
                    >
                      Revoke policy · stop new payments
                    </button>
                  )}
                </div>
              ))}
            </Card>
            <Card title="Transfer USDC under an approved policy">
              <form
                className="settings-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void transfer();
                }}
              >
                <label>
                  Active spending policy
                  <select
                    value={selectedPolicy?.id ?? ""}
                    disabled={action.working}
                    onChange={(event) => {
                      editTransfer();
                      setPolicyId(event.target.value);
                      setRecipient("");
                    }}
                  >
                    <option value="">No active policy</option>
                    {activePolicies.map((policy) => (
                      <option key={policy.id} value={policy.id}>
                        {policy.id} · {currency(policy.per_payment_minor / 100)}{" "}
                        per payment
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Transfer recipient
                  <select
                    value={recipient}
                    required
                    disabled={action.working}
                    onChange={(event) => {
                      editTransfer();
                      setRecipient(event.target.value);
                    }}
                  >
                    <option value="">Choose an allowed recipient</option>
                    {selectedPolicy?.recipients.map((address) => (
                      <option key={address} value={address}>
                        {address}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Transfer amount (USDC)
                  <input
                    value={amount}
                    required
                    inputMode="decimal"
                    disabled={action.working}
                    onChange={(event) => {
                      editTransfer();
                      setAmount(event.target.value);
                    }}
                  />
                </label>
                <label>
                  Payment purpose
                  <textarea
                    value={purpose}
                    required
                    maxLength={1000}
                    disabled={action.working}
                    onChange={(event) => {
                      editTransfer();
                      setPurpose(event.target.value);
                    }}
                  />
                </label>
                <p>
                  Autonomous within approved policy.{" "}
                  {query.data.network === "base"
                    ? "This submits a real on-chain USDC payment."
                    : "This submits a Base Sepolia test USDC payment."}
                </p>
                <button
                  className="button primary"
                  disabled={
                    action.working ||
                    !query.data.payments_enabled ||
                    !selectedPolicy ||
                    Boolean(transferResult)
                  }
                >
                  Transfer USDC
                </button>
              </form>
            </Card>
            <Card title="On-chain payment history">
              {payments.length ? (
                payments.map((payment) => (
                  <div className="notice" key={payment.id}>
                    <strong>{paymentLabels[payment.status]}</strong>
                    <p>
                      {currency(payment.amount_minor / 100)} USDC →{" "}
                      {payment.recipient}
                    </p>
                    <p>{payment.purpose}</p>
                    {payment.tx_hash && (
                      <p>
                        Transaction: <code>{payment.tx_hash}</code>
                      </p>
                    )}
                    {payment.error && <p>{payment.error}</p>}
                    <button
                      className="button small"
                      disabled={action.working}
                      onClick={() =>
                        void action.run(async () => {
                          const updated = await post<WalletPayment>(
                            `${base}/payments/${encodeURIComponent(payment.id)}/refresh`,
                            {},
                          );
                          setTransferResult(updated);
                          refresh();
                        })
                      }
                    >
                      Refresh receipt
                    </button>
                  </div>
                ))
              ) : (
                <Empty title="No on-chain payments recorded">
                  Submitted transactions appear separately from confirmed
                  receipts. An uncertain result is never shown as paid.
                </Empty>
              )}
            </Card>
          </>
        )
      )}
    </section>
  );
}
