// OWNER: tanush
import { useState } from "react";
import { Link } from "react-router-dom";
import { post } from "../../api/client";
import { invalidateQueries } from "../../api/hooks";
import type { Approval } from "../../shared/contracts";
import { useCompany } from "../context";
import { currency, safeUrl, titleCase } from "../types";
import { ErrorNotice, Status, useAction } from "./Shared";

function GateEvidence({approval}:{approval:Approval}){
  const payload=approval.payload;
  if(['outreach','send','public_post'].includes(approval.gate_type)){
    const drafts=(Array.isArray(payload.drafts)?payload.drafts:[payload]).filter(value=>value&&typeof value==='object') as Record<string,unknown>[];
    return <div>{drafts.map((draft,index)=><div className="conversation-turn" key={index}>{Boolean(draft.to)&&<p><strong>To:</strong> {String(draft.to)}</p>}{Boolean(draft.subject)&&<h4>{String(draft.subject)}</h4>}<p>{String(draft.body??'No message body was provided.')}</p></div>)}</div>;
  }
  if(approval.gate_type==='pivot')return <div className="notice"><strong>Verdict: {String(payload.verdict??'Review required')}</strong>{Array.isArray(payload.reasons)&&<ul>{payload.reasons.map((reason,index)=><li key={index}>{String(reason)}</li>)}</ul>}{Boolean(payload.proposed_revision)&&<p>{String(payload.proposed_revision)}</p>}</div>;
  if(approval.gate_type==='integration')return <dl className="detail-grid"><div><dt>Provider</dt><dd>{String(payload.provider??'GitHub')}</dd></div><div><dt>Access</dt><dd>{String(payload.scopes??'Review the connection scopes before continuing.')}</dd></div></dl>;
  if(approval.gate_type==='merge'){
    const url=safeUrl(String(payload.pr_url??payload.url??''));const tests=payload.tests&&typeof payload.tests==='object'?payload.tests as Record<string,unknown>:null;
    return <div>{url&&<a className="text-link" href={url} target="_blank" rel="noreferrer">Review pull request ↗</a>}{Boolean(payload.diff_summary)&&<p>{String(payload.diff_summary)}</p>}{tests&&<dl className="detail-grid">{Object.entries(tests).filter(([,value])=>['string','number','boolean'].includes(typeof value)).map(([key,value])=><div key={key}><dt>{titleCase(key)}</dt><dd>{String(value)}</dd></div>)}</dl>}</div>;
  }
  if(approval.gate_type==='new_capability'){
    const design=(payload.agent_spec??payload.design??payload.spec??payload) as Record<string,unknown>;
    return <div className="notice"><strong>{String(design.display_name??design.name??'New capability')} · {String(design.title??design.capability??'Proposed agent')}</strong><p>{String(design.role_summary??design.description??'Review the proposed capability and its tools below.')}</p>{Array.isArray(design.tools)&&<p>Tools: {design.tools.map(String).join(', ')||'No external tools'}</p>}</div>;
  }
  return null;
}

export function ApprovalCard({
  approval,
  compact = false,
}: {
  approval: Approval;
  compact?: boolean;
}) {
  const { venture } = useCompany();
  const action = useAction();
  const [note, setNote] = useState("");
  const questions = Array.isArray(approval.payload.questions)
    ? (approval.payload.questions as {
        id: string;
        issue?: string;
        proposed?: string;
        risk_if_wrong?: string;
      }[])
    : [];
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, q.proposed ?? ""])),
  );
  async function decide(decision: "approve" | "reject") {
    await action.run(async () => {
      await post(`/v1/approvals/${approval.id}/decision`, {
        decision,
        note,
        decided_by: venture?.founder_name ?? "Founder",
        ...(approval.gate_type === "clarification" ? { answers } : {}),
      });
      invalidateQueries();
    });
  }
  const payload = approval.payload;
  return (
    <article
      className={`approval-card ${compact ? "compact" : ""} ${approval.status === "pending" ? "pending" : ""}`}
      id={approval.id}
    >
      <div className="card-heading">
        <span className="overline">
          {titleCase(approval.gate_type)} approval
        </span>
        <Status value={approval.status} />
      </div>
      <h3>{approval.title}</h3>
      <p>{approval.summary}</p>
      {compact&&approval.gate_type==='spend'&&<p><strong>Requested increase: {currency(Number(payload.requested_increase_usd??0))}</strong></p>}
      {!compact && (
        <div className="approval-payload">
          <GateEvidence approval={approval}/>
          {questions.map((question) => (
            <label key={question.id}>
              {question.issue ?? question.id}
              <textarea
                value={answers[question.id] ?? ""}
                disabled={approval.status !== "pending"}
                onChange={(event) =>
                  setAnswers((old) => ({
                    ...old,
                    [question.id]: event.target.value,
                  }))
                }
              />
              {question.risk_if_wrong && (
                <small>{question.risk_if_wrong}</small>
              )}
            </label>
          ))}
          {approval.gate_type === "spend" && (
            <dl className="detail-grid">
              <div>
                <dt>Current budget</dt>
                <dd>
                  {currency(
                    Number(payload.budget_usd ?? venture?.budget_usd ?? 0),
                  )}
                </dd>
              </div>
              <div>
                <dt>Requested increase</dt>
                <dd>{currency(Number(payload.requested_increase_usd ?? 0))}</dd>
              </div>
              <div>
                <dt>Spent so far</dt>
                <dd>
                  {currency(
                    Number(payload.spent_usd ?? venture?.spent_usd ?? 0),
                  )}
                </dd>
              </div>
            </dl>
          )}
          {approval.gate_type === "computer_action" && (
            <>
              <p>
                <strong>
                  {String(
                    payload.reason ??
                      "A computer action requires your decision.",
                  )}
                </strong>
              </p>
              {safeUrl(String(payload.screenshot_url ?? "")) && (
                <img
                  className="approval-screen"
                  src={safeUrl(String(payload.screenshot_url))}
                  alt="Computer screen before the requested action"
                />
              )}
              <p>{String(payload.url ?? "")}</p>
            </>
          )}
          {!questions.length && approval.gate_type !== "spend" && (
            <details>
              <summary>Review action details</summary>
              <pre>{JSON.stringify(payload, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
      {approval.status === "pending" ? (
        <>
          <label className="decision-note">
            Decision note <span>(optional)</span>
            <input
              aria-label={`Decision note for ${approval.title}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={2000}
            />
          </label>
          <ErrorNotice error={action.error} />
          <div className="actions">
            <button
              className="button primary small"
              onClick={() => void decide("approve")}
              disabled={action.working}
            >
              Approve
            </button>
            <button
              className="button small"
              onClick={() => void decide("reject")}
              disabled={action.working}
            >
              Reject
            </button>
            {compact && (
              <Link to={`/approvals?id=${approval.id}`} className="text-link">
                Review details
              </Link>
            )}
          </div>
        </>
      ) : (
        <p className="muted small-text">
          {approval.decided_by ?? "Founder"} {approval.status}
          {approval.decision_note ? ` — ${approval.decision_note}` : ""}
        </p>
      )}
    </article>
  );
}
