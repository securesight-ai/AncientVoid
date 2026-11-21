/**
 * EPIC-P51 T51.5 (ADR: Nutzerauftrag 11.11.2026): zentrale Shortcut-Registry.
 * Eine deklarative Liste (Katalog) ist Datenquelle für Cheat-Sheet (T51.7),
 * Tooltips, aria-keyshortcuts und den Konflikt-Unit-Test; ein einziger
 * window-keydown-Dispatcher führt aus — Reihenfolge fest: Overlay/Modal vor
 * global. Eingabefelder (INPUT/TEXTAREA/contentEditable) schlucken Kürzel
 * ohne Modifikator. Migration Verhalten 1:1 (Premortem 3): Bestehende
 * Kombinationen und ihr Fühlbares Verhalten bleiben unverändert.
 */

type ShortcutScope = "global" | "overlay";

export interface ShortcutInfo {
  /** Stabile ID, z. B. "command.toggle" — Registrierung und data-shortcut referenzieren sie. */
  id: string;
  /** Kanonische Combo fürs Matching, z. B. "Ctrl+K", "Alt+Shift+1", "Esc". */
  combo: string;
  /** Menschliche Anzeige (deutsch), z. B. "Strg+K". */
  label: string;
  description: string;
  scope: ShortcutScope;
  /** Wirkt auch in Textfeldern ohne Modifikator (Standard: nur mit Ctrl/Alt/Meta). */
  inInput?: boolean;
  /** Shift darf zusätzlich gedrückt sein (Zoom: „+“ liegt auf Shift-Ebene; Alt+L rückwärts). */
  lenientShift?: boolean;
  /** Nur Katalog: Ausführung lokal in der Komponente (Eingabe-Interaktion wie Composer 1–9). */
  localOnly?: boolean;
  /** Cheat-Sheet (T51.7): interne Detail-Kürzel ausblenden. */
  hidden?: boolean;
  /** Für localOnly: wo das Kürzel wirkt (Anzeige im Cheat-Sheet). */
  where?: string;
}

/** Kombinationen mit Alt bleiben Alt (Omarchy/Super-Entscheid, Epic 3.5). */
export const CATALOG: ShortcutInfo[] = [
  { id: "ui.zoom-in", combo: "Ctrl+Plus", label: "Strg +", description: "Oberfläche vergrößern", scope: "global", lenientShift: true },
  { id: "ui.zoom-out", combo: "Ctrl+Minus", label: "Strg −", description: "Oberfläche verkleinern", scope: "global", lenientShift: true },
  { id: "ui.zoom-reset", combo: "Ctrl+0", label: "Strg 0", description: "Oberfläche auf 100 % zurücksetzen", scope: "global" },
  { id: "command.toggle", combo: "Ctrl+K", label: "Strg+K", description: "Schnellsuche/Befehle öffnen und schließen", scope: "global" },
  { id: "command.close", combo: "Esc", label: "Esc", description: "Befehlsleiste schließen", scope: "overlay", inInput: true },
  { id: "files.toggle", combo: "Ctrl+Shift+E", label: "Strg+Umschalt+E", description: "Dateien-Seitenleiste ein-/ausblenden", scope: "global" },
  { id: "workspace.tile-1", combo: "Alt+1", label: "Alt+1", description: "Kachel 1 fokussieren", scope: "global" },
  { id: "workspace.tile-2", combo: "Alt+2", label: "Alt+2", description: "Kachel 2 fokussieren", scope: "global" },
  { id: "workspace.tile-3", combo: "Alt+3", label: "Alt+3", description: "Kachel 3 fokussieren", scope: "global" },
  { id: "workspace.tile-4", combo: "Alt+4", label: "Alt+4", description: "Kachel 4 fokussieren", scope: "global" },
  { id: "workspace.tile-swap-1", combo: "Alt+Shift+1", label: "Alt+Umschalt+1", description: "Kachel 1 mit Fokus tauschen", scope: "global" },
  { id: "workspace.tile-swap-2", combo: "Alt+Shift+2", label: "Alt+Umschalt+2", description: "Kachel 2 mit Fokus tauschen", scope: "global" },
  { id: "workspace.tile-swap-3", combo: "Alt+Shift+3", label: "Alt+Umschalt+3", description: "Kachel 3 mit Fokus tauschen", scope: "global" },
  { id: "workspace.tile-swap-4", combo: "Alt+Shift+4", label: "Alt+Umschalt+4", description: "Kachel 4 mit Fokus tauschen", scope: "global" },
  { id: "workspace.layout", combo: "Alt+L", label: "Alt+L", description: "Kachel-Layout weiter-/zurückschalten (Umschalt: rückwärts)", scope: "global", lenientShift: true },
  { id: "workspace.tile-close", combo: "Alt+W", label: "Alt+W", description: "Fokussierte Kachel schließen", scope: "global" },
  { id: "tool.close", combo: "Esc", label: "Esc", description: "Werkzeug-Fläche schließen", scope: "overlay", inInput: true },
  { id: "dock.more-close", combo: "Esc", label: "Esc", description: "Mehr-Blatt im Dock schließen", scope: "overlay", inInput: true },
  { id: "nyx.close", combo: "Esc", label: "Esc", description: "Nyx-Blatt schließen", scope: "overlay", inInput: true },
  { id: "sessiontabs.more-close", combo: "Esc", label: "Esc", description: "Unterreiter-Blatt schließen", scope: "overlay", inInput: true },
  { id: "overview.menu-close", combo: "Esc", label: "Esc", description: "Kartenmenü der Übersicht schließen", scope: "overlay", inInput: true },
  { id: "notifications.close", combo: "Esc", label: "Esc", description: "Benachrichtigungs-Panel schließen", scope: "overlay", inInput: true },
  { id: "cheatsheet.close", combo: "Esc", label: "Esc", description: "Kürzel-Übersicht schließen", scope: "overlay", inInput: true },
  { id: "skillpicker.close", combo: "Esc", label: "Esc", description: "Skill-/Agenten-Auswahl schließen", scope: "overlay", inInput: true },
  { id: "stt.cancel", combo: "Esc", label: "Esc", description: "Sprachdiktat stoppen — der gehörte Text bleibt erhalten", scope: "overlay", inInput: true },
  // EPIC-P51 T51.6: globale View-Wechsel (Alt-Schema; Firefox-Nutzen in docs/tastatur-kollisionen.md).
  { id: "view.home", combo: "Alt+Home", label: "Alt+Pos1", description: "Zur Übersicht (Start)", scope: "global" },
  { id: "view.back", combo: "Alt+ArrowLeft", label: "Alt+←", description: "Zurück in der Ansichts-Historie", scope: "global" },
  { id: "view.forward", combo: "Alt+ArrowRight", label: "Alt+→", description: "Vor in der Ansichts-Historie", scope: "global" },
  // Eingabe-Interaktion bleibt lokal (ADR-0042-Präzedenz), gehört aber in den Katalog:
  { id: "composer.send", combo: "Ctrl+Enter", label: "Strg+Enter", description: "Nachricht senden", scope: "global", localOnly: true, inInput: true, where: "im Eingabefeld" },
  { id: "composer.suggest", combo: "ArrowDown", label: "↓ / ↑", description: "In der Vorschlagsliste blättern, Enter übernimmt", scope: "global", localOnly: true, inInput: true, where: "im Composer mit offener Vorschlagsliste" },
  { id: "approvals.choose", combo: "Digit1", label: "1–9", description: "Freigabe-Option direkt wählen", scope: "global", localOnly: true, inInput: true, where: "in einer Freigabe-Frage" },
  { id: "graph.search", combo: "Slash", label: "/", description: "Graph-Suche fokussieren", scope: "global", localOnly: true, where: "im Graph-Tab (fokussierte Fläche)" },
  { id: "graph.navigate", combo: "ArrowRight", label: "Pfeiltasten", description: "Im Datei-Graph zwischen Nachbarn wandern", scope: "global", localOnly: true, where: "im Graph-Tab (fokussierte Fläche)" },
  // T43.6 (?-Übersicht) ist hierher gezogen (P51); Shift gehört zum „?“-Zeichen selbst.
  { id: "cheatsheet.toggle", combo: "?", label: "?", description: "Kürzel-Übersicht anzeigen/verbergen", scope: "global", lenientShift: true },
];

/** Kanonischen Zugriff ohne Array-Suche. */
const BY_ID = new Map(CATALOG.map((s) => [s.id, s]));

export function shortcut(id: string): ShortcutInfo | undefined {
  return BY_ID.get(id);
}

/** Anzeige-Label für Tooltips/Overlay (T51.8): „Strg+K“ statt handgeschriebener Hints. */
export function comboLabel(id: string): string | undefined {
  return BY_ID.get(id)?.label;
}

/** ARIA-Schreibweise für aria-keyshortcuts (Control+k, Alt+1 …). */
export function ariaCombo(id: string): string | undefined {
  const info = BY_ID.get(id);
  if (!info) return undefined;
  return info.combo
    .replace("Ctrl+Shift+", "Control+Shift+")
    .replace("Ctrl+", "Control+")
    .replace("Minus", "-")
    .replace("Plus", "+")
    .replace("Digit", "");
}

type Handler = (e: KeyboardEvent) => void;

interface Registration {
  info: ShortcutInfo;
  handler: Handler;
}

/** Aktive Registrierungen in Mount-Reihenfolge — Overlay zuerst bedienen. */
const active = new Map<string, Registration>();

let dispatcherInstalled = false;

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    const t = target.type;
    return !(t === "checkbox" || t === "radio" || t === "button" || t === "range" || t === "file");
  }
  return false;
}

/** Hauptkey-Normalisierung: Tastaturlayout-Aliase wie die Migration 1:1 (scaleKey, Digit-Codes).
 * Code-first: synthetische und Layout-abweichende Events tragen teils keinen `key`. */
export function normalizeKey(e: KeyboardEvent): string {
  if (e.key === "+" || e.key === "=" || e.key === "Add") return "Plus";
  if (e.key === "-" || e.key === "_" || e.key === "Subtract") return "Minus";
  const digit = /^Digit([0-9])$/.exec(e.code)?.[1];
  if (digit) return digit;
  const letter = /^Key([A-Z])$/.exec(e.code)?.[1];
  if (letter) return letter.toLowerCase();
  return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}

export function matchesCombo(info: ShortcutInfo, e: KeyboardEvent): boolean {
  const parts = info.combo.split("+");
  const main = parts[parts.length - 1];
  const wantCtrl = parts.includes("Ctrl");
  const wantAlt = parts.includes("Alt");
  const wantShift = parts.includes("Shift");
  const ctrl = e.ctrlKey || e.metaKey; // Plattform-tolerant wie ui-scale/CommandBar
  if (wantCtrl !== ctrl || wantAlt !== e.altKey) return false;
  if (!info.lenientShift && wantShift !== e.shiftKey) return false;
  if (info.lenientShift && wantShift && !e.shiftKey) return false;
  if (main === "Esc") return e.key === "Escape";
  const norm = normalizeKey(e);
  if (main.length === 1 && /[0-9]/.test(main)) return norm === main && /^Digit/.test(e.code);
  return norm === (main.length === 1 ? main.toLowerCase() : main);
}

function onKeydown(e: KeyboardEvent) {
  const regs = [...active.values()];
  const text = isTextEntry(e.target);
  // Overlay/Modal zuerst: preventDefault beendet die Kette — geschichtetes
  // Schließen statt „ein Esc schließt alles“ (CommandBar über ToolPane).
  for (const scope of ["overlay", "global"] as const) {
    for (const r of regs) {
      if (r.info.scope !== scope) continue;
      if (!matchesCombo(r.info, e)) continue;
      if (text && !r.info.inInput && !(e.ctrlKey || e.metaKey || e.altKey)) continue;
      r.handler(e);
      if (e.defaultPrevented) return;
    }
  }
}

function ensureDispatcher(): void {
  if (dispatcherInstalled || typeof window === "undefined") return;
  dispatcherInstalled = true;
  window.addEventListener("keydown", onKeydown);
}

/**
 * Registriert den Handler einer Katalog-ID. Die Registrierung lebt so kurz
 * wie der useEffect, der sie vornimmt — Komponenten re-registrieren mit
 * frischen Closures stattRefs (wie bisherige window-Listener auch).
 */
export function registerShortcut(id: string, handler: Handler): () => void {
  const info = BY_ID.get(id);
  if (!info || info.localOnly) throw new Error(`Unbekanntes oder lokales Kürzel: ${id}`);
  ensureDispatcher();
  active.set(id, { info, handler });
  return () => {
    active.delete(id);
  };
}

/** Test- und Cheat-Sheet-Zugriff auf die laufende Registry (IDs der aktiven Handler). */
export function activeShortcutIds(): string[] {
  return [...active.keys()];
}
