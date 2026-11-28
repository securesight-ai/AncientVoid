import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Adapter, NormalizedEvent, SessionActivity, SessionHandle, SessionRecord, SessionStatus } from "@ancientvoid/contracts";
import type { NotificationDraft } from "../notifications/index.ts";

export const WRITER_LEASE_MS = 30_000;

/** ADR-0074 (BUG-0155): offene Aktivitäten aus dem JSONL falten — jedes
 * `session.activity_begin` ohne passendes `session.activity_end` ist offen.
 * Verspätete `end`s alter Generationen treffen ihre eigene Id und streuen nicht. */
export function foldActivities(events: readonly NormalizedEvent[]): Map<string, SessionActivity> {
  const open = new Map<string, SessionActivity>();
  for (const e of events) {
    const p = e.payload as { kind?: string; id?: string; source?: string; label?: string; startedAt?: string };
    if (p?.kind === "session.activity_begin" && typeof p.id === "string") {
      open.set(p.id, { id: p.id, source: typeof p.source === "string" ? p.source : "external", label: typeof p.label === "string" ? p.label : "", startedAt: typeof p.startedAt === "string" ? p.startedAt : new Date(e.ts).toISOString() });
    } else if (p?.kind === "session.activity_end" && typeof p.id === "string") {
      open.delete(p.id);
    }
  }
  return open;
}

/** EPIC-P17 T17.4: hard cap for the hub's wait on one adapter submission
 * (a prompt steer or a reopen's start). A timeout never resubmits — it
 * answers "outcome unknown" as a session.steer_timeout event instead. */
export const DEFAULT_STEER_WAIT_MS = 30_000;

export interface SteerMeta {
  inputId?: string;
  revision?: number;
  clientId?: string;
  /** T5.5: take the writer lease from another device on purpose. Input-id
   * and revision checks still apply. */
  takeover?: boolean;
  /** EPIC-P15 T15.3: hold this prompt back until the running turn ends. */
  queue?: boolean;
  /** EPIC-P15 T15.3: sent by the hub itself from the queue — never queued again. */
  fromQueue?: boolean;
}

export interface LiveSession {
  mainTurnIdle?: boolean;
  /** ADR-0100 (EPIC-P72): wurde der Ketten-Block in dieser Laufzeit schon
   * geliefert — bei Adaptern mit fortbestehendem Kontext nicht noch einmal. */
  skillChainInjected?: boolean;
  lifecycle?: Promise<void>;
  turnFailed?: boolean;
  /** ADR-0015 Nachtrag 2026-11-15: Provider-Fehler dieses Laufs, zurückgehalten
   * bis der Lauf wirklich abbricht — überstandene Fehler bleiben im Verlauf. */
  pendingErrorDraft?: NotificationDraft | null;
  /** Für diesen Lauf wurde bereits eine Fehler-Meldung gespeichert. */
  runFailureNotified?: boolean;
  record: SessionRecord;
  adapter: Adapter;
  handle: SessionHandle | null;
  abort: AbortController;
  subscribers: Set<(events: NormalizedEvent[]) => void>;
  /** ADR-0074 (BUG-0155): offene Aktivitäten dieser Session — Zug-Prozesse
   * zählen weiterhin über activeWorkers, alles andere (persistente Turns,
   * registrierte externe Jobs) hier. Idle gibt es nur mit leerem Register. */
  activities: Map<string, SessionActivity>;
  /** T2.1: real per-session working directory — the worktree path when
   * isolation succeeded, else the raw `record.project` (honest fallback,
   * see WorktreeManager's doc comment). Adapters only ever see this via
   * AdapterContext.workdir/spawnWorker cwd, never `record.project`
   * directly, once a session is live. */
  workdir: string;
  /** Set only when this session actually got worktree isolation — needed
   * at stop() time to know whether (and against which real repo) to
   * `git worktree remove`. */
  worktreeIsolated: boolean;
  /** T2.7: true once the 80%-budget warning has fired for this session —
   * prevents every subsequent cost-bearing event from re-emitting it. */
  budgetWarned: boolean;
  /** Selected skill, so a later steer reloads the same extends chain. */
  skillName?: string;
  /** T5.4: provider workers of this session that have not exited yet. */
  activeWorkers?: number;
  /** Expected exits of per-turn workers killed by an explicit park. */
  parkGeneration?: number;
  /** BUG-0100: der letzte Worker des aktuellen Zugs ist beendet — die
   * Abschluss-Klassifizierung (250 ms) oder das Zugende läuft noch. Ein
   * Prompt in diesem Fenster gehört in einen neuen Lauf, nicht an das
   * tote Handle. In-proc-Adapter ohne Worker setzen das nie. */
  workerExitPending?: boolean;
  /** T5.6: result of ctx.adoptWorker() during recover(), if it was asked. */
  adopted?: boolean;
  /** EPIC-P14: a long-lived worker (ACP, app-server) has the worktree as its
   * cwd — deleting it would pull the directory out from under the process. */
  persistentWorker?: boolean;
  /** EPIC-P15 T15.5: the first words of the person, for the AI title. */
  titlePrompt?: string;
  /** EPIC-P15 T15.5: the model was asked once already (success or not). */
  aiTitleTried?: boolean;
  /** EPIC-P29 (ADR-0051): der Workspace-Zustand dieser Session — nur gesetzt,
   * wenn am Basis-SHA ein Manifest existiert. In-Memory; die Wahrheit liegt
   * in den workspace.*-Events (K7-Faltung `foldWorkspaceState`). */
  workspace?: LiveWorkspaceState;
}

/** EPIC-P29: Phase vor/während/nach Setup; `pendingApprovalId` nur bei
 * `approval_required` gesetzt. */
interface LiveWorkspaceState {
  phase: "approval_required" | "preparing" | "ready" | "failed" | "needs_attention";
  manifestHash: string;
  baseSha: string;
  pendingApprovalId: string | null;
}

/** A turn counts as over only if no new worker starts within this window —
 * some adapters run a short probe (`--version`) right before the turn. */
export const TURN_END_SETTLE_MS = 250;

/** Politeness and filler that carry no task ("Kannst du mir sagen, ob …"). */
const LEAD =
  /^(?:(?:hallo|hi|hey|moin|servus)\b[,!.\s]*|(?:bitte|please)\s+|(?:kannst|könntest|würdest) du(?: mir)?(?: bitte)?\s+|(?:can|could|would) you(?: please)?\s+|ich (?:würde|möchte|will|brauche|hätte)(?: gern(?:e)?)?(?: bitte)?\s+|i(?:'d| would) like(?: you)? to\s+|mir sagen[,:\s]+|sagen[,:]\s+)/i;

export interface SessionCreateOptions {
  workInProject?: boolean;
  naming?: Pick<SessionRecord, "originIntent" | "focus" | "handoverFrom"> & { title: string | null };
}

export function originFromPrompt(text: string): string | null {
  const compact = text.replace(/\s+/gu, " ").trim();
  return compact.length > 240 ? `${compact.slice(0, 239).trimEnd()}…` : compact || null;
}

/** Overview title: the first line that says something, without the
 * prefixes the composer adds (Workflow:, /skill, Agent:, Ziel:) and without
 * filler words in front of the actual task. */
export function sessionTitle(prompt: string): string | null {
  const line = prompt
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !/^(workflow|agent):\s/i.test(l) && !/^\/[\w-]+$/.test(l));
  if (!line) return null;
  let text = line
    .replace(/^(ziel|goal):\s*/i, "")
    .replace(/^#+\s*/, "")
    .replace(/[*_`]/g, "")
    .trim();
  // Strip filler from the front, but never down to nothing ("Bitte", "Hallo" stay).
  for (let i = 0; i < 4; i++) {
    const rest = text.replace(LEAD, "").trim();
    if (rest === text || !rest) break;
    text = rest;
  }
  text = text.replace(/[.!?:;,\s]+$/, "");
  if (!text) return line.slice(0, 80);
  text = text.charAt(0).toUpperCase() + text.slice(1);
  return text.length > 80 ? `${text.slice(0, 79).trimEnd()}…` : text;
}

/**
 * T8.1: what a person would call "the last thing that happened" — a
 * reply, a tool, a question, an error, the end of a turn. Internal system
 * noise (heartbeats, native ids, metrics) is not an activity.
 */
export function activityOf(event: Pick<NormalizedEvent, "type" | "summary" | "payload" | "ts">): { text: string; type: string; at: string } | null {
  const kind = (event.payload as { kind?: unknown }).kind;
  const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
  const clip = (s: string) => (s.length > 140 ? `${s.slice(0, 139).trimEnd()}…` : s);
  let text: string | null = null;
  switch (event.type) {
    case "assistant": {
      const t = (event.payload as { text?: unknown }).text;
      text = oneLine(typeof t === "string" && t.trim() ? t : event.summary);
      break;
    }
    case "user":
      text = `Du: ${oneLine(event.summary)}`;
      break;
    case "tool_use":
      text = `Werkzeug: ${oneLine(event.summary)}`;
      break;
    case "gate":
      text = kind === "tool.permission_requested" ? `Wartet auf Freigabe: ${oneLine(event.summary)}` : oneLine(event.summary);
      break;
    case "error":
      text = `Fehler: ${oneLine(event.summary)}`;
      break;
    case "system":
      if (kind === "provider.error" || kind === "cursor.usage_limit") text = `Fehler: ${oneLine((event.payload as { title?: string }).title ?? event.summary)}`;
      else if (kind === "session.interrupted") text = `Unterbrochen: ${String(event.payload.reason)}`;
      else if (kind === "session.turn_end") text = event.payload.reason === "interrupted" ? "Zug unterbrochen — braucht dich" : "Zug beendet — wartet auf dich";
      else if (kind === "session.stopped") text = "Beendet";
      break;
  }
  return text ? { text: clip(text), type: event.type, at: event.ts } : null;
}

export function readSkillName(args: Record<string, unknown> | undefined): string | undefined {
  const skill = args?.skill;
  return typeof skill === "string" && skill.length > 0 ? skill : undefined;
}

export function skillNameFromEvents(events: readonly NormalizedEvent[]): string | undefined {
  for (const event of events) {
    const payload = event.payload as { kind?: unknown; args?: unknown };
    if (payload.kind !== "session.created" || !payload.args || typeof payload.args !== "object") continue;
    return readSkillName(payload.args as Record<string, unknown>);
  }
  return undefined;
}

export function nativeIdFromEvents(events: readonly NormalizedEvent[]): string | undefined {
  let found: string | undefined;
  for (const event of events) {
    // BUG-0126: a repair dropped the binding — everything before it (the
    // stale announce) stays dead; only a later announce binds again.
    if ((event.payload as { kind?: unknown }).kind === "session.native_binding_dropped") found = undefined;
    const native = (event.payload as { nativeSessionId?: unknown }).nativeSessionId;
    if (typeof native === "string" && native.length > 0) found = native;
  }
  return found;
}

export async function nativeIdFromWorkerLog(dataDir: string, sessionId: string): Promise<string | undefined> {
  try {
    const text = await readFile(join(dataDir, "workers", `ancientvoid-${sessionId}.log`), "utf8");
    const ids = [...text.matchAll(/"session(?:ID|_id)"\s*:\s*"([^"]+)"/g)];
    return ids.at(-1)?.[1];
  } catch {
    return undefined;
  }
}

export const VALID_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  idle: ["working", "waiting_approval", "parked", "stopping", "stopped", "error"],
  starting: ["working", "idle", "waiting_approval", "error", "stopping", "stopped", "interrupted"],
  working: ["idle", "waiting_approval", "parked", "stopping", "stopped", "error", "interrupted"],
  // T7.2: a provider process may still end while a tool request waits.
  waiting_approval: ["working", "idle", "parked", "stopping", "stopped", "error", "interrupted"],
  parked: ["working", "stopping", "stopped", "error", "interrupted"],
  stopping: ["stopped", "error"],
  stopped: ["working"],
  // ADR-0044: the run was cut off — resume goes back to working, a failed
  // resume fails loud into error (never silently back to interrupted).
  // BUG-0149: a failed or cut-off run can still be parked when the work
  // moves to another session (handover). It is not running.
  interrupted: ["working", "stopping", "stopped", "error", "parked"],
  // ADR-0015: a failed turn (quota, rate limit, provider outage) is not a
  // dead session — the next prompt may start a new turn.
  // ADR-0076 Nachtrag (Limit-Wiederaufnahme): error → interrupted ist der
  // ausdrückliche menschliche Beschluss „nach dem Limit-Fenster automatisch
  // weitermachen" — kein automatischer Übergang, nur via setAutoResumeOnLimit.
  error: ["stopping", "stopped", "working", "parked", "interrupted"],
};

/** T1.9: 30s default per EPIC-P1 §2 ("Heartbeat pro Adapter (30 s)"). */
export const DEFAULT_HEARTBEAT_MS = 30_000;

/** ADR-0076 Nachtrag (Limit-Wiederaufnahme): Das gesperrte Limit-Fenster
 * aus dem Journal lesen — letzte strukturierte Kontingent-Meldung des
 * Providers (ADR-0004, usageQuota), früheste zukünftige Freigabe der
 * ausgelasteten Fenster (utilization >= 1). `known` sagt, ob der Provider
 * überhaupt Fenster gemeldet hat; ohne Fenster wird nicht geraten. */
export function limitWindow(events: readonly NormalizedEvent[], now = Date.now()): { known: boolean; blockedUntil?: string } {
  const quota = events.findLast((e) => e.usageQuota !== undefined)?.usageQuota;
  if (!quota) return { known: false };
  let blockedUntil: string | undefined;
  for (const window of quota.windows) {
    if (window.utilization < 1) continue;
    const at = Date.parse(window.resetsAt);
    if (!Number.isFinite(at) || at <= now) continue;
    if (blockedUntil === undefined || at < Date.parse(blockedUntil)) blockedUntil = window.resetsAt;
  }
  return blockedUntil === undefined ? { known: true } : { known: true, blockedUntil };
}

/** ADR-0076 Nachtrag: Starb der aktuelle Zug am Kontingent/Rate-Limit?
 * Wahr, wenn die letzte sichtbare Provider-Fehlermeldung diese Kategorie
 * trägt (cursor.usage_limit zählt als Kontingent) oder der Provider ein
 * gesperrtes Fenster gemeldet hat — auch bei „unknown“-Kategorie, weil
 * Claude „session limit“ schreibt (Nutzerfund 2026-11-15). */
export function limitFailureInEvents(events: readonly NormalizedEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    const kind = (event.payload as { kind?: unknown }).kind;
    if (kind === "session.prompt" || kind === "session.handover_out") return false;
    if (event.type === "assistant") return false;
    if (kind === "provider.error") {
      const category = (event.payload as { category?: unknown }).category;
      return category === "quota" || category === "rate_limit" || limitWindow(events).blockedUntil !== undefined;
    }
    if (kind === "cursor.usage_limit") return true;
  }
  return false;
}
