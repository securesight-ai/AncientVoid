---
id: BUG-0246
slug: session-delete-orphan-projekt
status: done
severity: S2
area: core, hub
instance: live
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/240"
epic: "P14"
created: 2026-11-20
reporter: silenttz
---

# BUG-0246 — Session-Löschen scheitert an toten Projekten; Reste bleiben

## Gesehen

Alle 41 archivierten Sessions liefern 409: `Workspace konnte nicht
aufgeräumt werden` — `git worktree remove` gegen Projekte ohne `.git`
(z. B. `mobile-hub`) oder fehlende Pfade (`uacc-provider-smoke`,
`securesight-harnez`). Worktree-Ordner und Worker-Logs bleiben; nach
erfolgreichem Löschen fehlen weiterhin Notifications/Drafts-Cascades.

## Erwartet

Endgültiges Löschen entfernt Worktree unter `data/worktrees/<id>` auch
wenn das Projekt kein Git-Repo mehr ist oder fehlt; Session-Zeile,
JSONL/Blobs, Sidecar-Tabellen und Worker-Logs/`bridges` gehen mit.
Nur wenn das eigene Worktree-Verzeichnis hart nicht löschbar ist, 409.

## Repro

1. Live-Hub: archivierte Session mit `project` ohne `.git` oder fehlendem Pfad.
2. `DELETE /api/sessions/<id>` → 409, Session bleibt.
3. `data/worktrees/<id>` und `data/workers/ancientvoid-<id>*` bleiben.

**Häufigkeit:** immer (41/41 archivierte auf diesem Hub)

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | live `127.0.0.1:7373` |
| Repro-Weg | API / PWA Archiv |

## Logs

```text
fatal: not a git repository … Stopping at filesystem boundary
Workspace konnte nicht aufgeräumt werden: Command failed: git -C …/mobile-hub worktree remove --force …/data/worktrees/<id>
```

## Tests

| Ring | Datei | Stand |
|---|---|---|
| Unit | `worktree.test.ts` remove ohne Git-Projekt | Lücke |
| Unit | `session-manager.test.ts` Sidecar-Cascade | Lücke |

## Eingrenzung

`packages/core/src/modules/workspace/worktree.ts` `remove`,
`session-manager.ts` `deleteNow`.

## Handoff

- [x] Index
- [ ] GitHub-Issue
- [x] bugfix
