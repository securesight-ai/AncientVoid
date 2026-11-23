---
id: BUG-0278
slug: halogen-live-daten-fehlen
status: fixed
severity: S3
area: server
instance: live
commit: "58b43d75"
forge: "https://github.com/securesight-ai/AncientVoid/issues/391"
epic: "EPIC-P59"
created: 2026-11-23
reporter: "Nutzer"
---

# BUG-0278 — Metrik-Reiter zeigt laufende Halogen-Anfragen nicht

## Gesehen

Während der Arbeit mit dem Halogen-Modell stehen Warteschlange, Bearbeitung und busy auf 0; Token-Tempo fehlt ganz.

## Erwartet

Laufende und gerade beendete Anfragen sind mit Tempo und Alter sichtbar.

## Repro

1. `aiMetrics.servers[].url` zeigt auf ein Gateway, das `/metrics` mit 404 beantwortet.
2. Anfragen von 1–6 s stellen, Statistik → Metrik ansehen.

**Ergebnis:** überwiegend 0, kein Tempo. **Häufigkeit:** fast immer.

## Logs

```text
22:49:24Z serve_api: mtp 270 tok in 4.50s = 60.05 t/s   (Engine)
Gateway: GET /metrics 404, GET /health 200 alle 10 s     (Hub)
```

## Eingrenzung

`packages/core/src/modules/aimetrics/sampler.ts`: `/health` ist eine Momentaufnahme im 10-s-Takt. Außerdem hieß
die Decode-Zeit-Familie falsch, und nach einem Engine-Neustart entstand eine negative Rate.

## Fix

Optional `metricsUrl` (Zähler), `/health` zusätzlich, Tempo je gerechneter Sekunde aus Zählern (ADR-0078 Nachtrag).

## Tests

`packages/core/test/aimetrics/halogen.test.ts` „BUG-0278“: drei Fälle, ohne Fix rot.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue #391
