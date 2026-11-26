---
id: BUG-0287
slug: spaete-kachelaktualisierung-schreibt-die-adresse-zurueck
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

# BUG-0287 — Zurücktippen wird von einer nachträglichen Kachel-Schreiboperation überschrieben

Anknüpfung: BUG-0282 (`handy-zurueck-pfeil-pendelt`, erledigt) behob den Zurück-Pfeil **in**
der Sitzung. Dieser Fall bleibt dahinter: die **Historie der Browser-Leiste / Handy-Geste**.

## Gesehen

Nach dem Zurücktippen schreibt die App die URL der gerade verlassenen Ansicht erneut in
die Historie. Im Browser ist danach die Sitzung wieder Adress-Ziel, obwohl die Historie
eine andere Ansicht zeigte.

## Erwartet

Ein Zurück-Schritt bleibt wirksam: die Adresse der Ansicht, die zurückgeholt wurde, bleibt
stehen, bis der Nutzer wieder vorwärts geht.

## Repro

Hub läuft (`127.0.0.1:7373`), Handy-Breite (ViewPort 430×900), eine Pi-Sitzung auf
`kaisgamingdesk`.

1. Sitzungsliste öffnen (`#/`), eine Sitzungszeile anklicken.
2. **Noch während die Sitzung lädt** zurücktippen (Browser-Leiste, Handy-Geste, `history.back()`).
3. 1,5 s warten und `location.hash` lesen.

**Ergebnis nach Schritt 3:** direkt nach dem Zurück `#/` (Korrekt), danach wieder
`#/hosts/kaisgamingdesk/sessions/…` — die Adresse der Aufgabe-Ansicht wurde nachgeschrieben.

**Häufigkeit:** bei schnellem Zurücktippen wiederholbar; bei vollständig geladener Sitzung
bleibt der Zurückschritt stehen (dann funktioniert es).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`), ViewPort 430×900 |
| Commit | `89fddc39` |
| Adapter | pi |
| Repro-Weg | PWA (agent-browser, `eval` auf `location.hash`/`history.length`) |

## Logs

Kein Konsolenfehler, keine Seiten-Ausnahme (QA-Durchlauf: „Console messages: 0, Page
errors: 0“). Die Historie selbst ist korrekt besetzt — `history.length` wächst beim Öffnen
einer Sitzung um eins, der Zurückschritt landet auf dem vorherigen Eintrag.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/pwa/src/app/main.test.tsx` (Historie-Block) | kein Fall für „Kacheländerung nach popstate“ |

Fehlender Fall: popstate → danach eine offene, späte Kachel-Aktualisierung ausführen →
Adresse muss die Zurück-Ansicht behalten. Datei: bestehende `main.test.tsx`.

## Eingrenzung

`apps/pwa/src/app/main.tsx`: `changeWorkspace()` (Zeile ~653) schreibt bei **jeder**
Kacheländerung in die Historie, der popstate-Hörer (Zeile ~332) setzt Kacheln aus der
Adresse. Beide Richtungen laufen ohne Erkennung, dass gerade ein Historien-Schritt
ausgeführt wurde. Vorgesehene Richtung: eine Navigations-Marke (Zähler/Epoche) beim
popstate setzen und Kachel-Schreiboperationen, die zu einer früheren Absicht gehören,
nur noch die Kacheln, nicht aber die Historie verändern lassen.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen
