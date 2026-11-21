---
id: BUG-0207
slug: live-strom-rollt-nicht-mit
status: done
severity: S3
area: pwa
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/pull/142"
epic: "ADR-0083 (betroffen: Live-Frames), EPIC-P43 (Lesbarkeit des Chats)"
created: 2026-11-18
reporter: Nutzer (Kai, Handy/PWA) + Agent (Harness nachgemessen)
---

# BUG-0207 — beim Live-Strom wächst der Text unter der Lesespitze weg, die Liste rollt nicht mit

## Gesehen

Am Handy (PWA) bei einer Session mit langem Live-Strom (Denken und Antworten werden
Frame für Frame übertragen) bleibt die Lesespitze stehen und der Text wächst nach unten
davon: „ich sehe immer nur die ersten Zeilen und dann schreibst du mir aus dem Bildschirm
raus und scrollst nicht mit — beim thinking ist das ein Problem“.

Im E2E-Harness gemessen (Viewport 390×420, Frames verteilt über mehrere Sekunden, **keine**
eintreffenden Block-Ereignisse): Unterkante der Live-Blase **911 px** bzw. **891 px** unter
dem Rand des Lesefensters.

## Erwartet

Solange Frames eintreffen, läuft die Liste am Fuß mit — auch dann, wenn in dieser Phase kein
einziges Ereignis eintrifft (Frames sind kein Ereignis). Wer selbst nach oben gelesen hat,
darf dabei nicht zurückgezogen werden.

## Repro

Hub aus dem E2E-Harness, Dummy-Adapter mit verteilt gesendeten Frames
(`liveChunks: 40`, `liveChunkDelayMs: 150`, `blockLeadMs: 9000`, `eventsPerSecond: 1`,
`cycleTypes: false`) — damit ist die Phase erzwungen, in der Frames laufen und keine
Block-Ereignisse eintreffen.

1. `npx playwright test e2e/specs/live-streaming.spec.ts -g "BUG-0207"`.
2. Fall 1: Sitzung öffnen, Chat-Reiter, beim Einlaufen der Frames die Geometrie von
   `.tail-scroll` und `[data-testid='chat-live']` vergleichen.
3. Fall 2: wie Fall 1, aber mit vorher gemerkter Scrollposition
   (`localStorage: ancientvoid.tailScroll.<sessionId>.chat = 260`) — Kais „Sitzung wieder
   geöffnet“-Fall.

**Ergebnis nach Schritt 2/3:** Blase unter dem Rand (`-911` / `-891`); in Fall 2 rollt gar
nicht mit, weil das Anheften beim Wiederherstellen der Position ausgeschaltet war und von
Frames nie wieder scharf wurde.

**Häufigkeit:** immer bei längeren Live-Stromen.

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
| E2E | `e2e/specs/live-streaming.spec.ts` („Live-Frames ohne neue Ereignisse … (BUG-0207)“, zwei Fälle) | rot (`-911`, `-891`) |
| Unit | `apps/pwa/test/tail-scroll.test.ts`, `apps/pwa/test/features/session/*` | grün (unverändert) |
| Contract | `packages/adapters/dummy/test/contract.test.ts` | grün (neue Defaults unverändert) |

## Eingrenzung

`apps/pwa/src/features/session/SessionTail.tsx`: das Anheften geschah in einem
`useEffect` mit Abhängigkeit `[events, activeTab, filter]` — Live-Frames landen in
`liveText` und änderten diese Abhängigkeit nie. Zusätzlich blieb `stickRef` nach einer
gemerkten Position auf `false` und wurde durch Frames nie wieder eingeschaltet.


## Fix

Behoben: PR #142 (`42350c8d`). Doku-Abschluss 2026-11-21 (Status-Nachzug).

## Handoff

- [x] Datei im Index `bugs/README.md`
- [ ] GitHub-Issue (URL in `forge:`) — PR enthält den Fix, Issue wird mit dem Merge nachgetragen
- [x] `bugfix` ausgeführt (Fix im selben PR-Zweig, rot→grün belegt)
