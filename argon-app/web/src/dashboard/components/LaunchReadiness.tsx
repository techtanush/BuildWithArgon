// OWNER: tanush
import { Link } from "react-router-dom";
import { useCompany } from "../context";
import { currency } from "../types";
import { Card } from "./Shared";

/** Recorded state only: configuration and conversations are not completed builds. */
export function LaunchReadiness() {
  const { venture, live } = useCompany();
  if (!venture) return null;
  const counts = venture.stats?.tickets ?? {};
  return <Card title={venture.status === "draft" ? "Ready when you are" : "Recorded work"}>
    <p role="status">{venture.status === "draft" ? "Your idea is saved. Building has not started." : `Company status: ${venture.status}.`} {live !== "live" && "Updates reconnecting; recorded state may be stale."}</p>
    <div className="readiness-counts"><span><strong>{counts.open ?? 0}</strong> queued</span><span><strong>{counts.in_progress ?? 0}</strong> running</span><span><strong>{counts.done ?? 0}</strong> completed</span><span><strong>{venture.stats?.artifacts ?? 0}</strong> artifacts</span></div>
    <p>{currency(venture.spent_usd)} recorded spend of {currency(venture.budget_usd)} budget.{venture.spent_usd >= venture.budget_usd && " Budget cap reached. Review spending before continuing."}</p>
    <details><summary>What starting authorizes</summary><p>Starting authorizes model usage, not wallet funding or publishing. A preview appears only after the backend records one. Connections and consequential actions require their own approval.</p></details>
    <div className="actions"><Link to="/tickets">Follow tickets</Link><Link to="/runs">Inspect runs</Link><Link to="/approvals">Review approvals</Link><Link to="/integrations">Connections</Link></div>
  </Card>;
}
