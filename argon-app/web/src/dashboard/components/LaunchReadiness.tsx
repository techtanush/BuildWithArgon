// OWNER: tanush
import { Link } from "react-router-dom";
import { get } from "../../api/client";
import { useQuery } from "../../api/hooks";
import type { Approval, ListPage } from "../../shared/contracts";
import { useCompany } from "../context";
import { currency } from "../types";
import { Card, ErrorNotice } from "./Shared";

type Connection = { provider: string; status: string };

/** Read-only readiness. Configuration is never evidence of provider entitlement or a build. */
export function LaunchReadiness() {
  const { venture, ventureId, system, live } = useCompany();
  const prefix = ventureId ? `/v1/ventures/${ventureId}` : null;
  const integrations = useQuery<ListPage<Connection>>(prefix ? `${prefix}/integrations` : null, () => get(`${prefix}/integrations`));
  const approvals = useQuery<ListPage<Approval>>(prefix ? `${prefix}/approvals?status=pending` : null, () => get(`${prefix}/approvals?status=pending`));
  if (!venture) return null;
  const github = integrations.data?.items.find(item => item.provider === "github");
  const connected = github?.status === "active";
  const githubApproval = approvals.data?.items.some(item => item.gate_type === "integration" && item.payload?.provider === "github");
  const budgetBlocked = venture.spent_usd >= venture.budget_usd;
  const ticketCount = Object.values(venture.stats?.tickets ?? {}).reduce((sum, n) => sum + n, 0);
  return <Card title={venture.status === "draft" ? "Your idea is saved. Building has not started." : "Build readiness"}>
    {venture.status === "draft" && <p>Draft saves your idea only. Choose <strong>Start building company</strong> above to create the intake brief ticket and begin the existing department workflow. Engineering starts after intake, specification and planning, not when you type an idea or talk to an agent.</p>}
    <p role="status">{live === "live" ? "Readiness from recorded company state." : "Updates offline or reconnecting; readiness may be stale."}</p>
    <ErrorNotice error={integrations.error} retry={integrations.refetch} />
    <ErrorNotice error={approvals.error} retry={approvals.refetch} />
    <ul>
      <li><strong>Provider usage:</strong> Starting authorizes agent work and may use paid model credits. Current cap {currency(venture.budget_usd)}, recorded spend {currency(venture.spent_usd)}. {budgetBlocked ? "The cap is reached; review spending approval before work can proceed." : "The scheduler pauses new work at the cap; increases require approval."} No wallet is funded by starting.</li>
      <li><strong>Gemini:</strong> {!system ? "Status not loaded." : system.mode === "fake" ? "Fake mode: no real generated product can be claimed." : system.providers.gemini?.configured ? "Server configured; configuration alone does not verify model access." : "Not configured on the server."}</li>
      <li><strong>GitHub:</strong> {integrations.error ? "Connection status unavailable." : !integrations.data ? "Checking connection status." : connected ? "Connected according to the integration record." : githubApproval ? "Connection approval pending; approval is not OAuth completion." : "Not connected."} GitHub does not block intake Start. Repository creation, PRs and publishing still require the connection and applicable approvals.</li>
      <li><strong>Engineering execution:</strong> {system?.executor === "antigravity" && connected && venture.repo_full_name ? "Antigravity selected; managed-agent access and successful execution still need verification." : "Without a connected repository, the current engineering handler uses the local loop. Live generated code requires an isolated runner such as Docker; this checklist does not verify its availability."} No unsafe host-execution fallback is enabled here.</li>
      <li><strong>Landing page and AI tutor:</strong> Not produced merely by saving or starting. A generated site needs recorded build and preview artifacts. Site chat additionally needs a server-side, venture-scoped Gemini broker with request and spending limits; no generated-site chat broker is enabled by this action.</li>
      <li><strong>Recorded work:</strong> {ticketCount} tickets, {venture.stats?.artifacts ?? 0} artifacts. Agent conversations are not engineering builds.</li>
    </ul>
    <div className="actions"><Link to="/integrations">Review connections</Link><Link to="/approvals">Review approvals</Link><Link to="/tickets">Follow actual work</Link></div>
  </Card>;
}
