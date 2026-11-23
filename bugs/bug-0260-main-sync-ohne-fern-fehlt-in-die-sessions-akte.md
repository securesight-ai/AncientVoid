---
id: BUG-0260
slug: main-sync-ohne-fern
status: open
severity: S2
area: workspace
instance: prod
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/296"
epic: "EPIC-P67 / ADR-0088"
created: 2026-11-22
reporter: kai
---

# BUG-0260 — Main-Sync ohne konfiguriertes Haupt-Fern fehlt in die Sessions-Akte

## Gesehen

Ein Projekt ohne `origin`-Fern (z. B. `E:\coding\garmin`) erzeugt laufend
Fehlermeldungen, obwohl an dem Projekt nichts kaputt ist:

1. In der Sessions-Akte (Handy-PWA, Systemnachrichten im Chat-Verlauf) steht
   wiederholt `workspace.main_sync_failed` — beobachtet als Eintrag **#2276 um
   21:17:07** (2026-11-22) in Session `943797b3` (Projekt `E:\coding\garmin`).
2. Zusätzlich eine Projekt-Meldung „Main-Sync gescheitert — Fetch von
   origin/main gescheitert“ (`mainsync.failed`, Notification um 14:48:51Z).

## Erwartet

„Kein Haupt-Fern konfiguriert“ ist eine **benannte Lage**, kein Fehlerfall:

* Der Check (`GET /api/sessions/:id/main-sync`) antwortet mit 501 und Grund
  `no_remote`, **ohne** System-Event in der Session und ohne 502.
* Der Scheduler unternimmt für solche Projekte gar nichts (kein Fetch, keine
  Projekt-Meldung).
* Stufe 1 verhält sich schon richtig (`WorktreeBaseChoice`
  `{source:"local", reason:"no-remote"}`, `worktree.ts:189-192`) — genau dieses
  Muster fehlt in Check und Scheduler.

## Repro

Voraussetzung: Hub läuft, ein Git-Projekt **ohne** `origin`-Fern als Projektordner
einer Worktree-Session.

1. Projekt anlegen: `git init` + ein Commit, **kein** `git remote add origin`.
2. Session auf diesem Projekt starten (`hubctl` oder PWA), Status `idle` abwarten.
3. In der PWA die Sessions-Ansicht öffnen (sie ruft
   `api.mainSyncCheck(session.id)`, `apps/pwa/src/features/session/SessionTail.tsx:268`).
4. Sessions-Akte lesen.

**Ergebnis nach Schritt 4:** Eintrag `workspace.main_sync_failed` in der Akte,
Route lieferte 502, Grundtext „Fetch von origin/main gescheitert (unknown)“.
Die PWA setzt `mainSyncAsked.current = false` zurück
(`SessionTail.tsx:276`) und versucht beim nächsten Öffnen erneut — die Akte füllt
sich weiter.

**Häufigkeit:** immer (jedes Öffnen der Sessions-Ansicht, jeder Scheduler-Takt)

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `566f876b` (main) |
| Node-Version | v24.18.0 |
| Adapter | pi |
| Repro-Weg | PWA + vitest |

## Logs

Sessions-Akte (`hubctl tail`) und Notification-Tabelle:

```text
notifications: 14:48:51Z  mainsync.failed  "Fetch von origin/main gescheitert"  project=E:\coding\garmin
session 943797b3 ...: 21:17:07  #2276 system workspace.main_sync_failed
git -C E:\coding\garmin fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
  fatal: 'origin' does not appear to be a git repository
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit/Integration | `packages/core/test/modules/workspace/main-sync-engine.test.ts` (neuer Fall: Projekt ohne Fern) | fehlt, muss rot sein (heute: Wurf „gescheitert“ + Event in der Akte) |
| Unit | `packages/core/test/modules/workspace/main-sync-scheduler.test.ts` (neuer Fall: kein Fetch für Projekt ohne Fern) | fehlt, muss rot sein (heute: Fetch versucht, Meldung „fetch-failed“) |

## Eingrenzung

* `packages/core/src/modules/sessions/session-manager.ts:1218-1224` —
  `mainSyncCheck` fetcht unbedingt und journalet bei Misserfolg
  `workspace.main_sync_failed`, ohne die in `worktree.ts:189-192` vorhandene
  „kein Fern“-Lage zu kennen.
* `packages/core/src/modules/workspace/main-sync-scheduler.ts:137-152` —
  `runProject` unterscheidet nicht zwischen „Fern nicht erreichbar“ und „gar kein
  Fern“ und meldet Letzteres als `fetch-failed`.
* `packages/core/src/modules/workspace/main-sync-git.ts` — der Remote-Nachweis
  existiert bereits, aber privat in `WorktreeManager.remoteUrl`
  (`worktree.ts:209`).

## Handoff

- [x] Datei im Index `bugs/README.md`
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [x] `bugfix` (PR folgt), nicht offen lassen
