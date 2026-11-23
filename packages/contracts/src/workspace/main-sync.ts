import { z } from "zod";

/**
 * EPIC-P67 / ADR-0088: Main-Sync — Einstellungen, Events und API des
 * Abgleichs zwischen Session-Worktrees und dem Hauptbranch.
 *
 * Drei Stufen: (1) neue Sessions starten auf `origin/<Hauptbranch>`,
 * (2) laufende Synchronisation nach Einstellung, (3) sichtbar und einstellbar
 * in PWA und hubctl. Der Contract ist rein additiv zur bestehenden
 * Workspace-Runtime (`runtime.ts`): keine Änderung an Manifest, Phase oder
 * Service-Status — Main-Sync ist ein Nebeneffekt des Worktrees, keine neue
 * Workspace-Phase.
 *
 * K7: Effektive Einstellungen sind aus der `config`-Tabelle + Defaults
 * faltbar (kein separater Speicher, kein Timer-Zustand). K5: Event-Payloads
 * bleiben ≤ 4 KB — Dateilisten sind gekappt (`MAX_MAIN_SYNC_FILES`).
 */

// ---------- Einstellungen ----------

/** Stufe 1: `off` = Basis ist der lokale HEAD (heutiges Verhalten), `fetch-base` = fetch + Basis `origin/<Hauptbranch>`. */
export const MAIN_SYNC_START_MODES = ["off", "fetch-base"] as const;
export type MainSyncStartMode = (typeof MAIN_SYNC_START_MODES)[number];

/** Stufe 2: Was passiert, wenn eine Session hinter dem Hauptbranch liegt. */
export const MAIN_SYNC_BEHIND_ACTIONS = ["notify", "ask", "auto"] as const;
export type MainSyncBehindAction = (typeof MAIN_SYNC_BEHIND_ACTIONS)[number];

/** Auto-Merge: `off` (nie), `clean-only` (nur konfliktfreier Probelauf), `ask` (mit Rückfrage). */
export const MAIN_SYNC_AUTO_MERGE_MODES = ["off", "clean-only", "ask"] as const;
export type MainSyncAutoMergeMode = (typeof MAIN_SYNC_AUTO_MERGE_MODES)[number];

/**
 * Alle Werte wie EPIC-P67 §3.5. `checkIntervalMin`: `0` = aus, sonst 5–1440
 * (Zwischenwerte wären Taktungen unter dem Mindestintervall des Premortems 4
 * — der K8-Lasttest deckt 20 Sessions auf einen Fetch je Projekt ab, nicht
 * Sekundentakt). `defaultBranch` leer = `origin/HEAD` auflösen.
 * `onlyWhenIdle` ist im ersten Wurf nicht abschaltbar (`z.literal(true)`) —
 * ein Merge unter den Füßen eines laufenden Agenten ist ausgeschlossen
 * (Premortem 2); wird er später wählbar, ist das ein eigener ADR-Nachtrag.
 */
export const MainSyncSettings = z
  .object({
    startSync: z.enum(MAIN_SYNC_START_MODES),
    fetchTimeoutSec: z.number().int().min(2).max(60),
    defaultBranch: z.string().max(200),
    checkIntervalMin: z.number().int().min(0).max(1440).refine((v) => v === 0 || v >= 5, {
      message: "checkIntervalMin: 0 (aus) oder 5–1440",
    }),
    behindAction: z.enum(MAIN_SYNC_BEHIND_ACTIONS),
    autoMerge: z.enum(MAIN_SYNC_AUTO_MERGE_MODES),
    onlyWhenIdle: z.literal(true),
  })
  .strict();
export type MainSyncSettings = z.infer<typeof MainSyncSettings>;

export const MAIN_SYNC_SETTINGS_KEYS = [
  "startSync",
  "fetchTimeoutSec",
  "defaultBranch",
  "checkIntervalMin",
  "behindAction",
  "autoMerge",
  "onlyWhenIdle",
] as const satisfies readonly (keyof MainSyncSettings)[];

/** Die konservativen Defaults aus EPIC-P67 §3.5 — Stufe 1 an, alles Autonome aus. */
export const MAIN_SYNC_DEFAULTS: MainSyncSettings = {
  startSync: "fetch-base",
  fetchTimeoutSec: 10,
  defaultBranch: "",
  checkIntervalMin: 60,
  behindAction: "notify",
  autoMerge: "off",
  onlyWhenIdle: true,
};

/** Projekt-Override: nur die Felder, die das Projekt anders stellt — alle optional, Werte streng geprüft. */
export const MainSyncProjectOverride = MainSyncSettings.partial();
export type MainSyncProjectOverride = z.infer<typeof MainSyncProjectOverride>;

/** Effektive Einstellungen: Defaults ← global ← Projekt-Patch (der spezifischere Patch gewinnt). */
export function resolveMainSyncSettings(
  global: MainSyncSettings | null,
  projectOverride: MainSyncProjectOverride | null,
): MainSyncSettings {
  const merged = { ...(global ?? MAIN_SYNC_DEFAULTS), ...(projectOverride ?? {}) };
  return MainSyncSettings.parse(merged);
}

/** Warum ein Lesen auf Defaults gefallen ist — der Hub macht das als Event sichtbar, nie still (Regel 6). */
export const MAIN_SYNC_READ_FALLBACKS = ["none", "missing", "invalid"] as const;
export type MainSyncReadFallback = (typeof MAIN_SYNC_READ_FALLBACKS)[number];

export interface MainSyncSettingsRead {
  value: MainSyncSettings;
  fallback: MainSyncReadFallback;
}

export interface MainSyncOverrideRead {
  value: MainSyncProjectOverride;
  fallback: MainSyncReadFallback;
}

function pickKnownKeys(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  if (raw === null || typeof raw !== "object") return picked;
  const record = raw as Record<string, unknown>;
  for (const key of keys) if (key in record) picked[key] = record[key];
  return picked;
}

/**
 * Additives Lesen gespeicherter Einstellungen (AC-P67-8): ein Eintrag aus
 * einer künftigen Version mit zusätzlichen Feldern liest sich weiter —
 * unbekannte Felder werden übergangen, bekannte fehlende durch Defaults
 * ergänzt. Ein inhaltlich ungültiger Eintrag fällt auf Defaults zurück und
 * wird als `invalid` markiert (fail loud beim Aufrufer, nicht beim Parser).
 */
export function readMainSyncSettings(raw: unknown): MainSyncSettingsRead {
  if (raw === null || raw === undefined) return { value: { ...MAIN_SYNC_DEFAULTS }, fallback: "missing" };
  const merged = { ...MAIN_SYNC_DEFAULTS, ...pickKnownKeys(raw, MAIN_SYNC_SETTINGS_KEYS) };
  const parsed = MainSyncSettings.safeParse(merged);
  return parsed.success
    ? { value: parsed.data, fallback: "none" }
    : { value: { ...MAIN_SYNC_DEFAULTS }, fallback: "invalid" };
}

/** Dasselbe additive Lesen für Projekt-Overrides: unbekannte Felder und ungültige Einträge entfallen. */
export function readMainSyncOverride(raw: unknown): MainSyncOverrideRead {
  if (raw === null || raw === undefined) return { value: {}, fallback: "missing" };
  const picked = pickKnownKeys(raw, MAIN_SYNC_SETTINGS_KEYS);
  const parsed = MainSyncProjectOverride.safeParse(picked);
  return parsed.success
    ? { value: parsed.data, fallback: "none" }
    : { value: {}, fallback: "invalid" };
}

// ---------- Events ----------

/** K5: Dateilisten in Events gekappt — der volle Konfliktfall steht im Probelauf-Ergebnis der API. */
export const MAX_MAIN_SYNC_FILES = 20;

export const MainSyncFilesList = z.array(z.string().min(1).max(400)).max(MAX_MAIN_SYNC_FILES);

/** Ticker-Zustand einer Messung: wie weit liegt die Session zurück, wie weit ist sie voraus, ist der Worktree sauber. */
export const MainSyncChecked = z
  .object({
    behind: z.number().int().min(0),
    ahead: z.number().int().min(0),
    clean: z.boolean(),
    checkedAt: z.string().min(1),
  })
  .strict();
export type MainSyncChecked = z.infer<typeof MainSyncChecked>;

/**
 * Bekannte Skip-Gründe (kein Enum, damit neue Gründe alten Lesern nicht den
 * Parser brechen — die Werte sind dokumentierte Konvention): `disabled`
 * (Einstellung `startSync: off`), `not-main-branch` (Projektordner steht auf
 * einem Feature-Branch — die Basis bleibt der lokale Stand, EPIC-P67 §3.2),
 * `no-remote` (Projekt hat kein `origin`).
 */
export const MainSyncSkipped = z
  .object({
    reason: z.string().min(1).max(200),
    detail: z.string().max(500).optional(),
  })
  .strict();
export type MainSyncSkipped = z.infer<typeof MainSyncSkipped>;

/**
 * Bekannte Fehlergründe: `offline`, `auth`, `timeout`, `no-remote`,
 * `hook-rejected`, `unknown`. Ein Merge-Konflikt ist nie `failed`, sondern
 * `main_sync_conflict` (der Worktree bleibt unverändert).
 */
export const MainSyncFailed = z
  .object({
    reason: z.string().min(1).max(200),
    detail: z.string().max(500).optional(),
  })
  .strict();
export type MainSyncFailed = z.infer<typeof MainSyncFailed>;

export const MainSyncApplied = z
  .object({
    from: z.string().min(1).max(64),
    to: z.string().min(1).max(64),
    files: MainSyncFilesList,
    /** ADR-0102: Dateien, deren Konflikte automatisch gunsten des
     * Session-Branchs gelöst wurden (`favor-session`). Fehlt = nichts
     * automatisch gelöst (alter Leser versteht das Feld nicht falsch). */
    autoResolved: MainSyncFilesList.optional(),
  })
  .strict();
export type MainSyncApplied = z.infer<typeof MainSyncApplied>;

export const MainSyncConflict = z
  .object({
    files: MainSyncFilesList,
  })
  .strict();
export type MainSyncConflict = z.infer<typeof MainSyncConflict>;

/** Die `workspace.main_sync_*`-Systemevents (Kind im Payload, `session.*`-Vorbild). */
export const MAIN_SYNC_EVENT_KINDS = [
  "workspace.main_sync_checked",
  "workspace.main_sync_applied",
  "workspace.main_sync_conflict",
  "workspace.main_sync_skipped",
  "workspace.main_sync_failed",
] as const;
export type MainSyncEventKind = (typeof MAIN_SYNC_EVENT_KINDS)[number];

/** Payload-Schema je Event-Kind — `MAIN_SYNC_EVENT_PAYLOAD[kind]` ist die Zusage an Leser. */
export const MAIN_SYNC_EVENT_PAYLOAD = {
  "workspace.main_sync_checked": MainSyncChecked,
  "workspace.main_sync_applied": MainSyncApplied,
  "workspace.main_sync_conflict": MainSyncConflict,
  "workspace.main_sync_skipped": MainSyncSkipped,
  "workspace.main_sync_failed": MainSyncFailed,
} as const;

// ---------- API ----------

export const mainSyncSettingsPath = "/api/settings/main-sync";

export const sessionMainSyncPath = (sessionId: string): string => `/api/sessions/${sessionId}/main-sync`;

/** GET-Antwort: Messung plus Probelauf (`merge-tree`, lesend) — Konfliktliste gekappt (K5). */
export const MainSyncCheckResult = z
  .object({
    sessionId: z.string().min(1),
    branch: z.string().min(1).max(200),
    behind: z.number().int().min(0),
    ahead: z.number().int().min(0),
    clean: z.boolean(),
    conflicts: MainSyncFilesList.nullable(),
    checkedAt: z.string().min(1),
    /** Zeitstempel des letzten erfolgreichen Abgleichs (aus Events gefaltet, K7) — null = noch nie. */
    lastSyncedAt: z.string().min(1).nullable(),
  })
  .strict();
export type MainSyncCheckResult = z.infer<typeof MainSyncCheckResult>;

/** POST-Body des Anwendens: `conflictStrategy` `abort` (Default, AC-P67-7 —
 * bei Konflikt abbrechen, nichts verändern) oder `favor-session` (Konflikt-
 * Hunks automatisch gunsten des Session-Branchs lösen, ADR-0102). */
export const MAIN_SYNC_CONFLICT_STRATEGIES = ["abort", "favor-session"] as const;
export type MainSyncConflictStrategy = (typeof MAIN_SYNC_CONFLICT_STRATEGIES)[number];

export const MainSyncApplyRequest = z
  .object({
    conflictStrategy: z.enum(MAIN_SYNC_CONFLICT_STRATEGIES).optional(),
  })
  .strict();
export type MainSyncApplyRequest = z.infer<typeof MainSyncApplyRequest>;

/** POST-Ergebnis: angewendet, Konflikt (nichts verändert), übersprungen (mit Grund) oder gescheitert (Git-Fehler, Worktree unverändert). */
export const MainSyncApplyResult = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("applied"), from: z.string().min(1).max(64), to: z.string().min(1).max(64), files: MainSyncFilesList, autoResolved: MainSyncFilesList.optional() }).strict(),
  z.object({ outcome: z.literal("conflict"), files: MainSyncFilesList }).strict(),
  z.object({ outcome: z.literal("skipped"), reason: z.string().min(1).max(200), detail: z.string().max(500).optional() }).strict(),
  z.object({ outcome: z.literal("failed"), reason: z.string().min(1).max(200), detail: z.string().max(500).optional() }).strict(),
]);
export type MainSyncApplyResult = z.infer<typeof MainSyncApplyResult>;
