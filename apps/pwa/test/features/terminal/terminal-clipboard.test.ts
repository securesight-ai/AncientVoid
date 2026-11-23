import { describe, expect, it } from "vitest";
import { clipboardShortcut, type ShortcutLikeEvent } from "../../../src/features/terminal/terminal-clipboard.ts";

const ev = (over: Partial<ShortcutLikeEvent>): ShortcutLikeEvent => ({
  type: "keydown",
  key: "v",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

/** ADR-0087 Nachtrag 2026-11-23: Nutzerreport — Ctrl+V landete als ^V in
 * readline, einfügen war unmöglich. Der Klassifikator entscheidet, was die
 * App abfängt; Ctrl+C ohne Markierung muss SIGINT bleiben. */
describe("clipboardShortcut", () => {
  it("paste: Strg/Cmd+V mit und ohne Shift", () => {
    expect(clipboardShortcut(ev({ ctrlKey: true }), false)).toBe("paste");
    expect(clipboardShortcut(ev({ ctrlKey: true, shiftKey: true }), false)).toBe("paste");
    expect(clipboardShortcut(ev({ metaKey: true }), false)).toBe("paste");
  });

  it("paste: Shift+Einfg (klassische Terminal-Paste)", () => {
    expect(clipboardShortcut(ev({ key: "insert", shiftKey: true }), false)).toBe("paste");
  });

  it("copy: Strg+Shift+C und Strg+C mit Markierung; Ctrl+Insert", () => {
    expect(clipboardShortcut(ev({ key: "c", ctrlKey: true, shiftKey: true }), false)).toBe("copy");
    expect(clipboardShortcut(ev({ key: "c", ctrlKey: true }), true)).toBe("copy");
    expect(clipboardShortcut(ev({ key: "insert", ctrlKey: true }), false)).toBe("copy");
  });

  it("Ctrl+C ohne Markierung bleibt SIGINT (null)", () => {
    expect(clipboardShortcut(ev({ key: "c", ctrlKey: true }), false)).toBeNull();
  });

  it("unkritische Tasten und keyup gehen unangetastet an die Shell", () => {
    expect(clipboardShortcut(ev({ key: "a", ctrlKey: true }), false)).toBeNull();
    expect(clipboardShortcut(ev({ ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(clipboardShortcut(ev({ ctrlKey: true, type: "keyup" }), false)).toBeNull();
    expect(clipboardShortcut(ev({ key: "l", ctrlKey: true }), false)).toBeNull();
  });
});
