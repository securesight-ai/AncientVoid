---
id: BUG-0224
slug: mainsync-scheduler-flutet-benachrichtigungen
status: done
severity: S2
area: core
instance: live
commit: "5c722433"
forge: "https://github.com/securesight-ai/AncientVoid/issues/197"
epic: "EPIC-P67"
created: 2026-11-19
reporter: "Kai (Nutzerreport, „main not synced … in x-facher Ausführung“)"
---

# BUG-0224 — Main-Sync-Scheduler flutet die Benachrichtigungen (je Takt/je Session)

## Gesehen

Die Glocke zeigt dieselbe Main-Sync-Meldung in x-facher Ausführung. Live-Daten
(Haupt-Hub, `data/hub.db`, letzte 2 Tage, 2026-11-19 abgefragt):

- 390× `mainsync.failed` „AncientVoid · Main-Sync gescheitert“ (00:04–17:59, alle 5 min weiterlaufend)
- 745× Detail „Fetch von origin/main gescheitert“, 342× „dry-run-failed“
- 82× `mainsync.behind` „AncientVoid · 527 Commits hinter main“ innerhalb von 23 s
- gesamt 2070 Benachrichtigungs-Rows in 2 Tagen

## Erwartet

Eine Main-Sync-Meldung je Projekt und Zustand (Premortem 5 zu EPIC-P67:
„Benachrichtigungsflut“). Kein neuer Row je Takt, keiner je Session desselben
Projekts, keiner je Netz-Flap.

## Repro

Live am Haupt-Hub (read-only SQL, `data/hub.db`):

```sql
SELECT kind, title, count(*) c, min(created_at), max(created_at)
FROM notifications WHERE created_at > datetime('now','-2 days')
GROUP BY kind, title HAVING c > 1 ORDER BY c DESC;
```

**Ergebnis:** 390×/288×/252× `mainsync.failed`, 82×/43×/41× `mainsync.behind`
(je identischem Titel). Verteilung: 82 Rows „527 hinter main“ = 41 Sessions ×
2 Takte; „Fetch gescheitert“ = 1 Fetch je Projekt × Meldung je Session.

**Häufigkeit:** immer (läuft live weiter, alle 5 min je Projekt).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | live (systemd `ancientvoid-hub.service`, Hauptrepo-Checkout) |
| Commit | `5c722433` (main) |
| Node-Version | 26.7.0 |
| Adapter | beliebige (73 idle Sessions im Hauptprojekt) |
| Repro-Weg | SQL auf Live-DB / Scheduler-Unit-Test |

## Logs

```text
390x mainsync.failed | AncientVoid · Main-Sync gescheitert | 2026-11-19T00:04:25 .. 17:59:05
 82x mainsync.behind | AncientVoid · 527 Commits hinter main  | 2026-11-19T10:37:00 .. 10:37:23 (41 Sessions)
  745x Detail „Fetch von origin/main gescheitert“ · 342x Detail „dry-run-failed“
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/core/test/modules/workspace/main-sync-scheduler.test.ts` | vorhanden, deckt die Flut-Pfade nicht ab |

Ohne Fix rot: neue Fälle — Fetch-Fehler meldet je Projekt nicht je Session;
`dry-run-failed`/`conflict` nur je Zustand; `behind` je Projekt+Stand.

## Eingrenzung

`packages/core/src/modules/workspace/main-sync-scheduler.ts`

- `runProject()` :135–141: Fetch-Failure-Loop meldet **je Session** (ein Fetch
  ist je Projekt) — ×41 Sessions; `seen.failure` wird bei jedem erfolgreichen
  Takt implizit gelöscht → Netz-Flatten meldet je Wechsel neu.
- `runSession()` :179 (`dry-run-failed`) und :182–185 (`conflict`): `notice()`
  ohne Zustandsprüfung — feuert je Takt.
- `notifyBehindOnce()` :200–204: Dedup je **Session** — 41 Sessions im Projekt
  erzeugen 41 identische Rows je Stand (EPIC-P67 ging von wenigen Sessions aus).
- `apps/hub/src/main.ts:518–559`:.notice-Verkabelung (Titel/Detail je Meldung).

Neustart-Behalten: „Nachholen beim Start“ (§3.4, main.ts:562) bleibt — nach dem
Fix bedeutet es einen Row je Projekt und Zustand, nicht je Session.


## Handoff
- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [x] `bugfix`
