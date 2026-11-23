import type { SessionTextHit } from "@ancientvoid/contracts";

/**
 * Der Sitzungsfilter der Übersicht suchte bisher Titel, Projekt und die letzte
 * Aktivität. Wer eine Sitzung wegen ihres **Inhalts** sucht („die Sitzung, in der
 * wir tokdeck gebaut haben“), findet sie so nicht — dieser Baustein hält die
 * Fundstellen aus dem Sessiontext-Index pro Sitzung bereit, damit die Kachel sie
 * zeigen und direkt dorthin springen kann.
 */

export interface ContentHit {
  /** Fundstellen insgesamt in dieser Sitzung (über die ausgelieferten hinaus). */
  count: number;
  /** Früheste ausgelieferte Fundstelle — das Sprungziel beim Öffnen. */
  seq: number;
  /** Rollen der Fundstellen, für die Zeile unter der Kachel. */
  roles: string[];
}

/** Sitzungs-Id als Schlüssel: die Fundstellen kommen von **diesem** Hub, die
 * Übersicht führt ihre Sessions aber mit `hostId` (der eigene Rechner heißt dort
 * nicht leer) — eine Id bringt beide zusammen. Fremde Hub-Funde (Cross-Hub)
 * bleiben der Suche vorbehalten und werden hier nicht mitgemischt. */
export function hitKey(sessionId: string): string {
  return sessionId;
}

/** Fundstellen nach Sitzung bündeln. Die **früheste** Fundstelle ist das
 * Sprungziel: von oben zu lesen ist seltener ein Raten als von der letzten. */
export function hitsBySession(hits: readonly SessionTextHit[]): Map<string, ContentHit> {
  const out = new Map<string, ContentHit>();
  for (const h of hits) {
    const key = hitKey(h.sessionId);
    const prev = out.get(key);
    if (!prev) {
      out.set(key, { count: h.sessionHits, seq: h.seq, roles: [h.role] });
      continue;
    }
    prev.count = Math.max(prev.count, h.sessionHits);
    if (h.seq < prev.seq) prev.seq = h.seq;
    if (!prev.roles.includes(h.role)) prev.roles.push(h.role);
  }
  return out;
}

/** Sitzungsliste für den Filter: Titel-Treffer **und** Inhalts-Treffer. Eine
 * Sitzung, die nur inhaltlich passt, fehlt sonst — genau der Fall, für den das
 * Feld benützt wird. Titellos bleibende Inhalts-Treffer stehen vorn. */
export function filterWithHits<T extends { id: string; hostId?: string | null }>(
  sessions: readonly T[],
  titleMatches: (s: T) => boolean,
  hits: ReadonlyMap<string, ContentHit>,
): T[] {
  if (hits.size === 0) return sessions.filter(titleMatches);
  const withHit: T[] = [];
  const rest: T[] = [];
  for (const s of sessions) {
    if (hits.has(hitKey(s.id))) withHit.push(s);
    else if (titleMatches(s)) rest.push(s);
  }
  return [...withHit, ...rest];
}

/** Top-Fundstelle für „Enter“: die Sitzung mit den meisten Fundstellen. */
export function topHit<T extends { id: string; hostId?: string | null }>(
  sessions: readonly T[],
  hits: ReadonlyMap<string, ContentHit>,
): { session: T; hit: ContentHit } | null {
  let best: { session: T; hit: ContentHit } | null = null;
  for (const s of sessions) {
    const hit = hits.get(hitKey(s.id));
    if (!hit) continue;
    if (!best || hit.count > best.hit.count) best = { session: s, hit };
  }
  return best;
}
