---
id: BUG-0239
slug: hintergrundaufgaben-ohne-details
status: done
severity: S3
area: pwa
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/228"
epic: ""
created: 2026-11-20
reporter: "Nutzerbericht"
---

# BUG-0239 — Hintergrundaufgaben werden nur gezählt

## Gesehen

Der Chat zeigt zu Hintergrundaktivitäten nur einen Zähler. Gemeldete Namen und Startzeiten fehlen.

## Erwartet

Aktive Hintergrundaufgaben mit Namen und Startzeit sind im Chat sichtbar.

## Repro

Zwei Hintergrundjobs mit verschiedenen Bezeichnungen melden und die Session öffnen.

`session-robustheit.spec.ts` reproduzierte die fehlenden Namen in Chromium. Der Test prüft inzwischen zusätzlich, dass belegte Jobs beim Abschluss aus der Liste verschwinden.

## Tests

`e2e/specs/session-robustheit.spec.ts`

## Handoff

- [x] Datei im [Index](README.md)
- [x] GitHub-Issue
- [x] Fix lokal verifiziert
