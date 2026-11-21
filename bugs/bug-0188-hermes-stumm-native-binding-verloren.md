---
id: BUG-0188
slug: hermes-stumm-native-binding-verloren
status: done
severity: S1
area: core
instance: dev
commit: "7d2378a6"
forge: "https://github.com/securesight-ai/AncientVoid/pull/133"
created: 2026-11-17
reporter: "jan-pixel (Tablet, Nutzerreport) + Repro 2026-11-17"
---

# BUG-0188 — Hermes-Session verstummt bei langen Turns; nach Stop ist die native Session (Resume-Griff) verloren

> **Hinweis:** Dieselbe Nummer `BUG-0188` trägt auch
> [`bug-0188-projekt-anlegen-ignoriert-host.md`](bug-0188-projekt-anlegen-ignoriert-host.md)
> (andere Ursache). Index und Forge unterscheiden die Dateien.

## Gesehen

„Wenn ich Hermes als Adapter auswähle passiert nichts!" — Session d2910969
(2026-11-17 20:52 UTC, Projekt `presentations`, Adapter `hermes`): Nach
`session.started` kam **kein einziges Event mehr**. Der Nutzer stoppte nach
2 Minuten von der PWA aus. Hermes hatte zu diesem Zeitpunkt die Aufgabe
bereits zu großer Teile erledigt (state.db: 76 Messages, Titel
„DOAG kompakt Folien mit Quellen zusammenfassen #2", beendet 20:55:02 durch
`cli_close` = der Kill).

## Erwartet

- Sofortiges Feedback, dass der Hermes-Turn läuft (wie im Telegram-Kanal des
  Nutzers, wo Hermes live antwortet).
- Nach einem Stop bleibt die native Hermes-Session im Hub gebunden
  (`record.nativeSessionId`), damit „Weitermachen" mit `--resume <sid>`
  die geleistete Arbeit fortführen kann (K7).

## Repro

1. Hermes v0.21.0 (CLI `…/venv/bin/hermes`), Hub mit
   `workerRunner: "tmux"`, Adapter `hermes` registriert.
2. PWA: Neue Session, Adapter `hermes`, längerer Auftrag (minutenlang).
3. Beobachten: Verlauf bleibt nach dem eigenen Prompt leer; keine
   Aktivität, keine Session-ID, nichts („passiert nichts").
4. Nach `Stop` (Tablet/PWA): `snapshot.json` der Session zeigt
   `nativeSessionId: null`, obwohl Hermes die `session_id` beim Interrupt
   auf den Pane-Stream schrieb.

**Belege (Session d2910969, 2026-11-17):**

```text
data/sessions/d2910969…/events.jsonl   seq 1–4: created, prompt, started, stopped — sonst nichts
data/workers/ancientvoid-d2910969….log Pane: "\x1b]11;?\x1b\\ \x1b[c ^C^C\r\n session_id: 20261117_215259_171868\r\n"
…log.offset                           53 = alles zugestellt — erst beschrieben um 21:55:02 (Kill-Zeitpunkt)
~/.hermes/state.db                     Session 20261117_215259_171868: source=cli, 76 messages, end_reason=cli_close
data/sessions/d2910969…/snapshot.json  "nativeSessionId": null
```

Hermes v0.21.0 druckt mit `-Q --pass-session-id` Antwort **und**
`session_id:` erst am Zugende bzw. beim Interrupt — der Pane bleibt während
des gesamten Turns stumm (live nachgestellt: kurzer Turn antwortet nach ~8 s
komplett; die Terminal-Queries stehen ab Sekunde 1 im Pane-Log).

**Häufigkeit:** jede Hermes-Session mit einem Turn > wenige Sekunden, plus
jeder Stop eines laufenden Hermes-Turns.

## Ursache (root-caused)

Zwei Defekte greifen ineinander:

1. **Adapter verstummt** — `packages/adapters/hermes/src/index.ts`
   (`spawnTurn`/`attach`): der Adapter emittet erst beim Zugende
   (`hermes.native_session`, Antwort). Während des Turns gibt es kein
   Ereignis, obwohl der Hub-Status „working" zeigt — für die PWA sieht das
   wie „nichts passiert" aus.
2. **Core verwirft das Binding nach dem Stop** —
   `packages/core/src/modules/sessions/session-manager.ts`:
   `emit` droppte bei `signal.aborted` alles still. `stop()` abortet das
   Signal, bevor der Adapter-Kill die Pane-Ausgabe flusht; das
   `hermes.native_session`-Event aus dem onExit-Flush (mit
   `payload.nativeSessionId`) wurde **still verworfen**. Damit war die
   geleistete Arbeit über den Hub unerreichbar — Verstoß gegen Fail-loud
   und K7.

Sekundärbefund (Steuerbarkeit, Evidenz Session cb017253, 2026-11-09):
Hermes v0.21.0 sperrt native Sessions auf einen Live-Owner („Only one
surface at a time may run a session"). Ein Follow-up-steer, das
`--resume <sid>` spawnt, während der alte CLI-Owner noch lebt, stirbt mit
Exit 1 — die Nachricht geht verloren, statt wie im Telegram-Kanal in
derselben Session zu landen.

## Fix

Gemerged in [#133](https://github.com/securesight-ai/AncientVoid/pull/133)
(`7d2378a6`, 2026-11-17):

1. `adapter-hermes`: jedes `spawnTurn` emittiert sofort
   `hermes.turn_started` (System-Event).
2. `core/session-manager`: Adapter-Events mit `payload.nativeSessionId`
   werden nach dem Abort weiterhin journalisiert; andere Post-Abort-Drops
   werden geloggt. `shuttingDown` verwirft weiterhin alles.
3. `adapter-hermes`: Exit 1 mit „already has a live owner" löst genau einen
   verzögerten Neuversuch desselben Turns aus.

## Tests

| Ring | Datei | Stand |
|---|---|---|
| Unit | `packages/adapters/hermes/test/adapter.test.ts` (BUG-0188-Block) | grün (re-verify 2026-11-21) |
| Integration | `packages/core/test/modules/sessions/session-manager.test.ts` „BUG-0188: Adapter-Event…“ | grün (re-verify 2026-11-21) |

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`, Haupt-Checkout) |
| Commit | `7d2378a6` (Fix) / Repro auf `918a57f4` |
| Node-Version | 24 |
| Adapter | hermes (Hermes Agent v0.21.0) |
| Repro-Weg | PWA / hubctl, workerRunner tmux |

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] PR [#133](https://github.com/securesight-ai/AncientVoid/pull/133)
- [x] `bugfix` (Code 2026-11-17; Doku-Abschluss 2026-11-21)
