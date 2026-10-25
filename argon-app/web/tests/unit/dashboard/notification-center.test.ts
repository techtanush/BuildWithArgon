import { expect, it } from "vitest";
import { recordedNotifications } from "../../../src/dashboard/components/DashboardNotificationCenter";
import type { Approval, Artifact, Run } from "../../../src/shared/contracts";

it("uses only recorded links and completed records", () => {
  const run: Run = { id: "run_real", ticket_id: null, agent_id: "eng.builder", kind: "managed_agent", job: "engineering_build", model: "argon", status: "succeeded", tokens_in: 0, tokens_out: 0, cost_usd: 0, interaction_id: null, created_at: "2026-10-25T12:00:00Z", started_at: null, completed_at: "2026-10-25T12:03:00Z", error: null };
  const preview: Artifact = { id: "art_real", kind: "preview", title: "Real preview", summary: "", department_id: "engineering", agent_id: null, ticket_id: null, uri: null, meta: { preview_url: "https://preview.example.test/real" }, created_at: "2026-10-25T12:02:00Z" };
  const unsafe: Artifact = { ...preview, id: "art_unsafe", uri: "javascript:alert(1)", meta: { preview_url: "//not-recorded.test" } };
  const approval: Approval = { id: "apr_real", gate_type: "deploy", status: "pending", title: "Deploy the recorded build", summary: "", payload: {}, requested_by_agent_id: null, ticket_id: null, created_at: "2026-10-25T12:04:00Z", decided_at: null, decided_by: null, decision_note: null };
  const notices = recordedNotifications([preview, unsafe], [run], [approval]);
  expect(notices.map(item => item.id)).toEqual(["approval:apr_real", "run:run_real", "artifact:art_real", "artifact:art_unsafe"]);
  expect(notices.find(item => item.id === "artifact:art_real")?.external).toBe("https://preview.example.test/real");
  expect(notices.find(item => item.id === "artifact:art_unsafe")?.title).toBe("Engineering artifact recorded");
  expect(notices.find(item => item.id === "approval:apr_real")?.to).toBe("/approvals?id=apr_real");
});
