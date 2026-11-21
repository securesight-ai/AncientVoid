---
id: BUG-0243
slug: archiv-loeschen
status: done
severity: S3
area: pwa, hub, core
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/234"
epic: "P5, P14"
created: 2026-11-20
reporter: "Nutzerbericht"
---

# BUG-0243 — Archiv-Sessions lassen sich nicht gesammelt oder zuverlässig löschen

## Gesehen

Das Archiv bietet nur Einzelaktionen. Eine archivierte OpenCode-Session mit
laufendem Adapter bleibt nach bestätigtem Löschen sichtbar. Auf gekoppelten
Hubs schlägt auch das Löschen gestoppter Sessions fehl. Bei einem gesperrten
Worktree meldet der Hub Erfolg und entfernt die Session samt Verlauf, während
der Worktree zurückbleibt.

## Erwartet

Einzelne, mehrere oder alle sichtbaren Archiv-Sessions lassen sich nach einer
Bestätigung löschen. Der Hub stoppt laufende archivierte Sessions vor dem
Löschen. Schlägt die Workspace-Bereinigung fehl, bleibt die Session im
Archiv und der Fehler wird angezeigt.

## Repro und Eingrenzung

- OpenCode-Sitzung starten, die Antwort abwarten, archivieren und über die
  Karte löschen. Der Adapter bleibt nach dem Archivieren live und der Hub
  antwortet auf DELETE mit 409.
- Eine Sitzung auf einem gekoppelten Hub stoppen, archivieren und vom
  Heim-Hub aus löschen. Die Policy ordnet dem DELETE keine Operation zu.
  Der gekoppelte Hub antwortet mit 403 und der Proxy mit 502.
- Einem gestoppten Lauf mit verbliebener Arbeit den Worktree per
  `git worktree lock` sperren und den Lauf löschen. Der SessionManager
  protokolliert den Git-Fehler und löscht trotzdem den Verlauf.

## Regressionstests

- `e2e/specs/workspace.spec.ts` prüft Einzel- und Mehrfachlöschung im Archiv, Abbruch und Wiederholung nach einem Teilfehler.
- `apps/hub/test/modules/fleet/fleet-routing.test.ts` prüft das Löschen über einen gekoppelten Hub.
- `packages/core/test/modules/sessions/session-manager.test.ts` prüft wiederholte Löschanfragen und den gesperrten Worktree.
