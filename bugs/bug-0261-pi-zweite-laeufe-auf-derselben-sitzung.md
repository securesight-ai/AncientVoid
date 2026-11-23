---
id: BUG-0261
slug: pi-zweite-laeufe-auf-derselben-sitzung
status: done
severity: S1
area: harness
instance: prod
commit: "a00c7305"
forge: "https://github.com/securesight-ai/AncientVoid/issues/300"
epic: "EPIC-P15 / ADR-0085 (korrigiert durch ADR-0114)"
created: 2026-11-23
reporter: kai
---

# BUG-0261 — Drei Pi-Läufe auf derselben native Sitzung überschreiben sich

## Gesehen

Aus **einem** Chat heraus arbeiteten drei Pi-Agenten gleichzeitig am selben
Arbeitsverzeichnis. In der Sessions-Akte erschien dazu scheinbar grundlos:

    #4523 · system  08:12:55  session.turn_end   (payload.reason: "error")
    #4524 · system  08:12:55  adapter.down
    Meldung: „garmin · Zug fehlgeschlagen“  (level: error)

Belegte Prozesslage (`Get-CimInstance Win32_Process`, CommandLine enthält
dieselbe Session-Datei):

    PID 26352 → 19536   Start 07:39:35Z   pi -p --mode json --session …01a203bb…
    PID  6736 → 13552   Start 07:52:56Z   pi -p --mode json --session …01a203bb…
    PID 28704 →  3656   Start 07:59:15Z   pi -p --mode json --session …01a203bb…

Folgen, alle beobachtet:

- Zwei Läufe schrieben parallel in `watchface-vice/` (fremde Datei-Mtime
  08:07:50 mitten in einem eigenen Lauf), Änderungen liefen Gefahr,
  überschrieben zu werden.
- Der Hub führte einen der Prozesse als *die* Adapter-Verbindung. Als dieser
  endete, buchte er `session.turn_end reason:"error"` + `adapter.down` und eine
  Fehlermeldung — für Arbeit, die in einem anderen Prozess längst fertig war.
- Events des noch lebenden Laufs liefen gegen ein bereits gestopptes Handle:
  Hub-Log „adapter event after stop dropped" von 07:12:55Z bis 07:14:17Z. Die
  Assistant-Antwort dieses Laufs wurde verworfen und kam auf dem Handy nie an.

## Ursache

`packages/adapters/pi/src/index.ts` sichert `midTurnInput: true` zu (ADR-0085,
Begründung dort: „jeder Lenk-Aufruf ist ein eigener Lauf"). `steer(prompt)` baut
aber `pi -p --mode json --session <dieselbe Datei>` (Adoption) bzw. `--continue`
— also einen **zweiten Prozess auf dieselbe native Sitzung**. Damit war ADR-0074
(kein zweiter Prozess auf dieselbe native Session) für Pi ausgehebelt.

Im Hub (`session-manager.ts`, `steerNow`) gilt:

    const wantsNow = meta?.queue === false && caps?.midTurnInput === true;

Wählt das Handy „jetzt senden" (PWA-Umschalter, ADR-0085), trifft diese Zeile auf
Pi zu → Prompt geht sofort an den Adapter → zweiter Lauf.

## Fix

1. Pi: `midTurnInput: false` — Lenken heißt bei Pi „im nächsten Zug".
2. Pi-Adapter: `steer(prompt)` mit noch laufendem Worker antwortet
   `{ ok: false, detail: "ein pi-Lauf läuft bereits — Meldung bitte vormerken" }`
   und spawn **nicht** (erfasst auch direkte Aufrufe über hubctl/Schleifen).
3. ADR-0114 korrigiert ADR-0085 und formuliert die Leitlinie:
   `midTurnInput: true` nur zusammen mit `promptDelivery: "live"`.

## Test (rot-dann-grün)

Neu: `packages/adapters/pi/test/keine-parallelen-laeufe.test.ts`

- Capabilities sichern Mid-Turn-Eingabe nicht mehr zu.
- Prompt während eines laufenden Zug: `ok: false` **und** `spawned.length === 1`
  (nachweislich kein zweiter Prozess).
- Nach beendetem Zug: Lenken wieder möglich, zwei Spawns.

Lauf: zuerst 3/3 rot, nach dem Fix `npx vitest run packages/adapters/pi/test/`
→ **42 passed**. `packages/hub/test/modules/sessions/queue-edit.test.ts` und
`packages/core/test/modules/sessions/session-queue.test.ts` grün (der
bestehende Fall „queue:false ohne Zusicherung → vorgemerkt" deckt Pi jetzt ab).

## Nicht die Ursache (ausgeschlossen)

- `autoResumeInterrupted` war bereits auf `false` gestellt und der Hub um
  06:45:22Z neu gestartet; die drei Läufe starteten 07:39/07:52/07:59Z, also
  **danach**. Auslöser war jede eingehende Nachricht, nicht die
  Wiederaufnahme unterbrochener Züge.
- Provider-Fehler mit Auto-Retry traten früher auf (06:32:45–06:32:59Z) und
  gehörten zu bereits gestoppten Adaptern.
- Der lokal bekannte Windows-Fall `EBUSY … hub.db` in
  `session-queue.test.ts > überlebt einen Hub-Neustart (K7)` ist vor dem Fix
  derselbe (mit `git stash` nachgewiesen) und hat mit diesem Bug nichts zu tun.

## Behoben auf der pi-Schiene (2026-11-23, PR #357)

Der Mechanismus ohne Zweitprozess ist `pi --mode rpc`: ein Prozess pro Sitzung,
Meldungen als JSONL-Frames auf stdin. `adapters.pi.config.mode` wählt zwischen
`oneshot` (altes Verhalten, Standard) und `rpc`. Lenken mitten im Zug ist damit
wieder erlaubt (ADR-0114 Nachtrag).

Nachweis auf einem Kratz-Hub (Port 7399, echtes Modell): `sleep 18`-Werkzeuglauf,
nach 6 s gelenkt → Antwort `GESTEUERT`; Meldung vorgemerkt + „Jetzt senden" mitten
im Lauf → 200, Ereignis `pi.queue` („vorgemerkt — 1 Lenkung"), Antwort `JETZTGESENDT`;
Hub-Neustart bei laufendem tmux-Worker → Sitzung übernimmt den Prozess, Lenken ergibt
`NACHNEUSTART`. Ein zweiter pi-Prozess kam in keinem dieser Läufe vor.
