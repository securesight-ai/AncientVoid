---
id: BUG-0220
slug: activity-begin-herzschlag-flutet-eventstore
status: done
severity: S2
area: core
instance: dev
commit: "54762797"
forge: "https://github.com/securesight-ai/AncientVoid/issues/184"
created: 2026-11-19
reporter: Nutzer
---

# BUG-0220 — Wiederholte Running-Reports fluten den EventStore mit `session.activity_begin`

## Fix

Behoben: PR #185 (`6899e0dc`). Doku-Abschluss 2026-11-21 (Status-Nachzug).


## Gesehen

Session `9f4b32e1-af86-47f8-b0a7-6bbf9dafd1a6` (19.11.2026, Adapter oh-my-pi):
18.547 `session.activity_begin`-Events (6,8 MB JSONL) in ~70 Minuten. Ein
verklemmter Agentenprozess (1009 % CPU, reagierte weder auf SIGTERM noch
SIGINT) re-sendete denselben Tool-Call-Report (`tool:call_621cf8af…`)
alle 12–400 ms; **jeder** Report emittierte erneut `session.activity_begin`,
obwohl das Register die Aktivität längst führte — 103 eindeutige Aktivitäts-IDs
stehen 18.5k Begin-Events gegenüber. Die PWA-Ansicht der Session staut sich
(Tail klappt den halben Chat zu), WS-Traffic und JSONL wachsen sinnlos.

Dieselbe Duplikat-Emission passiert im Regelbetrieb bei jedem externen
Herzschlag: `hubctl activity run` meldet alle `ACTIVITY_HEARTBEAT_MS`
(20 s) erneut `running` → alle 20 s ein weiteres `activity_begin`-Event pro
laufendem Job, für die ganze Laufdauer.

## Erwartet

Ein Running-Report für eine Aktivität, die das Register bereits führt, ist ein
Herzschlag: `startedAt` wird aufgefrischt (TTL `EXTERNAL_ACTIVITY_TTL_MS`
90 s bleibt wirksam), aber es wird **kein** weiteres `session.activity_begin`
emittiert. Erst nachdem die Aktivität beendet wurde (`activity_end` löscht sie
aus dem Register) darf dieselbe ID erneut beginnen — Wiederbeginn nach Ende
bleibt möglich.

## Repro

Zwei Pfade, dieselbe Wurzel:

1. **Provider (Live-Fund):** verklemmter oh-my-pi-Prozess, siehe EventStore
   `data/sessions/9f4b32e1…/events.jsonl` ( Bursts 07:2x: 4.861, 08:2x:
   4.485 Events, ~80/s; danach `session.activity_end {orphaned:true}` ).
2. **Unit (deterministisch):** Adapter meldet in `start` dieselbe
   `running`-Aktivität (feste ID) dreimal; `manager.tail()` enthält danach
   drei `session.activity_begin` mit derselben Payload-ID — erwartet: eins.
   Analog extern: `POST /api/sessions/:id/activity` zweimal `running`.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `54762797` (Stand des Live-Funds; Code unverändert seit ADR-0076) |
| Node-Version | 26 |
| Adapter | oh-my-pi (Provider-Pfad), hubctl (externer Pfad) |
| Repro-Weg | EventStore + Unit-Test |

## Ursache

`packages/core/src/modules/sessions/session-activity.ts:26-31` — `record()`
behandelt jeden `running`-Report wie einen Beginn: `session.activities.set`
(idempotent, deshalb bleibt das Register klein) **plus** bedingungsloses
`host.emit(session, "session.activity_begin", …)`. Der Herzschlag-/Wedged-
Fall führt kein eigenes Event-Modell.

## Fix-Richtung

In `record()` für `state === "running"`: ist die ID bereits im Register,
Eintrag aktualisieren (`startedAt`/`label` auffrischen — TTL weiterlaufen
lassen) und vor dem Emit zurückkehren. Kein Contract-Bruch: `ActivityReport`
bleibt, das Register bleibt, nur das Event-Duplikat verschwindet.

## Testlücke

Kein Test prüft die Event-Multiplizität wiederholter Running-Reports —
`activity-register.test.ts` prüft nur Anwesenheit (`toContain`) von
`session.activity_begin`.
