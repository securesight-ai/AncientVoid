---
id: BUG-0277
slug: extract-test-erwartet-alten-gemini-hinweis
status: done
severity: S3
area: tests
instance: dev
forge: "https://github.com/securesight-ai/AncientVoid/issues/382"
epic: ""
created: 2026-11-23
reporter: "Agent (Issue-Aufarbeitung: rot im lokalen packages/core-Lauf)"
---

# BUG-0277 — extract-Test erwartet den alten Gemini-Schlüssel-Hinweis (seit BUG-0266 anders)

## Gesehen

`packages/core/test/modules/attachments/extract.test.ts` „an image without
text says what would help — Gemini only with a key“ ist rot auf jedem
Rechner mit `magick`+`tesseract` (Konfiguration des Entwicklers):
`expected 'Kein Text im Bild erkannt. Ein eingeschaltetes Vision-Modell …'
to contain 'Gemini-Schlüssel'`. Auf Hosted-Runnern skipt der Fall sichtbar
(kein OCR) — deshalb fiel er in der CI nicht auf.

## Erwartet

Der Test prüft den Schlüssel-losen Befund gegen die aktuelle Meldung:
OCR lief und fand nichts → „Kein Text im Bild erkannt.“ plus der Hinweis auf
das Vision-Modell (seit 231d65ab/BUG-0266; vorher stand hier der
Gemini-Schlüssel-Hinweis). Mit (gestubbtem) Schlüssel fragt der Pfund Gemini
weiter — dieser Teil lief und läuft grün.

## Repro

`npx vitest run packages/core/test/modules/attachments/extract.test.ts` auf
einem Rechner mit OCR-Werkzeugen — rot (2 Läufe, 22:33/23:02, 23.11.2026).

## Eingrenzung

231d65ab (BUG-0266: „Bild-Auslese nennt fehlendes OCR-Werkzeug“) schrieb den
Hint in `extract.ts:193-199` um; die Test-Erwartung blieb auf der alten
Wortmeldung stehen. `skipIf(!hasMagick || !hasOcr)` maskierte es in der CI.

## Fix (2026-11-23)

Erwartung auf die aktuelle Meldung umgestellt („Kein Text im Bild erkannt“ +
„Vision-Modell“). Rot ohne Fix belegt (2 Läufe), grün mit Fix: Datei 7/7,
attachments 9/9, lint grün.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [x] `bugfix`
