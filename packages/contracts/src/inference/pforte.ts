import { z } from "zod";

/**
 * BUG-0272 (ADR-0116): die **Pforte** — Zugriff auf Modell-Endpoints, die nur
 * einen Platz haben (Strata auf diesem Rechner: ein Slot, 262 144 Token Gesamt-
 * kontext). Ohne Pforte drängeln Sitzungen und hub-interne Anfragen ungeordnet
 * darauf; der Schaden ist nicht der Slot, sondern das gemeinsame Kontextbudget:
 * zwei lange Sitzungen passen nicht gleichzeitig in den KV-Speicher, die zweite
 * bekommt einen Kontextüberlauf, und der Verdrängte muss seinen ganzen Verlauf
 * neu vorbehandeln (gemessen: ~112 k Token pro Sitzung, 85 % KV-Treffer — der
 * Treffer bricht beim Wechsel komplett weg).
 *
 * Die Pforte ist geteilter Zustand über Adapter hinweg → Contracts-Regel 1:
 * Konfiguration und Zustand liegen hier, die Entscheidung in `@ancientvoid/core`.
 */

/** Priorität eines Gesuchs. Hintergrundanfragen (Titel, Übersetzen, Gatekeeper)
 * warten, solange ein interaktiver Zug den Platz hält — sie stören ihn nie. */
export const INFERENCE_PRIORITÄTEN = ["interaktiv", "hintergrund"] as const;
export type InferencePriorität = (typeof INFERENCE_PRIORITÄTEN)[number];

export const InferenceGateEngine = z.object({
  /** Passt auf den Provider-Teil der Modellangabe (`strata/…`) oder auf die Basis-URL. */
  provider: z.string().trim().min(1).max(80).optional(),
  url: z.string().url().optional(),
  label: z.string().min(1).max(80).optional(),
  /** Plätze auf diesem Endpoint. Default 1 — mehr Slots verdrängen nur den KV. */
  slots: z.number().int().min(1).max(8).default(1),
  /** Gesamtkontext des Modells; Aufnahme nur, wenn die Summe hindurchpasst. */
  maxContext: z.number().int().min(1).max(10_000_000).optional(),
  /** Vorlauf, den ein Inhaber den Platz reserviert behält (KV-Wiederverwendung). */
  leaseMs: z.number().int().min(0).max(120_000).default(20_000),
  /** Nach dieser Wartezeit gibt es eine Entscheidung statt eines Wartens. */
  maxWaitMs: z.number().int().min(1_000).max(600_000).default(120_000),
}).refine((e) => e.provider !== undefined || e.url !== undefined, {
  message: "gate engines brauchen provider oder url",
});
export type InferenceGateEngine = z.infer<typeof InferenceGateEngine>;

export const InferenceGateConfig = z.object({
  engines: z.array(InferenceGateEngine).max(16).default([]),
}).default({ engines: [] });
export type InferenceGateConfig = z.infer<typeof InferenceGateConfig>;

/** Ablehnungsgründe — sichtbar am Ereignis, nie als Provider-Panne. */
export const INFERENCE_GRÜNDE = ["context_budget", "gate_timeout", "kein_platz"] as const;
export type InferenceGrund = (typeof INFERENCE_GRÜNDE)[number];

export interface InferenceGatePlatz {
  readonly inhaber: string;
  readonly priorität: InferencePriorität;
  readonly warum: string;
  /** Seit wann (ISO) der Platz belegt ist. */
  readonly seit: string;
  /** Gehaltene Prompt-Token dieses Inhabers, sofern bekannt. */
  readonly gehalteneToken: number | null;
}

export interface InferenceGateWartend {
  readonly inhaber: string;
  readonly priorität: InferencePriorität;
  readonly warum: string;
  /** Wartende Millisekunden seit der Anmeldung. */
  readonly wartetMs: number;
}

export interface InferenceGateZustand {
  readonly endpoint: string;
  readonly slots: number;
  readonly maxContext: number | null;
  readonly gehaltenToken: number;
  readonly plaetze: readonly InferenceGatePlatz[];
  readonly wartende: readonly InferenceGateWartend[];
  /** Reservierung für den letzten Inhaber (KV-Lease), null wenn abgelaufen. */
  readonly leaseInhaber: string | null;
  readonly leaseBisMs: number;
}

/** Was `GET /api/inference/gate` liefert — die Pfortenlage auf einen Blick. */
export interface InferenceGateSnapshot {
  readonly erzeugt: string;
  readonly endpunkte: readonly InferenceGateZustand[];
}

/** Ereignisarten der Pforte (Session-Akte, K7-rekonstruierbar). */
export const INFERENCE_PFORTE_EVENTS = [
  "inference.slot_wait",
  "inference.slot_granted",
  "inference.slot_denied",
  "inference.lease_broken",
] as const;
export type InferencePforteEvent = (typeof INFERENCE_PFORTE_EVENTS)[number];
