import type { NormalizedEvent } from "../../shared/ws.ts";

/**
 * Status, den ein WS-Ereignis sofort setzt — ohne auf den 3s-HTTP-Poll zu warten.
 * Hub setzt idle/error vor dem Emit von `session.turn_end` (settle); der Tail
 * sah den Strom live, den Status aber bis zu 3 s lang als „working“. Dann blieb
 * der Chat auf dem laufenden Zug-Mark und Übersicht/Nyx sagten „aktiv“ statt „bereit“.
 */
export function statusHintFromEvent(e: NormalizedEvent): string | null {
  if (e.type !== "system") return null;
  const kind = e.payload.kind;
  if (kind === "session.turn_end") {
    const reason = e.payload.reason;
    if (reason === "error") return "error";
    if (reason === "interrupted") return "interrupted";
    return "idle";
  }
  if (kind === "session.interrupted") return "interrupted";
  if (kind === "session.prompt" || kind === "session.resumed") return "working";
  if (kind === "session.start_failed") return "error";
  return null;
}

/** Letzter Status-Hinweis in einer Batch — spätere Ereignisse gewinnen. */
export function statusHintFromBatch(events: readonly NormalizedEvent[]): string | null {
  let hint: string | null = null;
  for (const e of events) {
    const next = statusHintFromEvent(e);
    if (next !== null) hint = next;
  }
  return hint;
}
