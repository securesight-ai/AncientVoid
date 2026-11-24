---
id: BUG-0178
slug: agent-ausgabe-nur-vorgetaeuscht-gestreamt
status: done
severity: S2
area: pwa
instance: live
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/pull/37"
epic: "ADR-0083"
created: 2026-11-16
reporter: "Nutzer (live auf dem Handy, 2026-11-16)"
---

# BUG-0178 — Agent-Ausgabe wird nur vorgetäuscht gestreamt (Typewriter über fertigen Blöcken)

**Status:** done · **Schweregrad:** S2 · **Bereich:** pwa/adapters · **Found on:**
live auf dem Handy-PWA-Pfad, nachgemessen am Event-Store einer echten pi-Session
(2026-11-16)

## Nutzerbericht

„Wie sieht das aus — nicht nach echtem Livestreaming, sondern so als wäre das Thinking
schon da und wird dann nachträglich gestreamt? Wir müssen sicherstellen, dass das ein
echtes Livestreaming ist … definitiv kein Fake Streaming, wenn wir die Ausgabe streamen.
Das sollte sauber implementiert sein, dass wirklich gestreamt wird.“

## Messbefund (Zahlen, keine Vermutung)

Store einer laufenden pi-Session (`data/sessions/18830ec6-…/events.jsonl`, 5317 Events):

| Beobachtung | Zahl |
| --- | --- |
| `assistant`-Ereignisse | 38, Median 265 Zeichen |
| größtes `assistant`-Ereignis | **3843 Zeichen in genau einem Event, ein Zeitstempel** |
| `thinking`-Ereignisse | 1212, Median 645,maximal 4018 Zeichen — ebenfalls Block-Granularität |
| Events mit Teiltext (wachsender Payload) | **0** |

Dazu im Code:

- `packages/adapters/pi/src/normalize.ts` — `IGNORED_UPDATES` enthält `text_start`,
  `text_delta`, `thinking_start`, `thinking_delta`, `toolcall_start`, `toolcall_delta`,
  `done`. Kommentar: „one event per finished content block (`*_end`), not per token
  delta“. Die Provider-Deltas existieren im pi-Stream, werden am Adapter verworfen.
- `packages/adapters/claude/src/normalize.ts:174` — `stream_event` wird explizit nicht
  ausgewickelt.
- `packages/contracts/src/sessions/event.ts` — `EVENT_TYPES` kennt keinen Delta-/Stream-Typ;
  `MAX_EVENT_PAYLOAD_BYTES = 4096`.
- `apps/pwa/src/shared/typewriter.ts` — `TW_TICK_MS = 40`, `TW_BASE_STEP = 2` (≈ 50
  Zeichen/s), `TW_IMMEDIATE_LAG = 300`, `TW_QUEUE_INSTANT = 8`.

## Was der Nutzer sieht

Der Hub empfängt den fertigen Block (oft erst am Ende des Turns). Die PWA tippt den
**bereits vollständigen** Text clientseitig mit ~50 Zeichen/s ab. Ab 300 Zeichen
Rückstand rastet sie sofort ein — lange Antworten erscheinen deshalb schlagartig, kurze
wirken wie live geschrieben. Beides ist Kosmetik: echt gestreamt wird nichts.

## Warum das ein Fehler ist

1. Es erzeugt eine vorgetäuschte Latenz: Der Anschein von Fortschritt, wo keiner mehr ist.
2. Es verschleiert die reale Pipeline — ein Adapter, der Deltas verwirft, fällt nie auf.
3. Es widerspricht der Anforderung: Wenn streamed wird, dann echt (ADR-0083).

## Fix-Richtung (ADR-0083)

- Block-Ereignisse bleiben die dauerhafte Wahrheit (JSONL, Snapshot, K5/K7/K8).
- Live-Deltas laufen als **transiente Frames** über den bestehenden ws-Tail, ohne
  EventStore; `AdapterContext` bekommt `ctx.stream(frame)`, Adapter kohärieren auf
  ≤ 10 Frames/s (Flush alle 150 ms oder ab 1 KB, Frame ≤ 4 KB).
- PWA hängt Frames in-place an; der einlaufende Block **ersetzt** die Live-Blase.
- Der Typewriter-Effekt für `assistant`/`thinking` wird entfernt.

## Schrittstand (verifiziert)

- [x] Messung + Ursachen (dieses Dokument, Zahlen oben)
- [x] Contracts: `streamFrame`/`WsStreamFrames` in `packages/contracts/src/sessions/stream.ts`,
      `AdapterContext.stream()` (ADR-0083)
- [x] pi-Adapter: `createLivePump()` kohäriert Deltas (≤ 150 ms, ≥ 1 KB, Frame ≤ 4 KB,
      `seq` je Serie, `final` vor dem Block) — `packages/adapters/pi/src/live.ts`
- [x] Hub: `ctx.stream` validiert und verteilt am ws-Tail, **ohne** EventStore/Snapshot;
      kaputte Frames zählen als `live_frames_rejected`, die Session läuft weiter
- [x] PWA: `chat-live`-Blase („antwortet“/„denkt“, 2px-Cursor), die beim Block einrückt
- [x] Typwriter-Fake entfernt (`shared/typewriter.ts`, `typewriter-queue.ts`, Appearance-
      Schalter, Fixture-Init) — sonst würde derselbe Text ein zweites Mal geraten
- [x] Beweise: 6 pi-Frame-Tests, 4 Hub-Frame-Tests (nichts wird persistiert), 2 ws-Client-
      Tests, `e2e/specs/live-streaming.spec.ts` 2 grün: die Blase zeigt „dummy assistant
      #N live“, während `/api/sessions/:id/events` diesen Summary noch nicht kennt und es
      keine `.event`-Zeile dazu gibt. Ohne `liveFrames` bleibt die Blase weg.
      Screenshot gesehen und nachgebessert (Beschriftung, schmalerer Cursor).
- [x] claude: `stream_event`-Deltas werden ausgewickt (`createLivePump` in
      `packages/adapters/claude/src/index.ts:235`, ADR-0083). codex app-server
      liefert Item-Granularität, keine Token-Deltas — dort gibt es nichts
      auszuwickeln, Blöcke kommen als Blöcke (kein Fake-Streaming). acp-Chunks
      gehen seit BUG-0033 live (1,5-s-Flush) als echte Events raus; ADR-0083-
      Frames für acp bleiben Folgeauftrag.

## Abschluss (2026-11-24)

Kerndefekt behoben und belegt: `shared/typewriter.ts`/`typewriter-queue.ts`
existieren nicht mehr, pi streamt echte Frames (`createLivePump`,
`packages/adapters/pi/src/index.ts:129,213`), claude ebenso
(`packages/adapters/claude/src/index.ts:235`), `e2e/specs/live-streaming.spec.ts`
grün gegen den Dummy-Adapter, gemerged mit PR #37. Kein Adapter täuscht
Streaming mehr vor — Restpunkt ist nur noch der ADR-0083-Rollout für acp.

