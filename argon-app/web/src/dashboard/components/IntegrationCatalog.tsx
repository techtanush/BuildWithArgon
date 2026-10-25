import { useState } from "react";
import { IntegrationConnect } from "./IntegrationConnect";
import { get } from "../../api/client";
import { useQuery } from "../../api/hooks";
import { ErrorNotice, Status } from "./Shared";

type Toolkit = { slug: string; name: string; description: string; logo: string | null; auth_schemes: string[] };
type Catalog = { items: Toolkit[]; next_cursor: string | null; total_items: number | null };
export function IntegrationCatalog({ ventureId }: { ventureId: string }) {
  const [search, setSearch] = useState(""), [cursor, setCursor] = useState(""), [history, setHistory] = useState<string[]>([]);
  const base = `/v1/ventures/${ventureId}/integrations`;
  const path = `${base}/catalog?search=${encodeURIComponent(search)}&cursor=${encodeURIComponent(cursor)}&limit=24`;
  const catalog = useQuery<Catalog>(path, () => get(path));
  const connections = useQuery<{items: {provider: string; status: string}[]}>(base, () => get(base));
  return <section aria-label="App integration catalog">
    <h2>Connect your tools</h2>
    <p>Search the live Composio catalog. Connections are optional and never block launch or GitHub. Connecting requires your approval and provider consent; it does not authorize payments. Agent tool actions currently support GitHub only; connecting other apps does not enable agent actions for those apps.</p>
    <label>Search all available apps<input type="search" value={search} placeholder="Search GitHub, Slack, Gmail…" onChange={event => { setSearch(event.target.value); setCursor(""); setHistory([]); }} /></label>
    <ErrorNotice error={catalog.error} retry={catalog.refetch} />
    <ErrorNotice error={connections.error} retry={connections.refetch} />
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
          <IntegrationConnect ventureId={ventureId} provider={app.slug} name={app.name} status={status} />
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
