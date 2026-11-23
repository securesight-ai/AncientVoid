/**
 * ADR-0087 Nachtrag 2026-11-23: Copy/Paste im Terminal-Tab.
 *
 * Vorher fraß xterm.js Ctrl+V als ^V (readline quoted-insert) und
 * Ctrl+Shift+C als ^C — Einfügen war unmöglich (Nutzerreport 23.11.2026).
 * Der Klassifikator entscheidet, welche Kombination die App abfängt;
 * alles andere (v. a. Ctrl+C ohne Markierung = SIGINT) geht unangetastet
 * an die Shell.
 */

export type ClipboardAction = "paste" | "copy";

export interface ShortcutLikeEvent {
  type: string;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * - paste: Strg/Cmd+V (± Shift) und Shift+Einfg (klassische Terminal-Paste).
 * - copy: Strg/Cmd+Shift+C, Strg/Cmd+C mit Markierung, Strg+Einfg.
 * Ctrl+C ohne Markierung bleibt SIGINT → null.
 */
export function clipboardShortcut(ev: ShortcutLikeEvent, hasSelection: boolean): ClipboardAction | null {
  if (ev.type !== "keydown" || ev.altKey) return null;
  const mod = ev.ctrlKey || ev.metaKey;
  const key = ev.key.toLowerCase();
  if (mod && key === "v") return "paste";
  if (mod && key === "insert") return "copy";
  if (ev.shiftKey && !mod && key === "insert") return "paste";
  if (mod && key === "c") return ev.shiftKey || hasSelection ? "copy" : null;
  return null;
}
