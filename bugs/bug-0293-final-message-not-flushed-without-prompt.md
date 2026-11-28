---
id: BUG-0293
slug: final-message-not-flushed-without-prompt
status: open
severity: S2
area: adapter
instance: dev
commit: "a5557f2e"
forge: "https://github.com/securesight-ai/AncientVoid/issues/475"
epic: ""
created: 2026-11-28
reporter: "pc (PWA); verifiziert am EventStore + Worker-Log"
---

# BUG-0293 — Zug-Abschlussnachricht ohne Tool-Call erreicht den EventStore erst mit dem nächsten Prompt

## Gesehen

Die finale Agent-Nachricht eines Zugs (kein Tool-Call mehr danach) erscheint
nicht im Chat, obwohl der Zug laut `session.turn_end` als beendet gilt — sie
kommt erst mit der **nächsten** Nutzernachricht nach (im Live-Fall 2 h 07 min
später, dann als erste Nachricht des neuen Zugs).

## Erwartet

Jede Agent-Nachricht erreicht den EventStore (und damit PWA/`hubctl tail`)
innerhalb der Live-Flush-Latenz (~`LIVE_FLUSH_MS`), unabhängig davon, ob der
Zug über einen ausstehenden Hub-`session/prompt` läuft oder harness-getrieben
fortgesetzt wird (Hintergrund-Task-Ergebnis, Nacharbeit nach Gate-Antwort).

## Repro

Voraussetzung: Hub lokal, ACP-Adapter (opencode im ACP-Modus), Session mit
Hintergrund-Shell-Task.

1. Nutzernachricht senden. Agent arbeitet mit Tool-Calls; ein Tool wird im
   Hintergrund gestartet; der ACP-Zug endet (`end_turn`, `main_turn_end`) mit
   einer reinen Textnachricht (Warten auf das Hintergrund-Ergebnis).
2. Das Hintergrund-Ergebnis trifft ein und setzt die Konversation im Agenten
   fort — **ohne** neuen Hub-`session/prompt` und ohne `session.steer`.
3. Agent arbeitet mit mehreren Tool-Call-Runden weiter.
4. Agent beendet den Zug mit einer Textnachricht **ohne** nachfolgenden
   Tool-Call.
5. Chat in der PWA beobachten.

**Ergebnis nach Schritt 5:** Letzte sichtbare Nachricht ist die vor dem
letzten Tool-Call (Schritt-3-Runde), die Abschlussnachricht fehlt; Status
„Zug beendet — wartet auf dich". Erst die nächste Nutzernachricht (Schritt
einer neuen Session-Runde) spült die alte Nachricht vor dem neuen Zug-Inhalt
heraus.

**Häufigkeit:** immer unter diesen Bedingungen (mechanisch deterministisch;
Live-Fund 2026-11-28, Session-Zug um 10:30 UTC, Nutzermeldung „keine saubere
letzte Nachricht im Chat").

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (systemd-User-Service) |
| Commit | `ae50cbd9` |
| Node-Version | 26.7.0 |
| Adapter | acp (opencode 2.4.2, ACP) |
| Repro-Weg | PWA (Nutzersicht) + EventStore/Worker-Log-Verifikation |

## Logs

UTC; EventStore `data/sessions/<id>/events.jsonl`, Worker-Rohstrom
`data/workers/<session>.log`. Session-IDs gekürzt.

```text
EventStore — Zug um 10:30 UTC:
seq=351 10:30:10 assistant  "Jetzt konfiguriere ich das Checkpoint-Ziel im Repo …"
seq=352 10:30:10 system     session.activity_begin (tool, source: provider)
seq=353 10:30:11 tool_use   shell
seq=355 10:30:11 tool_result
seq=356 10:30:11 system     session.activity_end {code: 0}
seq=357 10:30:11 system     session.turn_end {code: 0}          ← Zug gilt als beendet
seq=358 10:30:17 thinking   "Checkpoint remote is configured. Now I need …"
                       ← Thinking NACH turn_end; Finalnachricht: NICHT DA
— Lücke: 2 h 07 min ohne Events —
seq=362 12:37:08 user       session.prompt (nächste Nutzernachricht)
seq=363 12:37:08 system     session.main_turn_start
seq=365 12:37:10 assistant  "Checkpoint-Ziel steht. Jetzt brauche ich nur noch …"
                       ← die „verschwundene" Nachricht, 2 h 07 min nach Entstehung
```

```text
Worker-Log (ACP-Rohstrom) — vollständig, das Gegenteil des EventStore:
Zeile 2449–2478  agent_thought_chunk  msg_221b49…:reasoning:0   (Thinking)
Zeile 2479–2515  agent_message_chunk  msg_221b49…               (37 Chunks der Finalnachricht)
Zeile 2516       agent_thought_chunk  msg_22228d…               (nächster Nutzer-Zug)
```

Zwischen Log-Zeile 2515 und 2516 existiert **kein** Zugende-Signal: ACP
meldet ein Zugende nur über die Antwort auf `session/prompt` — und es stand
kein Hub-Prompt aus. Seq 358 (Thinking) kam uniquement durch den ersten
`agent_message_chunk` (mapper-interner Flush des Thought-Puffers), der
Text-Puffer selbst hatte danach keinen Trigger mehr.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/adapters/acp/test/normalize.test.ts` | grün — deckt `map()`-Pufferung + explizites `flush()` ab, nicht die Trigger-Lage |
| Contract (`adapter-testkit`) | `packages/adapters/acp/test/adapter.test.ts` („BUG-0033: buffered chunks go out live while the turn runs") | grün — Live-Flush nur mit ausstehendem Hub-Prompt (`start` → `session/prompt`) geprüft |

Ohne Fix rot sein müsste: ein Test, dessen Update-Strom **ohne** ausstehenden
`session/prompt` läuft (harness-getriebene Fortsetzung — Updates direkt über
die Notification-Schiene) und mit `agent_message_chunk` endet; die Nachricht
muss trotzdem innerhalb `LIVE_FLUSH_MS` + Toleranz bei `ctx.emit` ankommen.
Vorschlag: Erweiterung `adapter.test.ts` (Fake-Agent-Skript), Updates nach
Zugende ohne Prompt-Antwort.

## Eingrenzung

- `packages/adapters/acp/src/normalize.ts` — `UpdateMapper.map()`:
  `agent_message_chunk` akkumuliert still (Rückgabe `[]`).
- `packages/adapters/acp/src/index.ts` — Flush-Trigger: (a)
  `tool_call`/`tool_call_update`, (b) `liveFlush`-Intervall nur bei
  `state.turnSeq === seq && state.busy` — `busy` ist nur gesetzt, solange ein
  Hub-`session/prompt` aussteht —, (c) Prompt-Resolution, (d) Stop/Cancel.
  Harness-getriebene Fortsetzungen (Hintergrund-Ergebnisse, Weiterarbeit nach
  Gate-Antwort, alles nach `main_turn_end`) haben keinen ausstehenden Prompt
  → (b)/(c) entfallen. Ein Zug-Abschluss ohne Tool-Call hat danach **null**
  Trigger; der Puffer überlebt bis zum nächsten beliebigen Trigger.
- Verstärkend (eigenes Folge-Ticket wert): `packages/core/src/modules/sessions/session-activity.ts`
  `closeIfLast()` setzt `session.turn_end` beim Ende der letzten
  Tool-Aktivität, während das Modell die Abschlussnachricht noch komponiert
  (seq 357 vor seq 358) — die PWA zeigt „wartet auf dich", bevor die
  (dann fehlende) Nachricht käme.

Fix-Richtung (für `bugfix`, kein Patch hier): Trigger-lose Updates erkennen —
jedes `session/update` (re-)armt einen debouncten Trailing-Flush (z. B.
`LIVE_FLUSH_MS` nach dem letzten Update) statt `liveFlush` an `busy` zu
koppeln; alternativ zusätzliches Flush-Kriterium „Updates gesehen, kein
Prompt ausstehend".

## Handoff

- [ ] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen
