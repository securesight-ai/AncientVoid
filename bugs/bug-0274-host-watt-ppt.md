---
id: BUG-0274
slug: host-watt-ppt
status: done
severity: S3
area: core
instance: live
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/364"
epic: "EPIC-P81"
created: 2026-11-23
reporter: Agent (Bestandsaufnahme EPIC-P81)
---

# BUG-0274 — Host-Metriken: Watt fehlt, „System“ zeigt nur einen Host

## Gesehen

„GPU-Leistung“ steht auf jedem Host auf „nicht gemeldet“, obwohl `sensors` einen
Wert zeigt. Die Statistik-Sektion „System“ zeigt nur den ersten Hub-Host, auch wenn
der Report Peers enthält.

## Erwartet

Watt erscheint, wo der Kernel es meldet, und trägt den richtigen Namen: auf einer
gesteckten Karte die GPU, auf einer APU das CPU-Paket. Alle Hub-Hosts sind zu sehen.

## Repro

1. Host mit amdgpu, `aiMetrics.hostProbe: true`.
2. `#/statistik/metriken` öffnen und mit `sensors` (PPT) vergleichen.

**Ergebnis nach Schritt 2:** „nicht gemeldet“ statt rund 66 W.

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal |
| Commit | `fa40e4df` |
| Adapter | n/a (Sampler) |
| Repro-Weg | Unit-Test, Live-Vergleich |

## Logs

Keine.

## Tests

| Ring | Befund / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/core/test/aimetrics/sampler.test.ts` „BUG-0274“ (4 Fälle) | rot |
| E2E | `e2e/specs/statistik.spec.ts` „BUG-0274“ | rot |

Live auf omarchy: 10 Messungen, Abweichung zu `power1_input` unter 1 %. Der APU-Zweig
ist nur per Unit-Test belegt; die Dateien wurden auf beiden APUs lesend geprüft.

## Eingrenzung

`sampler.ts` las `device/power1_average`; der Wert liegt unter
`device/hwmon/hwmonN/power1_input`. `StatisticsPage.tsx` nahm per `find` nur die
erste Quelle.

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [x] `bugfix`
