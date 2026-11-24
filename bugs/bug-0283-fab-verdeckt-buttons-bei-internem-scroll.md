---
id: BUG-0283
slug: fab-verdeckt-buttons-bei-internem-scroll
status: done
severity: S2
area: pwa
instance: dev
commit: "140f15be"
forge: "https://github.com/securesight-ai/AncientVoid/issues/418"
epic: ""
created: 2026-11-24
reporter: "Nutzer (Layout-Report „Buttons der Sessions leicht verdeckt“, Omarchy Linux)"
---

# BUG-0283 — der Sprach-FAB verdeckt Karten-Buttons: die Ausweichprüfung hört nur auf window-Scroll, internes Listen-Scrollen erreicht sie nie

## Gesehen

Nutzerreport (24.11.2026): „Die Buttons der Sessions überlagern sich mit der
Footer-Bar und sind leicht verdeckt.“ Messung (layout-beweis, E2E-Harness,
390×844, Übersicht mit 18 Sessions, Scrollpositionen 0/25/50/75/100 %):
der Nyx-FAB (fix, 64×64, rechts über dem Dock) liegt auf dem „⋯“-Aktionsknopf
der untersten sichtbaren Session-Karte — an **jedem** messenden Punkt:

```text
STATION   0%  Aktionen für Übersicht 4@718  -> nyx-sprite nyx-quiet
STATION  50%  Aktionen für Übersicht 11@726 -> nyx-sprite nyx-quiet
STATION 100%  Aktionen für Übersicht 18@735 -> nyx-sprite nyx-quiet   (letzte Karte)
```

Der Treffer ist der FAB (bzw. sein Sprite-`<img>`) — ein Tipp geht nicht an den
Karten-Knopf. Auf Touch ist „⋯“ der einzige Weg zu Archiv/Löschen/Anheften
(`.row-action` ist dort ohne langes Drücken `display:none`), also ist die
Aktion an dieser Stelle **nicht erreichbar**.

## Erwartet

Die BUG-0199-Invariante gilt auch hier: Kein Bedienelement liegt unter dem FAB
— die automatische Platzierung weicht aus oder blendet den FAB aus, sobald ein
Control unter seine Fläche wandert.

## Repro

E2E-Hub mit Dummy-Adapter, PWA im Handy-Viewport:

1. 18 Sessions anlegen (`hub.createSession({ adapter: "dummy", … })`).
2. `#/` öffnen, bis die Liste intern scrollt.
3. `.dashboard` nacheinander auf 0/25/50/75/100 % der Scrollhöhe setzen,
   je 240 ms Absetzzeit (Entprellung 140 ms).
4. Je Station den Mittelpunkt jedes sichtbaren Karten-Aktionsknopfs
   (`elementFromPoint`) prüfen.

**Ergebnis nach Schritt 4:** Treffer `nyx-sprite nyx-quiet` an 3 von 5 Stationen,
dauerhaft (auch nach 700 ms Warten — die Prüfung läuft schlicht nie).

**Häufigkeit:** immer (jede intern scrollende Fläche: Übersichtsliste BUG-0099,
Chat-Verlauf `.tail-scroll`; Fenster-Scroll wie auf `#/einstellungen` bleibt
heil)

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (E2E-Hub des Harness) |
| Commit | `140f15be` |
| Node-Version | 22 |
| Adapter | dummy |
| Repro-Weg | PWA (Playwright, 390×844) |

## Logs

Keine — reines Layout (Geometrie-Messung, s. Repro). PWA-Konsole leer
(E2E-Fixture prüft `pageerror`).

## Tests

| Ring | Befund / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/pwa/test/features/stt/fab-clearance.test.ts` | grün — rechnet nur Kandidaten, kennt keine Events |
| E2E | `e2e/specs/nyx-fab.spec.ts` „BUG-0199: auf langen Seiten ohne Dock …“ | grün — scrollt nur `window`, nie einen inneren Scroller |

Ohne Fix rot sein müsste: ein E2E-Fall in `e2e/specs/nyx-fab.spec.ts`, der die
BUG-0199-Sonde gegen die **intern** scrollende Übersichtsliste fährt.

## Eingrenzung

`apps/pwa/src/features/stt/NyxFab.tsx:144` — die Ausweichprüfung hängt an
`window.addEventListener("scroll", …)`. Scroll-Events blubbern nicht: die
Übersichtsliste (BUG-0099: Fenster scrollt nie, `.dashboard` scrollt intern)
und der Chat-Verlauf (`.tail-scroll`) feuern auf dem Container, nicht auf
`window` — `pruefen()` läuft nach dem ersten Rendern nie wieder. BUG-0145s
80 px End-Polster schützt nur das Listenende, nicht die mittleren Positionen.


## Behoben (24.11., BUG-0283)

**Fix:** die Ausweichprüfung hört jetzt auf zwei weitere Quellen, beide in die
bestehende 140-ms-Entprellung (`NyxFab.tsx`):

1. `document.addEventListener("scroll", …, { capture: true })` — Capture sieht
   Scroll-Events jedes inneren Scrollers (blubbern nicht), also Übersichtsliste
   und Chat-Verlauf.
2. `MutationObserver` auf `document.body` (`childList`, `subtree`) — datengetriebene
   Umbrüche (Sessions wandern nach „fertig“ in die Ruhig-Gruppe, Verlauf wächst)
   schieben Karten ohne jedes Scroll-Event unter den FAB. Beobachtet im Diagnose-
   Lauf: 2,6 s nach Mount (alle Timer durch) lag Karte 4s „⋯“-Knopf unterm FAB.

Vorher/nachher (390×844, Übersicht mit 18 Sessions, Listen-Scrollpunkt 0):

| Messpunkt | vor dem Fix | nach dem Fix |
|---|---|---|
| Scrollpunkt 0 px | `link-btn row-menu-btn -> nyx-sprite nyx-quiet` | frei (FAB weicht aus) |
| alle Punkte 0 … max in 60-px-Schritten | Treffer an mehreren Punkten | **keine Treffer** |

**Tests:** `e2e/specs/nyx-fab.spec.ts` „BUG-0283: intern scrollende Übersichtsliste —
der FAB verdeckt kein Karten-Bedienelement“ — rot vor dem Fix (Scrollpunkt 0 px,
Retry reproduzierbar), grün danach; gesamte Spec 11 passed. Lint, Typecheck,
`apps/pwa/test/features/stt/` (18 Tests) grün.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
