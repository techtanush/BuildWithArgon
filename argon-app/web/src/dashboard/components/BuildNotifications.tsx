// OWNER: tanush
import { Link } from "react-router-dom";
import { get } from "../../api/client";
import { useQuery } from "../../api/hooks";
import type { Artifact, ListPage, Run, Ticket } from "../../shared/contracts";
import { useCompany } from "../context";
import { safeUrl } from "../types";
import { Card, Empty, ErrorNotice, Loading } from "./Shared";

export function buildEvidence(artifacts: Artifact[], runs: Run[], tickets: Ticket[]) {
  return [
    ...artifacts.filter(a => ["code", "test_report", "pr", "build", "preview"].includes(a.kind)).map(a => ({ id: "artifact:" + a.id, title: a.title, detail: a.kind === "pr" ? "Recorded pull request, not proof of deployment or push" : a.kind === "test_report" ? "Recorded test report" : a.kind === "build" ? "Recorded build artifact; inspect for outcome" : a.kind === "preview" ? "Recorded preview artifact" : "Recorded code artifact", at: a.created_at, to: "/artifacts/" + encodeURIComponent(a.id), external: safeUrl(a.uri), preview: typeof a.meta.preview_url === "string" ? safeUrl(a.meta.preview_url) : undefined })),
    ...runs.filter(r => ["engineering_build", "engineering_fix"].includes(r.job) && ["completed", "done", "succeeded"].includes(r.status) && r.completed_at).map(r => ({ id: "run:" + r.id, title: "Engineering run completed", detail: "Completion recorded; inspect logs for build, test and push evidence.", at: r.completed_at!, to: "/runs/" + encodeURIComponent(r.id), external: undefined, preview: undefined })),
    ...tickets.filter(t => t.department_id === "engineering" && t.status === "done" && typeof t.result?.tests_passed === "number").map(t => ({ id: "ticket:" + t.id, title: t.title, detail: String(t.result!.tests_passed) + " tests passed; " + (typeof t.result!.tests_failed === "number" ? String(t.result!.tests_failed) + " failed" : "failure count not recorded"), at: t.completed_at ?? t.updated_at, to: "/tickets/" + encodeURIComponent(t.id), external: undefined, preview: undefined })),
  ].sort((a,b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 8);
}

export function BuildNotifications() {
  const { ventureId, venture, live } = useCompany();
  const prefix = ventureId ? "/v1/ventures/" + ventureId : null;
  const artifacts = useQuery<ListPage<Artifact>>(prefix ? prefix + "/artifacts?limit=200" : null, () => get(prefix + "/artifacts?limit=200"));
  const runs = useQuery<ListPage<Run>>(prefix ? prefix + "/runs?limit=200" : null, () => get(prefix + "/runs?limit=200"));
  const tickets = useQuery<ListPage<Ticket>>(prefix ? prefix + "/tickets?limit=200" : null, () => get(prefix + "/tickets?limit=200"));
  const evidence = buildEvidence(artifacts.data?.items ?? [], runs.data?.items ?? [], tickets.data?.items ?? []);
  const error = artifacts.error ?? runs.error ?? tickets.error;
  return <Card title="Latest build evidence">
    <p role="status">{live === "live" ? "Live updates from recorded company events" : "Updates offline or reconnecting. Recorded results may be stale."}</p>
    <ErrorNotice error={error} retry={() => { void artifacts.refetch(); void runs.refetch(); void tickets.refetch(); }} />
    {artifacts.loading || runs.loading || tickets.loading ? <Loading /> : <div aria-live="polite" aria-label="Build completion notifications">
      {evidence.map(item => <article key={item.id} className="notice"><h3><Link to={item.to}>{item.title}</Link></h3><p>{item.detail}</p><time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time><div className="actions">{item.external && <a href={item.external} target="_blank" rel="noopener noreferrer">Open recorded artifact ↗</a>}{item.preview && <a href={item.preview} target="_blank" rel="noopener noreferrer">Open recorded preview ↗</a>}</div></article>)}
      {!evidence.length && !error && <Empty title="No completed build evidence yet">Completed engineering runs, code artifacts and test reports will appear here. No preview, test success or Git push is assumed.</Empty>}
    </div>}
    {safeUrl(venture?.repo_url) && <a href={safeUrl(venture?.repo_url)} target="_blank" rel="noopener noreferrer">Open connected repository ↗</a>}
  </Card>;
}
