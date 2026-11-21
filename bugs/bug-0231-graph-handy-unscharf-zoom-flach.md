---
id: BUG-0231
slug: graph-handy-unscharf-zoom-flach
status: done
severity: S2
area: pwa
instance: dev
commit: "40a5f239"
forge: "https://github.com/securesight-ai/AncientVoid/issues/219"
epic: ""
created: 2026-11-20
reporter: "Nutzer (Maki-Session)"
---

# BUG-0231 — Repo-Graph am Handy unscharf, Zoomgrenze zu flach

## Gesehen

Am Handy wirkt die Graph-Karte unscharf, und tiefer hineinzoomen als eine
ganze Galaxie-Nahaufnahme ist nicht möglich (Skalenzwilling 8); Pinch-Zoom
fehlt komplett.

## Erwartet

Die Karte wird in Gerätepixelauflösung gerendert (auch bei aktivem UI-Zoom),
und man kann weit hineinzoomen — Pinch mit zwei Fingern eingeschlossen.

## Repro

Voraussetzung: PWA am Handy (oder DevTools-Geräteemulation mit dpr ≥ 2).

1. Graph-Tab öffnen (startet am Handy direkt im Vollbild).
2. Sterne besichtigen: Konturen/Grafik wirken matschig.
3. Pinch-Zoom versuchen; Maßstab stoppt bei `SCALE_MAX = 8`.

**Ergebnis nach Schritt 2/3:** unscharfe Darstellung, kein ausreichender Zoom.

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
| Unit | `apps/pwa/test/features/graph/galaxy-view.test.ts` | grün (kennt nur Grenze 8) |

## Eingrenzung

`apps/pwa/src/features/graph/GraphPane.tsx:237` — Backing-Store nur
`devicePixelRatio`, ohne den UI-Zoom-Faktor (`--ui-zoom` skaliert via
`root.style.zoom`, `ui-scale.ts:36`); kein Re-Render bei
`ancientvoid:scale`. `galaxy-view.ts:13` — `SCALE_MAX = 8` zu flach für
„bis zur Datei zoomen“. Pinch-Handling existiert nicht (nur `onWheel`).

## Befund

Drei Ursachen: (1) Backing-Store nur nach `devicePixelRatio` bemessen — der
UI-Zoom (`root.style.zoom`) vergrößert die gezeichnete Fläche, ohne dass der
Canvas mitwächst; kein Re-Render bei `ancientvoid:scale`. (2) `SCALE_MAX = 8`
zu flach für „bis zur Datei zoomen“. (3) Pinch-Geste gar nicht implementiert
(nur Mausrad). Fix: `backingScale(dpr, uiZoom)` (gedeckelt bei 6) +
Scale-Listener, `SCALE_MAX = 32`, `pinchStep()` über die Pointer-Map am Wrap
(zwei Finger: Zoom um den Mittelpunkt plus Schwenk); Hit-Flächen auf 120 px
gedeckelt, damit tiefer Zoom keine Riesen-Knöpfe überlagert. Unit-Tests rot
ohne Fix (Import + `SCALE_MAX >= 24`).

## Handoff

- [ ] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen
