---
id: BUG-0268
slug: strg-klick-ersetzt-kachel
status: done
severity: S3
area: pwa
instance: dev
commit: "dabe85d5c8647d17adffd2c8fe06ed5790c0a738"
forge: "https://github.com/securesight-ai/AncientVoid/issues/322"
epic: ""
created: 2026-11-23
reporter: "Agent (Task PWA Navigationshistorie/Main-Sync/Modal)"
---

# BUG-0268 — Strg-Klick auf eine Session-Karte ersetzt im fixierten Raster die fokussierte Kachel statt eine zweite zu öffnen

## Gesehen

Am PC (breites Layout, fixiertes 1er-Raster) öffnet Strg-/Cmd-Klick auf eine
zweite Session-Karte keine eigene Kachel: Die neue Session ersetzt die
fokussierte Kachel, die bisher sichtbare Session verschwindet aus dem Raster.
Seit dabe85d5 (20.11.2026, „Neue Inhalte im Grid behalten") wertet
`openFromList` das `newTile`-Flag des Karten-Klicks nicht mehr aus.

## Erwartet

Strg-/Cmd-Klick öffnet die Session in einer eigenen Kachel (EPIC-P18:
„Ctrl/⌘-click — open next to the others"), auch im fixierten Raster
(entsprechend lösen/wachsen); die bisher fokussierte Kachel bleibt.

## Repro

E2E (rot, beide Nightly-Versuche vom 22.11.2026, `ci/full-suite`):

```
npx playwright test e2e/specs/main-sync-session.spec.ts -g "Kachelfokus" --project=desktop

  ✘ 150 [desktop] › e2e/specs/main-sync-session.spec.ts:108:3 › BUG-0219: Kachelfokus
     fragt neu — ausgewähltes Projekt zeigt seinen aktuellen Stand @desktop
     Error: locator('[data-tile="2"]').getByTestId('mainsync-behind') — element(s) not found
```

Ablauf: Deep-Link auf Session B (Kachel 1), Strg-Klick auf die Karte von
Session A → `Kachel 2` existiert nicht; Kachel 1 zeigt A, B ist verdrängt.
Lokal auf sauberem HEAD (eb455cb5) identisch reproduziert (11:57, 23.11.2026):
Fehlerbild `error-context.md` zeigt „Eine Kachel [pressed] · Layout lösen
[pressed]" (= fixiert) und Kachel 1 mit alpha-Inhalt.

## Eingrenzung

`apps/pwa/src/features/overview/Dashboard.tsx:658` sendet
`onOpen(session, { newTile: ev.ctrlKey || ev.metaKey })`; `App.tsx` gibt es an
`openFromList` weiter, aber `apps/pwa/src/app/main.tsx` (`openFromList`)
verwirft das opts-Argument (dabe85d5 entfernte die Auswertung). In
`openInNewTile` (tiles.ts, fixierter Zweig) ersetzt `put(ws, focus, ref)` dann
die fokussierte Kachel. Zweite Symptomwurzel im selben Commit: Das Icon der
Ctrl-Taste existiert im UI weiter (Tooltip „Strg/⌘-click").

## Logs

Kein Server-Log (reine PWA-Zustandsfrage). CI-Nightly 45069255649
(22.11.2026, 21:27 UTC): beide Versuche rot; Repro lokal 23.11.2026 11:57.

## Tests

Rot: `e2e/specs/main-sync-session.spec.ts` „BUG-0219: Kachelfokus fragt neu"
(@desktop) — seit dabe85d5. Eine Unit-Lücke in
`apps/pwa/test/features/workspace/tiles.test.ts` (newTile-Pfad durch
`openFromList`) hat den Rückschritt durchgehen lassen; der rote E2E-Fall
existiert schon und muss nur wieder grün werden.


## Fix (2026-11-23)

`openAdditionalTile` in `tiles.ts` (fixiertes Raster wächst eine Layout-Stufe,
Dedup zuerst) und Auswertung von `opts.newTile` in `openFromList`
(`main.tsx:480`). Rot ohne Fix: 4 Unit-Fälle
(`apps/pwa/test/features/workspace/tiles.test.ts`, „BUG-0268") und der neue
E2E-Fall `main-sync-session.spec.ts` „BUG-0268: Strg-Klick ersetzt im
fixierten Raster keine Kachel" (`[data-tile="2"]` element(s) not found,
belaufen per Stash des Fixes). Grün mit Fix: Unit 30/30, E2E 2/2 @desktop,
lint + typecheck.