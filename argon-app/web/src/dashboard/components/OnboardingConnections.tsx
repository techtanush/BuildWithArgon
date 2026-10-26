import { starterScenario } from "../../shared/starterScenario";
import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { get, post } from "../../api/client";
import { invalidateQueries, useQuery } from "../../api/hooks";
import type { Venture } from "../../shared/contracts";
import { useCompany } from "../context";
import { IntegrationCatalog } from "./IntegrationCatalog";
import { IntegrationConnect } from "./IntegrationConnect";
import { ErrorNotice, useAction } from "./Shared";

export default function OnboardingConnections({ ventureId }: { ventureId: string }) {
  const path = `/v1/ventures/${encodeURIComponent(ventureId)}`;
  const draft = useQuery<Venture>(path, () => get(path));
  const connections = useQuery<{items: {provider: string; status: string}[]}>(`${path}/integrations`, () => get(`${path}/integrations`));
  const { selectVenture } = useCompany();
  const navigate = useNavigate(), action = useAction();
  useEffect(() => { if (draft.data?.id === ventureId) selectVenture(ventureId); }, [draft.data?.id, ventureId]);
  async function start() {
    const venture = draft.data;
    if (!venture || venture.id !== ventureId || action.working) return;
    await action.run(async () => {
      const result = await post(`${path}/starter/start`, {budget_usd: Math.min(0.25, venture.budget_usd), ...starterScenario(venture.idea)});
      selectVenture(ventureId);
      invalidateQueries();
      try { sessionStorage.setItem("foundry.starter." + ventureId, JSON.stringify(result)); sessionStorage.setItem("foundry.just-launched", ventureId); } catch { /* optional browser storage */ }
      navigate("/dashboard");
    });
  }
  const active = connections.data?.items.filter(c => c.status === "active").length ?? 0;
  return <div className="onboarding connector-onboarding">
    <Link className="onboarding-brand" to="/welcome"><img src="/ycbf-mark.svg" alt="" width="28" height="28"/>YCBF</Link>
    <main className="onboarding-card connector-onboarding-card">
      <nav className="onboarding-steps" aria-label="Setup progress"><span className="step-done">1 · Idea saved</span><span aria-current="step">2 · Connect tools</span><span>3 · Your workspace</span></nav>
      <div className="connector-intro"><p className="eyebrow">YOUR TEAM, CONNECTED</p><h1>Bring your tools along.</h1><p>Connect the accounts you want your team to use. This step is optional, and you can always return to it later.</p></div>
      <ErrorNotice error={draft.error} retry={draft.refetch}/>
      {!draft.data && !draft.error && <p role="status">Loading your saved company…</p>}
      {draft.data?.id === ventureId && <>
        <div className="connector-project"><strong>{draft.data.name}</strong><span>Your brief is saved. Building has not been started by this page.</span><span>{active} connected {active === 1 ? "account" : "accounts"}</span></div>
        <section className="connector-featured" aria-label="Recommended connections">
          {[{provider:"github",name:"GitHub",hint:"Repository access for engineering. Publishing still requires approval."},{provider:"linkedin",name:"LinkedIn",hint:"Prepare your marketing connection. Posts require your explicit Post action."}].map(app => <article key={app.provider}>
            <div className={`connector-app-mark ${app.provider}`} aria-hidden="true">{app.provider === "github" ? "GH" : "in"}</div><div><h2>{app.name}</h2><p>{app.hint}</p></div>
            <IntegrationConnect ventureId={ventureId} provider={app.provider} name={app.name} status={connections.data?.items.find(c=>c.provider===app.provider)?.status}/>
          </article>)}
        </section>
        <details className="connector-permissions"><summary>You control every connection</summary><p>Connecting requires permission review and provider consent. No account is connected just by visiting this page. No payments, subscriptions or publishing are authorized here.</p></details>
        <div className="connector-catalog"><IntegrationCatalog ventureId={ventureId}/></div>
        <footer className="connector-launch-bar"><div><strong>{active ? "Ready when you are." : "No connections? You can still start."}</strong><p>Start authorizes the starter workflow, up to $0.25 of configured model usage within your company budget. No deposit or wallet funding.</p><ErrorNotice error={action.error}/></div><div className="actions"><Link to="/dashboard" className="button ghost">Save for later</Link><button type="button" className="button primary" onClick={()=>void start()} disabled={action.working}>{action.working ? "Starting…" : "Start building company"}</button></div></footer>
      </>}
    </main>
  </div>;
}
