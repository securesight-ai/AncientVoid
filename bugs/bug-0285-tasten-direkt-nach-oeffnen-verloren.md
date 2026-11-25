---
id: BUG-0285
slug: tasten-direkt-nach-oeffnen-verloren
status: done
severity: S3
area: pwa
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/403"
epic: "P82"
created: 2026-11-25
reporter: "EPIC-P82 Abschlussprüfung (volle E2E-Suite)"
---

# BUG-0285 — Tasten direkt nach dem Öffnen gehen verloren (Fokus, Escape, Pfeil)

## Gesehen

Unter Last springt der Kachelfokus nach Alt+1 zurück, Escape schließt ein eben geöffnetes Vollbild nicht, die Schnellsuche vergisst den ersten Pfeil.

## Erwartet

Eine Taste wirkt, sobald die Fläche sichtbar ist.

## Repro

Strg-Klick auf eine Sitzung und sofort Alt+1; die Taste muss vor dem nächsten Zeichnen eintreffen.

## Tests

`e2e/specs/workspace-tiles.spec.ts` „BUG-0285“: ohne Fix 3/3 rot, mit Fix 3/3 grün. Escape und Pfeil: ohne deterministischen Rot-Beleg; 80 Läufe unter Last (6 Worker) grün.

## Eingrenzung

Passive Effekte liefen erst nach dem Zeichnen: `main.tsx` (Routen-Effekt), `Attachments.tsx`, `CommandBar.tsx`. Jetzt `useLayoutEffect`.
