---
id: BUG-0289
slug: leseflaeche-in-kacheln-auf-48-pixelt
status: open
severity: S2
area: pwa
instance: dev
commit: "5aab9b8a"
forge: ""
epic: ""
created: 2026-11-26
reporter: "eigene Nachschau (agent-browser, 1280 × 633)"
---

# BUG-0289 — In niedrigen Fenstern und Kacheln schrumpft die Lesefläche auf 48 px

Anknüpfung: BUG-0288 (Denk-Strom im Verlauf-Reiter). Dessen Fix ist ausgeliefert und
gemessen — **aber** in einem niedrigen Desktop-Fenster bleibt für den Schwanz nur ein
48-px-Streifen, deshalb sieht der Nutzer den Strom dort trotzdem nicht. Diese Akte ist der
restliche, visuelle Teil desselben Nutzerfundes.

## Gesehen

Desktop-Fenster **1280 × 633**, Raster-Layout `layout-2v`, eine Sitzung als fokussierte
Kachel. Der Verlauf zeigt oben zwei Zeilen, dann abgeschnittener Inhalt („TODAY“ halb
durchtrennt, darunter ein ▾), sonst überall schwarze Leere; der Denk-Strom wächst im DOM,
ist aber nicht sichtbar. Screenshot der Nachschau:
`/home/kaib/.agent-browser/tmp/screenshots/screenshot-1795678255607.png`.

## Messung (deployter Stand `5aab9b8a`, Bundle `index-CeBE9rCF.js`)

| Größe | Wert |
|---|---|
| Viewport | 1280 × 633 |
| Kachel `.tile` | 502 px |
| `.session-live` | 532 px |
| `.topbar.session-topbar` | **163 px** |
| `button.ui-chip.new-jump` | 29 px |
| `.run-strip` | **101 px** |
| **`.tail-scroll`** | **48 px** (`scrollHeight` 64 432 px) |
| `.dock-stack` | **230 px** |

Die Summe der Bausteine (163 + 29 + 101 + 48 + 230 = 571) übersteigt `.session-live`
(532 px) — der Schwanz wird also nicht nur klein gerechnet, der Inhalt läuft auch über die
Kachel hinaus (`.tile:has(.tail-scroll)` hat `overflow: hidden`, daher das angeschnittene
„TODAY“).

## Ursache

Die Höhe des Schwanzes wird gemessen, nicht geflext
(`SessionTail.tsx:979`, gesetzt in `SessionTail.tsx:2349`):

```
available = Kachelunten − Schwanzoben − Dockhöhe − 8
setTailMaxHeight(Math.max(48, Math.floor(available)))   // BUG-0053: nie über das freie Maß
```

Bei 502 px Kachelhöhe und 523 px verbrauchter Chrome (topbar + run-strip + new-jump + dock)
ist `available` **negativ** (≈ −29 px); die Klammer `Math.max(48, …)` rettet mit einem
48-px-Minimum. Die Messung lügt nicht — sie verteilt nur Resthöhe, und der Rest ist
aufgefressen: die Topbar-2. Zeile trägt in der Kachel nur ein einzelnes „✕“, die
Laufleiste steht in drei Zeilen, unter dem Eingabefeld liegt eine weitere Knopfreihe
(„Überwachen / Debuggen“). Nichts davon gibt in niedrigen Fenstern Platz nach.

## Erwartet

Die Lesefläche bekommt in niedrigen Fenstern und Kacheln den verfügbaren Raum; die Chrome
(Topbar-Zweiteiler, Laufleiste, Knopfzeiten) gibt nach — sichtbar mindestens ~1/3 der
Kachelhöhe, nie ein 48-px-Streifen.

## Repro

1. Fenster auf 1280 × 633 (oder jede Höhe ≤ ~700 px), Raster `layout-2v`.
2. Eine Sitzung öffnen, im Verlauf-Reiter `eval`:
   `document.querySelector('.tail-scroll').clientHeight` → 48;
   `getComputedStyle(…).maxHeight` → `calc(48px / var(--ui-zoom, 1))`.

**Häufigkeit:** in diesem Layout immer (in zwei unabhängigen Lasts gemessen, Chat wie
Verlauf — der Streifen ist derselbe Container).

## Tests

Ring 0: kein Test für die Height-Messung; `SessionTail.tsx:979` ist ungetestet. Ein Fall
„Chrome > Kachelhöhe“ fehlt völlig — deshalb ist das 48-px-Minimum nie aufgefallen.

## Eingrenzung

pwa/CSS + Messroutine. Zwei getrennte Hebel, beide nötig:

1. **Chrome verkleinern, bevor der Schwanz leidet** — Topbar-Zeile 2 (einzelnes „✕“) in
   Zeile 1 ziehen, Laufleiste auf zwei Zeilen begrenzen, „Überwachen / Debuggen“-Zeile in
   das ⋯-Menü der Kachel verlegen (nur in Kacheln/niedrigen Fenstern).
2. **Messung absichern** — `available` darf nie negativ in die Klammer laufen; stattdessen
   Dock/Chrome nach Maßgabe nachziehen oder mindestens `max(200, …)` mit scrollendem Dock.

Vermutlich betroffen, noch zu messen: `50-short-viewport.css` (Media Queries ab niedriger
Höhe) und `layout-3*`/`layout-2v` nebeneinander — bei drei Spalten ist jede Kachel noch
kürzer.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen
