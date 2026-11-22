---
id: BUG-0259
slug: ralph-loop-review-workflow-fehlt
status: open
severity: S2
area: loops
instance: prod
commit: "2a7eab27"
forge: ""
epic: "EPIC-P54"
created: 2026-11-23
reporter: Nutzermeldung 22.11.2026 (Ralph-Skill erlaubt keine andere Adapter-Auswahl; Agent-Review und Heartbeat-Resume als Workflow fehlen)
---

# BUG-0259 — Ralph: keine freie Adapter-Wahl im Workflow, kein Agent-Review, kein Heartbeat

## Gesehen

1. Der registrierte Ralph-Loop am Live-Hub ist der **Hermes-Beobachter**
   (`@ancientvoid/loop-ralph` in `hub.config.json`) — Adapter/LLM sind auf
   Hermes festgenagelt; der hub-getriebene Connector `ralph-hub`
   (ADR-0110, Paket vorhanden) ist **nicht registriert** (kein Eintrag, keine
   Abhängigkeit in `apps/hub/package.json`).
2. Ein Ralph-Lauf verifiziert nicht per **Agent-Review in einer automatisch
   gestarteten Session**: `wartend` meldet sofort das Menschen-Gate, ohne
   zweite, in der PWA sichtbare Prüfsession.
3. Während eines Agenten-Turns gibt es **keinen Heartbeat** — ein hängender
   Turn ist unsichtbar; die Wiederaufnahme nach Unterbrechung zählt zwar
   Turns (Budget), hat aber kein liveliness-Signal.

## Erwartet

- Genau **ein** Ralph-Loop, als Workflow konfiguriert: `ralph-hub`, Adapter
  frei wählbar über `command` (jede promptbare CLI).
- Deterministische AC-Abarbeitung (State-Datei, Goal-Gate) **plus**
  Agent-Review in einer automatisch gestarteten Session (ADR-0113), die in
  der PWA als neue Session auftaucht; blockierte Review beendet den Lauf
  laut (Level 2).
- Heartbeat-Events während jedes Turns; Wiederaufnahme aus State-Datei +
  Session-Snapshot ohne Doppelarbeit (K7).

## Repro

Live-Hub + Code:

1. `hub.config.json` → `loops[]` enthält `ralph` (Beobachter), nicht
   `ralph-hub`; `apps/hub/package.json` hat keine Dep auf
   `@ancientvoid/loop-ralph-hub`.
2. `packages/loops/ralph-hub/src/index.ts` (Stand 2a7eab27): kein
   `loop.review`/`loop.heartbeat`, `LoopIo.startSession` existiert nicht im
   Contract.

**Ergebnis:** Ralph ohne freie Adapterwahl, ohne Review-Session, ohne Heartbeat.

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | prod (127.0.0.1:7373) |
| Commit | `2a7eab27` |
| Node-Version | 26.13.1 |
| Adapter | loop:ralph (Hermes-Beobachter) |
| Repro-Weg | hub.config.json / Code |

## Logs

Keine Fehler — fehlende Funktion/Registrierung.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/loops/ralph-hub/test/ralph-hub.test.ts` | 8 grün — keine Review-/Heartbeat-Fälle |
| Contract | `@ancientvoid/adapter-testkit` Loop-Suite | grün (bleibt grün) |

Rot-dann-grün (nachgewiesen via `git stash` der Fix-Dateien): 3 neue Fälle —
AC-Abarbeitung bis `wartend`, Review-Session (grün + blockiert), Heartbeat +
Resume ohne Doppelarbeit — ohne Fix rot, mit Fix 12/12 grün.

## Eingrenzung

Registrierung: `apps/hub/package.json` (Dep fehlt) + Live-`hub.config.json`
(Beobachter statt `ralph-hub`). Review: `LoopIo` ohne `startSession`
(packages/contracts/src/loops/connector.ts), ralph-hub ohne Review-Rolle.
Heartbeat: grind() ohne Intervall-Event.

## Handoff

- [ ] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen
