import { useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../../api/client";
import { useQuery } from "../../api/hooks";
import type { Approval, Artifact, ListPage, Run } from "../../shared/contracts";
import { useCompany } from "../context";
import { safeUrl } from "../types";
import { ErrorNotice, Icon, Loading } from "./Shared";

type Notice = { id: string; title: string; detail: string; at: string; to: string; external?: string };
const successful = new Set(["completed", "done", "succeeded"]);

/** Converts only persisted, venture-scoped records into notifications. */
export function recordedNotifications(artifacts: Artifact[], runs: Run[], approvals: Approval[]): Notice[] {
  const items: Notice[] = [
    ...runs.filter(run => ["engineering_build", "engineering_fix"].includes(run.job) && successful.has(run.status) && run.completed_at).map(run => ({
      id: `run:${run.id}`, title: "Engineering build completed", detail: "Completion is recorded. Open the run for its recorded output and logs.", at: run.completed_at!, to: `/runs/${encodeURIComponent(run.id)}`,
    })),
    ...artifacts.map(artifact => {
      const preview = artifact.kind === "preview" ? safeUrl(typeof artifact.meta.preview_url === "string" ? artifact.meta.preview_url : artifact.uri) : undefined;
      return {
        id: `artifact:${artifact.id}`,
        title: preview ? "Preview ready" : artifact.department_id === "engineering" ? "Engineering artifact recorded" : `${(artifact.department_id ?? "company").replaceAll("-", " ")} artifact recorded`,
        detail: preview ? "A recorded preview link is available." : `${artifact.kind} artifact recorded.`,
        at: artifact.created_at,
        to: `/artifacts/${encodeURIComponent(artifact.id)}`,
        external: preview,
      };
    }),
    ...approvals.filter(approval => approval.status === "pending").map(approval => ({
      id: `approval:${approval.id}`, title: "Approval needed", detail: approval.title, at: approval.created_at,
      to: `/approvals?id=${encodeURIComponent(approval.id)}`,
    })),
  ];
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 12);
}

export function DashboardNotificationCenter() {
  const { ventureId } = useCompany();
  const [open, setOpen] = useState(false);
  const prefix = ventureId ? `/v1/ventures/${ventureId}` : null;
  const artifacts = useQuery<ListPage<Artifact>>(prefix ? `${prefix}/artifacts?limit=100` : null, () => get(`${prefix}/artifacts?limit=100`));
  const runs = useQuery<ListPage<Run>>(prefix ? `${prefix}/runs?limit=100` : null, () => get(`${prefix}/runs?limit=100`));
  const approvals = useQuery<ListPage<Approval>>(prefix ? `${prefix}/approvals` : null, () => get(`${prefix}/approvals`));
  const notices = recordedNotifications(artifacts.data?.items ?? [], runs.data?.items ?? [], approvals.data?.items ?? []);
  const error = artifacts.error ?? runs.error ?? approvals.error;
  const pending = notices.filter(notice => notice.id.startsWith("approval:")).length;
  return <div className="notification-center">
    <button className="icon-button notification-bell" aria-label="Open notification center" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <Icon name="bell" size={18} />
      {pending > 0 && <span className="notification-count" aria-label={`${pending} approval${pending === 1 ? "" : "s"} needed`}>{pending}</span>}
    </button>
    {open && <section className="notification-popover" aria-label="Notification history">
      <header><strong>Notifications</strong><span>Recorded for this venture</span></header>
      <ErrorNotice error={error} retry={() => { void artifacts.refetch(); void runs.refetch(); void approvals.refetch(); }} />
      {artifacts.loading || runs.loading || approvals.loading ? <Loading /> : <div className="notification-list" aria-live="polite">
        {notices.map(notice => <article key={notice.id} className="notification-item">
          <Link to={notice.to} onClick={() => setOpen(false)}><strong>{notice.title}</strong></Link>
          <p>{notice.detail}</p>
          <time dateTime={notice.at}>{new Date(notice.at).toLocaleString()}</time>
          {notice.external && <a href={notice.external} target="_blank" rel="noopener noreferrer">Open recorded preview ↗</a>}
        </article>)}
        {!notices.length && !error && <p className="notification-empty">No recorded build completions, engineering artifacts, or approvals yet.</p>}
      </div>}
    </section>}
  </div>;
}
