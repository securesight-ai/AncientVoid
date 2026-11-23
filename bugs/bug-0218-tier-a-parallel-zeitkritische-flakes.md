---
id: BUG-0218
slug: tier-a-parallel-zeitkritische-flakes
status: done
severity: S3
area: tests
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/85"
epic: ""
created: 2026-11-18
reporter: "Windows-Tier-A-Läufe (Branch fix/e2e-stand-ins-windows)"
---

# BUG-0218 — Zeitkritische Flakes unter parallelem Tier A (handover, steer-wait-timeout, turn-state)

## Gesehen

Drei identische Läufe Tier A (parallel, 8 Forks) auf Windows — jeweils nur
in einem von drei Läufen rot, sonst grün; jedes Mal exakt
`112 failed | 2006 passed | 53 skipped` (36,3/35,2/35,3 s):

| Datei | Test | Läufe rot |
|---|---|---|
| `packages/core/test/modules/handover/handover.test.ts` | „startet die neue Session beim an…“ | 1 von 3 |
| `packages/core/test/modules/sessions/steer-wait-timeout.test.ts` | „Occupant-Pinning: ein vorgemerkte…“ | 1 von 3 |
| `packages/core/test/modules/sessions/turn-state.test.ts` | „a planned shutdown that keeps workers leaves sessions…“ | 1 von 3 |

120 der roten Identitäten sind deckungsgleich (Windows-Suite,
[BUG-0170](bug-0170-testsuite-auf-windows-rot.md)); diese drei sind die
einzigen, die ihre Identität zwischen den Läufen wechseln — verdächtig sind
Zeit-/Reihenfolge-Abhängigkeit, nicht Ports.

## Erwartet

Entweder deterministisch grün unter Parallelität, oder — wenn die Datei
wirklich Wanduhrzeit prüft — Umzug auf `scripts/slow-tests.json` (dann mit
gemessener Dauer im Commit).

## Repro

1. `npm run test:fast` auf Windows (paralleler Tier A, 8 Forks).
2. Dreimal wiederholen.

**Ergebnis nach Schritt 2:** je Lauf rotiert genau einer der drei Tests
(siehe Tabelle). **Häufigkeit:** 1 von 3 Läufen je Test (18.11.2026, Issue #85).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Windows-Entwicklungsrechner |
| Commit | Branch `fix/e2e-stand-ins-windows` |
| Node-Version | — |
| Adapter | — |
| Repro-Weg | `npm run test:fast` × 3 |

## Logs

Auszug in Gesehen (Zählungen je Lauf); vollständige Identitäten in Issue #85.

## Tests

| Ring | Befund / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `handover.test.ts`, `steer-wait-timeout.test.ts`, `turn-state.test.ts` | rotierend rot unter 8 Forks |

Historie: `vitest.config.ts` lief bis dahin mit `maxWorkers: 1` (Ersatz für
`singleFork`, BUG-0001/0002: zeitbasierte Tests seriell). Tier A fährt seit
dem 8 Forks (246 s → 36 s); Tier B bleibt seriell.

## Eingrenzung

`packages/core/test/modules/{handover,sessions}/` — Zeit-/Reihenfolge-
Abhängigkeit unter Parallelität; verwandt mit BUG-0170 (Windows-Suite) und
BUG-0217/#83 (Zeitrennen auf Hosted-Runnern).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue vorhanden ([#85](https://github.com/securesight-ai/AncientVoid/issues/85), SSOT nachgezogen EPIC-P71 T71.6)
- [x] `bugfix` oder offen lassen

## Fix (2026-11-23)

Linux-Stressreproduktion: die drei Dateien plus BUG-0217-Datei liefen 5× grün
(8 Forks) und im vollen `packages/core`-Lauf (16 Forks) grün — der Flake ist an
die Windows-/BUG-0170-Umgebung gebunden, nicht auf Linux reproduzierbar.
Slow-List entfällt (Dauern isoliert 0,9/1,1/3,0 s — Schwelle 10 s; der Commit
nennt die Messwerte). Gehärtet wurde die belegbare Einmalmess-Race:

- `turn-state.test.ts` „a planned shutdown …": `working` nach `create()` ist
  jetzt ein begrenztes `waitFor` statt einmaligem Lesen — unter Fork-Last kann
  die Working-Markierung noch anstehen.
- `activity-register.test.ts` (BUG-0217): Warten auf die Ereignisse statt auf
  den Status — dasselbe Muster, das `turn-state` Test 1 bereits nutzt
  („idle is set just before the turn_end event is written").
- `handover.test.ts` und `steer-wait-timeout.test.ts` unverändert: das Parken
  wird in `handover()` awaited; der Occupant-Pinning-Fall prüft eine negative
  Aussage in einem festen Fenster und skipt auf Hosted-Runnern.

Grün: sessions+handover 202/202 (8 Forks), 3× Stress 27/27, lint + typecheck.
