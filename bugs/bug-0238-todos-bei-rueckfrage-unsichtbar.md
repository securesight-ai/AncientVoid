---
id: BUG-0238
slug: todos-bei-rueckfrage-unsichtbar
status: done
severity: S3
area: pwa
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/227"
epic: ""
created: 2026-11-20
reporter: "Nutzerbericht"
---

# BUG-0238 — Gemeldete To-dos verschwinden während einer Rückfrage

## Gesehen

Gemeldete Aufgaben fehlen in der Session-Ansicht während sie auf eine Antwort wartet.

## Erwartet

Die aktuelle gemeldete To-do-Liste bleibt beim Warten lesbar.

## Repro

Einen Zug mit einem Plan und anschließender strukturierter Frage öffnen.

`run-progress.test.ts` reproduzierte den Verlust in `waiting_approval`. `harness.spec.ts` bestätigt die sichtbare Aufgabenliste in der offenen Claude-Frage.

## Tests

`apps/pwa/test/features/session/run-progress.test.ts`

## Handoff

- [x] Datei im [Index](README.md)
- [x] GitHub-Issue
- [x] Fix lokal verifiziert
