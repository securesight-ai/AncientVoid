---
id: BUG-0153
slug: erstinstallation-ohne-projektwurzeln
status: done
severity: S2
area: pwa
instance: dev
commit: "b477999"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/60"
epic: "P57"
created: 2026-11-13
reporter: TTFS-Messlauf (P57 T57.10)
---

# BUG-0153 — Erstinstallation ohne projectRoots: erste Session unmöglich, Tutorial schweigt den Schritt weg

## Gesehen

Nach dem Standard-Wizard (`./setup.sh --yes --adapter=dummy`) ist die
Projektliste leer (`projectRoots: []` in `hub.config.example.json`, Wizard
fragt nicht). Damit scheitert der Erststart-Pfad auf einer echten
Neuinstallation an zwei Stellen: Der Probe-Session-Knopf (T57.9) meldet
„Kein Projekt gefunden … trage projectRoots in hub.config.json ein“, und das
Formular „Neue Session“ zeigt nur „keine Projekt-Wurzeln konfiguriert — siehe
docs/configuration.md“ (keine Freitext-Pfadeingabe, Inline-Anlage braucht
ebenfalls eine Wurzel, `project-create.routes.ts`). Das Tutorial
(`tutorial-erste-schritte.md` §3) sagt stattdessen „wähle … ein Projekt“ —
ein Projekt kann nicht gewählt werden.

## Erwartet

Der Wizard bereitet einen Pfad vor, auf dem die erste Session ohne manuelle
Config-Änderung startet (P53-Nacharbeit: Wizard-Frage oder Default-Wurzel),
oder das Tutorial enthält den ehrlichen Schritt „Projekt-Wurzeln eintragen“.

**Erledigt 15.11.2026:** Wizard fragt `projectRoots` ab (Default `~/Projects`)
oder nimmt `--projects=<dir>` entgegen und trägt ihn absolut aufgelöst ein;
`--yes` ohne Flag bleibt kopflos und druckt den ehrlichen Hinweis samt
Tutorial-Verweis. Tutorial §3 nennt beide Wege. Verify: zwei Wizard-Läufe in
frischen Klonen (Flag → Config-Eintrag; --yes → leer + Hinweis).

## Repro

Voraussetzung: frischer Klon, `./setup.sh --yes --adapter=dummy`, PWA geöffnet,
Token eingeben.

1. In der Übersicht „Probe-Session (dummy)“ klicken.
2. Alternativ: „Neue Session“ öffnen.

**Ergebnis nach Schritt 1:** Fehlermeldung „Kein Projekt gefunden. … trage
projectRoots in hub.config.json ein“, keine Session.
**Ergebnis nach Schritt 2:** Projektfeld zeigt „keine Projekt-Wurzeln
konfiguriert“, „Starten“ nicht möglich.

**Häufigkeit:** immer auf Neuinstallation mit Wizard-Defaults (gefunden im
TTFS-Messlauf, Lauf 1, Timeout bei M4; E2E/Tutorial-Test betroffen nicht, weil
TestHub Projekte vorkonfiguriert — `e2e/support/hub.ts` defaultet `project`).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | frischer Wizard-Klon (Messlauf, temp) |
| Commit | `c8ff64f` (T57.10-Branch, enthält T57.9) |
| Node-Version | v26.7.0 |
| Adapter | dummy |
| Repro-Weg | PWA (Playwright, Pixel-7-Viewport) |

## Logs

Messlauf-Abbruch (Timeout beim Warten auf die Session-Karte):

```text
locator.waitFor: Timeout 90000ms exceeded.
  - waiting for locator('.session-card').filter({ hasText: 'dummy' }).first()
StartGuide-Fehlerpfad: „Kein Projekt gefunden. Lege über „＋“ ein Projekt an
oder trage projectRoots in hub.config.json ein."
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/erststart.spec.ts` | grün — deckt den Fall **nicht** (TestHub hat Projekte) |
| Messlauf | `scripts/messlauf-ttfs.mjs` | rot (M4-Timeout) — der ehrliche Neuinstallations-Pfad |

Welcher Test **müsste** ohne Fix rot sein? `scripts/messlauf-ttfs.mjs` ist es
(Wizard-Defaults, keine Projekte). Die Lücke: kein E2E/Unit-Test fährt den
Probe-Knopf gegen einen Hub **ohne** Projekte — `bugfix` ergänzt einen
(`erststart.spec.ts`: Hub ohne projectRoots → Hinweis statt stiller Timeout).

## Eingrenzung

`apps/pwa/src/features/overview/StartGuide.tsx` (Fehlerpfad stimmt, IST-Zustand
ehrlich); Ursache im Zusammenspiel `setup.sh` (fragt projectRoots nicht ab,
P53) × `CreateSession.tsx:315` (kein Freitext-Fallback) × Tutorial §3 (Lücke).
Wizard-Seite gehört zur P53-Nacharbeit (offener Audit-Befund-Kontext:
`docs/2026-11-11-setup-modelle-audit.md`).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [ ] `bugfix` oder offen lassen (P57 deckt Tutorial-Schritt + Messlauf-Route; Wizard-Frage als Action Item P53)
