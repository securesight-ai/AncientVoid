---
id: BUG-0236
slug: rueckfragen-fehlt-blau
status: done
severity: S3
area: pwa
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/225"
epic: ""
created: 2026-11-20
reporter: "Nutzerbericht"
---

# BUG-0236 — Rückfragen erscheinen mit Freigabefarbe

## Gesehen

Eine offene strukturierte Frage im Chat erscheint mit dem gelben Badge „Bestätigung“.

## Erwartet

Fragen im Chat und in der Freigabeliste haben ein blaues Frage-Badge.

## Repro

In einer Claude-Session FRAGE auslösen und die wartende Karte öffnen.

Der mobile Chromium-Test in `harness.spec.ts` fand die gelbe Karte. Mit blauem Badge läuft derselbe Fall bis zur gesendeten Antwort durch.

## Tests

`e2e/specs/harness.spec.ts`

## Handoff

- [x] Datei im [Index](README.md)
- [x] GitHub-Issue
- [x] Fix lokal verifiziert
