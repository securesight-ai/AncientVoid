---
id: BUG-0223
slug: os-push-trotz-offener-app
status: done
severity: S3
area: pwa
instance: dev
commit: "a2daa730"
forge: "https://github.com/securesight-ai/AncientVoid/issues/193"
epic: ""
created: 2026-11-19
reporter: "Kai (Nutzerreport, „doppelt angezeigt“)"
---

# BUG-0223 — OS-Push und In-App-Toast melden dieselbe Nachricht doppelt

## Gesehen

Ist Web-Push aktiviert und die App im Vordergrund, erscheint dieselbe
Nachricht zweimal auf demselben Gerät: als In-App-Toast (Glocke pollt) und
als Betriebssystem-Meldung (`showNotification` im Service Worker).

## Erwartet

Ist ein App-Fenster derselben Herkunft sichtbar, übernimmt der In-App-Toast
— der Service Worker zeigt keine zweite OS-Meldung an. Verdeckte/geschlossene
Fenster bekommen weiterhin Push (dort sieht niemand den Toast).

## Repro

Voraussetzung: Push aktiviert (`PushSettings`), PWA im Vordergrund.

1. PWA öffnen und sichtbar lassen.
2. Eine push-würdige Meldung auslösen (Freigabe/Fehler/Zug-Ende).
3. Beobachten: Toast oben rechts UND OS-Benachrichtigung.

**Ergebnis nach Schritt 3:** doppelt angezeigt.

**Häufigkeit:** immer (mit Push + sichtbarem Fenster).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal / Tailscale |
| Commit | `a2daa730` |
| Node-Version | 26.7.0 |
| Adapter | beliebig |
| Repro-Weg | PWA (Test-Repro: Source-Zusagen in `public-sw.test.ts`) |

## Logs

Keine — reines Client-Verhalten im Service Worker.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit (Source-Zusagen) | `apps/pwa/test/public-sw.test.ts` | nicht vorhanden |

Ohne Fix rot: der Push-Handler enthält keine Sichtbarkeitsprüfung.

## Eingrenzung

`apps/pwa/public/sw.js:166–191`: der `push`-Handler ruft bedingungslos
`showNotification` auf. Test-Pushs (`data.test`) bleiben ausgenommen —
der Testknopf in den Einstellungen soll die OS-Auslieferung gerade
sichtbar prüfen.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [x] `bugfix`
