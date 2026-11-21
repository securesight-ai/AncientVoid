---
id: BUG-0242
slug: harness-metadaten-fehlen
status: done
severity: S3
area: adapters, pwa
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/231"
epic: ""
created: 2026-11-20
reporter: "Nutzerbericht"
---

# BUG-0242 — Native ACP-Kontextmeldung wird verworfen

## Gesehen

Je nach Adapter fehlen weitere Metadaten. Betroffene Felder und Adapter wurden im Nutzerbericht nicht genannt.

## Erwartet

Pro Harness sind die tatsächlich gemeldeten Metadaten sichtbar. Eine fehlende Quelle ist als solche erkennbar.

## Repro

Repo-Adaptermatrix mit den dokumentierten Provider-Signalen abgleichen und pro fehlendem Feld eine Fixture nachweisen.

Konkret reproduziert: Der ACP-Mapper verwirft `sessionUpdate: "usage_update"` mit `used` und `size`. Die PWA zeigt in der Folge nur den Katalogwert und die kumulierte Zugstatistik. Weitere vermisste Felder brauchen einen konkreten Adapter und ein belegtes Signal.

## Tests

`e2e/specs/harness.spec.ts` und `apps/pwa/test/features/session/run-stats.test.ts`

## Handoff

- [x] Datei im [Index](README.md)
- [x] GitHub-Issue
- [x] Fix lokal verifiziert
