---
id: BUG-0288
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

# BUG-0288 — Der Denk-Block streamt im Browser nicht (in der Native-App schon)

Anknüpfung: BUG-0284 (`live-strom-haelt-nach-jedem-block`) beschreibt dasselbe Verhalten von
der anderen Seite — dort läuft der Strom **nach jedem fertigen Block** bis zur Spitze, hier
wächst der Denk-Block gar nicht. Beide zusammen deuten auf: es kommen fertige Blöcke an,
keine Fetzen.

## Gesehen

Während ein Pi-Zug läuft, zeigt die Browser-Ansicht keinen wachsenden Denk-Block. In der
Native-App auf dem Handy läuft der Denktext sichtbar mit.

## Erwartet

Wie in der Native-App: der Denktext erscheint stückweise, und die Ansicht läuft am unteren
Rand mit, ohne dass der Nutzer scrollen muss.

## Repro

Hub läuft (`127.0.0.1:7373`), ViewPort 430×900, **die eigene laufende Pi-Sitzung**
`7d3df295-0af9-4520-ba33-fbbd5d26af5a` (Adapter `pi` im RPC-Modus, Modell
`strata/qwen3.8-flash-next-iq3_s`) — sie war während der Messung sichtbar in Arbeit.

1. In der Übersicht (`#/`) die laufende Sitzung antippen (Liste → Sitzung, derselbe Weg wie
   beim Nutzer).
2. 15 s zuwarten und alle 1,9 s im DOM messen.

**Ergebnis nach Schritt 2:** Ansicht baut korrekt (`.tail-scroll` vorhanden, klebt am unteren
Rand, `abstandUnten` durchgehend 0), aber der Live-Denk-Block bleibt die ganzen 15 s **leer**
(`.chat-live-thinking` nicht vorhanden, Länge 0) und ebenso der Live-Antwortblock (Länge 0) —
obwohl in dieser Zeit Denk-Fetzen laufen. Kein Konsolenfehler, keine Seiten-Ausnahme.

*Zwei Messläufe vorher sind irreführend und wurden verworfen:* sie riefen
`#/hosts/cachyos-ai/sessions/84a3981c-…` bzw. `#/sessions/84a3981c-…` auf. Diese Sitzung stand
nicht in der Liste; die App fiel stumm auf die Übersicht zurück (kein `.tail-scroll`). Für
die Messung zählt die Sitzung, die über die Liste erreichbar ist.

**Häufigkeit:** in diesem Ablauf immer (17 Messungen über zwei Läufe, durchgehend leer).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`), ViewPort 430×900 |
| Commit | `89fddc39` |
| Adapter | pi (RPC-Modus) |
| Repro-Weg | PWA (agent-browser, `eval`-Messung im DOM) |

## Logs

Der Hub protokolliert Denk-Fenster für dieselbe Sitzung (`[hub] Sitzung …: Denk-Fenster
geöffnet … (164 Zeichen)`), die Zeichen kommen also am Hub an. Am Adapter liegt es
voraussichtlich nicht: `packages/adapters/pi/src/normalize.ts:90-91` reicht `thinking_delta`
an die Live-Pumpe weiter, und `packages/contracts/src/sessions/stream-pump.ts:86-95` sendet
Fetzen **laufend** (spätestens nach `STREAM_FLUSH_INTERVAL_MS`, früher ab
`STREAM_FLUSH_MIN_CHARS`). Welche WebSocket-Rahmen davon im Browser ankommen, ist **noch nicht
gezählt** — das ist der nächste Arbeitsschritt: entweder reicht der Hub die Frames nicht an
die Sitzungs-WS weiter, oder die PWA verwirft sie, bevor `liveText.thinking` gefüllt wird.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/pwa/src/features/session/chat-turns.test.tsx` | Live-Denk-Block vorhanden, aber kein Fall für „wachsende Denk-Fetzen + Mitlauf-Scrollen“ |

Der Client-Code ist angelegt: `apps/pwa/src/features/session/ChatTurns.tsx:122-131`
(`chat-live-thinking`) und der Mitlauf-Effekt `SessionTail.tsx:1189-1190` (hängt an
`liveText`). Die Mitlauf-Richtung ist in Ordnung: die Ansicht klebte während der Messung am
unteren Rand. Offen bleibt, warum `liveText.thinking` bei einer laufenden Pi-Sitzung im
Browser leer bleibt (`setLiveText` in `SessionTail.tsx:812` wird nie erreicht).

## Eingrenzung

offen — zuerst messen, was am Browser ankommt (WebSocket-Rahmen eines laufenden Pi-Zugs),
dann entscheiden: Hub-Seite (Denk-Fetzen werden nicht weitergereicht) oder PWA-Seite
(Rahmen kommen an, werden nicht in `liveText.thinking` übernommen).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen
