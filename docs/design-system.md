# Design-System — Vertrag (EPIC-P63)

**Art:** referenz

Lebender Vertrag für jede UI-Aufgabe. Herkunft (P1.6/P43/P34/P52):
[`2026-11-16_design-system-herkunft.md`](2026-11-16_design-system-herkunft.md).
Tokens stehen in `apps/pwa/src/app/styles/00-tokens.css`; Bausteine in
`apps/pwa/src/shared/ui/`. Ratchet-Tests erzwingen die Verbote
(`apps/pwa/test/css-tokens.test.ts`, `ui-primitives.test.ts`,
`apps/pwa/test/app/tokens.test.ts`).

## 1. Tokens

Drei Schichten: **Primitiv** (nur Hex/rgb, nur in `00-tokens.css`) →
**Semantik** (Vokabular aller Regeln; Light überschreibt nur hier) →
**Komponente** (nur in `styles/ui/<name>.css`, verweist auf Semantik).

<!-- BEGIN:design-tokens (scripts/design-tokens-doc.mjs) -->

> Generiert aus `apps/pwa/src/app/styles/00-tokens.css` — nicht von Hand pflegen.
> `npm run docs:design-tokens` bzw. `--check`. Light überschreibt nur Semantik (`[data-theme="light"]`).

| Token | Schicht | Wert (Dunkel-Default) |
|---|---|---|
| `--gray-950` | primitiv | `#08090b` |
| `--gray-850` | primitiv | `#121316` |
| `--gray-800` | primitiv | `#21252c` |
| `--gray-025` | primitiv | `#eef0f6` |
| `--paper` | primitiv | `#ffffff` |
| `--gray-200` | primitiv | `#d7dae5` |
| `--gray-050` | primitiv | `#eef1f5` |
| `--gray-300` | primitiv | `#8d95a3` |
| `--gray-400` | primitiv | `#7b8391` |
| `--gray-900` | primitiv | `#0d1016` |
| `--gray-600` | primitiv | `#565d6e` |
| `--gray-500` | primitiv | `#666d7d` |
| `--void-violet-500` | primitiv | `#b58cff` |
| `--void-violet-600` | primitiv | `#7a4fd1` |
| `--void-violet-700` | primitiv | `#6a3cc9` |
| `--void-ink` | primitiv | `#12081f` |
| `--amber-400` | primitiv | `#ff9a3c` |
| `--amber-700` | primitiv | `#9c4d00` |
| `--amber-ink` | primitiv | `#1a0a00` |
| `--cyan-300` | primitiv | `#2ac3de` |
| `--cyan-400` | primitiv | `#5cc8ff` |
| `--cyan-700` | primitiv | `#0b6aa6` |
| `--cyan-800` | primitiv | `#1072b0` |
| `--cyan-ink` | primitiv | `#04131c` |
| `--mint-400` | primitiv | `#4fe0ab` |
| `--mint-500` | primitiv | `#9ece6a` |
| `--mint-700` | primitiv | `#127a56` |
| `--gold-400` | primitiv | `#ffcf5c` |
| `--gold-700` | primitiv | `#9a6a06` |
| `--rose-400` | primitiv | `#ff5c6a` |
| `--rose-700` | primitiv | `#c72d3d` |
| `--scrim-950` | primitiv | `rgba(0, 0, 0, 0.65)` |
| `--scrim-800` | primitiv | `rgba(0, 0, 0, 0.55)` |
| `--scrim-900` | primitiv | `rgba(0, 0, 0, 0.7)` |
| `--scrim-700` | primitiv | `rgba(20, 20, 40, 0.2)` |
| `--scrim-600` | primitiv | `rgba(20, 20, 40, 0.35)` |
| `--hue-red` | primitiv | `#f00` |
| `--hue-yellow` | primitiv | `#ff0` |
| `--hue-lime` | primitiv | `#0f0` |
| `--hue-cyan` | primitiv | `#0ff` |
| `--hue-blue` | primitiv | `#00f` |
| `--hue-magenta` | primitiv | `#f0f` |
| `--violet-300` | primitiv | `#bb9af7` |
| `--orange-400` | primitiv | `#ff9e64` |
| `--orange-700` | primitiv | `#a04b0a` |
| `--blue-400` | primitiv | `#7aa2f7` |
| `--data-blue-400` | primitiv | `#3987e5` |
| `--data-blue-600` | primitiv | `#2a78d6` |
| `--data-orange-400` | primitiv | `#d95926` |
| `--data-orange-600` | primitiv | `#eb6834` |
| `--data-aqua-400` | primitiv | `#199e70` |
| `--bg` | semantik | `var(--gray-950)` |
| `--bg-elev` | semantik | `var(--gray-850)` |
| `--bg-chip` | semantik | `var(--gray-800)` |
| `--bg-hover` | semantik | `color-mix(in srgb, var(--fg) 6%, var(--bg-elev))` |
| `--bg-active` | semantik | `color-mix(in srgb, var(--fg) 11%, var(--bg-elev))` |
| `--border` | semantik | `color-mix(in srgb, var(--fg) 18%, var(--bg-elev))` |
| `--border-strong` | semantik | `color-mix(in srgb, var(--fg) 34%, var(--bg-elev))` |
| `--fg` | semantik | `var(--gray-050)` |
| `--fg-dim` | semantik | `var(--gray-300)` |
| `--fg-faint` | semantik | `var(--gray-400)` |
| `--fg-on-accent` | semantik | `var(--accent-ink)` |
| `--accent` | semantik | `var(--void-violet-500)` |
| `--accent-ink` | semantik | `var(--void-ink)` |
| `--call` | semantik | `var(--amber-400)` |
| `--call-ink` | semantik | `var(--amber-ink)` |
| `--info` | semantik | `var(--cyan-400)` |
| `--info-ink` | semantik | `var(--cyan-ink)` |
| `--ok` | semantik | `var(--mint-400)` |
| `--warn` | semantik | `var(--gold-400)` |
| `--err` | semantik | `var(--rose-400)` |
| `--code-keyword` | semantik | `var(--violet-300)` |
| `--code-string` | semantik | `var(--mint-500)` |
| `--code-number` | semantik | `var(--orange-400)` |
| `--code-title` | semantik | `var(--blue-400)` |
| `--code-type` | semantik | `var(--cyan-300)` |
| `--content-paper` | semantik | `var(--paper)` |
| `--content-terminal` | semantik | `var(--gray-950)` |
| `--graph-code` | semantik | `var(--cyan-400)` |
| `--graph-config` | semantik | `var(--void-violet-500)` |
| `--graph-other` | semantik | `var(--gray-300)` |
| `--data-1` | semantik | `var(--data-blue-400)` |
| `--data-2` | semantik | `var(--data-orange-400)` |
| `--data-3` | semantik | `var(--data-aqua-400)` |
| `--radius` | form | `7px` |
| `--radius-sm` | form | `4px` |
| `--radius-lg` | form | `14px` |
| `--shadow-elev` | form | `0 0 0 1px var(--bg-chip), 0 10px 26px -14px var(--scrim-900)` |
| `--shadow-sheet` | form | `0 18px 48px -20px var(--scrim-950)` |
| `--backdrop` | form | `var(--scrim-800)` |
| `--warn-ink` | form | `var(--amber-ink)` |
| `--err-ink` | form | `var(--paper)` |
| `--font-display` | typografie | `"Orbitron", system-ui, sans-serif` |
| `--font-ui` | typografie | `"Inter", system-ui, sans-serif` |
| `--font-code` | typografie | `"JetBrains Mono", ui-monospace, "Fira Code", system-ui, monospace` |
| `--font-mono` | typografie | `var(--font-code)` |
| `--tracking-label` | typografie | `0.1em` |
| `--space-1` | skala | `4px` |
| `--space-2` | skala | `8px` |
| `--space-3` | skala | `12px` |
| `--space-4` | skala | `16px` |
| `--space-5` | skala | `24px` |
| `--space-6` | skala | `32px` |
| `--text-xs` | skala | `calc(11px * var(--font-scale))` |
| `--text-sm` | skala | `calc(12px * var(--font-scale))` |
| `--text-md` | skala | `calc(14px * var(--font-scale))` |
| `--text-lg` | skala | `calc(16px * var(--font-scale))` |
| `--text-xl` | skala | `calc(20px * var(--font-scale))` |
| `--text-input` | skala | `max(16px, calc(16px * var(--font-scale)))` |
| `--text-code` | skala | `calc(12px * var(--code-scale))` |
| `--target` | ziel | `44px` |
| `--icon-target` | ziel | `44px` |
| `--icon-glyph` | ziel | `calc(20px * var(--font-scale))` |
| `--icon-glyph-md` | ziel | `calc(var(--icon-glyph) + 2px)` |
| `--icon-glyph-lg` | ziel | `calc(var(--icon-glyph) + 4px)` |
| `--motion-fast` | bewegung | `120ms` |
| `--motion-base` | bewegung | `220ms` |
| `--motion-slow` | bewegung | `420ms` |
| `--ease-out` | bewegung | `cubic-bezier(0.2, 0.8, 0.2, 1)` |
| `--ease-spring` | bewegung | `cubic-bezier(0.2, 0.9, 0.25, 1.1)` |
| `--z-base` | ebene | `1` |
| `--z-sticky` | ebene | `10` |
| `--z-dock` | ebene | `20` |
| `--z-overlay` | ebene | `50` |
| `--z-sheet` | ebene | `60` |
| `--z-toast` | ebene | `200` |
| `--z-popout` | ebene | `210` |
| `--status-bar-h` | ebene | `28px` |
| `--z-lightbox` | ebene | `300` |
| `--font-scale` | preset | `1` |
| `--ui-zoom` | preset | `1` |
| `--code-scale` | preset | `1` |
| `--preset-border` | preset | `1px` |
| `--device-background` | preset | `none` |
| `--chat-max-width` | preset | `720px` |

<!-- END:design-tokens -->

Kontrast ≥ 4,5:1 für semantische Text/Flächen-Paare in beiden Themen
(`tokens.test.ts`). Statusfarbe ≠ Akzentfarbe (`--ok/--warn/--err/--call/--info`
vs `--accent`).

## 2. Leitern

| Leiter | Tokens / Konstanten | Test |
|---|---|---|
| z-index | `--z-base` 1 · `--z-sticky` 10 · `--z-dock` 20 · `--z-overlay` 50 · `--z-sheet` 60 · `--z-toast` 200 · `--z-popout` 210 | css-tokens (d) |
| Breakpoints | phone ≤ 639 · tablet ≤ 1023 · desktop ≥ 1280 · short ≤ 520 Höhe (Galaxie 699/700/760) | css-tokens (f) |
| Schrift | `--text-xs/sm/md/lg/xl` (+ `--text-input`, `--text-code`) | css-tokens (e) |
| Abstand | `--space-1…6` (4/8/12/16/24/32 px) | Rezept |
| Zielgröße | `--target` / `--icon-target` (Touch 44, Maus 30/36) | — |
| Bewegung | `--motion-fast/base/slow`, `--ease-out/--ease-spring` | — |

Keine neuen Zahlen außerhalb dieser Leitern.

## 3. Bausteine

Export: `apps/pwa/src/shared/ui/index.ts`. CSS: `apps/pwa/src/app/styles/ui/<name>.css`,
Klassenpräfix `ui-<name>`. Keine Props für freie Farben — nur Varianten.

| Baustein | Props | Varianten / Hinweise |
|---|---|---|
| `Button` | `variant`, `size`, `icon`, übliche button-Attrs | `primary` \| `subtle` \| `danger` \| `link`; `sm` \| `md`; `icon` → `--icon-target` |
| `Chip` | `tone`, `active`, `onRemove`, `removeLabel` | `neutral` \| `ok` \| `warn` \| `err` \| `info`; `ChipStatic` für nicht-interaktiv |
| `Card` | `padding`, `elevated` | `md` \| `none` (flush) |
| `Sheet` | `open`, `onClose`, `label`, `variant`, `preferred`, `testid` | `sheet` (unten) \| `modal` (zentriert); Fokusfalle + Esc via `overlay-focus.ts` |
| `EmptyState` | `icon`, `text`, `action` | Kleinkram-Regel 2: ein Satz + Aktion |
| `Field` / `Select` / `Switch` / `Segmented` | siehe `forms.tsx` | Re-Export aus `shared/forms.tsx` bleibt eine Phase |

Unit-Tests: `apps/pwa/test/ui/*.test.tsx`. Fokusfalle/Esc: `e2e/specs/fokus.spec.ts`.

## 4. Rezept für eine neue Ansicht

0. Nutzer sichtbarer Text kommt aus dem i18n Katalog (`shared/i18n/`,
   ADR-0101); neue Views migriert man mit (`check:i18n` Ratchet; der Gate meldet auch `t()`-Schlüssel, die im de-Katalog fehlen).
1. Feature-Datei unter `apps/pwa/src/features/<name>/` (ADR-0020).
2. CSS-Datei mit eindeutigem Präfix, Import nur über `styles/index.css`.
3. Nur semantische Tokens und Leitern — kein neuer Hex, kein freier `z-index`.
4. Flächen aus Bausteinen (`Button`/`Chip`/`Card`/`Sheet`/`EmptyState`).
5. Keine rohen `btn`/`chip`/`card`/`empty`/`overlay-sheet`-Klassen.
6. Inline-`style={{…}}` nur für Laufzeitwerte (`--lane`, Position, Transform).
7. Globales `:focus-visible` reicht; eigene Ringe nur mit Begründung (inset).
8. Spec in `e2e/specs/` oder Unit-Test an der Naht.
9. Probe ohne Allowlist: `e2e/fixtures/ds-probe/` (AC-P63-8).
10. `npm run typecheck` + betroffene Tests grün.

## 5. Verbote (mit Test)

| Verbot | Test |
|---|---|
| Undefiniertes `var(--…)` | css-tokens / tokens |
| `#hex` / `rgb(` / `hsl(` außerhalb `00-tokens.css` | css-tokens (b) |
| `var(--x, fallback)` | css-tokens (c) |
| `z-index` / Schriftgröße / Media außerhalb der Leitern | css-tokens (d)(e)(f) |
| Rohe `btn`/`chip`/`card`/`empty`/`overlay-sheet` in `features/` | ui-primitives |
| Klasse im TSX ohne CSS-Regel (außer Allowlist-Präfixe) | css-tokens |
| Selektor in zwei Dateien (außerhalb `@media`) | css-tokens |
| Kontrast < 4,5:1 für semantische Paare | tokens.test.ts |

Abweichung braucht genannten Grund und Allowlist-Eintrag mit Datei-Verweis —
nicht Review-Disziplin allein.
