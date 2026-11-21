---
id: BUG-0240
slug: kontextfenster-nativ-fehlt
status: done
severity: S3
area: adapters, pwa
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/229"
epic: ""
created: 2026-11-20
reporter: "Nutzerbericht"
---

# BUG-0240 — Gemeldete Kontextfenster von Codex und Claude fehlen

## Gesehen

Einige Sessions zeigen Kontext in Token, aber keinen Prozentwert, auch wenn das Harness die Fenstergröße meldet.

## Erwartet

Die Kontextanzeige verwendet die Fenstergröße des aktiven Modells und sagt, welche Werte fehlen.

## Repro

Eine Codex-App-Server-Session bzw. Claude-Session mit einer nativen Fensterangabe öffnen.

Claude liefert die Werte in `modelUsage`, Codex im App-Server-Feld `modelContextWindow`. Die kleineren Regressionstests und `harness.spec.ts` prüfen die verwendeten Kontextzahlen.

## Tests

`e2e/specs/harness.spec.ts`

## Handoff

- [x] Datei im [Index](README.md)
- [x] GitHub-Issue
- [x] Fix lokal verifiziert
