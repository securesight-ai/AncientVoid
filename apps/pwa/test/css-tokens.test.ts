import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EPIC-P63 T63.0/AC-P63-1 — Ratchet über die Styling-Invarianten des
 * Design-Systems (docs/design-system.md). Jede Prüfung zählt Verstöße gegen
 * den Zielzustand; der Ist-Stand steht in `test/css-ratchet.json` und darf
 * nur sinken (senken = Test rot schreiben, dann beheben).
 *
 *  (a) jedes var(--x) ist definiert (CSS oder JS-Setter/Inline-Custom-Props)
 *  (b) keine Hex-/rgb-/hsl-Farben außerhalb von 00-tokens.css
 *  (c) kein var(--x, <fallback>)
 *  (d) z-index nur über die Ebenen-Leiter (--z-*)
 *  (e) keine px-/em-Schriftgröße außerhalb von 00-tokens.css
 *  (f) nur dokumentierte @media-Ausdrücke (Breakpoint-Leiter)
 */

const PWA = resolve(import.meta.dirname, "..");
const STYLES = join(PWA, "src/app/styles");
const SRC = join(PWA, "src");
const TOKEN_FILE = "00-tokens.css";

/** Alle CSS-Dateien unter styles/ (einschließlich ui/), pfadrelativ zum Ordner. */
function cssFiles(dir = STYLES, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? cssFiles(join(dir, e.name), `${prefix}${e.name}/`) : e.name.endsWith(".css") ? [`${prefix}${e.name}`] : [],
  );
}

const FILES = cssFiles();
const cssOf = (rel: string): string => readFileSync(join(STYLES, rel), "utf8");

/** Kommentare entfernen, damit Beispiele in Kommentern nicht zählen. */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

type Counts = {
  unknownVarTokens: number;
  colorLiteralsOutsideTokens: number;
  varFallbacks: number;
  zIndexOffLadder: number;
  fontSizeOffScale: number;
  mediaOffLadder: number;
};

function counts(): Counts {
  const cleaned = new Map(FILES.map((f) => [f, stripComments(cssOf(f))]));
  const cssAll = [...cleaned.values()].join("\n");

  // (a) definierte Custom Properties: CSS-Deklarationen + JS-Setter + Inline-Keys in TSX/TS.
  const defined = new Set<string>();
  for (const css of cleaned.values()) for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]!);
  const tsFiles = readdirSync(SRC, { recursive: true })
    .map((f) => join(SRC, String(f)))
    .filter((f) => /\.[jt]sx?$/.test(f) && !f.includes("node_modules"));
  const tsAll = tsFiles.map((f) => readFileSync(f, "utf8")).join("\n");
  for (const m of tsAll.matchAll(/setProperty\(\s*"(-{2}[a-z0-9-]+)"/g)) defined.add(m[1]!);
  for (const m of tsAll.matchAll(/"(-{2}[a-z0-9-]+)"\s*:/g)) defined.add(m[1]!);
    for (const m of tsAll.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]!);
  const used = new Map<string, number>();
  for (const m of `${cssAll}\n${tsAll}`.matchAll(/var\((--[a-z0-9-]+)/g)) used.set(m[1]!, (used.get(m[1]!) ?? 0) + 1);
  const unknownVarTokens = [...used.entries()].filter(([t]) => !defined.has(t)).reduce((n, [, c]) => n + c, 0);

  // (b) Farbliterale — nur die Token-Datei darf welche enthalten.
  const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g;
  const colorLiteralsOutsideTokens = [...cleaned]
    .filter(([f]) => f !== TOKEN_FILE)
    .reduce((n, [, css]) => n + (css.match(COLOR)?.length ?? 0), 0);

  // (c) Fallback-Werte in var().
  const varFallbacks = (cssAll.match(/var\(--[a-z0-9-]+\s*,/g) ?? []).length;

  // (d) z-index ausschließlich über Leiter-Tokens.
  const zIndexOffLadder = [...cleaned.values()]
    .join("\n")
    .split("\n")
    .filter((l) => /z-index\s*:/.test(l) && !/z-index\s*:\s*var\(--z-[a-z-]+\)/.test(l)).length;

  // (e) Schriftgrößen mit px/em — erlaubt nur in der Token-Datei (Skala --text-*).
  const FONT = /font-size\s*:[^;{}]*[0-9](\.\d+)?(px|em)\b/g;
  const fontSizeOffScale = [...cleaned]
    .filter(([f]) => f !== TOKEN_FILE)
    .reduce((n, [, css]) => n + (css.match(FONT)?.length ?? 0), 0);

  // (f) dokumentierte @media-Ausdrücke: Breakpoint-Leiter (00-tokens.css unten),
  // Graph-/Tablet-Konstanten (EPIC-P52/P43, design-system.md), Orientierung/Hover/Bewegung.
  const ATOMS = new Set([
    "(prefers-reduced-motion: reduce)",
    "(hover: hover)",
    "(hover: none)",
    "(pointer: fine)",
    "(orientation: portrait)",
    "(orientation: landscape)",
    "(max-width: 639px)",
    "(min-width: 640px)",
    "(max-width: 1023px)",
    "(min-width: 1280px)",
    "(max-width: 699px)",
    "(min-width: 700px)",
    "(min-width: 760px)",
    "(max-height: 430px)",
    "(max-height: 520px)",
    "(min-height: 521px)",
    "(max-height: 699px)",
    "(min-height: 700px)",
  ]);
  let mediaOffLadder = 0;
  for (const css of cleaned.values()) {
    for (const m of css.matchAll(/@media([^{]+)\{/g)) {
      const atoms = [...m[1]!.matchAll(/\([^()]+\)/g)].map((a) => a[0]!);
      if (atoms.some((a) => !ATOMS.has(a))) mediaOffLadder += 1;
    }
  }

  return { unknownVarTokens, colorLiteralsOutsideTokens, varFallbacks, zIndexOffLadder, fontSizeOffScale, mediaOffLadder };
}

const RATCHET_PATH = join(import.meta.dirname, "css-ratchet.json");
const ratchet: Counts = JSON.parse(readFileSync(RATCHET_PATH, "utf8"), (k, v) => (k === "" ? { ...counts(), ...v } : v));

describe("EPIC-P63 css-tokens-Ratchet (AC-P63-1)", () => {
  it("00-tokens.css ist importiert und jede CSS-Datei kommt in index.css vor", () => {
    const index = cssOf("index.css");
    for (const f of FILES) if (f !== "index.css") expect(index, `${f} fehlt in index.css`).toContain(`@import "./${f}";`);
  });

  it.each(Object.keys(ratchet) as (keyof Counts)[])("%s bleibt unterhalb des Ratchet-Werts", (key) => {
    const c = counts();
    if (c[key] > ratchet[key]) {
      expect.fail(`${key}: ${c[key]} > Ratchet ${ratchet[key]} — Ratchet senken heißt: erst Zahl herabsetzen (rot), dann aufräumen (grün).`);
    }
  });

  it("Breakpoint-Leiter und Ebenen-Leiter sind in 00-tokens.css dokumentiert", () => {
    const tokens = cssOf(TOKEN_FILE);
    for (const z of ["--z-base", "--z-sticky", "--z-dock", "--z-overlay", "--z-sheet", "--z-toast", "--z-popout"]) {
      expect(tokens, z).toContain(`${z}:`);
    }
    expect(tokens).toContain("--space-6:");
    expect(tokens).toContain("Breakpoint-Leiter");
  });

  it("jeder Klassen-Selektor außerhalb von @media existiert in genau einer Datei (AC-P63-3)", () => {
    const bySelector = new Map<string, string[]>();
    for (const f of FILES) {
      const css = stripComments(cssOf(f)).replace(/@media[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
      for (const m of css.matchAll(/([^{}]+)\{/g)) {
        for (const part of m[1]!.split(",")) {
          const cls = part.trim().match(/^\.([A-Za-z0-9_-]+)$/);
          if (cls) bySelector.set(cls[1]!, [...(bySelector.get(cls[1]!) ?? []), f]);
        }
      }
    }
    // Mediengebundene Schichten (50-short-viewport, BUG-0181) dürfen denselben
    // Selektor innerhalb eines @media-Kontexts überschreiben — oben entfernt.
    const dups = [...bySelector.entries()].filter(([, fs]) => new Set(fs).size > 1);
    expect(dups.map(([c, fs]) => `${c}: ${fs.join(", ")}`)).toEqual([]);
  });

  it("jede TSX-Klasse hat eine Regel oder einen dokumentierten dynamischen Präfix (AC-P63-3, T63.6)", () => {
    const defined = new Set<string>();
    for (const f of FILES) for (const m of stripComments(cssOf(f)).matchAll(/\.([A-Za-z0-9_-]+)/g)) defined.add(m[1]!);
    /** Dynamische Präfixe: der Zusatz wird im TSX zur Laufzeit zusammengesetzt —
     * je Präfix die erzeugende Stelle. Neue Einträge brauchen einen Datei-Verweis. */
    const DYNAMIC = [
      "hljs-", // files/highlight.ts (Syntax-Highlighting)
      "layout-", // workspace/TileWorkspace.tsx (Kachel-Layouts)
      "graph-dot-", "graph-diag-source-", // graph/GraphPane.tsx
      "kind-", // composer/SourceChips.tsx
      "git-", // files/FilesSidebar.tsx (Git-Status)
      "gate-", // approvals/Approvals.tsx, loops/LoopPanel.tsx
      "ui-", // shared/ui/ (Bausteine, T63.7)
      "status-", // shared/StatusDot.tsx (Anzeigezustand)
      "nyx-", // nyx/Nyx.tsx (Sprite-Zustände)
      "md-", // shared/markdown.ts (gerendertes Markdown)
      "json-", "nb-", // files/RenderedViews.tsx
      "log-", "run-", // browser/BrowserLayer.tsx (Log-/Testzustände)
      "epic-", // files/FilesSidebar.tsx (Epic-Statuspunkte)
      "state-", // discovery/Discovery.tsx
      "section-", // overview/Dashboard.tsx
      "risk-", // commands/CommandBar.tsx
      "metric-", // session/ReportPane.tsx
      "todo-", "ws-phase-", "ws-state-", // session/SessionTail.tsx, workspace/WorkspaceRuntimePane.tsx
      "st-", // team/TeamsPane.tsx
      "session-status-", // Anzeigezustand abgeleitet (display-state.ts)
    ];
    const missing = new Set<string>();
    const srcDir = join(PWA, "src");
    for (const f of readdirSync(srcDir, { recursive: true })) {
      if (!/\.tsx$/.test(String(f))) continue;
      const src = readFileSync(join(srcDir, String(f)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const cls = new Set<string>();
      for (const m of src.matchAll(/class="([^"]*)"/g)) for (const t of m[1]!.trim().split(/\s+/)) if (t) cls.add(t);
      for (const m of src.matchAll(/class=\{`([^`]*)`\}/g)) {
        const frag = m[1]!;
        for (const part of frag.split(/\$\{[^}]*\}/)) for (const t of part.trim().split(/\s+/)) if (t && !t.endsWith("-")) cls.add(t);
        const pre = frag.match(/^\s*([A-Za-z0-9_-]+)/);
        if (pre && frag.includes("${")) cls.add(pre[1]!);
      }
      for (const c of cls) {
        if (!c || c.endsWith("-")) continue;
        if (!defined.has(c) && !DYNAMIC.some((d) => c.startsWith(d))) missing.add(`${c} (${f})`);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  it("Datei-Präfixe sind eindeutig (T63.5: doppeltes 23- aufgelöst)", () => {
    const prefixes = FILES.filter((f) => f !== "index.css").map((f) => f.split("-")[0]);
    expect(new Set(prefixes).size, "Nummern-Präfixe doppelt").toBe(prefixes.length);
  });
});
