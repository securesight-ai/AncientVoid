import { createHash } from "node:crypto";
import type { OperationKind, OperationState, PendingOperation } from "@ancientvoid/contracts";
import type { HubDatabase } from "../../platform/index.ts";

interface OperationRow {
  id: string;
  session_id: string;
  kind: string;
  payload: string;
  payload_hash: string;
  revision: number;
  actor: string | null;
  state: string;
  outcome: string | null;
  created_at: string;
  updated_at: string;
}

/** Keys sorted, so the same arguments always give the same hash. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function payloadHash(payload: unknown): string {
  return createHash("sha256").update(canonical(payload)).digest("hex");
}

function toOperation(row: OperationRow): PendingOperation {
  return {
    id: row.id,
    sessionId: row.session_id,
    kind: row.kind as OperationKind,
    payload: JSON.parse(row.payload) as unknown,
    payloadHash: row.payload_hash,
    revision: row.revision,
    actor: row.actor,
    state: row.state as OperationState,
    outcome: row.outcome,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * T7.3: approval-gated actions that survive a hub crash. Every state change
 * is one conditional UPDATE — two callers can never both move the same
 * operation to `dispatching`, so an approval runs at most once.
 */
export class OperationStore {
  private readonly db: HubDatabase;

  constructor(db: HubDatabase) {
    this.db = db;
  }

  create(id: string, sessionId: string, kind: OperationKind, payload: unknown, revision: number, actor: string | null): PendingOperation {
    const now = new Date().toISOString();
    const hash = payloadHash(payload);
    this.db
      .prepare(
        `INSERT INTO operations (id, session_id, kind, payload, payload_hash, revision, actor, state, outcome, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
      )
      .run(id, sessionId, kind, JSON.stringify(payload), hash, revision, actor, now, now);
    this.db.prepare("UPDATE approvals SET payload_hash = ? WHERE id = ?").run(hash, id);
    return this.get(id)!;
  }

  get(id: string): PendingOperation | undefined {
    const row = this.db.prepare("SELECT * FROM operations WHERE id = ?").get(id) as unknown as OperationRow | undefined;
    return row ? toOperation(row) : undefined;
  }

  list(states: readonly OperationState[], sessionId?: string): PendingOperation[] {
    // Only literal placeholders belong in SQL. Bind all states separately.
    const marks = states.map(() => "?").join(",");
    const rows = (
      sessionId
        ? this.db.prepare(`SELECT * FROM operations WHERE state IN (${marks}) AND session_id = ? ORDER BY created_at`).all(...states, sessionId)
        : this.db.prepare(`SELECT * FROM operations WHERE state IN (${marks}) ORDER BY created_at`).all(...states)
    ) as unknown as OperationRow[];
    return rows.map(toOperation);
  }

  /** Moves `id` to `to` only if it is in one of `from`. False: someone else
   * got there first (or the state never allowed it). */
  transition(id: string, from: readonly OperationState[], to: OperationState, outcome?: string): boolean {
    // Same placeholder-only rule as list(); state values are bound below.
    const marks = from.map(() => "?").join(",");
    const res = this.db
      .prepare(`UPDATE operations SET state = ?, outcome = COALESCE(?, outcome), updated_at = ? WHERE id = ? AND state IN (${marks})`)
      .run(to, outcome ?? null, new Date().toISOString(), id, ...from);
    return Number(res.changes) === 1;
  }

  /** T7.2: the human's answer, stored next to (not inside) the payload. */
  setResponse(id: string, response: unknown): void {
    this.db.prepare("UPDATE operations SET response = ? WHERE id = ?").run(JSON.stringify(response), id);
  }

  response(id: string): unknown {
    const row = this.db.prepare("SELECT response FROM operations WHERE id = ?").get(id) as { response: string | null } | undefined;
    return row?.response ? (JSON.parse(row.response) as unknown) : null;
  }

  /** T7.2: the request a provider already made for this tool call. */
  findToolRequest(sessionId: string, toolUseId: string): PendingOperation | undefined {
    const row = this.db
      .prepare("SELECT * FROM operations WHERE session_id = ? AND kind = 'tool.permission' AND json_extract(payload, '$.toolUseId') = ?")
      .get(sessionId, toolUseId) as unknown as OperationRow | undefined;
    return row ? toOperation(row) : undefined;
  }

  /** The arguments about to run are still the ones that were approved. */
  intact(op: PendingOperation): boolean {
    const approved = this.db.prepare("SELECT payload_hash FROM approvals WHERE id = ?").get(op.id) as { payload_hash: string | null } | undefined;
    const now = payloadHash(op.payload);
    return now === op.payloadHash && (approved?.payload_hash ?? now) === now;
  }
}
