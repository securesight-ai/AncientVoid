---
id: BUG-0219
slug: mainsync-stand-gehört-zur-auswahl
status: done
severity: S3
area: pwa
instance: dev
commit: "236a53b4"
forge: "https://github.com/securesight-ai/AncientVoid/issues/180"
epic: "EPIC-P67"
created: 2026-11-18
reporter: Nutzer
---

# BUG-0219 — Main-Sync-Stand „N hinter main“ gehört nicht zur Auswahl

## Gesehen

Bei Auswahl eines anderen Projekts zeigt die Session-Ansicht weiterhin einen
Main-Sync-Stand, der nicht zur gewählten Session gehört (Zahlen eines anderen
Projekts bzw. eines früheren Zeitpunkts); auch eine neue Session zeigt den
veralteten Stand der vorher offenen Ansicht.

## Erwartet

Die Abfrage `GET /api/sessions/:id/main-sync` wird immer neu gestellt, wenn ein
anderes Projekt ausgewählt wird (Session-Wechsel, Kachelfokus) oder eine neue
Session startet — der Hinweis „N hinter main“ zeigt dann den Stand der
gewählten Session.

## Repro

Voraussetzung: Hub mit zwei Git-Projekten (alpha, beta), je eigenes
Bare-„origin“-Remote, Sessions im Worktree-Modus (Muster:
`e2e/specs/main-sync-session.spec.ts`, `withOrigin`).

1. alpha-origin um 1 Commit vorrücken, beta-origin um 3 Commits.
2. Session B (beta) öffnen → Hinweis „3 hinter main“. ✓
3. Desktop: Session A (alpha) per Strg-Klick in einer zweiten Kachel öffnen →
   Kachel zeigt „1 hinter main“. ✓
4. beta-origin um einen weiteren Commit vorrücken (wäre jetzt 4).
5. Kachel 1 (beta) wieder auswählen (Fokus auf die Kachel legen).

**Ergebnis nach Schritt 5:** Hinweis bleibt „3 hinter main“ — die Abfrage wird
nicht neu gestellt; der Stand stammt vom Mount-Zeitpunkt, nicht von der
Auswahl. Analog Handy: Rückkehr zur offenen Session-Ansicht (App in den
Vordergrund holen) zeigt weiter den alten Stand.

**Häufigkeit:** immer (wohingegen reine Wechsel über Übersicht/Hash korrekt
neu fragen — die Komponente wird dort neu gemountet; nachgewiesen im Repro)

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `236a53b4` (T67.8, eingeführt) |
| Node-Version | 24 |
| Adapter | beliebig (dummy im Repro) |
| Repro-Weg | PWA |

## Logs

Hub-seitig korrekt gemessen (je Session ihr eigener Stand, gleichzeitig
abgefragt im Repro):

```text
HUB behind A = 1 · behind B = 3
```

Kein Vertauschen hubseitig — der Defekt ist clientseitig (Abfrage-Lifecycle).

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/main-sync-session.spec.ts` | bestehende Tests grün (decken Auswahl nicht) |

Rot ohne Fix: neue Fälle „Kachelfokus fragt neu“ (@desktop) und
„Rückkehr fragt neu“ in `main-sync-session.spec.ts` — schreibt `bugfix`.

## Eingrenzung

`apps/pwa/src/features/session/SessionTail.tsx:254` — der Effekt fragt
`mainSyncCheck` nur bei `session.id`-Wechsel (Mount) ab. Auswahl ohne Remount
(Kachelfokus `tile.active`, `visibilitychange` der offenen Ansicht) stellt die
Abfrage nie neu; `refreshMainSync` hat zudem keinen Abbruchschutz, eine späte
Antwort könnte einen neueren Stand überschreiben.


## Fix

Behoben: PR #182 (`54762797`). Doku-Abschluss 2026-11-21 (Status-Nachzug).

## Handoff

- [ ] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix`
