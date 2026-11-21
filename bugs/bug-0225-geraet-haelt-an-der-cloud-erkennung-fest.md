---
id: BUG-0225
slug: gerät-hält-an-der-cloud-erkennung-fest
status: done
severity: S3
area: pwa
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/pull/199"
epic: ""
created: 2026-11-19
reporter: Kai
---

# BUG-0225 — ein Gerät hält an der Browser-/Cloud-Erkennung fest, obwohl längst lokal erkannt wird

## Fix

Behoben: ADR-0095 / PR #199. Doku-Abschluss 2026-11-21 (Status-Nachzug).


## Gesehen

Am Handy kommt das Diktat sofort (und mit anderen Hörfehlern), am Tablet langsam: dasselbe
Konto, dieselbe Hub-Instanz, dieselbe PWA. Das Handy benutzt die Browser-/Cloud-Erkennung,
obwohl am Hub seit 18.11.2026 eine lokale whisper.cpp-Erkennung läuft und `GET /api/stt`
`available: true` meldet.

## Erwartet

Die App entscheidet nicht allein aus einer beim Start geholten Auskunft, die sie bis zum
kompletten Schliessen der App hält. Wer eine Quelle will, soll sie wählen können — und
eine einmal gewählte Quelle darf nicht still gegen eine andere (Cloud) getauscht werden.

## Repro

Hub läuft mit `stt.url`/`stt.streaming.url`; PWA auf zwei Geräten (Handy, Tablet).

1. PWA auf dem Handy starten, bevor am Hub eine eigene Erkennung konfiguriert/erreichbar ist
   (oder während eines Hub-Neustarts) — die App holt `GET /api/stt` einmal und merkt
   `available: false`.
2. Am Hub die lokale Erkennung hochfahren; `GET /api/stt` meldet jetzt `available: true`.
3. Auf dem Handy diktieren: es erscheinen sofort Teilwörter, ohne dass am Hub etwas ankommt.
4. Hub-Log und Bridge-Protokoll gegenhalten: die Diktate des Handy-Geräts tauchen dort nicht auf.

## Beweislage (19.11.2026, KaisGamingDesk)

- Hub-DB `device_tokens`: `handy` (zuletzt 17:32:23Z) und `tablet` (zuletzt 17:42:21Z).
- Hub-Log (`data/logs/hub-20261119-180107.log`, UTC): Diktate um **17:18:41** und **17:21:12**
  haben **keine** `/api/stt*`-Anfrage; die Bridge-Sitzungen liegen bei 17:01:27, 17:03:42,
  17:04:31, 17:26:47, 17:29:10–17:31:13 und 17:40:51.
- Bridge-Protokoll `E:\WhisperSTT\stt-stream.log` (17:29:10–17:31:13): exakt der Tabletspruch
  („Am Handy wird, glaube ich, auch gar kein Whisper benutzt … am Tablet wird es echt lahm …
  die kleinere Whisper-Variante … warum am Handy sofort geantwortet kommt und hier am Tablet
  langsam"), Segment füer Segment 5,9–7,1 s pro 0,7–4,3 s Audio.
- Gerät, das lokal erkannt hat, brauchte füer einen 4-Sekunden-Schnitt 6,0–6,8 s (CPU).
  "Sofort" ist auf diesem Rechner lokal nicht möglich — das Handy musste außerhalb
  erkannt haben.

## Ursache

`apps/pwa/src/features/stt/use-push-to-talk.ts` hängt nur an `localStt.available`, und
`sttStatus()` (`apps/pwa/src/shared/local-stt.ts`) wird beim App-Start **einmal** geholt und
bleibt (BUG-0214 erneüert sie nur nach einem Fehler). Eine PWA, die vor dem STT-Ausbau oder
während eines Hub-Neustarts gestartet wurde, bleibt damit füer ihre ganze Lebensdaüer auf
dem Browser-/Cloud-Pfad — ohne dass jemand das wolle oder bemerke.

## Fix-Richtung

Eine gespeicherte Wahl pro Gerät (Automatisch / Lokal / Browser) mit ehrlicher Anzeige der
gewählten Quelle; "Lokal" fällt nie still in die Cloud zurück. ADR-0095.
