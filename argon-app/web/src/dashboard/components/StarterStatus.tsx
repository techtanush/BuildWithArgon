import { useEffect } from "react";
import { Link } from "react-router-dom";
import { get } from "../../api/client";
import { useQuery } from "../../api/hooks";
import { safeWorldLink } from "../../world/activity/network";
import { Card, ErrorNotice } from "./Shared";
export interface StarterRecord { venture_id: string; status: string; preview_url: string | null; message: string; tickets: { id: string; type: string; status: string }[]; runs: { id: string; model: string; status: string; error: string | null }[] }
export function StarterStatus({ ventureId }: { ventureId: string }) {
  const key = `/v1/ventures/${ventureId}/starter`;
  const query = useQuery<StarterRecord>(key, () => get(key));
  useEffect(() => { const timer = setInterval(() => void query.refetch(), 5000); return () => clearInterval(timer); }, [key]);
  const record = query.data;
  const preview = safeWorldLink(record?.preview_url);
  return <Card title="Starter build">
    <ErrorNotice error={query.error} retry={query.refetch} />
    {record ? <><p role="status">{record.status === "not_started" ? "Not started. Choose Start building company when ready." : `Recorded status: ${record.status}`}</p>
      {record.status === "ready" && preview && <a className="button primary" href={preview} target="_blank" rel="noopener noreferrer">Open actual preview</a>}
      {!preview && record.status !== "not_started" && <p>No preview has been produced yet.</p>}
      <ul>{record.tickets.map(t => <li key={t.id}><Link to={`/tickets/${encodeURIComponent(t.id)}`}>{t.type.replace("starter.", "")}</Link> · {t.status}</li>)}</ul>
      {!!record.runs.length && <details><summary>Recorded runs and models</summary><ul>{record.runs.map(r => <li key={r.id}><Link to={`/runs/${encodeURIComponent(r.id)}`}>{r.model}</Link> · {r.status}{r.error && <p role="status">{r.error}</p>}</li>)}</ul></details>}
      <small>{record.message}</small></> : !query.error && <p role="status">Loading starter status…</p>}
  </Card>;
}
