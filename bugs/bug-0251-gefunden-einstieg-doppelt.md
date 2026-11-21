---
id: BUG-0251
slug: gefunden-einstieg-doppelt
status: done
severity: S4
area: pwa
instance: dev
commit: "019aa5da"
forge: "https://github.com/securesight-ai/AncientVoid/issues/253"
epic: ""
created: 2026-11-21
reporter: nutzer
---

# BUG-0251 — „Gefunden“-Einstieg doppelt in der Übersicht

## Gesehen

Die Übersicht zeigt den Einstieg zu den gefundenen (entdeckten) Sessions
zweimal: als vierten Tab „Gefunden“ im Ansichts-Umschalter und als Chip in
der Zusammenfassungszeile der Session-Ansicht. Nutzermeldung 2026-11-21:
Es soll genau einer sein, rechts neben dem Aktiv/Archiv-Button.

## Erwartet

Genau ein „Gefunden“-Einstieg: der Chip rechts vom Archiv-Button der
Session-Ansicht. Der Deeplink `#/gefunden` bleibt erhalten.

## Repro

Nutzermeldung (PWA, Übersicht): zwei sichtbare „Gefunden“-Bedienelemente
übereinander (Umschalter-Zeile + Zusammenfassungszeile).

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal |
| Commit | `019aa5da` |
| Adapter | — |
| Repro-Weg | PWA (Nutzermeldung) |

## Logs

—

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/overview-shell.spec.ts:104` | grün (deckte den Doppelbestand nicht ab) |

Der Fix pinst den Einzelbestand: Tabliste ohne „Gefunden“ (count 0),
Chip klickbar, Hash-Deeplink bleibt.

## Eingrenzung

`apps/pwa/src/features/overview/Dashboard.tsx` — `VIEWS` enthielt
`discovery` als vierten Tab, zusätzlich zum Summary-Chip (EPIC-P47 T47.5
hatte den State eingeführt, den Tab aber nie entfernt).

## Fix

Vierter Tab „Gefunden“ aus `VIEWS` entfernt; Chip rechts neben Archiv und
Deeplink `#/gefunden` bleiben (Commit `30be05d7` / Closes #253).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue [#253](https://github.com/securesight-ai/AncientVoid/issues/253)
- [x] `bugfix`
