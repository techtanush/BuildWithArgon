import { useEffect, useState } from "react";
import { post } from "../../api/client";
import { invalidateQueries } from "../../api/hooks";
import { safeUrl } from "../types";
import { ErrorNotice, useAction } from "./Shared";

export function safeConnectUrl(value: string | null): string | undefined {
  if (!safeUrl(value)) return;
  try {
    const url = new URL(value!);
    if (url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") &&
      (["connect.composio.dev", "backend.composio.dev"].includes(url.hostname) || (url.hostname === "github.com" && url.pathname.startsWith("/login/oauth")))) return url.href;
  } catch { /* Reject malformed provider redirects. */ }
}
type Result = { redirect_url: string | null; status: string; approval_id: string };
export function IntegrationConnect({ ventureId, provider, name, status, disabled = false }: {
  ventureId: string; provider: string; name: string; status?: string; disabled?: boolean;
}) {
  const action = useAction();
  const setupMessage = action.error?.message ?? "";
  const setupRequired = /requires configuration|auth config|toolkit-specific/i.test(setupMessage);
  const [approval, setApproval] = useState("");
  const [url, setUrl] = useState<string>();
  const [waiting, setWaiting] = useState(false);
  const base = `/v1/ventures/${ventureId}/integrations/${encodeURIComponent(provider)}`;
  async function refresh() { await post(`${base}/refresh`); invalidateQueries(); }
  useEffect(() => {
    if (status === "active") { setWaiting(false); setUrl(undefined); return; }
    const onFocus = () => { if (waiting || status === "pending" || new URLSearchParams(location.search).get("connected") === provider) void refresh().catch(() => {}); };
    onFocus();
    window.addEventListener("focus", onFocus);
    const timer = waiting || status === "pending" ? window.setInterval(onFocus, 10000) : undefined;
    return () => { window.removeEventListener("focus", onFocus); window.clearInterval(timer); };
  }, [base, provider, status, waiting]);
  async function connect() {
    const result = await post<Result>(`${base}/connect`, { callback_url: `${location.origin}/integrations?connected=${encodeURIComponent(provider)}` });
    invalidateQueries();
    if (result.status === "waiting_approval") { setApproval(result.approval_id); return; }
    const safe = safeConnectUrl(result.redirect_url);
    if (!safe) throw new Error("Unsafe provider sign-in link rejected. No account has been connected.");
    setApproval(""); setUrl(safe); setWaiting(true);
  }
  return <div className="integration-connect">
    {setupRequired ? <section className="integration-setup" role="status"><strong>Set up {name} authorization</strong><p>{setupMessage}</p><p>Your API key can read the toolkit catalog. This app also needs an enabled auth configuration in your Composio project before a sign-in link can be created. Enable that toolkit’s managed OAuth configuration, then try Connect again. No account is connected yet.</p></section> : <ErrorNotice error={action.error} />}
    {!approval && !url && <button type="button" className="button" disabled={disabled || action.working || status === "active"} onClick={() => void action.run(connect)}>{status === "active" ? "Connected" : `Connect ${name}`}</button>}
    {approval && <section className="notice" aria-label={`Review ${name} connection`}>
      <h4>Review connection permission: {name}</h4>
      <p>Allow YCBF to request a {name} sign-in link through Composio for this company ({ventureId}). This is not provider consent.</p>
      <p>Access: {provider === "github" ? "GitHub repositories, pull requests and issues using Composio-managed authentication." : "The enabled toolkit-specific auth configuration in your Composio project."} Exact account permissions are shown by the provider before you consent. Do not continue there unless those permissions are acceptable.</p>
      <p>No payments or plan activation are approved. Agent tool execution remains GitHub-only. {provider === "github" ? "A managed GitHub auth configuration may be provisioned if missing." : "If the toolkit has no enabled auth configuration, server setup is required; none is created automatically."}</p>
      <button type="button" className="button primary" disabled={action.working} onClick={() => void action.run(async () => {
        await post(`/v1/approvals/${approval}/decision`, { decision: "approve", decided_by: "Founder", note: `Explicit inline approval to connect ${provider} through Composio.` });
        setApproval("");
        await connect();
      })}>Approve &amp; continue</button>
      <button type="button" className="button ghost" disabled={action.working} onClick={() => setApproval("")}>Not now</button>
    </section>}
    {url && <p role="status">Waiting for provider authorization. <a className="button primary" href={url} target="_blank" rel="noopener noreferrer">Open {name} sign-in in a new tab</a> If a tab did not open, click this link again. Return here after consent; status refreshes automatically.</p>}
    <button type="button" className="button ghost" disabled={action.working || disabled} onClick={() => void action.run(refresh)}>Refresh status</button>
  </div>;
}
