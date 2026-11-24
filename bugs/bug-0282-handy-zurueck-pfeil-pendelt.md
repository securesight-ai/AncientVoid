---
id: BUG-0282
slug: handy-zurueck-pfeil-pendelt
severity: S2
status: done
instance: dev
commit: "d0728b79"
forge: "https://github.com/securesight-ai/AncientVoid/issues/397"
epic: ""
created: 2026-11-24
reporter: "Nutzer (Chat)"
---

# BUG-0282 — Handy: Zurück-Pfeil pendelt zwischen Sessions statt zur Übersicht

## Gesehen

Am Handy führt der Zurück-Pfeil in einer Session nicht zur Übersicht,
sondern zurück in die zuvor offene Session; wiederholtes Tippen pendelt
zwischen den Sessions, ohne je die Übersicht zu erreichen. Nutzermeldung:
„Sonst kann man Handy nicht mehr zurück navigieren, wenn man einmal in
einer Session war."

## Erwartet

Der Zurück-Knopf der Session-Ansicht am Handy führt immer deterministisch
zur Übersicht — unabhängig davon, über welchen Weg (Übersicht, Suche,
Forge-Link, Übernahme) die Session geöffnet wurde.

## Repro

Voraussetzung: Hub lokal (`node apps/hub/src/main.ts`), PWA im Mobil-Layout
(< 700 px Breite), zwei Sessions mit unterscheidbarem Auftragstext.

1. Übersicht öffnen, Session A per Tap öffnen.
2. Im Such-Tab der Session A nach dem Auftragstext von Session B suchen.
3. Den Sitzungs-Treffer von B antippen (In-Session-Navigation, setzt nur
   `location.hash`).
4. In Session B den Zurück-Pfeil („Zur Übersicht") tippen.

**Ergebnis nach Schritt 4:** Ansicht zeigt Session A (Session-Kopf
„Nadel Alpha"), nicht die Übersicht. Nochmaliges Tippen öffnet Session B —
Ping-Pong. Belegt im E2E-Lauf (Playwright, Projekt `mobile`,
`e2e/specs/zz-repro.spec.ts` beim Fix-Lauf): `.dashboard` nie sichtbar,
Session-Kopf zeigt die jeweils andere Session.

**Häufigkeit:** immer (deterministisch), sobald eine In-Session-Navigation
vor dem Pfeil-Druck stand

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `d0728b79` |
| Node-Version | 24 |
| Adapter | dummy |
| Repro-Weg | PWA (E2E, Projekt mobile) |

## Logs

Keine Hub-Logs beteiligt (reines PWA-Navigationsverhalten). E2E-Beweis:
`test-results/zz-repro-*/error-context.md` — Aria-Snapshot nach dem
Pfeil-Klick zeigt `.session-topbar` mit „Nadel Alpha", `.dashboard` fehlt.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/session.spec.ts` (neue Spec, Projekt mobile) | rot |
| Unit | — | nicht vorhanden |

Ohne Fix rot: eine Spec, die Schritt 1–4 oben fährt und auf `.dashboard`
wartet. Bestehte Specs öffnen Sessions nur per Deep-Link (`goto
#/sessions/<id>`) und drücken den Pfeil ohne vorherige In-Session-Navigation
— deshalb grün.

## Eingrenzung

`apps/pwa`: `features/session/SessionTail.tsx:1865` (Pfeil:
`location.hash = popView() ?? pageHash("dashboard")`) zusammen mit
`app/main.tsx:299`: Jeder `hashchange` mit View-Wechsel merkt die verlassene
Ansicht erneut (`rememberView(letzterHash)`) — auch der vom Pfeil selbst
ausgelöste Rückschritt. Der Stack baut sich beim Zurückkehren damit selbst
wieder auf; `popView()` liefert beim nächsten Pfeil-Druck die gerade
verlassene Session. Zusätzlich schiebt jede `location.hash`-Zuweisung einen
Browser-History-Eintrag — das System-Zurück des Handys läuft durch dieselbe
Pendelkette.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`) — [#397](https://github.com/securesight-ai/AncientVoid/issues/397)
- [ ] `bugfix`

## Abschluss (2026-11-24)

Gemerged als PR #398 (verify grün). Nummern-Kollision mit main-0279 (Shell)
aufgelöst: dieser Bug ist jetzt 0282 (zuerst als 0279 angelegt).
