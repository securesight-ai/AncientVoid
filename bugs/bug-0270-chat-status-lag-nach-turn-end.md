---
id: BUG-0270
slug: chat-status-lag-nach-turn-end
status: in-progress
severity: S3
area: pwa
instance: local
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/334"
epic: ""
created: 2026-11-23
reporter: nutzer (Handy)
---

# BUG-0270 — Nach Zugende bleibt Status „aktiv/arbeitet“ statt „bereit“

## Gesehen

Manchmal wirkt die letzte Chat-Antwort nicht sauber abgeschlossen (Antwort
steckt im noch laufenden Zug / Status-Pill atmet weiter). Gleichzeitig sagen
Übersicht, Statuszeile bzw. Nyx weiter „aktiv“/„arbeitet“ statt „bereit“,
obwohl der Zug am Hub schon fertig ist.

## Erwartet

Sobald `session.turn_end` im WS-Strom ankommt, wechselt der Anzeigezustand
sofort auf `idle` („bereit“): letzte Antwort als eigene Bubble, kein laufender
Zug-Mark, Fleet/Nyx nicht mehr unter „aktiv“.

## Repro

Voraussetzung: Hub läuft, Session mit Werkzeugaufrufen (Antwort kommt nach
`tool_result`).

1. Prompt senden, Zug laufen lassen bis zur finalen Assistant-Antwort.
2. Unmittelbar nach der letzten Nachricht StatusDot / Übersicht prüfen
   (innerhalb der ersten ~3 s, bevor der HTTP-Poll greift).

**Ergebnis nach Schritt 2:** Status bleibt kurz (manchmal sichtbar länger durch
stale Poll) auf `working`; Chat hält die Antwort im offenen `turn-work`.

**Häufigkeit:** manchmal (Race Poll ↔ WS)

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal |
| Commit | `origin/main` nach PR #327 |
| Adapter | beliebig mit Tool-Zügen |

## Logs

Kein Serverfehler. Hub setzt in `settle` zuerst `idle`, dann `session.turn_end`;
der Tail aktualisierte `status` nur per 3s-`api.session`-Poll.

## Eingrenzung

`apps/pwa/src/features/session/SessionTail.tsx` — `onEvents`-Flush setzt Events,
aber nicht `status`; `live = status === "working"` hält den Zug-Mark offen und
`publishHubStatus` bleibt auf working bis zum Fleet-Poll.

## Tests

| Ring | Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/pwa/test/features/session/status-from-events.test.ts` | rot ohne Modul / ohne Status aus Batch |

## Handoff

- [x] Datei im Index `bugs/README.md`
- [ ] GitHub-Issue
- [ ] Fix-PR
