---
id: BUG-0233
slug: graph-dateiklick-ohne-viewer
status: done
severity: S2
area: pwa
instance: dev
commit: "40a5f239"
forge: "https://github.com/securesight-ai/AncientVoid/issues/221"
epic: ""
created: 2026-11-20
reporter: "Nutzer (Maki-Session)"
---

# BUG-0233 — Datei im Graph anklicken öffnet weder Viewer noch Dateibaum

## Gesehen

Klick auf einen Stern (Datei) in der Graph-Karte wählt die Datei nur aus;
Viewer/Editor öffnen erst über den zusätzlichen „Öffnen“-Knopf, und der
Dateibaum (PC/Tablet) bleibt zu.

## Erwartet

Anklicken einer Datei öffnet sie direkt im Viewer/Editor (Tab „Datei“), am
PC/Tablet zusätzlich den Dateibaum, sodass die Auswahl im Kontext des Repos
lesbar ist.

## Repro

Voraussetzung: Session mit Graph-Tab, Desktop-Breite ≥ 700 px.

1. Graph-Tab öffnen.
2. Auf einen Stern klicken.

**Ergebnis nach Schritt 2:** nur Auswahlmarkierung + Nachbarschaftsliste;
kein Viewer, kein Dateibaum.

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `40a5f239` |
| Node-Version | 22 |
| Adapter | beliebig |
| Repro-Weg | PWA |

## Logs

Keine.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/repo-graph.spec.ts` („Knoten-Klick öffnet die Datei im Datei-Tab") | grün — klickt zusätzlich „Datei öffnen“ |

## Eingrenzung

`apps/pwa/src/features/graph/GraphPane.tsx` — Klick führt nur
`selectPath()` aus; `onOpenFile` hängt an Enter/„Öffnen“. Der Dateibaum-Layer
(`openLayer("files")`, `shared/layers.ts`) wird nie ausgelöst.

## Befund

Der Stern-Klick lief nur in `selectPath()` — Viewer/Editor öffneten erst
über „Öffnen“/Enter, der Dateibaum gar nie. Fix: `openPath()` (Auswahl +
`onOpenFile`) am Stern-Klick (Canvas-Tap wie Hit-Knopf); SessionTail öffnet
bei ≥ 700 px zusätzlich den Dateibaum-Layer (`openLayer("files")`, gleiche
Grenze wie TABLET/WIDE). Browsing bleibt über Suche/Nachbarn/Pfeiltasten
ohne Öffnen. E2E rot-vor-grün (repo-graph direkt/Knoten-Klick + Dateibaum
am Desktop; repo-galaxie Auswahl-Setup auf Suche umgestellt).

## Handoff

- [ ] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen
