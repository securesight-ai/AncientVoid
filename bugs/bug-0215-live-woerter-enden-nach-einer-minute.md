---
id: BUG-0215
slug: live-woerter-enden-nach-einer-minute
status: done
severity: S2
area: hub
instance: dev
commit: ""
forge: ""
epic: "ADR-0028 (lokale Spracherkennung), EPIC-P10 (Diktat)"
created: 2026-11-18
reporter: Agent (am laufenden Hub nachgemessen)
---

# BUG-0215 — lange Diktate verlieren nach 60 Sekunden die Live-Wörter

## Gesehen

Kai will Qualität vor Geschwindigkeit, also auch lange Diktate. Nachgemessen am laufenden
produktiven Hub mit einem 85-Sekunden-Diktat (`data/ops/stt-stream-livecheck.mjs`, Audio wird
in Echtzeit eingespielt):

```
+25279 ms  Teiltext: Leere den Cache vom Service Worker und prüfe die Logs.
+31551 ms  Teiltext: Codex soll einen Unit-Test für den Adapter schreiben.
…
+57470 ms  Teiltext: Wie viel Kontingent hat Claude noch für heute?
FEHLER: Sprachaufnahme dauerte länger als 60 Sekunden.
```

Danach ist die Live-Vorschau weg — mitten im Satz. Die Aufnahme selbst läuft weiter, der
Endtext kommt vollständig (`POST /api/stt` mit dem ganzen Clip: 85 s Diktat, Antwort in
1,84 s, 1135 Zeichen, Text sinnvoll). Verloren geht also die mitschreibende Vorschau, und die
Meldung klingt nach Abbruch.

## Ursache

`STT_STREAM_MAX_AUDIO_BYTES = 16_000 * 2 * 60` (contracts) = **sechzig Sekunden** Rohaudio pro
Sprachaufnahme. Diese Zahl wird doppelt benutzt:

* als Byte-Bremse für hereinkommende Rahmen (`stt-stream.ts:181`, Meldung „…überschritt die
  lokale Streamgrenze.“),
* als Wanduhr-Rückfall: `setTimeout(…, STT_STREAM_MAX_AUDIO_BYTES / 32)` — die Teilung durch 32
  sind 32 000 Bytes pro Sekunde, daraus werden 60 000 ms. Die Meldung nennt die 60 Sekunden
  festgeschrieben im Text, die Variable heißt `inactivity`, ist aber eine harte Dauerbremse.

Für ein Diktat von ein, zwei Minuten (Kais übliche Mehr-Satz-Aufträge) ist eine Minute zu knapp.

## Erwartet

* Ein Diktat von bis zu drei Minuten behält seine Live-Wörter.
* Die Meldung nennt die tatsächliche Grenze aus derselben Zahl, nicht einen festgeschriebenen Text.

## Repro

`node data/ops/stt-stream-livecheck.mjs <85s.wav>` am laufenden Hub — Teiltexte bis ~57 s, dann
Abbruchmeldung. Oder die neue Spec: hundert Sekunden Rahmen schnell eingesandt, danach darf kein
`error` kommen.

## Umgebung

Windows-PC (KAISGAMINGDESK), produktiver Hub 127.0.0.1:7373, whisper.cpp auf der Radeon,
Streaming-Brücke 127.0.0.1:8095.

## Tests

`apps/hub/test/modules/voice/stt-routes.test.ts`: hundert Sekunden PCM-Rahmen einsenden, dann
`finish` — erwartet `final`, nicht `error`. Ohne den Fix: `error` nach sechzig Sekunden.


## Fix

Behoben: `ca56c3d9` (60 s → 180 s). Doku-Abschluss 2026-11-21 (Status-Nachzug).

## Handoff

contracts: eine Sekundenzahl (`STT_STREAM_MAX_AUDIO_SECONDS`, 180) statt der halben Umrechnung
aus Bytes; hub: Bothasen ableiten, Meldung aus der Zahl, Variable ehrlich benennen.
