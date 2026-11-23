---
id: BUG-0217
slug: aktivitaetsregister-zeitkritisch-auf-hosted-runner
status: done
severity: S3
area: tests
instance: ci
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/83"
epic: ""
created: 2026-11-18
reporter: "GitHub-Actions-CI (PR #53, verify, Run 43961976579)"
---

# BUG-0217 — Aktivitätsregister-Test zeitkritisch auf Hosted-Runnern (1 von 2139 rot, Neustart grün)

## Gesehen

Im `verify`-Job (PR #53, Lauf 43961976579, erster Versuch) bleibt genau ein
Test von 2139 rot:

```text
FAIL packages/core/test/modules/sessions/activity-register.test.ts
  > Aktivitätsregister (ADR-0074, BUG-0155)
  > Werkzeug-Aktivitäten im Hauptzug schließen den Lauf nicht — „Zug fertig“ genau einmal, mit dem Hauptzug (Nutzerfund 2026-11-15)
AssertionError: expected [] to have a length of 1 but got +0
  at packages/core/test/modules/sessions/activity-register.test.ts:187:59
```

Dieselbe Commit-Restart: **grün** (`verify` pass, 4m31s). Der Zweig ändert
nichts am Aktivitätsregister (nur PWA/E2E/Doku); lokal läuft die Datei 8/8 grün.

## Erwartet

Der Test ist auf dem Hosted-Runner deterministisch grün — ein Neustart darf
kein Reparaturwerkzeug sein.

## Repro

Voraussetzung: GitHub-gehosteter Runner (`verify`),Suite im Kaltlauf.

1. PR öffnen, der `packages/core` nicht berührt.
2. `verify`-Lauf ansehen; bei Rot einmal neu starten.

**Ergebnis nach Schritt 2:** erstes Auftreten rot (Assertion oben), Neustart
grün. **Häufigkeit:** einmalig beobachtet (18.11.2026 gemeldet, Issue #83).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | GitHub-Actions-Runner `ubuntu-latest` |
| Commit | PR #53-Head (ändert Aktivitätsregister nicht) |
| Node-Version | 24 |
| Adapter | — |
| Repro-Weg | CI (`verify`) |

## Logs

Siehe Gesehen (Assertion-Auszug, Run 43961976579).

## Tests

| Ring | Befund / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/core/test/modules/sessions/activity-register.test.ts:187` | zeitweise rot auf Hosted-Runnern, lokal grün |

## Eingrenzung

Zeitrenne auf dem Hosted-Runner, kein Produkttreffer — verwandt mit
[BUG-0170](bug-0170-testsuite-auf-windows-rot.md) (Umgebungssensibilität der
Suite) und #85/BUG-0218 (zeitkritische Flakes unter parallelem Tier A).
Offene Entscheidung (aus Issue #83 übernommen, bewusst nicht entschieden):
Toleranz im Test (Poll statt Einmalmessen, Muster BUG-0163/BUG-0176) oder
Datei auf `scripts/slow-tests.json` und seriell fahren — wer anfasst, misst
und nennt den Messwert im Commit.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue vorhanden ([#83](https://github.com/securesight-ai/AncientVoid/issues/83), SSOT nachgezogen EPIC-P71 T71.6)
- [x] `bugfix` oder offen lassen

## Fix (2026-11-23)

Root cause: `settle()` setzt den Status `idle` **vor** dem `session.turn_end`-Event
(`setStatus(...).then(emit)`) — der Test wartete auf den Status und las danach
einmalig die Events. Auf einem gedrosselten Hosted-Runner liegt der Schreibvorgang
nach dem Lesen (Issue-Beobachtung: Länge 0 statt 1). Der Test wartet jetzt auf die
Ereignisse selbst (turn_end, main_turn_end, Notification) und behält die
„genau einmal"-Asserts; `waitFor` nimmt zusätzlich asynchrone Prüffunktionen.
Slow-List entfällt: Datei misst isoliert 1,3 s (Schwelle 10 s).

Grün: Datei 8/8, sessions+handover 202/202 (8 Forks), 3× Stress 27/27,
lint + typecheck.
