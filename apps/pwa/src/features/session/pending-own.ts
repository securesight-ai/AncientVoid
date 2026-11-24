import type { QueuedPrompt } from "../../shared/api.ts";
import { queueOrder } from "./QueueList.tsx";

/**
 * BUG-0280: Eine vorgemerkte eigene Eingabe soll im Chat als eigene Zeile mit
 * Status sichtbar sein — der Streifen unten bleibt die Verwaltung, ist aber
 * nicht der einzige Nachweis. Volle Texte; die Reihe führt der Hub (ADR-0085).
 */
export type PendingOwnRow = { id: string; text: string; status: "waiting" | "unknown" };

export function pendingOwnRows(items: QueuedPrompt[]): PendingOwnRow[] {
  return queueOrder(items).map((q) => ({ id: q.id, text: q.text, status: q.delivery === "unknown" ? "unknown" : "waiting" }));
}
