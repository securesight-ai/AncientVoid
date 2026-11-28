---
id: BUG-0292
slug: uebergabe-blatt-unter-dem-dock
status: done
area: pwa
instance: dev
commit: "ae50cbd9"
forge: "https://github.com/securesight-ai/AncientVoid/issues/477"
epic: ""
created: 2026-11-28
reporter: "Nutzer (mündlich, Handy)"
---

# BUG-0292 — Übergabe aus der Karte: Blatt unterm Dock, Knöpfe tot, Flackern

## Gesehen

„Übergeben…“ im Kartenmenü der Übersicht öffnet die Übergabe als
untenliegendes Blatt, das **im Karten-DOM** hängt. Nutzerbericht
(28.11.2026): „Der Übergabe Modal ist kaputt! […] Aktuell flackert alles
und ich kann keine Buttons mehr klicken!“ — das Blatt liegt unter dem
Dock, die Hinterlegung deckt nur die App-Spalte.

## Erwartet

Die Übergabe ist dasselbe zentrierte Modal wie „Neue Session“
(BUG-0291): Kopf mit Titel und ✕, Hinterlegung über dem ganzen Fenster,
Knöpfe klickbar — und der Übergabetext (Hub-Entwurf) steht wie bisher
schon im Textfeld.

## Repro

E2E-Hub (Playwright, Projekt „mobile“ = Pixel 7), Commit `ae50cbd9`
(Wegwurf-Spec, Muster der Recherche):

1. `hub.createSession(adapter: "dummy")` mit laufenden Events (10/s,
   endlos).
2. Kartenmenü „⋯“ → „Übergeben…“.
   **Ergebnis:** Blatt (`ui-sheet`, bottom-sheet-Variante) mit
   Stammbaut `.card.session-card` — also innerhalb `#app > .app-page`;
   `pageTransform: matrix(0.97, …)` (T86.3-Rückzug), Stapelkette des
   Blatts: `.ui-sheet (z=60, transform)` → `.app-page (transform,
   z=auto)` — der Dock (`.dock-stack`, `--z-dock: 20`) liegt darüber.
3. „Abbrechen“ klicken.
   **Ergebnis:** Timeout — Playwright: „`dock-more …` subtree
   intercepts pointer events“. JS-`click()` dagegen schließt — die
   Handler leben, nur die Trefferfläche ist verdeckt.
4. Hinterlegung vermessen: Rechteck 388×839 bei x=12 statt 412×839
   bei x=0 — `inset: 0` bezieht sich seit dem Transform auf
   `.app-page`, nicht auf das Fenster. Beim Öffnen (320 ms
   Übergang) wandert das Blatt mit der skalierten Seite — das
   sichtbare „Flackern“.

**Häufigkeit:** immer (Übergabe aus der Karte, jede Breite).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | E2E-Hub (127.0.0.1, Playwright) |
| Commit | `ae50cbd9` |
| Node-Version | 25 (Node strip-types) |
| Adapter | dummy (Quelle) → beliebiges Ziel |
| Repro-Weg | PWA (Playwright) |

## Logs

Keine Hub-Log-Zeilen betroffen (rein clientseitige Darstellung); Beleg
sind die gemessenen Rechtecke/Stapelketten oben.

## Tests

| Ring | Befund / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/uebergabe-modal.spec.ts` | nicht vorhanden — rot ohne Fix (alle 3 Tests) |

## Eingrenzung

`apps/pwa/src/features/overview/Dashboard.tsx` (Karte): Sheet im
Karten-DOM statt Modal. Ursache zweigeteilt: (1) Render-Ort —
`position: fixed` im transformierten Vorfahren `.app-page` (T86.3)
verliert Fensterbezug und Stapelkontext an den Dock; (2) Variante —
bottom-sheet statt `variant="modal"` wie BUG-0291.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt: [#477](https://github.com/securesight-ai/AncientVoid/issues/477)
- [x] `bugfix` gelaufen (Fix: `HandoverModal` als Body-Portal im
      Neues-Session-Look) — erledigt, verifiziert (s. Tests)
