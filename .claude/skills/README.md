# Skills — portable Fähigkeiten

> Fähigkeiten liegen unter `.claude/skills/<name>/SKILL.md`. Claude Code
> liest diesen Ordner nativ. Verhaltensregeln stehen in
> [`AGENTS.md`](../../AGENTS.md) — Skills referenzieren sie, sie kopieren sie
> nicht. Übernommen und angepasst aus `custom-rag`
> (siehe [`docs/adr/`](../../docs/adr/) für den swarm-Adapter-Kontext).

## Progressive Disclosure

| Level | Was | Wo |
|---|---|---|
| 1 Discovery | `name` + `description` (YAML) | Frontmatter jeder `SKILL.md` |
| 2 Instructions | Zweck, Hard Rules, Phasen, Output | Body der `SKILL.md` (knapp halten) |
| 3 Resource | Geteilte Verträge | `_shared/` |

## Available Skills

| Skill | Kurzbeschreibung | Auto-loads when | Abgrenzung |
|---|---|---|---|
| [`gates`](gates/SKILL.md) | Qualitäts-Gates (npm test/lint/typecheck) in der richtigen Reihenfolge | „ist das grün?", CI rot, vor Commit | Messung, kein fachliches Urteil |
| [`git-workflow`](git-workflow/SKILL.md) | Commit-Notation, Branch, PR via gh, Post-Merge-Hygiene | commit, branch, PR, Branch-Aufräumen | ausführbare Form von `CONTRIBUTING.md` § Commit notation / Branches and pull requests |
| [`bugfix`](bugfix/SKILL.md) | Reproduce → Fix → Re-verify → Finalize | Bug, Defekt, reproduzieren, Issue investigate | Handoff → `pr-review` |
| [`bug-report`](bug-report/SKILL.md) | Defekt sehen, belegen, unter `bugs/` anlegen | „Bug anlegen", Dev-Fund, Issue erstellen, kein Patch | kein Fix; Handoff → `bugfix` |
| [`pr-review`](pr-review/SKILL.md) | 6-Dimensionen-Gate-Review inkl. Future-Fragility | PR review, Merge-Freigabe, structured review | reines Lint bleibt `gates` |
| [`ponytail-review`](ponytail-review/SKILL.md) | Diff-Advisory, Tags `delete/stdlib/native/yagni/shrink` | Diff vereinfachen, Komplexität, YAGNI | read-only, keine Edits |
| [`architecture-best-practices`](architecture-best-practices/SKILL.md) | AncientVoid-Pipeline, Modultiefe, Testing-Standard | Architektur, Schichten, Anti-Pattern | Referenz, kein Workflow |
| [`write-tests`](write-tests/SKILL.md) | Unit-/Integrations-/E2E-Rezept für dieses Repo | neuen Test, Coverage, Playwright, rot-dann-grün | Gates fahren bleibt `gates` |
| [`concept-phase`](concept-phase/SKILL.md) | Aufgabe in vertikale Slices (6 Dimensionen) | Aufgabe slicen, Scoping, Edges | `epic-creation` für neue Phasen |
| [`epic-creation`](epic-creation/SKILL.md) | Neue `EPIC-Pn`-Datei nach 7-Abschnitt-Schema | „neues Epic", „P5 planen" | Phasen-Ebene; Feinschnitt → `concept-phase` |
| [`messlauf`](messlauf/SKILL.md) | Messlauf gegen K1–K10 fahren und ablegen | Benchmark, Durchsatz, Latenz, Messzahl zitieren | Ablage unter `docs/messlauf/` |
| [`hub-neustart-live`](hub-neustart-live/SKILL.md) | Live-Hub gefahrlos heben: Wachhund mit Rueckfall, version.json gegen HEAD, K7-Rekonstruktion, PWA-Cache beim Blick | „neuen Stand live nehmen“, Hub-Neustart, Seite zeigt alten Stand | ohne Wachhund niemals裸 neu starten |
| [`layout-beweis`](layout-beweis/SKILL.md) | Uberlappung, Flaechenhaushalt und Mitrollen am Handy messen (elementFromPoint, Geometriezahlen) | „fuehlt sich ueberdeckt/gedrungen an“, FAB/Dock/Composer, Scrollverhalten | Wegwerf-Spec `_scratch-*.spec.ts` vor Commit loeschen |
| [`retro`](retro/SKILL.md) | Evidence-basierte Retro gegen Epic-AC | „Retro", Phasen-Abschluss | bewertet Vergangenheit; planen → `epic-creation` |
| [`setup-wizard`](setup-wizard/SKILL.md) | Setup-Hilfe für `./setup.sh` (Provider zuerst, Exit-Code-Diagnose) | „Installation", „Setup", „läuft nicht", Provider anbinden | Wizard-Fehlersuche; Defekte → `bugfix` |
| [`factory`](factory/SKILL.md) | Factory-Orchestrator: Story-Zerlegung, Bahnen A/B, verify-Gates, Abnahme | factory-Aufträge, Spiel-/UI-Projekt mit PRD und `.factory/` | Harness-Template-Skill, projectlokal |
| [`context-audit`](context-audit/SKILL.md) | Monatlicher semantischer Kontext-Audit (Veraltung/Widersprüche), nur Diff-Vorschläge | „Kontext-Audit", „docs aufräumen", „AGENTS.md prüfen" | Struktur-Gate bleibt `npm run check:context`; nie auto-mergen |
| [`head-n`](head-n/SKILL.md) | Zeilenanfang deterministisch (Pilot EPIC-P72) | nur erste Zeilen einer Datei | Logik in `scripts/head-n.mjs` |
| [`sort`](sort/SKILL.md) | Sortieren/Histogramm deterministisch (Pilot EPIC-P72) | Sortier-/Haeufigkeits-Idiom | Logik in `scripts/sort.mjs` |
| (`_shared/skill-checks.json`) | Regelkatalog + `$config` für die Skill-Kur (Mindestläufe pro Lernfall) | — | maschinenlesbar; Lint-Check: `check:skills` |

Vorlage für neue Skills: [`skill-template.md`](_shared/skill-template.md).

## Skript-Skill-Muster

Wenn ein Skill bei jedem Lauf dieselben Schritte durchführt, ist die `SKILL.md` eine
kurze Hülle und die Logik liegt in `scripts/<skill>.mjs`: aufrufbar, `--json`,
Exit 0/1/2 = ok/Befund/Fehler, Ausgabe ≤ 40 Zeilen. Regeln, die kein Skript prüfen
kann, stehen in `_shared/skill-checks.json` (Regelkatalog, maschinenlesbar; Anker
muss wörtlich in der Quelle stehen, jede Regel braucht ≥ 1 Regressionsfall). Der
Lint dazu ist `npm run check:skills` (im Gate; `--fix` nur bei eindeutigen Renames).
Beschreibungs-Ratchet: `check:skills` meldet die Summe aller `description`-Längen —
sie darf nur sinken.

AncientVoid-Verträge, die `ponytail-review` nicht wegoptimieren darf:
[`_shared/ancientvoid-protected-invariants.md`](_shared/ancientvoid-protected-invariants.md).

**Ein neuer Skill muss sich eintragen:** `packages/core/test/modules/skills/skills.test.ts`
zählt das echte Inventar exakt (Ratchet). Neuer Ordner unter `.claude/skills/` ohne
Aktualisierung dieser Liste macht das PR-Gate rot.

## Bewusst nicht übernommen

`product-wiki`, `installer-hygiene`, `ui-schicht`,
`ponytail-audit`, `ponytail-debt`, `docs-hygiene` (als eigener Skill) — jeweils
weil die vorausgesetzte Infrastruktur (Produkt-Wiki, Installer-Wizard,
Markdown-Lint-Tooling, Debt-Bestand) in diesem Repo noch nicht existiert.
`browser-e2e` ist durch [`write-tests`](write-tests/SKILL.md) + `e2e/` ersetzt
(P4.5). Nachziehen der übrigen, sobald der Bedarf real ist, nicht vorab
([`AGENTS.md`](../../AGENTS.md) Regel 5, "Kein Scope-Creep").

## Agenten

Rollen-Agenten unter `.claude/agents/`: [`hub-dev`](../agents/hub-dev.md)
(Hub-Kern + Adapter), [`pwa-dev`](../agents/pwa-dev.md) (PWA),
[`epic-planner`](../agents/epic-planner.md) (Phasen scaffolden).
