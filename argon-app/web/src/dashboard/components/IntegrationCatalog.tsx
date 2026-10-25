import { useState } from "react";
import { Link } from "react-router-dom";
import { get, post } from "../../api/client";
import { invalidateQueries, useQuery } from "../../api/hooks";
import { ErrorNotice, Status, useAction } from "./Shared";

type Toolkit = { slug: string; name: string; description: string; logo: string | null; auth_schemes: string[] };
type Catalog = { items: Toolkit[]; next_cursor: string | null; total_items: number | null };
export function IntegrationCatalog({ ventureId }: { ventureId: string }) {
  const [search, setSearch] = useState(""), [cursor, setCursor] = useState(""), [history, setHistory] = useState<string[]>([]);
  const [approval, setApproval] = useState(""), [notice, setNotice] = useState("");
  const action = useAction();
  const base = `/v1/ventures/${ventureId}/integrations`;
  const path = `${base}/catalog?search=${encodeURIComponent(search)}&cursor=${encodeURIComponent(cursor)}&limit=24`;
  const catalog = useQuery<Catalog>(path, () => get(path));
  const connections = useQuery<{items: {provider: string; status: string}[]}>(base, () => get(base));
  async function connect(slug: string) {
    setNotice(""); setApproval("");
    await action.run(async () => {
      const result = await post<{redirect_url: string | null; status: string; approval_id: string}>(`${base}/${encodeURIComponent(slug)}/connect`, { callback_url: `${location.origin}/integrations?connected=${encodeURIComponent(slug)}` });
      invalidateQueries();
      if (result.status === "waiting_approval") {
        setApproval(result.approval_id);
        setNotice("Review the connection approval, then return and click Connect again to authorize with the provider. Nothing is connected yet.");
        return;
      }
      const url = new URL(result.redirect_url ?? "");
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Unsafe provider sign-in link rejected.");
      location.assign(url.href);
    });
  }
  return <section aria-label="App integration catalog">
    <h2>Connect your tools</h2>
    <p>Search the live Composio catalog. Connections are optional and never block launch or GitHub. Connecting requires your approval and provider consent; it does not authorize payments. Agent tool actions currently support GitHub only; connecting other apps does not enable agent actions for those apps.</p>
    <label>Search all available apps<input type="search" value={search} placeholder="Search GitHub, Slack, Gmail…" onChange={event => { setSearch(event.target.value); setCursor(""); setHistory([]); }} /></label>
    <ErrorNotice error={catalog.error} retry={catalog.refetch} />
    <ErrorNotice error={connections.error} retry={connections.refetch} />
    <ErrorNotice error={action.error} />
    {notice && <p role="status" className="notice">{notice} {approval && <Link to={`/approvals?id=${approval}`}>Review approval</Link>}</p>}
    {catalog.loading && <p role="status">Loading provider catalog…</p>}
    {catalog.data && <p className="muted">{catalog.data.total_items ?? "Available"} matching apps. Availability and authentication depend on your Composio project configuration. Non-GitHub apps need an enabled toolkit-specific auth config; no paid setup is performed.</p>}
    <div className="integration-grid">
      {catalog.data?.items.map(app => {
        const status = connections.data?.items.find(item => item.provider === app.slug)?.status ?? "not_connected";
        return <article className="integration-card" key={app.slug} style={{display:"block", minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            {app.logo?.startsWith("https://") && <img src={app.logo} alt="" width={32} height={32} loading="lazy" referrerPolicy="no-referrer" style={{objectFit:"contain"}} onError={event => { event.currentTarget.style.visibility = "hidden"; }} />}
            <h3>{app.name}</h3>
          </div>
          <p style={{fontSize:13}}>{app.description.slice(0, 180)}</p>
          <Status value={status} />
          <div className="actions">
            <button type="button" className="button" disabled={action.working || status === "active"} onClick={() => void connect(app.slug)}>{status === "active" ? "Connected" : "Connect"}</button>
            <button type="button" className="button ghost" disabled={action.working} onClick={() => void action.run(async () => { await post(`${base}/${encodeURIComponent(app.slug)}/refresh`); await connections.refetch(); })}>Refresh status</button>
          </div>
        </article>;
      })}
    </div>
    {catalog.data?.items.length === 0 && <p>No apps match this search.</p>}
    <div className="actions">
      <button type="button" className="button" disabled={!history.length || catalog.loading} onClick={() => { setCursor(history[history.length - 1]); setHistory(history.slice(0,-1)); }}>Previous</button>
      <button type="button" className="button" disabled={!catalog.data?.next_cursor || catalog.loading} onClick={() => { setHistory([...history,cursor]); setCursor(catalog.data!.next_cursor!); }}>Next apps</button>
    </div>
  </section>;
}
