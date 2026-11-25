---
id: BUG-0286
slug: vormerkung-geraet-in-laufenden-zug
status: done
severity: S2
area: core
instance: dev
commit: ""
forge: ""
epic: "P82"
created: 2026-11-25
reporter: "EPIC-P82 Abschlussprüfung (volle E2E-Suite)"
---

# BUG-0286 — Vorgemerktes kann unter Last in einen laufenden Zug geraten

## Gesehen

Unter CPU-/I/O-Last sendet der Drain eine Vormerkung in den Zug, der während des Drains begann.

## Erwartet

Eine Vormerkung wartet auf das Ende dieses Zugs (Occupant-Pinning, EPIC-P17 T17.4).

## Repro

24 Rechenlast-Prozesse, `steer-wait-timeout.test.ts` zwölfmal: 1 von 12 rot — vor und nach dem P82-Schnitt gleich.

## Tests

`packages/core/test/modules/sessions/steer-wait-timeout.test.ts` „BUG-0286“ verzögert das Journal: ohne Fix rot, mit Fix grün.
Unter derselben Last danach 0 von 10 rot.

## Eingrenzung

`turn("working")` setzt den Status erst nach Journal-I/O in `session.lifecycle`; `drainSlot` wartete nur einen Macrotask
(BUG-0163). Jetzt wartet er auf die Kette. `SessionActivities.report()` vergiftete die Kette bei einem Fehler.
