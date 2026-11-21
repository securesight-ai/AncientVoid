---
id: BUG-0228
slug: archivieren-verlaesst-ansicht-nicht
status: done
severity: S3
area: pwa
instance: dev
forge: "https://github.com/securesight-ai/AncientVoid/issues/214"
epic: ""
created: 2026-11-20
reporter: "Kai (Nutzerreport: „wenn ich eine Session archiviere, will ich, dass am Handy die App zurück in die Übersicht springt und am PC die Kachel geleert wird — beides funktioniert gerade nicht richtig“)"
---

# BUG-0228 — Archivieren verlässt die Ansicht nicht: Handy bleibt in der Session, die PC-Kachel bleibt voll

## Gesehen

Wird eine Session archiviert, bleibt die Ansicht, die sie gerade zeigt,
unangetastet: Auf dem Handy/tablet bleibt die Session-Ansicht offen (Menü
„Archivieren“ schaltet nur auf „Zurückholen“ um), und am PC bleibt die
Kachel mit der archivierten Session belegt — auch wenn das Archivieren auf
einem anderen Gerät (Handy) passiert. Der alte E2E-Test
`workspace.spec.ts` („Archivieren aus der Session heraus bleibt nach
Reload“) pinnte genau dieses Bleiben als erwartetes Verhalten fest.

## Erwartet

Archivieren ist ein Verlassen: Das Handy/tablet springt zurück in die
Übersicht, am PC räumt die Kachel die Session ab — sofort beim eigenen
Klick und innerhalb des 3-s-Polls, wenn ein anderes Gerät archiviert hat.
„Zurückholen“ bleibt dagegen in der Ansicht (die Session ist wieder
aktiv), und eine bereits archiviert geöffnete Session (Archivliste) wird
nicht fortgeworfen.

## Repro

Voraussetzung: Hub lokal, eine Session (dummy/opencode).

1. PWA am Handy (schmal): Session öffnen → Menü ⋯ → „Archivieren“.
2. **Ergebnis:** Ansicht bleibt in der Session stehen; nur der Menütext
   wechselt auf „Zurückholen“. Erwartet: Zurück in der Übersicht (`#/`),
   Karte verschwunden.
3. PWA am PC (≥ 1280 px): Session per Klick in Kachel 1 öffnen.
4. Menü ⋯ in der Kachel → „Archivieren“ — **Ergebnis:** Kachel bleibt
   belegt. Erwartet: „Kachel 1 ist frei“.
5. Gleicher Aufbau, archivieren per API von außen (simuliert das Handy):
   `POST /api/sessions/<id>/archive {"archived":true}` — **Ergebnis:**
   Kachel bleibt über den 3-s-Poll hinaus belegt.

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `11e02f2b` |
| Node-Version | 26 |
| Adapter | beliebig (dummy im Repro) |
| Repro-Weg | PWA (E2E: mobile + Desktop-Viewport 2560 px) |

## Logs

Keine — reiner UI-Zustandsfehler, kein Hub-/Adapterfehler. Beobachtet über
die roten E2E-Läufe vor dem Fix (siehe Tests).

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/workspace.spec.ts:36` ( Handy → Übersicht) | rot (neu geschrieben; der Vorgänger-Test pinschte das Bleiben) |
| E2E | `e2e/specs/workspace-tiles.spec.ts:135` (Kachel leert sich) | rot |
| E2E | `e2e/specs/workspace-tiles.spec.ts:145` (Fernarchivierung räumt Kachel ab) | rot |

## Eingrenzung

`apps/pwa/src/features/session/SessionTail.tsx` — `toggleArchive()` und
der `onArchive`-Pfad des `InterruptedBanner` setzen nach erfolgreichem
`api.setArchived` nur lokalen Zustand (`setArchived`) und navigieren nie;
es gab keinen `onArchived`-Draht zur Kachel und keine Reaktion auf den
Archivierungs-Übergang im 3-s-`record`-Poll.
`apps/pwa/src/features/workspace/TileWorkspace.tsx` — `Tile` gab
`onClose` nie an `SessionTail` weiter.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [x] `bugfix` (Fix: `leaveArchived()` in SessionTail — Kachel-Kontext
      räumt über `onArchived`/`onClose` ab, sonst `onNavigate("dashboard")`;
      zusätzlich löst der Übergang nicht-archiviert → archiviert im
      `record`-Poll dasselbe aus. Verifiziert rot-dann-grün, siehe Tests.)
