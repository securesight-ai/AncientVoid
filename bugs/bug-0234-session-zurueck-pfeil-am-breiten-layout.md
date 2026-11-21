---
id: BUG-0234
slug: session-zurueck-pfeil-am-breiten-layout
status: done
severity: S4
area: pwa
instance: dev
commit: "40a5f239"
forge: "https://github.com/securesight-ai/AncientVoid/issues/222"
epic: ""
created: 2026-11-20
reporter: "Nutzer (Maki-Session)"
---

# BUG-0234 — Zurück-Pfeil neben dem Session-Titel am Tablet/PC überflüssig

## Gesehen

Neben dem Session-Titel steht auch am Tablet/PC der „← Zur Übersicht“-Pfeil,
obwohl dort die Session-Liste (Split bzw. Tablet-Strip ab 700 px) dauerhaft
sichtbar ist.

## Erwartung

Ab 700 px Breite bleibt der Pfeil weg (Liste ist der Weg zurück); am Handy
unter 700 px bleibt er, dort gibt es keine sichtbare Liste.

## Repro

1. PWA am PC/Tablet (≥ 700 px) öffnen, Session öffnen.
2. Topbar besichtigen: „←“ vor dem Titel.

**Ergebnis nach Schritt 2:** Pfeil vorhanden, obwohl Liste sichtbar ist.

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `40a5f239` |
| Node-Version | 22 |
| Adapter | beliebig |
| Repro-Weg | PWA |

## Logs

Keine.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/layout.spec.ts` („Zurück-Pfeil nur unter 700 px …") | nicht vorhanden — rot ohne Fix belegt |

## Eingrenzung

`apps/pwa/src/features/session/SessionTail.tsx` rendert den Button unbedingt;
Listen-Sichtbarkeit ab 700 px: `apps/pwa/src/app/main.tsx` (`TABLET`/`WIDE`).

## Befund

Der Pfeil wurde unabhängig von der Listen-Sichtbarkeit gerendert. Fix:
`@media (min-width: 700px) { .session-topbar .back-btn { display: none; } }`
— gleiche Grenze wie TABLET/WIDE. Am Handy bleibt er. E2E rot-vor-grün
(layout.spec: sichtbar 390 px, versteckt 900 px). Hinweis: der ältere
Layout-Test „Hälfte der Höhe“ ist auf diesem Rechner auch ohne diese Änderung
rot (0.4675, Umgebungsunterschied) — vorbestehend, keine Regression.

## Handoff

- [ ] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen
