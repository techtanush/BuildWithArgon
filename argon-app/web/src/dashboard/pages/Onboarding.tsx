import { IntegrationConnect } from "../components/IntegrationConnect";
// OWNER: tanush
import { IntegrationCatalog } from "../components/IntegrationCatalog";
import { useAppAuth } from "../../auth/AuthProvider";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { get, post } from "../../api/client";
import { invalidateQueries, useQuery } from "../../api/hooks";
import type { ListPage, Venture } from "../../shared/contracts";
import { useCompany } from "../context";
import { ErrorNotice, Icon, useAction } from "../components/Shared";

export default function Onboarding() {
  const auth = useAppAuth();
  const [step, setStep] = useState(1),
    [founder, setFounder] = useState(() => auth.name),
    [name, setName] = useState(""),
    [idea, setIdea] = useState(""),
    [intent, setIntent] = useState<"bring" | "discover">("bring"),
    [budget, setBudget] = useState("25");
  const [created, setCreated] = useState<Venture | null>(null),
    [files, setFiles] = useState<{ file: File; status: string }[]>([]),
    [validation, setValidation] = useState(""),
    [integration] = useState("");
  const action = useAction(),
    navigate = useNavigate(),
    { selectVenture, system } = useCompany(),
    input = useRef<HTMLInputElement>(null);
  const connections = useQuery<ListPage<{ provider: string; status: string }>>(
    created ? `/v1/ventures/${created.id}/integrations` : null,
    () => get(`/v1/ventures/${created!.id}/integrations`),
  );
  const github = connections.data?.items.find((item) => item.provider === "github");
  function chooseFiles(selected: File[]) {
    if (action.working) return;
    setValidation("");
    if (files.length + selected.length > 8) {
      setValidation("Choose up to 8 context files.");
      return;
    }
    if (
      selected.some(
        (file) =>
          !/\.(md|txt|pdf|csv|json)$/i.test(file.name) ||
          file.size > 15 * 1024 * 1024,
      )
    ) {
      setValidation(
        "Use .md, .txt, .pdf, .csv or .json files, up to 15 MB each.",
      );
      return;
    }
    setFiles((old) => [
      ...old,
      ...selected.map((file) => ({ file, status: "Ready to upload" })),
    ]);
  }
  async function next() {
    setValidation("");
    if (step === 1) {
      if (founder.trim().length < 2 || founder.trim().length > 60) {
        setValidation("Enter a founder name between 2 and 60 characters.");
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (
        !name.trim() ||
        idea.trim().length < 50 ||
        idea.trim().length > 4000 ||
        !Number.isFinite(Number(budget)) ||
        Number(budget) <= 0
      ) {
        setValidation(
          "Add a venture name, an idea or discovery brief of 50–4,000 characters, and a positive planning budget.",
        );
        return;
      }
      await action.run(async () => {
        let venture = created;
        if (!venture) {
          venture = await post<Venture>("/v1/ventures", {
            name: name.trim(),
            idea: `${intent === "discover" ? "Founder intent: Discover an idea for me. Research candidate ideas and present evidence and options for founder review before choosing what to build. No idea has been discovered or validated yet." : "Founder intent: Bring my idea."}

${idea.trim()}`,
            founder_name: founder.trim(),
            budget_usd: Number(budget),
          });
          setCreated(venture);
          selectVenture(venture.id);
          invalidateQueries("/v1/ventures");
        }
        setStep(3);
      });
      return;
    }
    if (step === 3) {
      await action.run(async () => {
        const remaining = files.filter((item) => item.status !== "Uploaded");
        if (remaining.length) {
          const body = new FormData();
          remaining.forEach((item) => body.append("files[]", item.file));
          setFiles((old) =>
            old.map((item) =>
              item.status === "Uploaded"
                ? item
                : { ...item, status: "Uploading…" },
            ),
          );
          try {
            await post(`/v1/ventures/${created!.id}/files`, body);
            setFiles((old) =>
              old.map((item) => ({ ...item, status: "Uploaded" })),
            );
          } catch (error) {
            setFiles((old) =>
              old.map((item) =>
                item.status === "Uploaded"
                  ? item
                  : { ...item, status: "Upload failed — retry" },
              ),
            );
            throw error;
          }
        }
        setStep(4);
      });
    }
  }
  async function launch() {
    await action.run(async () => {
      await post(`/v1/ventures/${created!.id}/start`);
      selectVenture(created!.id);
      invalidateQueries();
      try {
        sessionStorage.setItem("foundry.just-launched", created!.id);
      } catch {}
      navigate("/dashboard");
    });
  }
  return (
    <div className="onboarding">
      <Link className="onboarding-brand" to="/welcome">
        <span className="brand-mark">f</span>Foundry
      </Link>
      <div className="onboarding-card">
        <div className="step-dots" aria-label={`Step ${step} of 4`}>
          {["You", "Idea", "Context", "Launch"].map((label, index) => (
            <div className={step >= index + 1 ? "active" : ""} key={label}>
              <span>{index + 1}</span>
              {label}
            </div>
          ))}
        </div>
        <p className="eyebrow">A small beginning. A whole company.</p>
        <h1>
          {
            [
              "",
              "Let’s start with you.",
              "What are we building?",
              "Give the team context.",
              "Your company is ready.",
            ][step]
          }
        </h1>
        <p className="page-description">
          {
            [
              "",
              "You stay in control of the decisions that matter.",
              "Tell the team who this is for and what a useful first version does.",
              "Share research, notes, requirements or a brief. This step is optional.",
              "Review funding and optional connections, then explicitly start when you’re ready.",
            ][step]
          }
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void (step === 4 ? launch() : next());
          }}
        >
          {created && step < 3 && (
            <p className="notice">
              Your company has been created, so these saved details are
              read-only. Founder and budget preferences can be changed in
              Settings after launch.
            </p>
          )}
          {step === 1 && (
            <label>
              Founder name
              <input
                autoFocus
                readOnly={Boolean(created)}
                value={founder}
                onChange={(event) => setFounder(event.target.value)}
                autoComplete="given-name"
                maxLength={60}
              />
            </label>
          )}
          {step === 2 && (
            <>
              <fieldset disabled={Boolean(created)}>
                <legend>Your starting point</legend>
                <label><input type="radio" name="intent" checked={intent === "bring"} onChange={() => setIntent("bring")} /> Bring my idea</label>
                <label><input type="radio" name="intent" checked={intent === "discover"} onChange={() => setIntent("discover")} /> Discover an idea for me</label>
              </fieldset>
              {intent === "discover" && <p className="notice">Save a discovery request with your interests, audience and constraints. No discovery has run yet. Starting asks the team to research options, not claim an idea is already validated.</p>}
              <label>
                Venture name
                <input
                  readOnly={Boolean(created)}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={200}
                />
              </label>
              <label>
                {intent === "discover" ? "Discovery brief: interests, audience and constraints" : "Idea"}
                <textarea
                  readOnly={Boolean(created)}
                  value={idea}
                  onChange={(event) => setIdea(event.target.value)}
                  rows={5}
                  maxLength={4000}
                  placeholder={intent === "discover" ? "Tell the team about the people you want to help, your interests, constraints and problems worth researching." : "A pantry companion for busy families that tracks what they have, highlights food about to expire, and suggests simple recipes."}
                />
                <small>{idea.length} / 4,000 characters · minimum 50</small>
              </label>
              <label>
                Budget <span>(USD)</span>
                <input
                  readOnly={Boolean(created)}
                  aria-label="Budget"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={budget}
                  onChange={(event) => setBudget(event.target.value)}
                />
                <small>
                  This is a planning budget, not a deposit or wallet balance. It does not authorize a transfer or purchase. Funding and consequential spending require separate review.
                </small>
              </label>
            </>
          )}
          {step === 3 && (
            <>
              <input
                ref={input}
                className="sr-only"
                type="file"
                disabled={action.working}
                aria-label="Context files"
                multiple
                accept=".md,.txt,.pdf,.csv,.json"
                onChange={(event) => {
                  chooseFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <button
                className="upload-zone"
                type="button"
                disabled={action.working}
                onClick={() => input.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  chooseFiles(Array.from(event.dataTransfer.files));
                }}
              >
                <Icon name="artifacts" size={32} />
                <strong>Drop files here, or choose files</strong>
                <span>Up to 8 files · 15 MB each</span>
              </button>
              <ul className="upload-list">
                {files.map((item, index) => (
                  <li key={`${item.file.name}-${index}`}>
                    <span>
                      {item.file.name}
                      <small>{item.status}</small>
                    </span>
                    {item.status !== "Uploaded" && (
                      <button
                        type="button"
                        disabled={action.working}
                        className="icon-button"
                        aria-label={`Remove ${item.file.name}`}
                        onClick={() =>
                          setFiles((old) => old.filter((_, i) => i !== index))
                        }
                      >
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {step === 4 && (
            <>
              <div className="launch-summary">
                <span className="brand-mark">
                  <Icon name="departments" size={30} />
                </span>
                <div>
                  <strong>{created?.name}</strong>
                  <p>
                    {founder} · ${Number(budget).toFixed(2)} planning budget (not deposited)
                  </p>
                </div>
              </div>
              <div className="integration-card">
                <div>
                  <h3>Connect GitHub</h3>
                  <p>Optional. Authorization uses secure provider sign-in; credentials stay on the server.</p>
                  <p role="status">{connections.error ? "Connection status unavailable. Retry below." : connections.loading ? "Checking connection…" : `GitHub: ${github?.status ?? "not connected"}`}</p>
                  <p>{system?.providers?.composio?.configured === false ? "Connection provider is not configured on the server." : "Provider configuration alone does not mean connected."}</p>
                </div>
                {created && <IntegrationConnect ventureId={created.id} provider="github" name="GitHub" status={github?.status} disabled={system?.providers?.composio?.configured === false} />}
              </div>
              <div className="actions">
                <button className="button" type="button" onClick={() => void connections.refetch()}>Refresh connection status</button>
                <Link className="button" to="/approvals">Review connection approvals</Link>
                <Link className="button" to="/integrations">Review integrations</Link>
              </div>
              {created && <IntegrationCatalog ventureId={created.id} />}
              <div className="notice">
                <h3>Review funding</h3>
                <p>No funds have been deposited or transferred by onboarding. Review wallet readiness, funding instructions and approvals in Treasury. Starting may create agent work and provider usage; it does not connect GitHub or fund a wallet.</p>
                <Link className="button" to="/treasury">Review funding in Treasury →</Link>
              </div>
              {integration && (
                <p role="status" className="notice">
                  {integration}
                </p>
              )}
            </>
          )}
          <ErrorNotice error={validation || action.error} />
          <div className="onboarding-footer">
            {step > 1 && step < 4 ? (
              <button
                type="button"
                className="button ghost"
                disabled={action.working}
                onClick={() => setStep(step - 1)}
              >
                Back
              </button>
            ) : (
              <span />
            )}
            <button
              className="button primary"
              disabled={action.working}
              type="submit"
            >
              {action.working
                ? "Working…"
                : step === 4
                  ? "Launch company"
                  : step === 3
                    ? "Continue"
                    : "Next"}
              <Icon name="arrow" size={16} />
            </button>
          </div>
        </form>
      </div>
      <p className="onboarding-footnote">
        Thirteen departments, working together. You make the consequential
        decisions.
      </p>
    </div>
  );
}
