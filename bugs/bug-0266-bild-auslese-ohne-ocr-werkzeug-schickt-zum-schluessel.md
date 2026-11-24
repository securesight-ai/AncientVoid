---
id: BUG-0266
slug: bild-auslese-ohne-ocr-werkzeug-schickt-zum-schluessel
status: done
severity: S2
area: core
instance: dev
commit: ""
forge: ""
epic: ""
created: 2026-11-23
reporter: Kai
---

# BUG-0266 — Bild ohne OCR-Werkzeug meldet „Kein Text gefunden … Gemini-Schlüssel"

## Gesehen

Anhang `image.png` in der Eingabezeile: **„22 KB · Kein Text gefunden. Mit einem
Gemini-Schlüssel in den Einstellungen wird das Bild zusätzlich beschrieben."**
Ein Vision-Schlüssel ist nicht gewollt und nicht nötig — Kai betreibt die
Bildverarbeitung lokal. Und auf dem Hub-Rechner ist gar **kein**
OCR-Werkzeug installiert, der Text im Bild wurde also nie versucht.

## Erwartet

Der Befund nennt, was tatsächlich fehlt, und schickt niemanden auf eine
irreführende Fährte: ohne OCR-Werkzeug auf dem Hub heißt die Antwort „tesseract
fehlt auf diesem Rechner", nicht „besorg einen Schlüssel". Außerdem: das Bild
selbst muss **vor** dem Senden anfassbar sein (Vorschau in der Eingabezeile),
sonst wirkt der Anhang wie ein toter Chip.

## Repro

1. Windows-Hub (127.0.0.1:7373) ohne `tesseract` im PATH (`command -v tesseract`
   findet nichts), kein Vision-Schlüssel in den Einstellungen.
2. Bild einfügen (oder Ablegen) im Eingabefeld.
3. Chip zeigt den Auslese-Text mit Gemini-Hinweis; ein Klick auf den Chip tut
   nichts — eine Vorschau gibt es in der Eingabezeile nicht.

## Ursache und Prüfung

`extractText` (packages/core/src/modules/attachments/extract.ts) fiel bei
Bildern in einen **fest programmierten** Hinweistext, unabhängig davon, ob
`tesseract` vorhanden war: `„Kein Text gefunden. Mit einem Gemini-Schlüssel…"`.
Die Werkzeugprüfung `has("tesseract")` entschied nur übers Machen, nicht über
die Meldung. Der zugehörige Test war zusätzlich an die Anwesenheit von
`tesseract`/`magick` gekoppelt (`it.skipIf(!hasMagick || !hasOcr)`) — auf
Rechnern ohne diese Werkzeuge wurde der Fall **übersprungen**, deshalb fiel der
Falschtext lokal nie auf.

## Umgebung

Windows 11, Hub 127.0.0.1:7373, kein `tesseract`, kein Vision-Schlüssel.

## Tests

`packages/core/test/modules/attachments/extract.test.ts` — neuer, **determini-
scher** Fall über den jetzt injizierbaren Werkzeug-Probierer `hasTool`
(läuft damit auf jedem Rechner, ohne Skip): ohne Werkzeug sagt der Befund
„tesseract" + „voller Größe", erwähnt keinen Schlüssel und nennt das
Vision-Modell nur, wenn keins eingeschaltet ist. Ergebnis: **5 passed |
2 skipped** (die beiden echten OCR-Fälle bleiben Werkzeug-abhängig skipped).

## Eingrenzung

Core: Hinweis-Text werkzeugabhängig, `hasTool` injizierbar. PWA: Vorschaubild
in der Eingabezeile (`AttachmentPicker` → `AttachmentThumb compact`, ein Tipp
öffnet dasselbe Vollbild wie im Chat), der lange Hub-Grund bleibt als `title`
erhalten, die Zeile zeigt nur noch „1 KB · kein Text gelesen". E2E
`e2e/specs/anhang-bilder.spec.ts`: **3 passed** (neu: Vorschau vor dem Senden
öffnen, Esc schließt, Anhang bleibt häangen).

## Handoff

Lokaler Hinweis: `tesseract` auf dem Hub-Rechner installieren (oder Vision am
lokalen Modell anschließen) — dann stimmt auch der ausgelesene Text wieder.

## Abschluss (2026-11-24)

Nachgestellt: `hasTool` ist injizierbar und entscheidet die Meldung
(`packages/core/src/modules/attachments/extract.ts:27`), PWA zeigt
„kein Text gelesen" (`apps/pwa/src/features/attachments/Attachments.tsx:38`),
`e2e/specs/anhang-bilder.spec.ts` existiert.
`npx vitest run packages/core/test/modules/attachments/extract.test.ts` →
7 passed, 0 skipped (tesseract hier vorhanden — auch die echten OCR-Fälle
laufen). Fix im Stand.
