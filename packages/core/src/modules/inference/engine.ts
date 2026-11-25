import type {
  InferenceCache,
  InferenceEngine,
  InferenceFeatures,
  InferenceHardware,
  InferenceHistory,
  InferenceLive,
  InferenceTotals,
} from "@ancientvoid/contracts";

/**
 * EPIC-P79 T79.2: gemeinsame Normalform der Engine-Adapter. Ein Adapter sagt
 * **was er liefern kann** (`features`) und legt fehlendes als `null` ab — die
 * Seite blendet dann aus, statt Nullen oder Erfundene Werte zu zeigen.
 */

/** Abgeschlossene Anfrage, wie sie in der eigenen Historie liegt (K7: JSONL). */
export type RequestRecord = {
  id: string;
  /** Quelle, die diese Anfrage gemeldet hat — Verteilungen nie über Engines mischen. */
  source: string;
  /** ISO-8601 (UTC) — die Engine meldet nur Sekunden vor „jetzt“, datiert wird beim Poll. */
  at: string;
  prompt: number | null;
  reused: number | null;
  read: number | null;
  output: number | null;
  prefillTokS: number | null;
  decodeTokS: number | null;
  ttftS: number | null;
  /** Rohzeiten für die Statistik (Sekunden). */
  prefillS: number | null;
  decodeS: number | null;
  finish: string | null;
};

export type EngineReading = {
  engine: InferenceEngine;
  features: InferenceFeatures;
  live: InferenceLive | null;
  totals: InferenceTotals | null;
  cache: InferenceCache | null;
  hardware: InferenceHardware | null;
  history: InferenceHistory;
  requests: RequestRecord[];
  /** Begrenzte, menschenlesbare Einschränkungen dieser Quelle (K9). */
  hints: string[];
};

export const NO_HISTORY: InferenceHistory = { decodeTokS: [], prefillTokS: [], ramUsedBytes: [] };

/** Zahl oder null — „nicht gemeldet“ ist nie 0 (ADR-0023). */
export function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  // Manche Engines zahlen Zahlen als Text aus (Strata meldet pcie_frac als "0.15").
  // Genommen wird nur, was verlustfrei eine Zahl ist — sonst bleibt es null, nicht 0.
  if (typeof value === "string") {
    const rand = value.trim();
    if (rand === "") return null;
    const wert = Number(rand);
    return Number.isFinite(wert) ? wert : null;
  }
  return null;
}

/**
 * Anteile auf 0..1 bringen. Die Engines sind uneinheitlich: Strata meldete
 * `gpu_util` schon als 0,87 und als 100, `cpu` als 56 und als 860 (Summe über alle
 * Kerne). Geraten wird nicht — unplausibles bleibt null, statt einen Fantasiewert
 * in Prozent zu kleben.
 */
export function anteilNormalisieren(value: unknown, kerne?: number | null): number | null {
  const wert = num(value);
  if (wert == null || wert < 0) return null;
  if (wert <= 1) return wert;
  if (wert <= 100) return wert / 100;
  // > 100: nur plausibel als Summe über alle Kerne — dann pro Kern mitteln.
  if (kerne != null && kerne > 0 && wert <= 100 * kerne) return wert / (100 * kerne);
  return null;
}

export function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** Anteil 0…1 aus Zähler/Nenner; null wenn nichts gemessen wurde. */
export function anteil(zähler: number | null, nenner: number | null): number | null {
  if (zähler == null || nenner == null || nenner <= 0) return null;
  return zähler / nenner;
}
