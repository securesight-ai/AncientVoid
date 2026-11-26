---
id: BUG-0283
slug: denk-block-streamt-nicht-im-browser
status: open
severity: S2
area: pwa
instance: dev
commit: "89fddc39"
forge: ""
epic: ""
created: 2026-11-24
reporter: "Kai (Handy, Telegram-PWA)"
---

# BUG-0283 — Der Denk-Block streamt im Browser nicht (in der Native-App schon)

## Gesehen

Während ein Pi-Zug läuft, zeigt die Browser-Ansicht keinen wachsenden Denk-Block. In der
Native-App auf dem Handy läuft der Denktext sichtbar mit.

## Erwartet

Wie in der Native-App: der Denktext erscheint stückweise, und die Ansicht läuft am unteren
Rand mit, ohne dass der Nutzer scrollen muss.

## Repro

Hub läuft (`127.0.0.1:7373`), ViewPort 430×900, eigene laufende Pi-Sitzung
`84a3981c-217c-41ee-ade4-5892ddbb3c9a` (Adapter `pi`, Modell `strata/qwen3.8-flash-next-iq3_s`).

1. Adresse der laufenden Sitzung setzen: `#/hosts/cachyos-ai/sessions/84a3981c-…`.
2. 20 s zuwarten und dabei alle 1,8 s im DOM messen.

**Ergebnis nach Schritt 2:** 12 Messungen in Folge ohne Live-Block
(`.chat-live-thinking` nicht vorhanden) **und ohne Scroll-Container** (`.tail-scroll` nicht
vorhanden, `scrollHeight` deshalb `null`) — die Sitzung wurde in dieser Zeit überhaupt
nicht als Schwanz-Ansicht gerendert. Kein Konsolenfehler, keine Seiten-Ausnahme.

**Häufigkeit:** in diesem Ablauf immer; ob der Live-Block bei einer über die Liste
angeklickten Sitzung erscheint, ist offen (dieselbe Sitzung, anderer Weg).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`), ViewPort 430×900 |
| Commit | `89fddc39` |
| Adapter | pi (RPC-Modus) |
| Repro-Weg | PWA (agent-browser, `eval`-Messung im DOM) |

## Logs

Der Hub protokolliert Denk-Fenster für diese Sitzung (`[hub] Sitzung …: Denk-Fenster
geöffnet … (164 Zeichen)`), die Zeichen kommen also am Hub an. Welche WebSocket-Rahmen bei
einem laufenden Zug den Browser erreichen (Denk-Fetzen oder nur fertige Blöcke), ist **noch
nicht gemessen** — das ist der nächste Arbeitsschritt.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/pwa/src/features/session/chat-turns.test.tsx` | Live-Denk-Block vorhanden, aber kein Fall für „wachsende Denk-Fetzen + Mitlauf-Scrollen“ |

Der Client-Code ist angelegt: `apps/pwa/src/features/session/ChatTurns.tsx:122-131`
(`chat-live-thinking`) und der Mitlauf-Effekt `SessionTail.tsx:1189-1190` (hängt an
`liveText`). Offene Frage: warum `liveText.thinking` bei einer laufenden Pi-Sitzung im
Browser leer bleibt und warum der Scroll-Container in dem Messlauf fehlte.

## Eingrenzung

offen — zuerst messen, was am Browser ankommt (WebSocket-Rahmen eines laufenden Pi-Zugs),
dann entscheiden: Hub-Seite (Denk-Fetzen werden nicht weitergereicht) oder PWA-Seite
(Rahmen kommen an, werden nicht in `liveText.thinking` übernommen).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen
