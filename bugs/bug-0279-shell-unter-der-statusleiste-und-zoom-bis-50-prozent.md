---
id: BUG-0279
slug: shell-ragt-unter-die-statusleiste-rauszoomen-bis-70-prozent-gerettet
status: fixed
severity: S2
area: pwa
instance: dev
commit: ""
forge: ""
epic: P50
created: 2026-11-24
reporter: Kai
---

# BUG-0279 — Die Shell endet unter der Statusleiste; Rauszoomen war bei 70 % zu Ende

## Gesehen

Kai am PC: „Warum wird es so groß dargestellt … ich würde gerne mehr rauszoomen
können, geht aber irgendwie nicht." Die Oberfläche endete bei **70 %** — Strg +
Mausrad / Strg + Minus gingen nicht weiter (`SCALE_MIN = 0.7` in
`apps/pwa/src/app/ui-scale.ts`). Die App fängt diese Tasten bewusst ab
(`preventDefault`), damit sich der Browser-Zoom nicht darauf stapelt — die
Grenze war also eine harte Kante in der App, keine Browser-Einstellung.

Der Grund für die konservative Untergrenze war eine Layout-Garantie, die
bereits bei kleineren Stufen brach: die messbare Shell reichte bis zum
Fensterboden und **überdeckte** die fixe Statusleiste.

## Messung (vor dem Fix, 1280 × 720, Übersicht)

    .split: Rect 1200 × 720  (computed height 720px)
    .status-bar: top 692, height 28px, display flex
    Befund: shell-Unterkante 720 ≠ Boden 692

Das ist kein Zoom-Problem: die Shell lief bei **jeder** Stufe 28 Layout-Pixel
unter die Leiste — die letzten Karten der Übersicht lagen hinter ihr.
`e2e/specs/zoom-flaechen.spec.ts` („Übersicht: Fenster scrollt nie, die Shell
füllt das Fenster") war damit auf diesem Rechner **rot**, auch ohne meine
Änderung (Stichprobe: dasselbe Ergebnis mit zurückgesetzter Matrix).

## Ursache

`#app:has(.split) { height: calc(100dvh / var(--ui-zoom)); }` teilt die
Viewport-Höhe durch die Zoomstufe, zieht aber die Statusleiste **nicht** ab.
Die Leiste ist `position: fixed` und wird mitgezoomt, belegt also
`28px × ui-zoom` Device-Pixel. Richtig ist: erst dividieren, dann die Leiste
einmal abziehen — sonst endet die Shell am echten Fensterboden.

Zusätzlich: ein Abzug an `.split` selbst wirkt nicht, weil
`#app:has(.split) .split { flex: 1 1 auto; }` spezifischer ist und die Höhe als
Flex-Kind setzt. Der Abzug muss am **Container** stehen.

## Fix

* Neuer Token `--status-bar-h: 28px` (dokumentiert in `docs/design-system.md`),
  die Leiste nutzt ihn statt der harten 28 px.
* Ab 1280 px: `#app:has(.split)` und `.app-page:has(> .dashboard)` rechnen
  `calc(100dvh / var(--ui-zoom) - var(--status-bar-h))`.
* `SCALE_MIN` von 0.7 auf **0.5** — jetzt gefahrlos, weil die Garantie wieder
  hält. Der Hinweis in den Einstellungen nennt die Grenzen.

## Prüfung (rot → grün)

* `apps/pwa/test/app/ui-scale.test.ts`: Untergrenze zuerst rot
  (`expected 0.7 to be 0.5`), nach dem Fix **6 passed**.
* `e2e/specs/oberflaeche.spec.ts`: „Grenzen 50 % und 200 %" — **13 passed**.
* `e2e/specs/zoom-flaechen.spec.ts`: Matrix auf **fünf** Stufen erweitert
  (50/70/100/130/200 %) — vorher rot, jetzt **11 passed**; die gemessene
  Shell-Unterkante fällt exakt auf die Oberkante der Leiste.
* `npm run typecheck` Exit 0, `eslint` der geänderten Dateien 0 errors,
  `css-tokens` + `ui-scale` **20 passed** (Token in der Leiter, Breakpoint
  1280 px bereits dokumentiert).

## Umgebung

Windows 11, Chromium (Playwright), Viewport 1280 × 720, Übersicht-Route.

## Eingrenzung

Nur Desktop (ab 1280 px), wo es die Statusleiste gibt. Unter 1280 px bleibt die
bisherige Höhenberechnung unangetastet (`@media not all and (min-width: 1280px)`
in `21-icon-rail.css`).
