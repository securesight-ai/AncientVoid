---
id: BUG-0230
slug: graph-vollbild-ohne-schliessen
status: done
severity: S2
area: pwa
instance: dev
commit: "40a5f239"
forge: "https://github.com/securesight-ai/AncientVoid/issues/218"
epic: ""
created: 2026-11-20
reporter: "Nutzer (Maki-Session)"
---

# BUG-0230 — Graph-Vollbild am PC: kein erkennbarer Schließen-Button, Fläche ragt bei UI-Zoom über den Bildschirm

## Gesehen

Vollbild der Graph-Ansicht am PC zeigt als einzige Rückkehrmöglichkeit einen
nur mit „←“ beschrifteten Pfeil oben links; es ist nicht erkennbar, dass und
wie man zurückkommt. Bei erhöhtem UI-Zoom ragt die Vollbild-Fläche über den
Bildschirm hinaus.

## Erwartet

Vollbild hat einen klar beschrifteten, gut sichtbaren Schließen-Button
(„Vollbild verlassen“), der auf allen Geräten funktioniert; die Fläche bleibt
bei UI-Zoom im Bildschirm (Höhe durch `--ui-zoom` teilen, wie alle
Vollflächen der App).

## Repro

Voraussetzung: PWA am PC (Breite ≥ 700 px).

1. Session öffnen → Tab „Graph“.
2. „Vollbild“ klicken.
3. Schließen-Suche: nur „←“ oben links; mit UI-Zoom ≥ 1.2 ragt die Fläche unten aus dem Bildschirm.

**Ergebnis nach Schritt 3:** Rückweg unklar, Fläche bei Zoom zu groß.

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) / Tailscale |
| Commit | `40a5f239` |
| Node-Version | 22 |
| Adapter | beliebig |
| Repro-Weg | PWA |

## Logs

Keine — reiner Client-Defekt.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/repo-graph.spec.ts` („Vollbild verlassen ist beschriftet und führt zurück") | nicht vorhanden |

## Eingrenzung

`apps/pwa/src/features/graph/GraphPane.tsx:867` (Button-Inhalt nur „←“) und
`apps/pwa/src/app/styles/32-repo-graph.css:289` (`height: 100dvh` ohne
Division durch `--ui-zoom` — Muster siehe `02-layout.css`, BUG-0122-Familie).

## Befund

Der Vollbild-Exit bestand nur aus „←“ ohne Text (aria-label zwar vorhanden,
aber optisch nicht als Schließen erkennbar), und die Vollbild-Fläche nutzte
`height: 100dvh` ohne Division durch `--ui-zoom` — bei erhöhtem UI-Zoom ragt
sie unten aus dem Bildschirm. Fix: beschrifteter Knopf „✕ Vollbild
verlassen“ oben rechts (`.graph-fullclose`, über dem Hit-Overlay), Höhe wie
alle Vollflächen `calc(100dvh / var(--ui-zoom))`. E2E „Vollbild zeigt
beschrifteten Schließen-Knopf …“ rot-vor-grün belegt (mobile + desktop).

## Handoff

- [ ] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen
