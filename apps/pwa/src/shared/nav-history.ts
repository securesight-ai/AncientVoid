/**
 * Navigations-Historie für überlagernde Ansichten: Wer eine Ansicht öffnet,
 * die eine andere überlagert (Notizen-Seite über der Session-Kachel, Anhang
 * über allem), merkt sich hier den Zustand davor — Schließen stellt exakt
 * die zuletzt sichtbare Ansicht wieder her (gleicher Hash, gleiche Kachel,
 * gleicher Reiter). Ein Stack, kein volles Routing: Die Adresszeile bleibt
 * die einzige Quelle der Ansicht, hier steht nur das „davor“.
 *
 * `tileRef` trägt die Kachel-Referenz (features/workspace/tiles.ts), wenn der
 * gemerkte Zustand eine Kachel war — main.tsx setzt sie beim Wiederherstellen
 * nach dem Schließen einer Kachel wieder ein. Bewusst `unknown`: shared/
 * kennt die Feature-Typen nicht, einziger Schreiber ist main.tsx.
 *
 * Bewusst In-Memory (kein localStorage): Nach einem Reload startet die
 * Historie leer — die Adresszeile beschreibt die aktuelle Ansicht schon.
 */

const CAP = 32;

export interface NavEntry {
  readonly hash: string;
  readonly tileRef?: unknown;
}

const stack: NavEntry[] = [];

/** Vor dem Öffnen einer überlagernden Ansicht: merkt den aktuellen Zustand.
 * Doppelter gleicher Schritt hintereinander ist kein eigener Eintrag — aber
 * eine Kachel-Referenz wird am bestehenden Eintrag nachgetragen (der Hash-
 * Wechsel läuft vor dem Kachel-Öffnen durch die Historie). */
export function rememberView(hash: string, tileRef?: unknown): void {
  const entry: NavEntry = { hash: hash || "#/", ...(tileRef !== undefined ? { tileRef } : {}) };
  const top = stack[stack.length - 1];
  if (top !== undefined && top.hash === entry.hash) {
    if (entry.tileRef !== undefined && top.tileRef === undefined) stack[stack.length - 1] = entry;
    return;
  }
  if (stack.length >= CAP) stack.shift();
  stack.push(entry);
}

/** Zurück: nimmt den zuletzt gemerkten Eintrag (LIFO). null = Stack leer, der
 * Aufrufer fällt auf seine Übliche zurück (Übersicht bzw. Kachel-Klemme). */
export function popEntry(): NavEntry | null {
  return stack.pop() ?? null;
}

/** Wie popEntry, aber nur der Hash (Zurück-Knopf, Anhang schließen). */
export function popView(): string | null {
  return stack.pop()?.hash ?? null;
}

/** Nachsehen ohne zu verbrauchen. */
export function peekView(): string | null {
  return stack[stack.length - 1]?.hash ?? null;
}

/** Leerstellen (Token-Wechsel, Neu-Start) — halbe Historie ist gelogen. */
export function clearViewHistory(): void {
  stack.length = 0;
}
