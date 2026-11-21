---
id: BUG-0232
slug: graph-kategorien-stattdessen-gruppen
status: done
severity: S3
area: pwa
instance: dev
commit: "40a5f239"
forge: "https://github.com/securesight-ai/AncientVoid/issues/220"
epic: ""
created: 2026-11-20
reporter: "Nutzer (Maki-Session)"
---

# BUG-0232 — Graph-Kategorienfilter kennt die Bereiche des Repos nicht (epics, bugs, …)

## Gesehen

Der Filter der Graph-Ansicht kennt nur die festen Gruppen Doc/Code/Config.
Häufige Bereiche eines Repos — beim AncientVoid-Hub z. B. `epics/`, `bugs/`,
`docs/`, `packages/` — sind nicht als Kategorie filterbar.

## Erwartet

Die Karte erkennt Kategorie-Bereiche dynamisch aus dem gescannten Repo
(Top-Level-Verzeichnisse wie `epics`, `bugs`, …, häufig vorkommende zuerst)
und bietet sie als Filter-Chips an; die Filterung dimmt alles außerhalb wie
bei den Gruppen.

## Repro

Voraussetzung: Hub mit einem Repo aus mehreren Top-Level-Bereichen.

1. Graph-Tab öffnen.
2. Filterzeile besichtigen: nur Doc/Code/Config/Nur tote/Nur Fehler.

**Ergebnis nach Schritt 2:** keine Repo-Bereiche filterbar.

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
| Unit | `packages/core/test/modules/graph/graph.test.ts` | grün (kennt kein category) |
| Unit | `apps/pwa/test/features/graph/galaxy-query.test.ts` | grün (kennt kein categoriesOf) |

## Eingrenzung

`packages/contracts/src/graph/graph.ts:9` — `GraphNode` trägt nur die
Erweiterungs-`group`; `packages/core/src/modules/graph/scan.ts:235` erzeugt
keine Bereichsangabe; `GalaxyPanel.tsx` rendert nur die statischen Gruppen.

## Befund

`GraphNode` trug nur die Erweiterungsgruppe (doc/code/config/other) —
Repo-Bereiche waren nicht abbildbar. Fix: `category` (erstes
Pfadsegment, Wurzeldateien null) als optionales Contract-Feld, vom Scan
mitgegeben (`graphCategoryOf`); die PWA leitet daraus dynamische
Kategorie-Chips ab (`categoriesOf`: häufige zuerst, ab 2 Dateien, max. 12,
Wurzel gebündelt), filtert darüber wie bei Gruppen und persistiert die
Wahl im Ansichtsstand (Relikte werden beim Restaurieren verworfen).
Unit (core+galaxy-query) und E2E (Chips aus Repo-Verzeichnissen,
aria-pressed + Persistenz) belegt.

## Handoff

- [ ] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen
