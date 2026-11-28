import { MetricCounters, SessionFocus, metricsState, type SessionRecord, type SessionMetricsState } from "@ancientvoid/contracts";
import type { HubDatabase } from "../../platform/index.ts";

/** Raw SQLite row shape (snake_case) for the sessions table. */
export interface SessionRow {
  id: string;
  adapter: string;
  project: string;
  worktree_sha: string | null;
  model: string | null;
  permission_mode: string | null;
  status: string;
  created_at: string;
  budget_usd: number | null;
  adapter_version: string;
  last_seq: number;
  cost_usd: number;
  updated_at: string;
  tokens_est: number;
  park_reason: string | null;
  control_mode: string;
  harness: string;
  host_id: string;
  native_session_id: string | null;
  resume_version: number;
  log_offset: number | null;
  parent_session_id: string | null;
  observed_at: string | null;
  fork: number;
  input_revision: number;
  writer_client: string | null;
  writer_lease_until: string | null;
  archived: number;
  title: string | null;
  title_source: string | null;
  origin_intent: string | null;
  focus: string | null;
  handover_from: string | null;
  metric_counters: string;
  last_activity: string | null;
  pinned: number;
  persistent_worker: number;
  workspace_mode: string | null;
  workspace_baseline: string | null;
  auto_resume_on_limit: number;
}

function activity(raw: string | null | undefined): SessionRecord["lastActivity"] {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { text?: unknown; type?: unknown; at?: unknown };
    return typeof v.text === "string" && typeof v.type === "string" && typeof v.at === "string" ? { text: v.text, type: v.type, at: v.at } : null;
  } catch {
    return null;
  }
}

function counters(raw: string | null | undefined): MetricCounters {
  try {
    return MetricCounters.parse(JSON.parse(raw ?? "{}"));
  } catch {
    return MetricCounters.parse({});
  }
}

export function rowToRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    adapter: row.adapter,
    project: row.project,
    worktreeSha: row.worktree_sha,
    workspaceMode: row.workspace_mode === "worktree" || row.workspace_mode === "direct" ? row.workspace_mode : "unknown",
    workspaceBaseline: row.workspace_baseline ? (JSON.parse(row.workspace_baseline) as SessionRecord["workspaceBaseline"]) : null,
    model: row.model,
    permissionMode: row.permission_mode ?? null,
    status: row.status as SessionRecord["status"],
    createdAt: row.created_at,
    budgetUsd: row.budget_usd,
    adapterVersion: row.adapter_version,
    lastSeq: row.last_seq,
    costUsd: row.cost_usd,
    updatedAt: row.updated_at,
    tokensEst: row.tokens_est,
    parkReason: row.park_reason as SessionRecord["parkReason"],
    controlMode: row.control_mode as SessionRecord["controlMode"],
    harness: row.harness as SessionRecord["harness"],
    hostId: row.host_id,
    nativeSessionId: row.native_session_id,
    resumeVersion: row.resume_version,
    logOffset: row.log_offset,
    parentSessionId: row.parent_session_id,
    observedAt: row.observed_at,
    fork: row.fork === 1,
    inputRevision: row.input_revision,
    writerClient: row.writer_client,
    writerLeaseUntil: row.writer_lease_until,
    archived: row.archived === 1,
    title: row.title ?? null,
    titleSource: row.title_source === "ai" || row.title_source === "manual" ? row.title_source : "auto",
    originIntent: row.origin_intent,
    focus: row.focus ? SessionFocus.parse(JSON.parse(row.focus)) : null,
    handoverFrom: row.handover_from,
    metrics: metricsState(counters(row.metric_counters)),
    lastActivity: activity(row.last_activity),
    pinned: row.pinned === 1,
    persistentWorker: row.persistent_worker === 1,
    autoResumeOnLimit: row.auto_resume_on_limit === 1,
  };
}

export function persistRecord(db: HubDatabase, record: SessionRecord): void {
  db
    .prepare(
      `INSERT INTO sessions (
         id, adapter, project, worktree_sha, model, status, created_at, budget_usd, adapter_version, last_seq,
         cost_usd, updated_at, tokens_est, park_reason, control_mode, harness, host_id, native_session_id,
         resume_version, log_offset, parent_session_id, observed_at, fork, input_revision, writer_client, writer_lease_until,
         archived, title, metric_counters, last_activity, pinned, permission_mode, title_source, persistent_worker, workspace_mode, workspace_baseline, auto_resume_on_limit,
         origin_intent, focus, handover_from
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         model = excluded.model,
         worktree_sha = excluded.worktree_sha,
         budget_usd = excluded.budget_usd,
         adapter_version = excluded.adapter_version,
         last_seq = excluded.last_seq,
         cost_usd = excluded.cost_usd,
         updated_at = excluded.updated_at,
         tokens_est = excluded.tokens_est,
         park_reason = excluded.park_reason,
         control_mode = excluded.control_mode,
         harness = excluded.harness,
         host_id = excluded.host_id,
         native_session_id = excluded.native_session_id,
         resume_version = excluded.resume_version,
         log_offset = excluded.log_offset,
         parent_session_id = excluded.parent_session_id,
         observed_at = excluded.observed_at,
         fork = excluded.fork,
         input_revision = excluded.input_revision,
         writer_client = excluded.writer_client,
         writer_lease_until = excluded.writer_lease_until,
         archived = excluded.archived,
         title = excluded.title,
         metric_counters = excluded.metric_counters,
         last_activity = excluded.last_activity,
         pinned = excluded.pinned,
         permission_mode = excluded.permission_mode,
         title_source = excluded.title_source,
         origin_intent = COALESCE(sessions.origin_intent, excluded.origin_intent),
         focus = excluded.focus,
         handover_from = COALESCE(sessions.handover_from, excluded.handover_from),
         persistent_worker = excluded.persistent_worker,
         workspace_mode = excluded.workspace_mode,
         workspace_baseline = excluded.workspace_baseline,
         auto_resume_on_limit = excluded.auto_resume_on_limit`,
    )
    .run(
      record.id,
      record.adapter,
      record.project,
      record.worktreeSha,
      record.model,
      record.status,
      record.createdAt,
      record.budgetUsd,
      record.adapterVersion,
      record.lastSeq,
      record.costUsd,
      record.updatedAt,
      record.tokensEst,
      record.parkReason,
      record.controlMode,
      record.harness,
      record.hostId,
      record.nativeSessionId,
      record.resumeVersion,
      record.logOffset,
      record.parentSessionId,
      record.observedAt,
      record.fork ? 1 : 0,
      record.inputRevision,
      record.writerClient,
      record.writerLeaseUntil,
      record.archived ? 1 : 0,
      record.title,
      JSON.stringify((record.metrics as SessionMetricsState).counters),
      record.lastActivity ? JSON.stringify(record.lastActivity) : null,
      record.pinned ? 1 : 0,
      record.permissionMode,
      record.titleSource,
      record.persistentWorker ? 1 : 0,
      record.workspaceMode === "unknown" ? null : record.workspaceMode,
      record.workspaceBaseline ? JSON.stringify(record.workspaceBaseline) : null,
      record.autoResumeOnLimit ? 1 : 0,
      record.originIntent ?? null,
      record.focus ? JSON.stringify(record.focus) : null,
      record.handoverFrom ?? null,
    );
}
