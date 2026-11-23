# Dokumentationsübersicht

**Art:** referenz

Ordnung der lebenden Seiten in `docs/` nach [Diátaxis](https://diataxis.fr/)
(Grundlage: [Recherche 2026-11-13](2026-11-13_doku-onboarding-recherche.md),
EPIC-P57). Jede Seite trägt genau eine Art in ihrer Kopfzeile
(`**Art:** …`); `npm run check:context` prüft Kopfzeile **und** Eintrag
hier (Regeln `doc-kind`, `doc-index`, siehe [`check-context.md`](check-context.md)).
Datierte Snapshots (`JJJJ-MM-TT` im Namen), `adr/`, `messlauf/`, `assets/`
sind ausgenommen.

| Art | Beantwortet | Seiten |
|---|---|---|
| **tutorial** — Lernen durch Tun | „Ich bin neu, führ mich zum ersten Erfolg“ | `tutorial-erste-schritte.md` (Befehle laufen als Test: `apps/hub/test/tutorial-schritte.test.ts`) |
| **how-to** — Ziel erreichen | „Wie mache ich X?“ | `onboarding.md`, `howto-geraete-und-tokens.md`, `howto-provider-wechseln.md`, `howto-wizard-fehler.md`, `beitragen-als-agent.md`, `operations-runbook.md`, `backup-restore.md`, `fleet.md`, `host-monitoring.md` (EPIC-P81), `loops.md`, `local-llm.md`, `desktop-companion.md`, `workplace-runbook.md`, `forge-runbook.md`, `ci-runbook.md`, `testing-e2e.md`, `bild-links-fuer-agenten.md` (Bild-Links im Chat), `aspark-factory-mqtt.md`, `p12-abnahme-checkliste.md`, `main-sync.md` (EPIC-P67), `demo-media.md` (Aufnahmeregeln Demo-Medien, EPIC-P62), `guide/README.md` (EN-User-Guide, EPIC-P62) |
| **referenz** — Fakten nachschlagen | „Was genau heißt Feld/Befehl/Spalte Y?“ | `configuration.md`, `adapters.md`, `harness-matrix.md`, `funktionsinventar.md`, `commit-notation.md`, `ci-gate-inventar.md`, `check-context.md`, `referenz-hubctl.md`, `referenz-config.md`, `referenz-wizard.md` (generiert, siehe unten), `design-system.md`, `factory-schnittstelle.md`, `epic-status.md`, `skill-curation.md`, `statistik-metriken.md`, `tastatur-kollisionen.md`, `issues.md` (Issue-Lebenszyklus, EPIC-P71), `uebersicht.md`, `guide/inventory.md` (EN-Guide-Inventar, EPIC-P62) |
| **erklaerung** — Verstehen | „Warum ist es so?“ | `architecture.md`, `security.md`, `interrupted-sessions.md`, `zoom-robuste-flaechen.md`, `einstellungen-empfehlungen.md` |

## Generierte Referenz

`referenz-hubctl.md`, `referenz-config.md` und `referenz-wizard.md` entstehen
aus dem Code (`npm run docs:reference`, `scripts/gen-reference.mjs`): hubctl-
`usage`, dem zod-Schema `HubConfig` und dem Kopf von `setup.sh`. Nicht von
Hand ändern — `check:context` (Regel `reference-fresh`) scheitert bei
veraltetem Stand. Erklärtexte dazu bleiben in
[`configuration.md`](configuration.md) und [`onboarding.md`](onboarding.md).

Die Token-Tabelle in [`design-system.md`](design-system.md) entsteht aus
`apps/pwa/src/app/styles/00-tokens.css` (`npm run docs:design-tokens`,
`scripts/design-tokens-doc.mjs`). `check:context` (Regel `design-tokens-fresh`)
scheitert bei Drift.

## Pflege

- Neue lebende Seite: Kopfzeile `**Art:** …` setzen **und** hier eintragen —
  sonst scheitert das Gate.
- Eine Seite, die zwei Arten mischt, wird geteilt (Beispiel: `onboarding.md`
  wurde in EPIC-P57 T57.7 vom Beitragen-Teil `beitragen-als-agent.md` getrennt).
- Einstieg für Endnutzer ist das [README](../README.md); ein neuer Nutzer
  beginnt dort, nicht hier.
