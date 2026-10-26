import { useEffect, useState } from "react";
import { get } from "../../api/client";
type AnswerRecord = { run_id?: string; model?: string; run_status?: string };
/** Model labels come only from the answer's persisted run, never configured defaults. */
export function AnswerRunEvidence({ answerId }: { answerId: string }) {
  const [record, setRecord] = useState<AnswerRecord | null>(null);
  useEffect(() => { let current = true; setRecord(null); void (async () => { try { const value = await get<AnswerRecord>(`/v1/answers/${encodeURIComponent(answerId)}`); if (current) setRecord(value ?? {}); } catch { if (current) setRecord({}); } })(); return () => { current = false; }; }, [answerId]);
  if (!record) return null;
  return <p className="answer-run-evidence">{record.run_id && record.model ? <><a href={`/runs/${encodeURIComponent(record.run_id)}`}>{record.model}</a> · {record.run_status || "Status unavailable"}</> : "Answer model record unavailable"}</p>;
}
