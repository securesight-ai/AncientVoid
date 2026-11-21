---
id: BUG-0244
slug: neue-session-kachel1-layout
status: done
severity: S3
area: pwa
instance: dev
commit: "a5aed0f6"
forge: "https://github.com/securesight-ai/AncientVoid/issues/236"
epic: ""
created: 2026-11-20
reporter: silenttz
---

# BUG-0244 — Neue Session öffnet nicht in Kachel 1; Formular zu lang

## Gesehen

Auf dem breiten Layout landet „Neue Session“ in der ersten freien Kachel
(oft Kachel 2+), statt fest in Kachel 1. Das Formular ist einspaltig und
erfordert viel Scrollen am PC (und am Tablet).

## Erwartet

„Neue Session“ öffnet immer in Kachel 1 (Index 0). Am PC/Tablet nutzt das
Formular zwei Spalten, sobald die Kachel breit genug ist, damit weniger
gescrollt werden muss.

## Repro

Voraussetzung: Hub läuft, PWA breit (≥700 px), mindestens eine Session in
Kachel 1.

1. Session in Kachel 1 öffnen.
2. Dock/Sidebar „Neue Session“ wählen (`#/neu`).
3. Beobachten, in welcher Kachel das Formular erscheint und wie lang die
   Scrollstrecke ist.

**Ergebnis nach Schritt 2:** Formular in Kachel 2+; einspaltiges Layout.

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal |
| Commit | `a5aed0f6` |
| Repro-Weg | PWA (Code-Pfad) |

## Logs

```text
openInNewTile wählt first-empty statt Index 0 — tiles.ts:76–82
CreateSession nutzt .form-grid einspaltig — CreateSession.tsx:329
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/pwa/test/features/workspace/tiles.test.ts` | Lücke: kein Pin auf Kachel 1 |
| Unit | Layout-CSS / CreateSession-Markup | Lücke |

Welcher Test **müsste** ohne Fix rot sein? `openInTile`/`page:new` → Fokus Index 0
trotz belegter Kachel 1.

## Eingrenzung

`apps/pwa/src/features/workspace/tiles.ts`, `apps/pwa/src/app/main.tsx`,
`apps/pwa/src/features/new-session/CreateSession.tsx`, Form-CSS.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt
- [x] `bugfix`
