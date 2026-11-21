---
id: BUG-0237
slug: optionsfrage-eigene-antwort
status: done
severity: S2
area: pwa
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/226"
epic: ""
created: 2026-11-20
reporter: "Nutzerbericht"
---

# BUG-0237 — Optionsfragen wirken wie Pflicht zur Texteingabe

## Gesehen

Bei Optionsfragen steht „Eigene Antwort“ dauerhaft unter der Auswahl. Im Nutzerfall wirkte die Auswahl allein nicht als vollständige Antwort.

## Erwartet

Ausgewählte Optionen lassen sich direkt bestätigen. Freitext ist bei Optionen eine bewusst gewählte Alternative.

## Repro

Eine strukturierte Claude- oder ACP-Frage öffnen, eine Option antippen und ohne Freitext antworten.

Der mobile Chromium-Test in `harness.spec.ts` prüft die Auswahl ohne Freitext. Der genaue Harness des ursprünglich gemeldeten Antwortproblems ist im Nutzerbericht offen.

## Tests

`e2e/specs/harness.spec.ts`

## Handoff

- [x] Datei im [Index](README.md)
- [x] GitHub-Issue
- [x] Fix lokal verifiziert

ACP übernimmt jetzt die Pflichtfelder aus `requestedSchema.required`.
Der Browserfall sendet die Auswahl, während drei optionale Felder leer bleiben.
