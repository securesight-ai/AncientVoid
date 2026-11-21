---
id: BUG-0229
slug: graph-pan-touch-blockiert
status: done
severity: S1
area: pwa
instance: dev
commit: "40a5f239"
forge: "https://github.com/securesight-ai/AncientVoid/issues/217"
epic: ""
created: 2026-11-20
reporter: "Nutzer (Maki-Session)"
---

# BUG-0229 — Repo-Graph: Pan und Tap gehen nicht (Maus wie Touch)

## Gesehen

In der Repo-Graph-Ansicht lässt sich die Galaxie mit Maus oder Finger weder
verschieben noch per Klick leerer Fläche erkunden; Zoom geht nur mit dem Mausrad.

## Erwartet

Ziehen verschiebt die Karte (Maus wie 1-Finger-Touch), Tippen/Klicken auf
Sterne wählt sie aus, Zoomen funktioniert.

## Repro

Voraussetzung: Hub läuft, Session mit Projekt, Repo-Graph-Tab geöffnet.

1. Graph-Tab öffnen (`#/sessions/<id>/graph`).
2. Mit der Maus auf freie Fläche zwischen den Sternen drücken und ziehen.
3. Dasselbe am Handy mit dem Finger.

**Ergebnis nach Schritt 2/3:** Karte bewegt sich nicht.

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

Keine Server-Beteiligung — reiner Client-Defekt.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/repo-graph.spec.ts` („Pan verschiebt die Karte") | nicht vorhanden |

## Eingrenzung

`apps/pwa/src/app/styles/32-repo-graph.css:133` — `.graph-node-hits` liegt als
flächeiges Overlay über dem Canvas, ohne `pointer-events: none`; die
Pointer-Handler hängen am Canvas (`GraphPane.tsx` `onPointerDown`), der das
Overlay nie durchlässt. Pinch-Zoom ist gar nicht implementiert (nur `onWheel`).

## Befund

`GraphPane.tsx` hängte die Pointer-Handler an den Canvas; über ihm lag
`.graph-node-hits` (inset: 0, ohne `pointer-events: none`) und fing jedes
down/move/up ab — Pan und Tap kamen nie an. Fix: Handler am `.graph-wrap`
(Event-Bubbling), Overlay lässt Events durch, nur die Treffer-Knöpfe
empfangen selbst; ihr Klick ist nach einem Pan unterdrückt
(`suppressClickRef`), `touch-action: none` liegt jetzt auf dem Wrap.
E2E „Ziehen am Stern verschiebt die Karte …“ rot-vor-grün belegt.

## Handoff

- [ ] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen
