import { describe, expect, it } from "vitest";
import { buildTerminalTheme, withAlpha } from "../../../src/features/terminal/terminal-theme.ts";

const tokens: Record<string, string> = {
  "--accent": "#b58cff",
  "--content-terminal": "#08090b",
  "--gray-050": "#eef1f5",
  "--gray-850": "#121316",
  "--gray-400": "#7b8391",
  "--gray-300": "#8d95a3",
  "--rose-400": "#ff5c6a",
  "--mint-500": "#9ece6a",
  "--mint-400": "#4fe0ab",
  "--gold-400": "#ffcf5c",
  "--blue-400": "#7aa2f7",
  "--violet-300": "#bb9af7",
  "--cyan-400": "#5cc8ff",
  "--cyan-300": "#2ac3de",
  "--void-ink": "#12081f",
};
const read = (name: string, fallback: string): string => tokens[name] ?? fallback;

/** ADR-0087 Nachtrag 2026-11-23: Nutzerreport — Terminal-Farben waren das
 * xterm-Default-Thema, kein AncientVoid. Der Builder mappt alle 16 ANSI-
 * Farben plus Cursor/Markierung auf Tokens, die Akzentfarbe wird sichtbar. */
describe("terminal theme aus App-Tokens", () => {
  it("Fläche bleibt dunkel (content-terminal), auch im hellen App-Thema", () => {
    const theme = buildTerminalTheme(read);
    expect(theme.background).toBe("#08090b");
    expect(theme.foreground).toBe("#eef1f5");
  });

  it("Akzentfarbe trägt Cursor, Markierung und ANSI-Magenta", () => {
    const theme = buildTerminalTheme(read);
    expect(theme.cursor).toBe("#b58cff");
    expect(theme.magenta).toBe("#b58cff");
    expect(theme.selectionBackground).toBe("rgba(181, 140, 255, 0.35)");
    expect(theme.cursorAccent).toBe("#12081f");
  });

  it("fehlende Tokens fallen auf AncientVoid-Defaultfarben zurück", () => {
    const theme = buildTerminalTheme((_name, fallback) => fallback);
    expect(theme.background).toBe("#08090b");
    expect(theme.cursor).toBe("#b58cff");
    expect(theme.green).toBe("#9ece6a");
  });

  it("withAlpha: hex3/hex6 werden rgba, alles andere bleibt unverändert", () => {
    expect(withAlpha("#abc", 0.5)).toBe("rgba(170, 187, 204, 0.5)");
    expect(withAlpha("#b58cff", 0.35)).toBe("rgba(181, 140, 255, 0.35)");
    expect(withAlpha("color-mix(in srgb, red, blue)", 0.5)).toBe("color-mix(in srgb, red, blue)");
    expect(withAlpha("", 0.5)).toBe("");
  });
});
