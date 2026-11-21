---
id: BUG-0216
slug: endtext-des-streamten-diktats-traegt-fremden-namen
status: done
severity: S3
area: hub
instance: dev
commit: ""
forge: ""
epic: "ADR-0028 (lokale Spracherkennung), EPIC-P10 (Diktat)"
created: 2026-11-18
reporter: Agent (am laufenden Hub nachgemessen)
---

# BUG-0216 — der Endtext des streamenden Diktats trägt einen fremden Erkennungsnamen

## Gesehen

Nach dem Diktat meldet der Hub als Erkennung des fertigen Textes
`Nemotron 3.5 ASR Streaming`, obwohl die eigene Radeon-Erkennung geliefert hat.
Die Konfigurationsseite und die Konfig-Referenz versprechen `stt.streaming.engine`
als Namen genau dieses Endtextes.

## Erwartet

Hat `hub.config.json` ein `stt.streaming.engine`, so trägt dieser Name das
`final`-Ereignis des streamenden Diktats. Ohne diesen Schlüssel bleibt die bisherige
Bezeichnung erhalten (Default unverändert).

## Repro

Voraussetzung: Hub läuft produktiv auf `127.0.0.1:7373`, `stt.streaming.url` zeigt auf
die Brücke (`ws://127.0.0.1:8095/`), whisper.cpp läuft auf der Radeon.

1. `hub.config.json` prüft: `stt.streaming.engine` gesetzt (Ist:
   `whisper.cpp large-v3 q5_0 (Vulkan, Radeon R9700)`).
2. Hub neu starten (`data/ops/hub-restart.ps1`), damit die Konfig neu gelesen wird.
3. `node data/ops/stt-diktat-check.mjs` — die Auskunft des Hub lesen.
4. `node data/ops/stt-stream-livecheck.mjs E:/WhisperSTT/corpus-tts/16k/h04.wav` —
   das `final`-Ereignis des Live-Hubs ansehen.

**Ergebnis nach Schritt 3:** `GET /api/stt` sagt `engine: "whisper.cpp large-v3 q5_0
(Vulkan, Radeon R9700)"`, `streaming: true`, `checkedMsAgo: 0` — die Konfig ist also
angekommen.

**Ergebnis nach Schritt 4:** `FERTIG engine=Nemotron 3.5 ASR Streaming` — der Name des
Konfigurationsschlüssels taucht nirgends auf.

**Häufigkeit:** immer (jedes streamende Diktat)

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`), Zweig `lokal/live-integration` `e222b2e9` |
| Commit | `d2c6ff69` (origin/main) |
| Node-Version | v24.18.0 |
| Adapter | — (Sprache, kein Modellzug) |
| Repro-Weg | CLI (`data/ops/stt-stream-livecheck.mjs`) |

## Logs

```text
/api/stt am Live-Hub: {"available":true,"engine":"whisper.cpp large-v3 q5_0 (Vulkan, Radeon R9700)",
  "language":"de","local":true,"streaming":true,"checkedMsAgo":0}
Diktat 4.05s: E:/WhisperSTT/corpus-tts/16k/h04.wav
+ 7446 ms  FERTIG engine=Nemotron 3.5 ASR Streaming (812 ms nach dem letzten Audio-Frame)
```

Nachgemessen zweimal nach je einem sauberen Hub-Neustart (15:54 und 15:58) —
gleiches Ergebnis, die Konfig-Datei selbst enthält den Schlüssel (mit
`loadConfig` aus `@ancientvoid/core` vorgedruckt:
`streaming: {"url":"ws://127.0.0.1:8095/","endpointingMs":800,"engine":"whisper.cpp large-v3 q5_0 (Vulkan, Radeon R9700)"}`).

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/hub/test/modules/voice/stt-wiring.test.ts` | nicht vorhanden |
| Contract (`adapter-testkit`) | — | irrelevant (kein Adapterzug) |

Welcher Test müsste ohne Fix rot sein? Eine Unit, die **die Weitergabe von der
Konfiguration an das Sprachmodul** prüft: `stt.routes.ts` und `stt-stream.ts`
zusammenzutesten reicht nicht — beide lesen `cfg.streaming.engine` korrekt, der
Verlust passiert dazwischen in `main.ts`.

## Eingrenzung

Package `apps/hub`. Verloren geht der Schlüssel beim Handanlegen des Objekts in
`apps/hub/src/main.ts:422-425`: weitergegeben werden `url`, `endpointingMs` und
`apiKeyFile`, aber nicht `engine`. `packages/core/src/platform/config.ts` nimmt den
Schlüssel an (`stt.streaming.engine`), `apps/hub/src/modules/voice/stt.routes.ts:117`
benutzt ihn — er erreicht die Stelle nur nie.


## Fix

Behoben: `3135b690`. Doku-Abschluss 2026-11-21 (Status-Nachzug).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen
