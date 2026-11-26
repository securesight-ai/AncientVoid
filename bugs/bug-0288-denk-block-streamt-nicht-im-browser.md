---
id: BUG-0288
slug: denk-block-streamt-nicht-im-browser
status: fixed
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

## Ursache

Nicht die Leitung, sondern die **Anordnung im Browser**. Messung in einer laufenden Pi-Sitzung
(bundle `index-CuWpiw_Y.js`, dieselbe Sitzung wie im Repro):

| Messpunkt | Zahl |
|---|---|
| WebSocket-Rahmen mit Denk-Fetzen, im Browser gezählt | 259 `onFrames`-Aufrufe, Rahmen 1 Stück je Nachricht |
| Live-Denk-Block im **Chat**-Reiter | in 245 von 300 DOM-Proben vorhanden, bis **3 048 Zeichen**, beim Block-Ende geleert |
| Live-Denk-Block im **Verlauf**-Reiter | **fehlt komplett** — kein `chat-live`-Knoten |

Der Strom hing an `ChatTurns` (`ChatTurns.tsx:127-145`) und wurde **nur im Chat-Reiter**
gerendert. Wer im Verlauf liest — auf dem Desktop der normale Leseweg — sah in der
Native-App einen streamenden Denkberg und im Browser nichts. Die earlier Vermutung „es kommen
nur fertige Blöcke an, keine Fetzen“ (BUG-0284) ist damit widerlegt: die Fetzen kommen an und
werden übernommen; es fehlt der Anzeigeort.

Nebenbefund, bewusst **nicht** geändert: `apps/hub/src/modules/sessions/ws.ts:105` verwirft
Rahmen während des Replay (`if (replaying) return;`). Das ist ADR-0083 so dokumentiert, und
die Messung zeigt: nach dem Replay kommen alle Rahmen innerhalb der Adapter-Kohärenz
(≤ 150 ms) an, der Block holt eine Lücke ohnehin ein.

## Fix

Der Live-Strom gehört zum Schwanz, nicht zu einem Reiter.

- `apps/pwa/src/features/session/LiveStream.tsx` (neu): der **einzige** Baustein, der den
  wachsenden Teiltext darstellt (Denk-Notiz + Antwortteil, cuid, `aria-live`).
- `SessionTail.tsx`: `<LiveStream live={liveText} />` steht jetzt im Schwanzcontainer für
  Chat **und** Verlauf; `ChatTurns` hat das `live`-Prop verloren (23 Zeilen weniger).
- `apps/pwa/src/features/session/live-frames.ts` (neu): `liveZuwachs(frames, offen)` — die
  reine Regel, welche Teiltexte dazugehören und welche Ströme offen sind. Der Handler ruft sie
  nur noch auf; damit steht die Regel im Test und nicht in einem DOM-Handler.
- `apps/pwa/src/shared/ws.ts`: der Rahmen-Typ ist jetzt `EmittedStreamFrame` aus `contracts`
  (`StreamFrameView` war eine duplizierte Kopie — ein Feld konnte nie nur auf einer Seite
  existieren).

## Prüfung (rot → grün)

**Unit:** `apps/pwa/test/features/session/live-frames.test.ts` — 5 Fälle (Reihenfolge beider
Ströme, leerer Teiltext, `final` schließt und meldet, keine Seiteneffekte auf die mitgegebene
Menge, fehlende Serie). Vorher gab es für die Regel **keinen** Test.
`npx vitest run test/features/session test/app`: **24 Dateien, 201 Fälle grün** (Regression
durch das entfernte `live`-Prop: keine).

**Live im Browser** (Hub `127.0.0.1:7373`, bundle `index-zmLtkxyA.js`, Sitzung
`7d3df295-…`, alle 200 ms im DOM gemessen):

| Reiter | Proben mit Denk-Block | Wachstum | Abstand zur Unterseite |
|---|---|---|---|
| Chat (vor dem Fix schon da) | 245 / 300 | bis 3 048 Zeichen | 0 (klebt) |
| **Verlauf** (neu) | **87 / 110** | 2 → 88 → max **328 Zeichen** | **0 in jeder Probe** — läuft mit |

Der Verlauf-Reiter wurde über `More → History` im Reiterstreifen erreicht (kein Skript-Trick),
die Messung lief über `eval` im echten DOM.

## Offen

Im Raster-Layout (`layout-2v`, 1280 × 633) bleiben dem Schwanz im fokussierten Kachel-Fenster
nur **48 px** Höhe (Kette gemessen: topbar 163 + new-jump 29 + run-strip 101 + dock-stack 230
von 579 px). Der Strom wächst also auch im Verlauf — aber in einem Streifen, der kaum zu lesen
ist. Das ist ein eigenes Layout-Thema (Kachelhöhen), kein Streaming-Fehler; eigene Akte nötig.

## Eingrenzung

offen — zuerst messen, was am Browser ankommt (WebSocket-Rahmen eines laufenden Pi-Zugs),
dann entscheiden: Hub-Seite (Denk-Fetzen werden nicht weitergereicht) oder PWA-Seite
(Rahmen kommen an, werden nicht in `liveText.thinking` übernommen).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen
