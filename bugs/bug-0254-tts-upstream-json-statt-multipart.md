---
id: BUG-0254
slug: tts-upstream-json-statt-multipart
status: open
severity: S2
area: hub
instance: prod
commit: "8c26bd02"
forge: "https://github.com/securesight-ai/AncientVoid/issues/279"
epic: "EPIC-P75"
created: 2026-11-22
reporter: Nutzermeldung 2026-11-22 („Sprachausgabe klappt nicht. Es passiert nichts wenn ich den Button klicke")
---

# BUG-0254 — TTS-Upstream-Aufruf spricht JSON, der echte Dienst will Multipart

## Gesehen

Der Vorlesen-Knopf in der PWA reagiert nicht auf den Tipp. Nach dem Eintragen
der TTS-URL würde jeder Vorlesen-Versuch mit 502 „Sprachausgabe nicht erreichbar
(TTS 422)" scheitern.

## Erwartet

Konfigurierte TTS-URL → Knopf aktiv, Hub synthetisiert über den Dienst, PWA
spielt WAV ab.

## Repro

Voraussetzung: Hub läuft, pocket-tts (`POST /tts`) erreichbar — der einzige
reale TTS-Dienst in dieser Umgebung (laut `HIVE_POCKET_TTS_URL`; Referenzclient
`hiveos/gateway/hive_gateway/voice.py`).

1. `GET /api/settings/tts` am live Hub → `{"tts":{"url":null,…}}` — Knopf
   deshalb disabled (Label „Vorlesen (einrichten)"): Tipp „passiert nichts".
2. `PUT /api/settings/tts {"url":"http://127.0.0.1:8000/tts"}` → Status wird
   `available:true` (GET-Probe: jedes Lebenszeichen zählt).
3. `POST /api/tts {"text":"Probe"}` → **502**; im Upstream-Call: Hub sendet
   `content-type: application/json` mit `{text,speed,language}`.
4. Direkt gegen den Dienst: JSON-Body → **422** („Field required: body.text");
   multipart `text=…` → **200 audio/wav**. Extra-Felder (speed, language) werden
   toleriert.

**Ergebnis nach Schritt 3:** 502 statt WAV — ADR-0097s angenommener Upstream-
Dialekt („Hivemind `/tts`, JSON-Body") existiert so nicht; der reale Dienst
speak multipart/form-data und antwortet mit Raw-WAV-Bytes.

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`, Hub-Prozess seit 18:24, P75 gemergt) |
| Commit | `8c26bd02` |
| Node-Version | 26 (mise) |
| Adapter | — (voice-Route, keine Session nötig) |
| Repro-Weg | hubctl/curl + PWA |

## Logs

Upstream-Antwort auf den JSON-Body des Hubs (Schritt 3/4):

```text
{"detail":[{"type":"missing","loc":["body","text"],"msg":"Field required","input":null}]}
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit/Route | `apps/hub/test/modules/voice/tts-routes.test.ts` | grün — pinst den JSON-Dialekt mit (Attrappe ahmt die falsche Annahme nach) |
| E2E | `e2e/specs/tts.spec.ts` | grün — ebenso JSON-Pinning |

Ohne Fix rot werden muss: ein Dialekt-Test, der verlangt, dass der Upstream-Call
`multipart/form-data` mit Feld `text` sendet (Attrappe prüft Content-Type und
Felder statt JSON.parse).

## Eingrenzung

`apps/hub/src/modules/voice/tts.routes.ts:119-124` — POST-Body als JSON mit
`content-type: application/json`; `packages/contracts/src/voice/tts.ts`
(`TtsUpstreamRequest`-Doku) und ADR-0097 §1 tragen dieselbe falsche Annahme.
Primäre Ursache des gemeldeten Symptoms ist zusätzlich der fehlende
Konfig-Eintrag (`tts.url=null` — Bedienung, kein Code-Defekt).

## Handoff

- [ ] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen
