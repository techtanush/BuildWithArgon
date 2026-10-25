# Contract requests — tanush

Format: file, exact change (diff), why, who is affected, workaround used meanwhile.

## T-CR-01 — Align TypeScript status and gate unions with the SQL/API contract

File: `web/src/shared/contracts.ts` (frozen).

```diff
-export type VentureStatus = 'draft' | 'running' | 'paused' | 'done' | 'failed';
+export type VentureStatus = 'draft' | 'running' | 'paused' | 'archived';
-export type GateType = 'merge' | 'public_post' | 'send' | 'spend' | 'new_capability' | 'integration' | 'clarification' | 'pivot' | 'computer_action';
+export type GateType = 'clarification' | 'pivot' | 'spend' | 'outreach' | 'merge' | 'deploy' | 'integration' | 'new_capability' | 'computer_action';
```

Why: frozen `schema.sql` and the API spec define these exact values. Consumers: dashboard and world. Workaround: the kernel follows SQL/Python contract values; dashboard gate display accepts the existing `Approval.gate_type` string escape hatch. No frozen file was edited.
