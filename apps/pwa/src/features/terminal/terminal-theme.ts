/**
 * ADR-0087 Nachtrag 2026-11-23: xterm-Theme aus den AncientVoid-Tokens
 * (EPIC-P63). Die Terminal-Fläche ist dokumenteneigen und bleibt dunkel
 * (--content-terminal, „kein Themen-Thema“) — auch im hellen App-Thema,
 * weil Shell-Ausgaben (ANSI-Farben, Prompts) auf Dunkel getunt sind.
 *
 * Akzentfarbe hervorheben: Cursor, Auswahl und ANSI-Magenta laufen auf
 * --accent — Prompts, die Magenta/Violett nutzen, sprechen damit die
 * Markenfarbe. appearance.ts überschreibt --accent zur Laufzeit; gelesen
 * wird er beim Erstellen des Terminals (Seite neu betreten genügt).
 */

export type TokenReader = (name: string, fallback: string) => string;

/** `#rgb`/`#rrggbb` → `rgba(...)`, alles andere unverändert (kein Wurf). */
export function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!hex) return color;
  const digits = hex[1].length === 3
    ? [...hex[1]].map((c) => c + c).join("")
    : hex[1];
  const r = parseInt(digits.slice(0, 2), 16);
  const g = parseInt(digits.slice(2, 4), 16);
  const b = parseInt(digits.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** ANSI-16-Palette auf Schicht-1-Primitive gemappt (dunkle Fläche). */
export function buildTerminalTheme(read: TokenReader): {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
} {
  const accent = read("--accent", "#b58cff");
  return {
    background: read("--content-terminal", "#08090b"),
    foreground: read("--gray-050", "#eef1f5"),
    cursor: accent,
    cursorAccent: read("--void-ink", "#12081f"),
    selectionBackground: withAlpha(accent, 0.35),
    black: read("--gray-850", "#121316"),
    red: read("--rose-400", "#ff5c6a"),
    green: read("--mint-500", "#9ece6a"),
    yellow: read("--gold-400", "#ffcf5c"),
    blue: read("--blue-400", "#7aa2f7"),
    magenta: accent,
    cyan: read("--cyan-400", "#5cc8ff"),
    white: read("--gray-300", "#8d95a3"),
    brightBlack: read("--gray-400", "#7b8391"),
    brightRed: read("--rose-400", "#ff5c6a"),
    brightGreen: read("--mint-400", "#4fe0ab"),
    brightYellow: read("--gold-400", "#ffcf5c"),
    brightBlue: read("--blue-400", "#7aa2f7"),
    brightMagenta: read("--violet-300", "#bb9af7"),
    brightCyan: read("--cyan-300", "#2ac3de"),
    brightWhite: read("--gray-050", "#eef1f5"),
  };
}
