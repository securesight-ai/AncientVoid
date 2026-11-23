---
id: BUG-0257
slug: analyse-ansichten-drei-icons-eine-seite
status: open
severity: S3
area: pwa
instance: dev
commit: "2a7eab27"
forge: "https://github.com/securesight-ai/AncientVoid/issues/295"
epic: ""
created: 2026-11-22
reporter: Nutzermeldung 22.11.2026 (Statistik, Metriken und Inferenz teilen sich ein Icon und stehen als drei Seiten nebeneinander)
---

# BUG-0257 — Statistik, Metriken und Inferenz: drei Ansichten, ein Icon, drei Routen

## Gesehen

Die drei Analyse-Ansichten — Statistik (EPIC-P56/P66), Metriken (EPIC-P59)
und Inferenz/Token-Tempo (EPIC-P79) — sind drei eigene Seiten mit drei
eigenen Navigations-Einträgen, die aber im Dock/der Seitenleiste alle
 dasselbe Icon `bericht` tragen (Dock.tsx `MORE`, sidebar.ts
`SIDEBAR_ENTRIES`: aimetrics/inference/statistics je `icon: "bericht"`).
Die drei Einträge sind im Menü nicht unterscheidbar und verteilen
zusammengehörige Auswertungen auf drei Routen (`#/statistik`, `#/metriken`,
`#/inferenz`).

## Erwartet

**Eine** Seite mit **einem** Navigations-Eintrag/Icon; innerhalb der Seite
per Tab zwischen Statistik, Metriken und Inferenz umschaltbar (Tab in der
URL, Deep-links und alte Links leiten um).

## Repro

PWA am PC/Tablet:

1. „Mehr“-Menü öffnen (Dock.tsx `MORE`).
2. Drei Einträge mit Icon „bericht“: „Metrik“, „Inferenz“, „Statistik“.

**Ergebnis nach Schritt 2:** Icon-Dreizahl — die Einträge unterscheiden
sich nur im Text; jede Auswahl lädt eine eigene Seite.

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (PWA, jede Instanz) |
| Commit | `2a7eab27` |
| Node-Version | 26.13.1 |
| Adapter | — |
| Repro-Weg | PWA |

## Logs

Keine — Struktur-/Navigations-Defekt.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/pwa/test/app/route.test.ts` | grün — pinnt `#/metriken`/`aimetrics` als eigene Page mit (alte Struktur) |
| E2E | `e2e/specs/statistik.spec.ts`, `ki-server-metriken.spec.ts`, `inference-tempo.spec.ts` | grün — erreichen jede Seite über den eigenen Menüpunkt |

Ohne Fix rot werden muss: Route-Tests für `#/statistik/<tab>` + Umleitung
der Altlints, und eine E2E, die alle drei Tabs über **einen** Menüpunkt
erreicht und jeweils eigenen Inhalt sieht.

## Eingrenzung

`apps/pwa/src/app/Dock.tsx:23-25` (drei `MORE`-Einträge, Icon `bericht`),
`apps/pwa/src/features/shell/sidebar.ts` (drei `SIDEBAR_ENTRIES`),
`apps/pwa/src/app/route.ts:59-66` (drei ListPages/Slugs).

## Handoff

- [ ] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen


## Fix (verifiziert 2026-11-23)

- Eine Seite `#/statistik` mit drei Reitern (Statistik · Metrik · Inferenz),
  Reiter-Zustand in der URL (`#/statistik/metriken`, `#/statistik/inferenz`);
  Altlinks leiten permanent um (`redirectLegacyStatHash`, Muster wie
  `#/runs` → `#/teams`). Ein Navigations-Eintrag/Icon in Dock, Seitenleiste
  und Quick-Commands. AiMetricsPage/InferencePage leben als Tab-Inhalte unter
  `features/statistics/` (ADR-0020).
- Rot-dann-grün: `apps/pwa/test/app/route.test.ts` (3 neue Fälle, ohne Fix
  rot via Stash) + E2E `statistik.spec.ts` „eine Seite, drei Reiter …
  Altlinks leiten um“; `ki-server-metriken`/`inference-tempo` navigieren
  über Menüpunkt + Reiter (16/16 grün).