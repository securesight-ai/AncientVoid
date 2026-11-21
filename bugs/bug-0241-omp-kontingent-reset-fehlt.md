---
id: BUG-0241
slug: omp-kontingent-reset-fehlt
status: done
severity: S3
area: contracts, pwa
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/230"
epic: ""
created: 2026-11-20
reporter: "Nutzerbericht"
---

# BUG-0241 — Das ausgeschöpfte OMP-Kontingent verliert seine Reset-Zeit

## Gesehen

Der Provider meldete „429 已达到 5 小时的使用上限。您的限额将在 2026-11-21 06:34:19 重置。 (type=1308)“. Die gemeinsame Fehlerklassifizierung erkennt nur 429.

## Erwartet

Der Hub zeigt das 5-Stunden-Kontingent und die unveränderte Reset-Zeit des Providers.

## Repro

Die gemeldete Antwort durch die Provider-Fehlerklassifizierung und die Kontingentanzeige laufen lassen.

`packages/contracts/test/harness/provider-error.test.ts` reproduziert die bisherige Fehlklassifizierung anhand der Originalmeldung. `harness.spec.ts` prüft die Anzeige über einen ACP-Testharness.

## Tests

`packages/contracts/test/harness/provider-error.test.ts`

## Handoff

- [x] Datei im [Index](README.md)
- [x] GitHub-Issue
- [x] Fix lokal verifiziert
