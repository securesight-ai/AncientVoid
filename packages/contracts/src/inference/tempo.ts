import { z } from "zod";

/**
 * EPIC-P79 (ADR-0102): Token- und Tempo-Verlauf lokaler Inferenz-Engines
 * (Strata, Halogen, llama.cpp). Abgrenzung zu P59/`aimetrics`: dort stehen
 * skalarisierte Felder im 10-s-Takt; hier geht es um **Request-bezogene
 * Verteilungen**, die eine eigene Request-Historie voraussetzen (K7).
 *
 * Regeln des Hauses: `null` heißt „nicht gemeldet“ und ist nie eine 0
 * (ADR-0023). K5: Antworten sind vertraglich gekappt — keine Prompts, kein
 * Roh-Metric-Dump. Secrets erscheinen nirgends (ADR-0011).
 */

export const InferenceEngineKind = z.enum(["strata", "halogen", "llamacpp"]);
export type InferenceEngineKind = z.infer<typeof InferenceEngineKind>;

/**
 * Was eine Quelle tatsächlich liefert. Die Seite blendet Karten aus, die die
 * Quelle nicht bedienen kann, und sagt warum — erfundene Verteilungen sind ein
 * Defekt, kein Füllstoff.
 */
export const InferenceFeatures = z.object({
  /** Einzel-Requests vorhanden → Perzentile und Protokoll sind möglich. */
  perRequest: z.boolean(),
  /** GPU-/RAM-Felder vorhanden (Strata: ja; llama.cpp/Halogen: nein). */
  hardware: z.boolean(),
  /** Engine-eigener Sekundentakt für Verläufe. */
  history: z.boolean(),
  totals: z.boolean(),
});
export type InferenceFeatures = z.infer<typeof InferenceFeatures>;

export const InferenceEngine = z.object({
  model: z.string().nullable(),
  version: z.string().nullable(),
  context: z.number().nullable(),
  kvTokens: z.number().nullable(),
  kvResident: z.boolean().nullable(),
  expertCacheMib: z.number().nullable(),
  // EPIC-P79 Nachzug: die statische Bauart der Engine, weil tokdeck sie gezeigt
  // hat und ohne sie nicht erkennbar ist, WARUM Temp so oder so ausfallen.
  maxContext: z.number().nullable(),
  kvQuant: z.string().nullable(),
  expertSlots: z.number().nullable(),
  expertsTotal: z.number().nullable(),
  arenaMib: z.number().nullable(),
  batchSlots: z.number().nullable(),
  drafting: z.string().nullable(),
  spec: z.number().nullable(),
  pcieFrac: z.number().nullable(),
  poolWorkers: z.number().nullable(),
  prefillCap: z.number().nullable(),
  conversationCacheMib: z.number().nullable(),
});
export type InferenceEngine = z.infer<typeof InferenceEngine>;

/** Momentzustand der Engine (laufender Request oder letzter Abschluss). */
export const InferenceLive = z.object({
  state: z.string().nullable(),
  phase: z.string().nullable(),
  queued: z.number().nullable(),
  decodeTokS: z.number().nullable(),
  prefillTokS: z.number().nullable(),
  /** Zeit bis zum ersten Token des laufenden/letzten Requests. */
  ttftS: z.number().nullable(),
  output: z.number().nullable(),
  prompt: z.number().nullable(),
  /** tatsächlich gelesene Prompt-Token (Prompt − wiederverwendete) */
  read: z.number().nullable(),
  reused: z.number().nullable(),
  elapsedS: z.number().nullable(),
  // EPIC-P79 Nachzug: Parallelität und Wartende entscheiden, ob Tempo an der
  // Engine oder an der Zulassung liegt.
  parallel: z.number().nullable(),
  waiting: z.number().nullable(),
  admitting: z.number().nullable(),
  heldTokens: z.number().nullable(),
});
export type InferenceLive = z.infer<typeof InferenceLive>;

/** Kumulierte Werte seit Engine-Start — über alle Sessions, nicht pro Sitzung. */
export const InferenceTotals = z.object({
  requests: z.number().nullable(),
  prompt: z.number().nullable(),
  reused: z.number().nullable(),
  read: z.number().nullable(),
  output: z.number().nullable(),
  reuseShare: z.number().nullable(),
  avgPrefillTokS: z.number().nullable(),
  avgDecodeTokS: z.number().nullable(),
  draftAcceptShare: z.number().nullable(),
  expertHitRate: z.number().nullable(),
  window: z
    .object({
      seconds: z.number(),
      prompt: z.number().nullable(),
      read: z.number().nullable(),
      output: z.number().nullable(),
      prefillTokS: z.number().nullable(),
      decodeTokS: z.number().nullable(),
    })
    .nullable(),
});
export type InferenceTotals = z.infer<typeof InferenceTotals>;

/** Prompt-/KV-Cache. `hitRate` ist Cache-Treffer, kein Experten-Cache. */
export const InferenceCache = z.object({
  hitRate: z.number().nullable(),
  tokenHitRate: z.number().nullable(),
  savedTokens: z.number().nullable(),
  entries: z.number().nullable(),
  bytes: z.number().nullable(),
  evictions: z.number().nullable(),
  budgetMib: z.number().nullable(),
  parked: z.number().nullable(),
  restores: z.number().nullable(),
  refusedTotal: z.number().nullable(),
  longestWaitS: z.number().nullable(),
  poolBelegung: z.number().nullable(),
});
export type InferenceCache = z.infer<typeof InferenceCache>;

export const InferenceHardware = z.object({
  gpuName: z.string().nullable(),
  gpuUtil: z.number().nullable(),
  gpuTempC: z.number().nullable(),
  vramUsedBytes: z.number().nullable(),
  vramTotalBytes: z.number().nullable(),
  powerW: z.number().nullable(),
  powerLimitW: z.number().nullable(),
  pcieGen: z.number().nullable(),
  pcieWidth: z.number().nullable(),
  ramUsedBytes: z.number().nullable(),
  ramTotalBytes: z.number().nullable(),
  // EPIC-P79 Nachzug: CPU und Platte gehören zur Frage „woran hängt es?“, und der
  // PCIe-Pfad ist erst mit Gegenprüfung (Ist gegen Maximum) ein Befund.
  cpuName: z.string().nullable(),
  cpuCores: z.number().nullable(),
  cpuUtil: z.number().nullable(),
  diskReadMbS: z.number().nullable(),
  diskWriteMbS: z.number().nullable(),
  pcieGenMax: z.number().nullable(),
  pcieWidthMax: z.number().nullable(),
  // „Maximum“ ist zweierlei: was der Slot hergibt und was die Karte könnte. Ist der
  // Slot niedriger als die Karte, steckt der Engpass im Mainboard, nicht in der GPU.
  pcieOwnGen: z.number().nullable(),
  pciePath: z.string().nullable(),
});
void 0;
export type InferenceHardware = z.infer<typeof InferenceHardware>;

/**
 * Eine Perzentil-Zeile. `peak` ist der absolute Höchstwert, `peakRobust` der
 * größte Wert innerhalb des Tukey-Bands (Q3 + 1,5·IQR); `ausreisser` zählt die
 * Werte außerhalb dieses Bands. So bleibt ein Ausreißer sichtbar, statt die
 * Spitze zu verdecken.
 */
export const InferencePerfRow = z.object({
  bereich: z.string(),
  n: z.number().int().min(0),
  p10: z.number().nullable(),
  p50: z.number().nullable(),
  p90: z.number().nullable(),
  mean: z.number().nullable(),
  peak: z.number().nullable(),
  peakRobust: z.number().nullable(),
  ausreisser: z.number().int().min(0),
});
export type InferencePerfRow = z.infer<typeof InferencePerfRow>;

/** Vorbehandlung nach Größe der *gelesenen* Token — kleine Mengen laufen nie in Grenzlaufrate. */
export const InferenceSizeRow = z.object({
  label: z.string(),
  n: z.number().int().min(0),
  p50: z.number().nullable(),
  p90: z.number().nullable(),
  peak: z.number().nullable(),
});
export type InferenceSizeRow = z.infer<typeof InferenceSizeRow>;

/**
 * Grenzlaufrate der Vorbehandlung: lineare Anpassung Zeit ≈ Vorlauf + gelesene
 * Token / Durchsatz. Nur mit genug großen Stichproben belastbar (`r2`, `n`).
 */
export const InferenceAsymptote = z.object({
  tokS: z.number().nullable(),
  overheadMs: z.number().nullable(),
  r2: z.number().nullable(),
  n: z.number().int().min(0),
});
export type InferenceAsymptote = z.infer<typeof InferenceAsymptote>;

export const InferencePerf = z.object({
  fensterH: z.number().positive(),
  /** Prefill-Raten brauchen gelesene Token oberhalb dieser Schwelle. */
  schwelleGelesen: z.number().int().min(0),
  stichprobenMinimum: z.number().int().min(0),
  decode: z.array(InferencePerfRow).max(4),
  prefill: z.array(InferencePerfRow).max(4),
  ttft: z.array(InferencePerfRow).max(4),
  groessenSchichten: z.array(InferenceSizeRow).max(8),
  asymptote: InferenceAsymptote.nullable(),
  engineHinweis: z.string().nullable(),
});
export type InferencePerf = z.infer<typeof InferencePerf>;

/** Abgeschlossener Request — gekürzt auf das, was die Seite zeigt (K5). */
export const InferenceRequestRow = z.object({
  id: z.string(),
  at: z.string(),
  prompt: z.number().nullable(),
  reused: z.number().nullable(),
  read: z.number().nullable(),
  output: z.number().nullable(),
  prefillTokS: z.number().nullable(),
  decodeTokS: z.number().nullable(),
  ttftS: z.number().nullable(),
  finish: z.string().nullable(),
});
export type InferenceRequestRow = z.infer<typeof InferenceRequestRow>;

/** Sekundentakt der Engine (kein Request-Mittel), für Verläufe. */
export const InferenceHistory = z.object({
  decodeTokS: z.array(z.number()).max(120),
  prefillTokS: z.array(z.number()).max(120),
  ramUsedBytes: z.array(z.number()).max(120),
});
export type InferenceHistory = z.infer<typeof InferenceHistory>;

export const InferenceStatus = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type InferenceStatus = z.infer<typeof InferenceStatus>;

/** Antwort von `GET /api/inference/snapshot?id=&fenster=` (K5: REST, gekappt). */
export const InferenceSnapshot = z.object({
  id: z.string(),
  kind: InferenceEngineKind,
  label: z.string(),
  /** ohne Secret — Schlüssel liegen nur als Dateireferenz vor (ADR-0011). */
  url: z.string().nullable(),
  status: InferenceStatus,
  sampledAt: z.string().nullable(),
  fensterH: z.number().positive(),
  engine: InferenceEngine,
  features: InferenceFeatures,
  live: InferenceLive.nullable(),
  totals: InferenceTotals.nullable(),
  cache: InferenceCache.nullable(),
  hardware: InferenceHardware.nullable(),
  history: InferenceHistory,
  perf: InferencePerf.nullable(),
  /**最近 12 abgeschlossene Requests — mehr nicht (K5). */
  requests: z.array(InferenceRequestRow).max(12),
  hinweise: z.array(z.string()).max(8),
});
export type InferenceSnapshot = z.infer<typeof InferenceSnapshot>;

/** Kurzbeschreibung einer Quelle für den Umschalter. */
export const InferenceSourceEntry = z.object({
  id: z.string(),
  kind: InferenceEngineKind,
  label: z.string(),
  url: z.string().nullable(),
  status: InferenceStatus,
  lastSampleAt: z.string().nullable(),
  features: InferenceFeatures,
  /** Decode-/Prefill-Token pro Sekunde für die Auswahlliste. */
  kurz: z.object({ decodeTokS: z.number().nullable(), prefillTokS: z.number().nullable() }),
});
export type InferenceSourceEntry = z.infer<typeof InferenceSourceEntry>;

/** Antwort von `GET /api/inference/sources`. */
export const InferenceSourceList = z.object({
  generatedAt: z.string(),
  /** Konfiguriertes Fenster; 0 = nichts konfiguriert (dann ist `quellen` leer). */
  fensterH: z.number().min(0),
  schwelleGelesen: z.number().int().min(0),
  quellen: z.array(InferenceSourceEntry).max(16),
});
export type InferenceSourceList = z.infer<typeof InferenceSourceList>;

/**
 * Die öffentliche Form des Hub-Trackers (EPIC-P79). Als Vertrag definiert, damit
 * Routen und Tests dieselbe Schnittstelle verwenden wie die Implementierung —
 * ein Abgleich, den der Compiler prüft.
 */
export type InferenceApi = {
  start(): void;
  stop(): void;
  /** ein Poll-Tick über alle Quellen — auch für Tests direkt aufrufbar */
  tickNow(): Promise<void>;
  sources(): InferenceSourceList;
  snapshot(id: string, fensterH?: number): InferenceSnapshot | null;
};
