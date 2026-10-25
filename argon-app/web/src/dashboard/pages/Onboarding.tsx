// OWNER: tanush
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { get, post } from "../../api/client";
import { invalidateQueries } from "../../api/hooks";
import type { ListPage, Approval, Venture } from "../../shared/contracts";
import { useCompany } from "../context";
import { ErrorNotice, Icon, useAction } from "../components/Shared";

export default function Onboarding() {
  const [step, setStep] = useState(1),
    [founder, setFounder] = useState(""),
    [name, setName] = useState(""),
    [idea, setIdea] = useState(""),
    [budget, setBudget] = useState("25");
  const [created, setCreated] = useState<Venture | null>(null),
    [files, setFiles] = useState<{ file: File; status: string }[]>([]),
    [validation, setValidation] = useState(""),
    [integration, setIntegration] = useState("");
  const action = useAction(),
    navigate = useNavigate(),
    { selectVenture } = useCompany(),
    input = useRef<HTMLInputElement>(null);
  function chooseFiles(selected: File[]) {
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
          "Add a venture name, an idea of 50–4,000 characters, and a positive budget.",
        );
        return;
      }
      await action.run(async () => {
        let venture = created;
        if (!venture) {
          venture = await post<Venture>("/v1/ventures", {
            name: name.trim(),
            idea: idea.trim(),
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
  async function connect() {
    await action.run(async () => {
      try {
        const result = await post<{ redirect_url: string }>(
          `/v1/ventures/${created!.id}/integrations/github/connect`,
          { callback_url: `${location.origin}/integrations?connected=github` },
        );
        if (result.redirect_url && /^https:\/\//.test(result.redirect_url))
          location.assign(result.redirect_url);
      } catch (error) {
        const pending = await get<ListPage<Approval>>(
          `/v1/ventures/${created!.id}/approvals?status=pending`,
        ).catch(() => ({ items: [] }));
        if (pending.items.some((a) => a.gate_type === "integration"))
          setIntegration(
            "The connection is waiting for your approval. You can review it on the Approvals page after launch.",
          );
        else throw error;
      }
    });
  }
  async function launch() {
    await action.run(async () => {
      await post(`/v1/ventures/${created!.id}/start`);
      selectVenture(created!.id);
      invalidateQueries();
      try {
        sessionStorage.setItem("foundry.just-launched", created!.id);
      } catch {}
      navigate("/");
    });
  }
  return (
    <div className="onboarding">
      <Link className="onboarding-brand" to="/">
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
              "Connect GitHub when you’re ready, or launch with the context you have.",
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
                Idea
                <textarea
                  readOnly={Boolean(created)}
                  value={idea}
                  onChange={(event) => setIdea(event.target.value)}
                  rows={5}
                  maxLength={4000}
                  placeholder="A pantry companion for busy families that tracks what they have, highlights food about to expire, and suggests simple recipes."
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
                  The company will ask before spending beyond this amount.
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
                    {founder} · ${Number(budget).toFixed(2)} starting budget
                  </p>
                </div>
              </div>
              <div className="integration-card">
                <div>
                  <h3>Connect GitHub</h3>
                  <p>Optional. Give the engineering team a place to build.</p>
                </div>
                <button
                  type="button"
                  className="button"
                  disabled={action.working}
                  onClick={() => void connect()}
                >
                  Connect
                </button>
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
