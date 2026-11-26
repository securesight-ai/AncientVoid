---
id: BUG-0290
slug: chatlink-geht-nicht-im-standardbrowser-auf
status: open
severity: S2
area: pwa
instance: dev
commit: "dae00453"
forge: "https://github.com/securesight-ai/AncientVoid/issues/440"
epic: "EPIC-P85"
created: 2026-11-25
reporter: silenttz
---

# BUG-0290 — Chat-Link angeklickt: der Standardbrowser geht nicht auf

## Gesehen

Im Chat führt ein Klick auf einen Link regelmäßig nicht in den Standardbrowser
(genutzter Weg:mobil, installierte App). Der Klick zeigt keine oder die falsche
Wirkung. Regelmäßig, nicht einmalig.

## Erwartet

Externe Links öffnen den Standardbrowser; eigene Hub-Links (z. B.
`…/#/anhang/<id>`) öffnen die In-App-Ansicht
([`docs/bild-links-fuer-agenten.md`](../docs/bild-links-fuer-agenten.md)).
Was ein Client-Weg nicht kann, soll sichtbar sein, nie still.

## Repro

Voraussetzung: Hub läuft, Session mit einer Agent-Antwort, die einen externen
Link als Markdown-Link oder nackte URL (eigene Zeile) enthält.

1. Chat-Zeile mit externem Link auf dem Gerät antippen.
2. Beobachten: was öffnet sich (App-Fenster / Browser-Tab / nichts)?
3. Dasselbe auf dem Desktop-Browser-Tab zum Vergleich.

**Ergebnis nach Schritt 2:** kein Standardbrowser (genauer Zielort auf dem
Gerät nachtragen — Evidenzmatrix in EPIC-P85 T85.1).

**Häufigkeit:** regelmäßig

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal via Tailnet |
| Commit | `dae00453` |
| Node-Version | (Hub-seitig, unverdächtig) |
| Adapter | beliebig (Renderer-seitig) |
| Repro-Weg | PWA auf dem Gerät (installierter Stand), Desktop-Browser als Vergleich |

## Logs

Quelle und **Auszug** (keine Secrets, keine Tokens). Zeitstempel zur Aktion
zuordnen.

```text
(keine serverseitigen Logs erwartet — der Fall ist clientseitig)
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/pwa/test/shared/markdown.test.ts` (Links werden mit `target="_blank"` gerendert — Renderer korrekt, Defekt liegt im Klickweg/Display-Mode) | grün |
| Contract (`adapter-testkit`) | — | |

Welcher Test **müsste** ohne Fix rot sein? Ein Policy-Test
(„Link-Klassifizierung: extern → Browser, eigenen Ursprung → In-App“), Datei
noch nicht vorhanden — das schreibt `bugfix` im Rahmen EPIC-P85 T85.2.

## Eingrenzung

Package `apps/pwa`. Renderer (`src/shared/Markdown.tsx`) setzt `target="_blank"`
korrekt; betroffen ist das Verhalten in installierten Clients
(Display-Mode standalone; `src/shared/device-status.ts` erkennt ihn bereits).
Plattformverhalten je Gerät ist zu messen, nicht zu raten — siehe EPIC-P85 §3.1/§3.2.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen — Umsetzung in EPIC-P85 (T85.1–T85.3)
