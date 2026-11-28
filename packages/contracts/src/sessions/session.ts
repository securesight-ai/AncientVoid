import { z } from "zod";
import { SessionMetricsState } from "./metrics.ts";
import type { PromptAttachment } from "../attachments/attachment.ts";
import { CONTROL_MODES, DEFAULT_HOST_ID, HARNESS_TARGETS, RESUME_SCHEMA_VERSION } from "./identity.ts";

/** ADR-0044: shared system-event vocabulary, additive to the session status. */
export type SessionInterruptionReason = "worker_exit" | "hub_restart" | "adapter_down" | "provider_limit";

export interface SessionInterruptionPayload {
  kind: "session.interrupted";
  reason: SessionInterruptionReason;
  since: string;
  lastTurnId: string | null;
  /** ADR-0076: absent on legacy interruptions; those remain manual. */
  autoResumeEligible?: boolean;
  /** ADR-0076 Nachtrag (Limit-Wiederaufnahme): true, wenn der Zug am
   * Kontingent/Rate-Limit des Providers starb — nur solche Unterbrechungen
   * darf die ausdrückliche Nutzer-Option automatisch fortsetzen. */
  limit?: boolean;
  /** Frühster bekannter Freigabezeitpunkt der blockierten Fenster (ISO),
   * sofern der Provider ihn strukturiert genannt hat (ADR-0004). */
  resumesAt?: string;
}

export const SESSION_STATUSES = [
  "idle",
  "starting",
  "working",
  "waiting_approval",
  "parked",
  "stopping",
  "stopped",
  /** ADR-0044: the run was cut off (worker kill, hub restart, adapter down
   * without an agent error) — the agent did not fail. Consumers must render
   * unknown statuses as text, never crash (defensive rule). */
  "interrupted",
  "error",
] as const;

export const SessionStatus = z.enum(SESSION_STATUSES);
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/**
 * A POSIX-legal env var name — the same pattern `TmuxRunner.spawn()`
 * (`packages/workers/src/tmux.ts`) enforces as its own last line of
 * defense against shell injection (a red-team review, 2026-09-18, found
 * an unvalidated env KEY reaching an interpolated shell command string —
 * `X=$(evil)` as a "key" ran the command). Validating it here too rejects
 * the same bad input early (a clean 400 at session creation) instead of
 * only late (a confusing session.start_failed deep inside the runner) —
 * defense in depth, not a replacement for the runner's own check.
 */
export const ENV_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * ADR-0057 (EPIC-P38): wo eine Session Dateien ändert. `worktree` = eigener
 * Git-Worktree, `direct` = im vorhandenen Projekt-Checkout, `unknown` = nur
 * für Altdaten ohne Beleg (sichtbarer Klärungsbedarf, nie geraten). Ein
 * Worktree isoliert Git-Dateien, keine Prozess-/Netzwerkrechte — die
 * Harness-Sandbox/der Permission-Mode ist davon unabhängig.
 */
export const WORKSPACE_MODES = ["worktree", "direct"] as const;
export const WorkspaceMode = z.enum(WORKSPACE_MODES);
export type WorkspaceMode = z.infer<typeof WorkspaceMode>;

/** Zustand des Checkouts beim Start einer direkten Session (Diff-Baseline, ADR-0057 §4). */
export const WorkspaceBaseline = z.object({
  /** Kanonischer Checkout (realpath der Git-Toplevel-Ebene bzw. des Ordners). */
  checkoutId: z.string().min(1),
  head: z.string().nullable(),
  branch: z.string().nullable(),
  /** Beim Start bereits geänderte Pfade (porcelain), gekappt — gehören nicht der Session. */
  dirty: z.array(z.string()).max(200),
  dirtyTruncated: z.boolean().default(false),
});
export type WorkspaceBaseline = z.infer<typeof WorkspaceBaseline>;

/** Adapter-neutral session creation request (API body / hubctl input). */
export const SessionSpec = z.object({
  /** Registered adapter id (e.g. "dummy", "claude", "codex"). */
  adapter: z.string().min(1),
  /** Absolute or repo-relative project path the session works in. */
  project: z.string().min(1),
  /** Initial prompt (optional — some adapters start idle). */
  prompt: z.string().optional(),
  /** Model override, adapter-specific meaning. */
  model: z.string().optional(),
  /** Hard budget cap in USD (enforced from P2; stored from P0). */
  budgetUsd: z.number().positive().nullable().optional(),
  /** ADR-0057: Arbeitsort. Fehlt = eigener Worktree (Standard; Nicht-Git-Projekte
   * fallen sichtbar auf direkt zurück). Explizit `worktree` auf Nicht-Git scheitert vor Spawn. */
  workspaceMode: WorkspaceMode.optional(),
  /** ADR-0057: ausdrückliche Bestätigung, in einem Checkout mit ungesicherten Änderungen zu starten. */
  confirmDirty: z.boolean().optional(),
  /** ADR-0081: ausdrückliche Bestätigung, in einem Nicht-Git-Ordner parallel zu einer
   * anderen Session zu schreiben. Ohne `true` bleibt der Allein-Schreiber-Zwang. */
  confirmSharedFolder: z.boolean().optional(),
  /** Additional env vars for the session worker. */
  env: z.record(z.string().regex(ENV_VAR_NAME), z.string()).optional(),
  /** Adapter-specific free-form arguments, validated by the adapter itself. */
  args: z.record(z.string(), z.unknown()).optional(),
  /**
   * Adoption (ADR-0011): continue a session the hub only observed so far.
   * `nativeSessionId` of the external run; the first prompt resumes it
   * (opencode `--session`, claude `--resume`). Adapters that cannot resume
   * refuse this via refuseSpec (unsupportedResume).
   */
  adoptNativeSessionId: z.string().min(1).optional(),
  /** ADR-0040: continue the adopted session as a copy with its own id, so a
   * run still open elsewhere is not written by two processes. */
  adoptFork: z.boolean().optional(),
  /** ADR-0040: overview title for an adopted session (display only). */
  title: z.string().min(1).max(120).optional(),
  /** Read-only mirror (ADR-0011 Erweiterung): show an externally observed
   * opencode session's conversation in the hub chat without adopting it —
   * history and updates come from opencode's own store, nothing is run. */
  mirrorNativeSessionId: z.string().min(1).optional(),
  /** T7.10: files for the first prompt — resolved by the hub from the
   * uploaded attachment ids (clients send `attachmentIds`). */
  attachments: z.array(z.custom<PromptAttachment>()).optional(),
});
export type SessionSpec = z.infer<typeof SessionSpec>;

/** Persisted session record (SQLite `sessions` table, P0 data model). */
export const SessionFocus = z.object({
  text: z.string().min(1).max(120),
  source: z.enum(["manual", "handoff", "model"]),
  setAt: z.iso.datetime(),
});

export const SessionRecord = z.object({
  id: z.string().min(1),
  adapter: z.string().min(1),
  project: z.string().min(1),
  worktreeSha: z.string().nullable(),
  /** ADR-0057: belegter Arbeitsort; `unknown` nur für Altdaten (needs_attention in der UI). */
  workspaceMode: z.enum(["worktree", "direct", "unknown"]).default("unknown"),
  /** ADR-0057: Checkout-Zustand beim Start einer direkten Session; sonst null. */
  workspaceBaseline: WorkspaceBaseline.nullable().default(null),
  model: z.string().nullable(),
  /** ADR-0033: the permission mode this session runs in (provider-specific
   * name), null when the adapter has none. */
  permissionMode: z.string().nullable().default(null),
  status: SessionStatus,
  createdAt: z.string().min(1),
  budgetUsd: z.number().positive().nullable(),
  adapterVersion: z.string().min(1),
  /** Last known event seq — used for K7 state restore. */
  lastSeq: z.number().int().nonnegative().default(0),
  /** Sum of every event's costUsd so far (ADR-0003). 0 for adapters that
   * never report a native cost (e.g. codex, T1.3) — "0" here means
   * "nothing billed via this field," not "confirmed free." */
  costUsd: z.number().nonnegative().default(0),
  /** Sum of every event's tokensEst so far (ADR-0006) — same "0 means
   * unreported, not confirmed zero" caveat as costUsd. */
  tokensEst: z.number().nonnegative().default(0),
  /** T7.7 (ADR-0023): how far costUsd/tokensEst can be trusted — "unknown"
   * means the 0 above is not a value. Derived from `counters`. */
  metrics: SessionMetricsState.prefault({ cost: "unknown", tokens: "unknown", counters: {} }),
  /** ISO-8601 timestamp of the last persisted change to this session
   * (status change or event) — T1.5's "zuletzt aktiv" sort key. */
  updatedAt: z.string().min(1),
  /** T2.7/ADR-0008: why a "parked" session is paused — null for every
   * other status, or for a manually parked session that predates this
   * field. Distinguishes a manual park() from an automatic budget/
   * daily-cap park so a budget top-up never auto-resumes a session that
   * was parked for an unrelated reason. */
  parkReason: z.enum(["manual", "budget", "daily_cap"]).nullable().default(null),
  /** ADR-0011. Defaults keep every pre-P5 row and caller valid. */
  controlMode: z.enum(CONTROL_MODES).default("managed"),
  harness: z.enum(HARNESS_TARGETS).default("cli"),
  hostId: z.string().min(1).default(DEFAULT_HOST_ID),
  nativeSessionId: z.string().nullable().default(null),
  resumeVersion: z.number().int().nonnegative().default(RESUME_SCHEMA_VERSION),
  logOffset: z.number().int().nonnegative().nullable().default(null),
  parentSessionId: z.string().nullable().default(null),
  observedAt: z.string().nullable().default(null),
  fork: z.boolean().default(false),
  inputRevision: z.number().int().nonnegative().default(0),
  writerClient: z.string().nullable().default(null),
  writerLeaseUntil: z.string().nullable().default(null),
  /** Hidden from the overview list. The session and its events stay. */
  archived: z.boolean().default(false),
  /** ADR-0050: die Session hatte beim letzten Persistieren einen
   * langlebigen Adapter-Prozess (persistent worker, z. B. ACP-App-Server).
   * K7-Recovery ruft adapter.recover() nur auf, wenn vor dem Crash ein Zug
   * offen war oder dies hier gesetzt ist — sonst wäre eine beendete Session
   * nach dem Restart fälschlich wieder am Laufen (BUG-0092). */
  persistentWorker: z.boolean().default(false),
  /** First line of the start prompt, for the overview. Null when the
   * session started without one (or before titles existed). */
  title: z.string().nullable().default(null),
  /** EPIC-P15 T15.5: where the title comes from — `auto` (first words of the
   * prompt), `ai` (short title from the assistant model), `manual` (renamed by
   * the person; never overwritten). */
  titleSource: z.enum(["auto", "ai", "manual"]).default("auto"),
  originIntent: z.string().max(240).nullable().optional(),
  focus: SessionFocus.nullable().optional(),
  handoverFrom: z.uuid().nullable().optional(),
  /** T8.1: the last understandable thing that happened — what the card
   * shows instead of an event number. */
  lastActivity: z.object({ text: z.string().max(160), type: z.string(), at: z.string() }).nullable().default(null),
  /** T8.6: pinned to the top of the overview (on this hub, all devices). */
  pinned: z.boolean().default(false),
  /** ADR-0076 Nachtrag (Limit-Wiederaufnahme): ausdrückliche Nutzer-Option —
   * diese Session nach einem Kontingent-/Rate-Limit-Fenster automatisch
   * fortsetzen, sobald der Provider wieder frei ist. Default aus (ADR-0076:
   * Limits bleiben grundsätzlich sichtbar und manuell). */
  autoResumeOnLimit: z.boolean().default(false),
});
export type SessionRecord = z.infer<typeof SessionRecord>;

/** ADR-0074 (BUG-0155): eine laufende Aktivität einer Session — Quelle ist
 * z. B. ein registrierter externer Job (`job:<uuid>`, Label für Menschen).
 * Idle gibt es erst, wenn keine Aktivität mehr offen ist. */
export interface SessionActivity {
  id: string;
  source: string;
  label: string;
  startedAt: string;
  /** ADR-0099: renews the external-job lease without moving the original start. */
  lastSeenAt?: string;
}

/**
 * Snapshot enabling K7 (100 % state restore in < 3 s after hard kill).
 * Persisted next to the JSONL stream; JSONL remains the source of truth.
 */
export interface SessionSnapshot {
  sessionId: string;
  status: SessionStatus;
  lastSeq: number;
  adapterVersion: string;
  savedAt: string;
  controlMode: string;
  nativeSessionId: string | null;
  resumeVersion: number;
  inputRevision: number;
  /** ADR-0074: Projektion der offenen Aktivitäten (Wahrheit: JSONL-Events). */
  openActivities?: SessionActivity[];
  originIntent?: SessionRecord["originIntent"];
  focus?: SessionRecord["focus"];
  handoverFrom?: SessionRecord["handoverFrom"];
}
