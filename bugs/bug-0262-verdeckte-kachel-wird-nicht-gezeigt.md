---
id: BUG-0262
slug: verdeckte-kachel-wird-nicht-gezeigt
status: fixed
severity: S2
area: pwa
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/104"
epic: P34
created: 2026-11-23
reporter: Codex
---

# BUG-0262 — Verdeckte Kachel erscheint nach erneutem Öffnen nicht

## Gesehen und erwartet

Ein zuvor geöffnetes Werkzeug bleibt unsichtbar, wenn es nach einer
Rasterverkleinerung erneut aufgerufen wird. Im fixierten Layout soll es
mit der sichtbaren Fokus-Kachel tauschen. Deren Inhalt bleibt gespeichert.

## Repro

1. Eine Session im Desktop-Raster öffnen und zwei Kacheln wählen.
2. Einstellungen öffnen und ein Layout-Preset speichern.
3. Zur Session wechseln, eine Kachel wählen und Einstellungen erneut öffnen.

Auf Basis `50c6b179` bleibt das Preset im Browser unsichtbar. Der Unit-Test
reproduziert `focus: 1` bei genau einer sichtbaren Kachel. Der Browser-Test
`appearance-presets.spec.ts` scheitert beim Öffnen des gespeicherten Presets.

## Ursache und Prüfung

`openInNewTile` fokussierte vorhandene Werkzeugkarten direkt, auch hinter
dem fixierten Raster. Der korrigierte Pfad verwendet denselben Tausch wie
`focusOpenSession`. Der Unit-Test prüft die erhaltene Session und die
sichtbare Werkzeugkarte. Die Spezifikation prüft die Wiederherstellung des
Layouts samt Session im Browser.
