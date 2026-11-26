---
id: BUG-0291
slug: neue-session-form-belegt-kachel-bleibt
status: done
area: pwa
instance: dev
commit: "8fc4f7f8"
forge: "https://github.com/securesight-ai/AncientVoid/issues/455"
epic: ""
created: 2026-11-26
reporter: "Nutzer (mündlich, PC)"
---

# BUG-0291 — „Neue Session“ am PC belegt eine Kachel, verzieht das Raster und bleibt nach dem Start stehen

## Gesehen

Am PC (und Tablet, ≥ 700 px) öffnet das Dock-Ziel „Neue Session“ das Formular
als **Kachel 1 im Arbeitsplatz-Raster** (BUG-0244: `openInTile(…, 0)`) statt
als überlagerndes Modal. Die belegte Kachel verschiebt eine dort laufende
Session sichtbar weg („verzieht das Layout“), und nach „Starten“ bleibt das
Formular in der Kachel stehen, wenn eine freie sichtbare Kachel existiert —
es schließt sich nicht von selbst. Nutzerzitat (26.11.2026): „wenn ich eine
neue Session erstellen möchte, wird eine Card belegt. Und das verzieht das
Layout irgendwie. […] wenn die Session gestartet wird, [soll es] sich auch
von alleine wieder schließen. Das ist gerade auch nicht [so].“

## Erwartet

„Neue Session“ liegt am PC/Tablet als zentriertes Modal über allem (Raster
bleibt unangetastet), und beim Start der Session schließt es sich von
selbst (Hash springt auf die Session). Am Handy bleibt der Seiten-Flow wie
er ist.

## Repro

E2E-Hub (Playwright, Viewport 1440×900, Wegwurf-Spec nach Rezept
`layout-beweis`), Commit 8fc4f7f8 — Messung über `localStorage`-Workspace
und Kachel-Rechtecke:

1. `hub.createSession(adapter: "dummy")`, Workspace per localStorage auf
   `2x2` mit genau einer laufenden Session in Kachel 1 gesetzt, Reload.
2. Dock „Neue Session“ klicken.
   **Ergebnis:** Session-Kachel wandert von Quadrant 1 (x=508) nach Quadrant
   2 (x=983), Slots `[Neu-Form, Session]` — das Raster verschiebt sich.
   Im Layout „Eine Kachel“ wird die laufende Session sogar komplett aus der
   sichtbaren Fläche gedrängt (Slots `[Neu-Form, Session]`, sichtbar nur
   Kachel 1 = Formular).
3. „Starten“ klicken (Projekt vorgewählt).
   **Ergebnis nach 6 s:** neue Session läuft in Kachel 3, aber die Formular-
   Kachel steht noch: Slots `[Neu-Form, Session, Neue Session]`,
   `form: true` in Kachel 1 — das Formular schließt sich nicht von selbst.

**Häufigkeit:** immer (am PC/Tablet mit freier sichtbarer Kachel; im
Layout „1“ wird das Formular beim Start zwar ersetzt, die verdrängte
Session bleibt aber unsichtbar).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | E2E-Hub (127.0.0.1, Playwright) |
| Commit | `8fc4f7f8` |
| Node-Version | 25 (Node strip-types) |
| Adapter | dummy |
| Repro-Weg | PWA (Playwright) |

## Logs

Keine Hub-Log-Zeilen betroffen (rein clientseitiger Zustand); Beleg sind
die gemessenen Workspace-Slots/Kachel-Rechtecke oben.

## Tests

| Ring | Befund / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/pwa/test/features/workspace/tiles.test.ts` (BUG-0244-Block) | grün — pinnt das falsche Verhalten fest |
| E2E | `e2e/specs/tool-pane.spec.ts` („Auch Neu bleibt erreichbar“, Z. 29–32) | grün — erwartet 5. Tool-Kachel mit „Starten“ |

Rot ohne Fix müsste: eine Spec, die am Desktop „Neue Session“ öffnet und
(1) keine neue Kachel, (2) das Modal über dem Raster und (3) dessen
Selbst-Schließen nach „Starten“ verlangt (Update von `tool-pane.spec.ts`).

## Eingrenzung

`apps/pwa/src/app/main.tsx:519–523` — Layout-Effekt pinnt `#/neu` per
`openInTile(current, ref, 0)` in Kachel 1 (BUG-0244); das Formular bleibt
danach ein normaler Kachelinhalt (`ToolPane`, `features/shell/ToolPane.tsx:107`)
ohne Selbst-Schließen. Beobachtung teilt sich eine Ursache: „Neue Session“
ist ein Kachelinhalt statt ein Route-getriebenes Modal.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt: [#455](https://github.com/securesight-ai/AncientVoid/issues/455)
- [x] `bugfix` läuft (Fix: Modal statt Kachel) — erledigt: Modal + Selbst-Schließen, verifiziert (s. Tests)
