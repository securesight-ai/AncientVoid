---
id: BUG-0221
slug: hintergrundbild-upload-quetscht-beschriftung
status: done
severity: S3
area: pwa
instance: dev
commit: "1e3ee9fa"
forge: "https://github.com/securesight-ai/AncientVoid/issues/188"
created: 2026-11-19
reporter: Nutzer
---

# BUG-0221 — Hintergrundbild-Upload quetscht Beschriftung auf 1 Buchstabe/Zeile

## Gesehen

Einstellungen → Voreinstellungen → „Lokales Hintergrundbild": Nach dem
Auswählen einer Datei (langer Dateiname) zieht sich der Beschriftungstext
(„Lokales Hintergrundbild" + Hinweis) extrem in die Länge — **1 Buchstabe je
Zeile**. Die Zeile ist unbenutzbar; betroffen ist jeder schmale Container
(Handy, schmale Werkzeugfläche).

## Erwartet

Wie bei allen Bedienelementen der Einstellungen: In schmalen Containern
(≤ 520 px) stapelt die Zeile — Beschriftung oben in voller Breite,
Bedienelement darunter — statt die Beschriftung zu quetschen (dokumentiertes
Muster in `24-settings.css`: „statt die Beschriftung zu quetschen"). Das
file-Input darf die Zeile nie sprengen.

## Repro

E2E (Geometrie, Muster `layout-beweis`): PWA im Mobil-Viewport öffnen →
Einstellungen → Voreinstellungen → Breite des Labels „Lokales Hintergrundbild"
messen. Erwartet: volle Zeilenbreite (> 200 px bei 375 px Viewport); beobachtet:
weit unter 30 px — ein Zeichen je Zeile, mit gewähltem Dateinamen noch schmaler.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`), PWA auf dem Handy |
| Commit | `1e3ee9fa` |
| Ansicht | Einstellungen → Voreinstellungen |
| Repro-Weg | PWA (Mobil-Viewport) |

## Ursache

`apps/pwa/src/app/styles/24-settings.css:107-121` — die Container-Stapel-Regel
(`:has(.scale-control)`, `:has(.quiet-control)`, `:has(.setting-control >
.btn)`) kennt **file-Inputs nicht**. `<input type="file">` hat eine native
intrinsische Mindestbreite; nach Dateiauswahl wächst sie um den Dateinamen —
die `auto`-Spalte des `setting-row`-Grids (`minmax(0,1fr) auto`) frisst die
ganze Zeile, die Label-Spalte kollabiert, `overflow-wrap: anywhere` auf
`.setting-title` bricht jeden Buchstaben um.

## Fix-Richtung

1. File-Inputs in die bestehende Stapel-Regel aufnehmen
   (`:has(.setting-control > input[type="file"])`).
2. Zusätzlich `input[type="file"]` im Setting-Kontext schrumpfbar machen
   (`max-width: 100%`), damit auch breite Felder/Dateinamen in der Desktop-
   Spalte (zweispaltig, aber schmal) nie die Zeile sprengen.

## Testlücke

Keine Geometrie-Prüfung für Setting-Zeilen mit breitem Bedienelement — die
Stapel-Regel war nie für file-Inputs getestet.

## Fix (2026-11-19)

`24-settings.css`: file-Inputs in die bestehende Container-Stapel-Regel
aufgenommen (≤ 520 px: Label volle Breite, Control darunter linksbündig) und
`input[type="file"]` im Setting-Kontext schrumpfbar (`max-width: 100%`,
`min-width: 0`) — auch breite Dateinamen sprengen die Zeile nie mehr. Beleg:
`e2e/specs/settings-file-row.spec.ts` misst Label-Breite vs. Zeilenbreite im
Mobil-Viewport — ohne Fix rot (Label < 30 px), mit Fix grün (> 60 % der
Zeilenbreite, Control bleibt in der Kartenbreite).

