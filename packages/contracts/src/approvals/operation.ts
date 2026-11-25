/**
 * T7.3: an action that waits for a human decision, then runs — persisted
 * with its immutable arguments so it survives a hub crash. The decision
 * itself stays in the approvals table (ADR-0007); this is what the
 * decision releases and what became of it.
 */
export const OPERATION_KINDS = ["steer.prompt", "budget.increase", "tool.permission", "session.create", "session.stop", "session.park", "workspace.setup", "knowledge.add", "scan.run"] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

/**
 * pending → approved | rejected | timed_out (decision)
 * approved → dispatching → done | failed
 * dispatching, hub crashed → uncertain (never retried blindly)
 */
export const OPERATION_STATES = ["pending", "rejected", "timed_out", "dispatching", "done", "failed", "uncertain"] as const;
export type OperationState = (typeof OPERATION_STATES)[number];

export interface PendingOperation {
  /** Same id as its approval request. */
  id: string;
  sessionId: string;
  kind: OperationKind;
  /** The exact arguments that were shown for approval. */
  payload: unknown;
  /** sha256 of the canonical payload — checked again right before running. */
  payloadHash: string;
  /** The session's input revision when requested (T5.5). */
  revision: number;
  actor: string | null;
  state: OperationState;
  /** What happened, in words (done/failed/uncertain). */
  outcome: string | null;
  createdAt: string;
  updatedAt: string;
}
