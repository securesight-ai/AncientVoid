# Kontext-Hygiene: `npm run check:context` (+ `check:knip`, Skill `context-audit`)

**Art:** referenz

Ziel: Agenten-Kontext (AGENTS.md, Skills, docs/) bleibt klein, verlinkt,
referenziert und inhaltlich frisch — **deterministisch** geprüft, im `gate`
und in CI. Grundlage ist die Recherche vom 2026-11-12:

- Anthropic-Empfehlung: **< 200 Zeilen** pro immer geladener Kontextdatei —
  längere Dateien verbrauchen Kontext und reduzieren die Regel-Befolgung.
- Attention-Forschung (u. a. „Context Rot", Chroma 2025; arXiv 2611.04169):
  **Widersprüche/Duplikate schaden stärker als Länge** (Aufmerksamkeits-
  Konkurrenz). Stale Doku wirkt als Distraktor.
- Studie Gloaguen et al. (arXiv 2602.11988): Kontextdateien kosten im Schnitt
  > 20 % Inferenz ohne Erfolgsgewinn; „Repo-Overviews" waren nutzlos.
  Rein gehört, was in den meisten Aufgaben gilt, nicht ableitbar ist und
  Verhalten ändert.

## Regeln des Gates (`scripts/check-context.mjs`, Tests daneben)

| Regel-ID | prüft | Scheitern wenn |
|---|---|---|
| `budget` | Zeilen-Budgets (Anthropic-Grenze): `AGENTS.md`/`CONTRIBUTING.md` ≤ 200, `README.md` ≤ 300, `epics/README.md` ≤ 435 (wächst pro Nutzerauftrag-Epoche um eine Sektion; +15 am 2026-11-18 für EPIC-P000, +10 am 2026-11-20 für P75, +15 am 2026-11-24 für P82, +15 am 2026-11-25 für P85, +10 am 2026-11-27 für P87–P89, +10 am 2026-11-27 für P90), Skill-README ≤ 120, `SKILL.md` ≤ 250, Agenten ≤ 150, `docs/guide/*.md` ≤ 420 (+10 am 2026-11-25 für EPIC-P80, +10 am 2026-11-26 für EPIC-P83), `docs/videos/*.md` ≤ 250 (EPIC-P62, on-demand) | Datei größer (on-demand Skills dürfen größer sein als immer geladene Dateien) |
| `link` | Markdown-Relativ-Links in AGENTS/CONTRIBUTING/README/epics-README/`.claude/**` | Ziel existiert nicht. Repo-externe Ziele (z. B. Nachbar-Checkouts) sind nicht portabel prüfbar und werden übersprungen |
| `docs-ref` | jede `docs/*.md` ist ≥ 1× im Repo referenziert (Dateiname als Suchstring über Textdateien) | Waise. Befreit: `docs/adr/**` (append-only Protokoll), `docs/assets|messlauf/**`, **datierte Snapshots** (`JJJJ-MM-TT` in Präfix/Suffix — Konvention s. AGENTS.md) |
| `doc-kind` | jede lebende `docs/*.md` (flach oder in `docs/guide|videos/`, kein datierter Snapshot) trägt in den ersten 12 Zeilen genau eine Kopfzeile `**Art:** tutorial\|how-to\|referenz\|erklaerung` (Diátaxis, EPIC-P57; guide/videos seit EPIC-P62 T62.1) | Zeile fehlt, doppelt oder unbekannte Art |
| `doc-index` | jede lebende Seite steht in [`uebersicht.md`](uebersicht.md) | Seite nicht gelistet oder Übersicht fehlt |
| `reference-fresh` | `scripts/gen-reference.mjs --check`: committete `docs/referenz-*.md` = frisch generierter Stand (hubctl-usage, `HubConfig`-Schema, `setup.sh`-Kopf; EPIC-P57) | Stand veraltet — `npm run docs:reference` |
| `design-tokens-fresh` | `scripts/design-tokens-doc.mjs --check`: Token-Tabelle in `docs/design-system.md` = Stand aus `00-tokens.css` (EPIC-P63 T63.10) | Stand veraltet — `npm run docs:design-tokens` |
| `script-ref` | jedes `scripts/*.{mjs,ts,sh}` ist referenziert (package.json/CI/Doku/…) **oder** hat `*.test.mjs/.ts` | weder-noch |
| `drift` | Frischhalte-Map: lebendes Dokument → Beobachtungsbereiche + `maxDrift` | mehr Commits im Bereich seit letzter Doc-Berührung als erlaubt → Review fällig. Uncommittete Überarbeitung gilt als laufendes Review (sonst Gate/Commit-Henne-Ei) |
| `drift-map` | Map-Konsistenz | Map-Eintrag ohne Datei |

Die Frischhalte-Map (aktuell 13 lebende Dokumente) liegt als Konstante in
`scripts/check-context.mjs` — eine Stelle, bewusst sichtbar. `maxDrift` ist
ein Ratchet: beim Einführen auf Ist+Luft gesetzt, bei jedem Review darf man
senken, nicht heben. Begründung: Commits im Bereich sind ein Proxy für
„der Code hat sich bewegt, die Doku vielleicht nicht" — Review-Zwang, nicht
Beweis.

Rot-dann-grün am 2026-11-12: Der erste Lauf fand 9 Befunde (toter
AGENTS.md-Link im setup-wizard-Skill, falsche Link-Tiefe der Skill-Vorlage,
referenzlose `docs/status-system-konzept.md`, 198-Commits-Drift auf
`docs/architecture.md`, …) — alle im selben MR behoben, danach grün.

## `npm run check:knip` (report-only, NICHT im Gate)

[Knip](https://knip.dev) findet ungenutzte Dateien, Exports und Abhängigkeiten
(npm-workspaces-fähig; Konfiguration `knip.json`; Entries = manuell lauffähige
Skripte, E2E, Fixtures, Beispiele). Aktueller Stand (2026-11-15): 2 ungenutzte
Exports (`Field`/`Select` in `apps/pwa/src/shared/forms.tsx` — EPIC-P43-Bausteine,
bewusst behalten, bis die PWA sie übernimmt oder sie streicht), sonst leer.
Die Triage vom 2026-11-15 hat 114 ungenutzte Exports/Typen entfernt bzw.
dateilokal gemacht, die 81 „unlisted" Test-Abhängigkeiten als
`devDependencies` deklariert und System-Binaries (`adb`, `rg`, `mkfifo`, …)
über `ignoreBinaries` ausgenommen. Report-only; als Ratchet ins Gate, sobald
die zwei Restbefunde entschieden sind.

## Semantik-Layer: Skill `context-audit` (monatlich)

Was kein Linter kann: inhaltliche Veraltung und widersprüchliche Regeln.
Der Skill `.claude/skills/context-audit/` läuft auf Wunsch/monatlich, liest
Kontextdateien und lebende Dokumente und liefert **ausschließlich
Diff-Vorschläge** — nie auto-merge (ein LLM-Audit kann selbst Slop erzeugen;
deterministische Gates haben Vorrang). Die `retro`-Checkliste erinnert an
die lebenden Dokumente des Epic-Bereichs.

## Pflege

- Neue immer geladene Kontextdatei → Eintrag in `LINE_BUDGETS`.
- Neues lebendes Dokument → Eintrag in der Frischhalte-Map (mit Ist-Drift + Luft).
- Regel geändert → Testfall in `scripts/check-context.test.mjs` anpassen
  (jede Regel hat positives und negatives Fixture).
- Snapshots: Datum in den Namen, fertig (keine Map, keine Referenz nötig).
