---
id: BUG-0267
slug: eingefuegtes-bild-ohne-ocr-hinweis-bleibt-liegend
status: fixed
severity: S2
area: core
instance: dev
commit: ""
forge: ""
epic: ""
created: 2026-11-23
reporter: Kai
---

# BUG-0267 — Eingefügtes Bild bleibt beim Agenten liegen („kein Text auslesbar")

## Gesehen

Kai fügt einen Screenshot in den Chat ein und erwartet, dass der Agent das Bild
**sieht** („das klappt doch auch"). Beim Adapter `pi` (Zusagen `images: false`,
`files: false`) baut der Hub den Prompt aus dem **ausgelesenen Text**; ohne OCR
auf dem Hub-Rechner steht in dem Block nur:

    [Anhang 1: bild.png (image/png, 21 KB) — Datei: <Pfad>]
    (kein Text auslesbar)

Der Pfad war da, der Hinweis nicht: ein Agent, der den Block überfliegt, hat
damit keinen Grund, die Datei zu öffnen. Das Bild blieb faktisch ungenutzt.

## Erwartet

Ein Bild ohne ausgelesenen Text wird dem Agenten als **Bild** angekündigt — mit
dem Satz, es mit seinem Datei-/Bild-Werkzeug zu sehen. Kein Vision-Schlüssel,
kein OCR nötig: das Bild liegt als Datei im Datenverzeichnis des Hubs.

## Repro

1. Hub mit Adapter `pi`, `tesseract` nicht installiert.
2. Screenshot ins Eingabefeld einfügen, Zug senden.
3. Ereignis `session.prompt` ansehen: der Anhangs-Block endet mit
   „(kein Text auslesbar)".

## Ursache und Prüfung

`promptWithAttachments` (packages/contracts/src/attachments/attachment.ts)
unterscheidet nicht zwischen „Text nicht lesbar" und „gar kein Text vorhanden,
aber ein Bild". Für Nicht-Text-Anhänge gab es genau einen Vermerk.
Rot-vor-grün über den neuen Test
`packages/contracts/test/attachments/prompt-with-attachments.test.ts`:
**2 failed | 3 passed** (Bild-Hinweis fehlte), nach dem Fix **5 passed**.

## Umgebung

Windows 11, Hub 127.0.0.1:7373, Adapter `pi`, ohne `tesseract`.

## Tests

`packages/contracts/test/attachments/prompt-with-attachments.test.ts`
**5 passed**: Bild ohne OCR-Text nennt „Bild … mit dem Datei-/Bild-Werkzeug
ansehen" plus Pfad; Nicht-Bilder bleiben kurz („(kein Text auslesbar)");
ausgelesener Text behält die Methoden-Angabe; nativ übergebene Anhänge bleiben
„(als Datei übergeben)".

## Eingrenzung

Contracts-Prompt-Text, kein Adapter-Wechsel: `pi` behält `images: false` /
`files: false`, weil das Bild **nicht** nativ übergeben wird — es liegt als Datei
im Hub-Datenverzeichnis und der Agent öffnet sie selbst. Adapter mit
Bild-Zusage (`claude`, `opencode`, `codex app-server`) bekommen das Bild
weiterhin als echtes Bild.

## Handoff

Zusammenhang mit BUG-0266 (fehlendes OCR-Werkzeug) und EPIC-P7 (Anhänge). Wer
Bild**beschreibung** im Hub selbst will (ohne Agenten), braucht einen Vision-
Endpoint — eigene Funktion, nicht dieses Ticket.
