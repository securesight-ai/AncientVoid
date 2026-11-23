---
id: BUG-0255
slug: sidebar-tooltips-tablet
status: done
severity: S3
area: pwa
instance: dev
commit: "2a7eab27"
forge: "https://github.com/securesight-ai/AncientVoid/issues/284"
epic: ""
created: 2026-11-22
reporter: Nutzermeldung 22.11.2026 (Tablet: Tooltips der Seitenleiste ragen aus dem Bildschirm und sind unlesbar)
---

# BUG-0255 — Seitenleisten-Tooltips am Tablet ragen aus dem linken Bildschirmrand

## Gesehen

Am Tablet (split-Layout, Icon-Leiste links) werden Tooltips der
Seitenleisten-Icons mittig über dem Icon platziert und ragen links aus dem
Bildschirm heraus — der Text ist abgeschnitten und unlesbar.

## Erwartet

Tooltips der Icon-Leisten-Icons erscheinen **rechts neben** dem Icon und
sind vollständig im Viewport sichtbar (auch bei langen Labels).

## Repro

E2E-Hub des Harness + PWA (Weg über Playwright, `layout-beweis`-Rezept),
Viewport 800×1280 (Tablet, split mit fester Icon-Leiste links). Hover über
Seitenleisten-Icons, dann `getBoundingClientRect()` am `.tooltip`:

1. Hover `data-sidebar-id="automationen"` → Tooltip „Automationen“.
2. Hover auf den Seitenleisten-Umschalter (☰) → „Sidebar minimieren“.
3. Geometrie gegen Viewport lesen.

**Ergebnis (gemessen, vorher):**

| Ziel | Label | tip.x | Breite | Abgeschnitten links |
|---|---|---|---|---|
| `automationen` | Automationen | **−21** | 97 px | 21 px |
| Umschalter ☰ | Sidebar minimieren | **−37** | 129 px | 37 px |
| `aimetrics` | Metrik | 0 | 55 px | 0 (knappe Grenze) |

`elementFromPoint(x=2)` im Tooltip-Bereich trifft `dock-item`, nicht den
Tooltip — die ersten Pixel gehören dem Icon, der Tooltip-Anfang ist
abgeschnitten.

**Häufigkeit:** immer (Tablet/split; jedes Label breiter als ~55 px)

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (E2E-Harness-Hub, `layout-beweis`-Wegwerf-Spec) |
| Commit | `2a7eab27` |
| Node-Version | 26.13.1 |
| Adapter | — (keine Session nötig) |
| Repro-Weg | PWA (Playwright, viewport 800×1280) |

## Logs

Keine Konsolenfehler — reines Geometrie-Problem (Zahlen siehe Repro).

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/pwa/test/shared/tooltip-logic.test.ts` | grün — Platzierung ist nicht ohne DOM testbar hinterlegt |
| E2E | `e2e/specs/tooltips.spec.ts` | grün — prüft Text/Interaktion, keine Geometrie |

Ohne Fix rot werden muss: eine Unit-Übergabe für die Tooltip-Platzierung
(neu in `tooltip-logic.ts`), die für einen Anker an der linken Icon-Leiste
Neben-Platzierung rechts des Icons und `left ≥ 0` verlangt; plus E2E-Geometrie
(`tip.x ≥ 0`, Tooltip beginnt rechts der Icon-Kante).

## Eingrenzung

`apps/pwa/src/shared/Tooltip.tsx:203-212` — die Klemmung
`x = min(max(shown.x, 8), maxX)` klemmt nur den **Ankerpunkt** (Mitte des
Icons), nicht die Box: mit `transform: translate(-50%)` (`.tooltip`,
`14-notifications.css:338`) ragt die linke Hälfte der Box über den Rand.
Icon-Mitte der Leiste liegt bei ~28 px; ab ~56 px Tooltip-Breite wird
negativ.

## Handoff

- [ ] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen
