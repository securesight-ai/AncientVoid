import { z } from "zod";

/**
 * EPIC-P41 / ADR-0064: Eine Automation besitzt Termin und Claim — die
 * Ausführung gehört dem Session-/Run-Manager. `dispatched` ist ein Startauftrag,
 * kein Erfolg: das Ergebnis kommt aus der referenzierten Ausführung.
 */

export const AUTOMATION_LIMITS = { definitions: 128, preview: 10, calendarDays: 8 * 366, prechecks: 4 } as const;

/** Presets aus dem Epic (Stunde/Tag/Woche/Werktag); Details im ADR. */
export const AUTOMATION_PRESETS = ["hourly", "daily", "weekly", "weekday"] as const;

/** Ortszeit HH:MM für die Presets (bei `hourly` ohne Bedeutung). */
const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Feld eines begrenzten 5-Feld-Crons: `*`, Zahlen, Bereiche, Schritte, Listen — sonst nichts. */
const CRON_PART = /^(?:\*(?:\/\d+)?|\d+(?:-\d+)?(?:\/\d+)?)(?:,(?:\*(?:\/\d+)?|\d+(?:-\d+)?(?:\/\d+)?))*$/;
const CRON_FIELDS: readonly { min: number; max: number }[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 6 },
];

/** Prüft ein Cron-Feld gegen Grenzen; erfüllt ohne Namen, `L`, `W`, `#` (begrenztes Subset, ADR-0064). */
export function cronFieldValid(field: string, min: number, max: number): boolean {
  if (!CRON_PART.test(field)) return false;
  for (const part of field.split(",")) {
    const step = part.split("/")[1];
    if (step !== undefined && (!Number.isSafeInteger(Number(step)) || Number(step) < 1)) return false;
    const bare = part.split("/")[0]!;
    if (bare === "*") continue;
    const numbers = bare.split("-").map(Number);
    for (const n of numbers) if (!Number.isInteger(n) || n < min || n > max) return false;
    if (numbers.length === 2 && numbers[0]! > numbers[1]!) return false;
  }
  return true;
}

/** Der begrenzte 5-Feld-Cron als Ganzer (minutenscharf, Feldgrenzen wie oben). */
export function cronSubsetValid(cron: string): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((f, i) => cronFieldValid(f, CRON_FIELDS[i]!.min, CRON_FIELDS[i]!.max));
}

/** IANA-Zeitzone; der Kalenderausdruck wird nie aus der Serverzone geraten. */
const IanaTimezone = z.string().min(2).max(64).refine((tz) => {
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "IANA-Zeitzone erforderlich");

export const AutomationSchedule = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("preset"),
    preset: z.enum(AUTOMATION_PRESETS),
    /** Ortszeit HH:MM; Pflicht außer bei `hourly`. */
    localTime: LocalTime.optional(),
    /** Wochentage 0–6 (So=0 wie Cron); nur bei `weekly` relevant. */
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    timezone: IanaTimezone,
  }),
  z.object({
    kind: z.literal("cron"),
    cron: z.string().max(256).refine(cronSubsetValid, "nur begrenztes 5-Feld-Cron (Zahlen, Bereiche, Schritte, Listen, *)"),
    timezone: IanaTimezone,
  }),
]).superRefine((schedule, ctx) => {
  if (schedule.kind === "preset" && schedule.preset !== "hourly" && !schedule.localTime) ctx.addIssue({ code: "custom", message: "Preset braucht eine Ortszeit", path: ["localTime"] });
  if (schedule.kind === "preset" && schedule.preset === "weekly" && !schedule.weekdays?.length) ctx.addIssue({ code: "custom", message: "Wöchentlich braucht mindestens einen Wochentag", path: ["weekdays"] });
});
export type AutomationSchedule = z.infer<typeof AutomationSchedule>;

/** Dysfunktionale Lokalzeit wird übersprungen, doppelte Lokalzeit feuert einmal (ADR-0064). */
export const AutomationClaimState = z.enum(["claimed", "dispatched", "settled", "skipped", "unknown"]);
export type AutomationClaimState = z.infer<typeof AutomationClaimState>;

/** Der Grund eines Skips bleibt getrennt — „skip" ist nicht gleich „skip" (Epic §3.3). */
export const AUTOMATION_SKIP_REASONS = [
  "dst_invalid",
  "missed",
  "overlap",
  "lease",
  "precheck",
  "precheck_exit",
  "precheck_timeout",
  "auth",
  "quota",
  "host_down",
  "disabled",
  "changed",
] as const;
export const AutomationSkipReason = z.enum(AUTOMATION_SKIP_REASONS);
export type AutomationSkipReason = z.infer<typeof AutomationSkipReason>;

/**
 * Ergebnis des referenzierten Laufs — nur gespiegelt, nie erfunden (Premortem 3).
 * `abandoned`: ein unklarer Start ohne Referenz, vom Menschen aufgegeben; das
 * tatsächliche Ergebnis bleibt unbekannt (ADR-0072).
 */
export const AutomationOutcome = z.enum(["succeeded", "failed", "timeout", "cancelled", "abandoned"]);
export type AutomationOutcome = z.infer<typeof AutomationOutcome>;

/**
 * Deterministischer Dedupe-Schlüssel (ADR-0064): Schedule-ID + Generation +
 * Occurrence in UTC-ISO. Ein Claim pro Schlüssel, atomar via Journal.
 */
export function automationClaimKey(scheduleId: string, generation: number, occurrenceUtc: string): string {
  return `${scheduleId}:${generation}:${occurrenceUtc}`;
}

/** Prompt als Blob-Verweis (K5: ≤ 4 KB im Payload, alles Große als Blob). */
const BlobRef = z.string().regex(/^[0-9a-f]{64}$/);

/** Der genehmigte Rahmen — bei Änderung invalidiert er die bisherige Freigabe (Generation++). */
export const AutomationGrant = z.object({
  maxParallel: z.number().int().min(1).max(4).default(1),
  /** Fenster, in dem ein verpasster Termin höchstens einmal nachgeholt wird; 0 = nie. */
  missedGraceMs: z.number().int().min(0).max(86_400_000).default(0),
});
export type AutomationGrant = z.infer<typeof AutomationGrant>;

/** Das Ziel: vorhandener Session-Start (P31/P35-Kataloge bleiben Wahrheit), vorhandene Swarm-Vorlage (P40, ehemals Run/Team) oder registrierte Miniskript-Aktion (ADR-0080). */
const AutomationTargetBase = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("session"),
    harness: z.string().min(1).max(60),
    model: z.string().min(1).max(120).optional(),
    /** Worktree ist Standard; direct-Checkout unterliegt dem P38-Lease (Skip-Grund `lease`). */
    workdir: z.enum(["worktree", "direct"]).default("worktree"),
    project: z.string().min(1).max(500),
    promptBlobSha256: BlobRef,
  }),
  z.object({
    kind: z.literal("swarm"),
    templateId: z.string().min(1).max(64),
    templateBlobSha256: BlobRef.optional(),
  }),
  z.object({
    // ADR-0080: ein Miniskript ist eine registrierte argv-Aktion des Codes-Moduls — kein Prompt-Blob, kein Harness.
    kind: z.literal("script"),
    project: z.string().min(1).max(500),
    actionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
  }),
]);
/** ADR-0077/ADR-0123: persistierte Ziele mit `kind: "run"` (bis P60) oder `"team"` (bis P83) werden toleriert gelesen und auf `"swarm"` normalisiert. */
export const AutomationTarget = z.preprocess(
  (v) => {
    if (typeof v !== "object" || v === null || !("kind" in v)) return v;
    if (v.kind !== "run" && v.kind !== "team") return v;
    return { ...v, kind: "swarm" };
  },
  AutomationTargetBase,
);
export type AutomationTarget = z.infer<typeof AutomationTarget>;

/** Die gespeicherte Definition (Journal-Record). `enabled=false` ist der Neuanfang-Zustand. */
export const AutomationDefinition = z.object({
  id: z.string().min(1).max(128),
  label: z.string().min(1).max(80),
  generation: z.number().int().positive(),
  enabled: z.boolean().default(false),
  /** Feste Eigentümer-Host; Failover ist nicht im MVP (Epic §3.2). */
  hostId: z.string().min(1).max(64),
  schedule: AutomationSchedule,
  target: AutomationTarget,
  /** Nur registrierte argv-Aktionen (Codes-Modul); frei erfundene Aktion-IDs lehnt der Hub ab. */
  precheckActionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/).optional(),
  precheckDeadlineMs: z.number().int().positive().max(600_000).default(60_000),
  grant: AutomationGrant.default({ maxParallel: 1, missedGraceMs: 0 }),
  createdAtUtc: z.iso.datetime(),
});
export type AutomationDefinition = z.infer<typeof AutomationDefinition>;

/** ADR-0065: gemeinsamer Verlaufsvertrag; optionale Felder erhalten alte Journale.
 * ADR-0077/ADR-0123: `swarmId` (ehemals `runId`, dann `teamId`) — alte Journalzeilen werden tolerierend übernommen. */
const AutomationHistoryEntryBase = z.object({
  claimKey: z.string(), automationId: z.string(), generation: z.number().int().positive(),
  occurrenceUtc: z.iso.datetime(), at: z.iso.datetime(), state: AutomationClaimState,
  reason: AutomationSkipReason.optional(), outcome: AutomationOutcome.optional(),
  swarmId: z.string().optional(), sessionId: z.string().optional(),
  kind: z.enum(["due", "catchup", "run_now"]).optional(),
  operationId: z.string().optional(), missedThroughUtc: z.iso.datetime().optional(),
  detail: z.string().max(500).optional(),
});
export const AutomationHistoryEntry = z.preprocess(
  (v) => {
    if (typeof v !== "object" || v === null) return v;
    if (!("swarmId" in v) && "teamId" in v) return { ...v, swarmId: v.teamId };
    if (!("swarmId" in v) && !("teamId" in v) && "runId" in v && typeof v.runId === "string") return { ...v, swarmId: v.runId };
    return v;
  },
  AutomationHistoryEntryBase,
);
export type AutomationHistoryEntry = z.infer<typeof AutomationHistoryEntry>;

/** Die Zeile der PWA-Tabelle (EPIC-P41 §3.4): Plan, nächste Termine, letztes Ergebnis. */
export const AutomationInfo = z.object({
  definition: AutomationDefinition,
  /** Nächste Termine als UTC + Ortszeit (Vorschau zeigt beide, AC-P41-2). */
  nextOccurrences: z.array(z.object({ utc: z.string(), local: z.string() })).max(10),
  lastOccurrence: z.object({
    utc: z.string(),
    state: AutomationClaimState,
    reason: AutomationSkipReason.nullish(),
    outcome: AutomationOutcome.nullish(),
    swarmId: z.string().nullish(),
    sessionId: z.string().nullish(),
  }).nullish(),
});
export type AutomationInfo = z.infer<typeof AutomationInfo>;


/** ADR-0065: die Aktivierung/Operation gilt genau für die geprüfte Generation. */
export const AutomationEnableBody = z.object({ enabled: z.boolean(), generation: z.number().int().positive().optional() })
  .refine(value => !value.enabled || value.generation !== undefined, "Aktivierung braucht die geprüfte Generation");
export const AutomationExecuteBody = z.object({ generation: z.number().int().positive() });
/** ADR-0072: einen unklaren Start ohne Referenz aufgeben — die Notiz ist Pflicht, sie ist der Beleg. */
export const AutomationResolveBody = z.object({ claimKey: z.string().min(1).max(300), note: z.string().trim().min(1).max(300) });
