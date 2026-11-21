---
id: BUG-0208
slug: nach-strom-ende-auf-nachrichtenanfang-scrollen
status: done
severity: S3
area: pwa
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/pull/142"
epic: "ADR-0083 (betroffen: Live-Frames → Block), EPIC-P43 (Lesbarkeit des Chats)"
created: 2026-11-18
reporter: Nutzer (Kai, Handy/PWA) + Agent (Harness nachgemessen)
---

# BUG-0208 — ist die Antwort fertig gestreamt, steht die Spitze am Ende; ihr Anfang bleibt oberhalb

## Gesehen

Nach dem letzten Frame und dem zugehörigen Block-Ereignis bleibt die Lesespitze dort, wo der
Strom endete — also am **Ende** der eben fertigen Nachricht. Der Anfang derselben Nachricht
liegt weit oberhalb und ist damit nie gesehen worden: „wenn du deine Antwort fertig
gestreamt hast, dann solltest du an den Anfang der Nachricht scrollen“.

Im Harness gemessen (Viewport 390×300, Blocks von ~760 px Höhe): Abstand des
Nachrichten-anfangs zur Spitze **−12 355 px**, und die Liste klebt am Fuß
(`footGap=100` bei erlaubter Toleranz: nicht am Fuß).

## Erwartet

Ist ein gestreamter Block fertig, rückt die Ansicht an seinen **Anfang**, sofern der sonst
oberhalb der Lesespitze läge. Ist die Nachricht ganz sichtbar, passiert nichts (kein
Flackern). Danach hält die Ansicht dort, bis der nächste Strom beginnt oder der Leser selbst
scrollt.

## Repro

Hub aus dem E2E-Harness, Dummy mit `liveFrames: true`, `liveChunks: 6`,
`liveChunkDelayMs: 120`, `blockLeadMs: 4000`, `eventsPerSecond: 1`, `cycleTypes: false`
(Blocks sind höher als die Lesespitze).

1. `npx playwright test e2e/specs/live-streaming.spec.ts -g "BUG-0208"`.
2. Sitzung öffnen, Chat-Reiter, bis die Live-Blase sichtbar ist.
3. Warten, bis der erste `assistant`-Block als Ereignis existiert.
4. Prüfen: liegt der Anfang einer Nachricht oben in der Spitze (±24 px) und die Liste nicht
   am Fuß (Fußabstand > 150 px)?

**Ergebnis nach Schritt 4:** ohne Fix „Chat klebt am Fuss (footGap=100)“.

**Häufigkeit:** immer, sobald eine gestreamte Nachricht die Lesespitze überragt.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (E2E-Harness, eigener Hub auf freiem Port) |
| Commit | `9effd963` |
| Node-Version | 24.18.0 |
| Adapter | dummy (verteilte Frames) |
| Repro-Weg | PWA im Harness (Chromium) |

## Tests

| Ring | Datei / Befehl | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/live-streaming.spec.ts` („nach dem Strom steht der Anfang einer Nachricht oben (BUG-0208)“) | rot (`Chat klebt am Fuss (footGap=100)`) |
| Unit | `apps/pwa/test/features/session/*` | grün (unverändert) |

## Eingrenzung

`apps/pwa/src/features/session/SessionTail.tsx`: nach dem Block-Commit wurde nur ans Ende
gerollt (`scrollTo({ top: scrollHeight })`), eine Adresse für den Anfang der eben
fertigen Nachricht gab es nicht. Zusätzlich musste die Zählung der laufenden Ströme nach
`turnId` erfolgen — sonst zog der nächste Frame den gerade gesetzten Sprung sofort wieder
nach unten.


## Fix

Behoben: PR #142 (`42350c8d`). Doku-Abschluss 2026-11-21 (Status-Nachzug).

## Handoff

- [x] Datei im Index `bugs/README.md`
- [ ] GitHub-Issue (URL in `forge:`) — PR enthält den Fix, Issue wird mit dem Merge nachgetragen
- [x] `bugfix` ausgeführt (Fix im selben PR-Zweig, rot→grün belegt)
