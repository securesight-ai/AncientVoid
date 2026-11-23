# AGENTS.md — Repo-Leitfaden für Coding-Agenten

## Was das ist

AncientVoid: local-first Hub, um Coding-Agenten vom Handy zu
überwachen/steuern. Basis-Dokumente: `epics/` (PRD + Epics P0–P4.5, Planungsentwürfe P5–P12) —
**lesen, bevor Features gebaut werden.** Epic-Gating: P(n) startet erst,
wenn die Exit-Kriterien von P(n-1) grün sind.

**On hold (Nutzerentscheid 15.11.2026):** P30 und P31 bleiben ausdrücklich
zurückgestellt. Nicht als nächste Aufgabe empfehlen oder automatisch starten;
Wiederaufnahme nur auf ausdrücklichen Nutzerauftrag. Abhängigkeiten bleiben
bestehen, auch wenn andere Epics oder Vorgänger inzwischen grün sind.

## Architektur-Regeln (nicht verhandelbar)

1. **Contracts first.** Alles, was Komponenten teilen, liegt in
   `@ancientvoid/contracts` und ist öffentlicher API-Stabilität unterworfen.
   Änderungen am Adapter-/Event-/Worker-Contract brauchen ein ADR in
   `docs/adr/`.
2. **Adapter sehen nur `AdapterContext`** (`emit`, `blob`, `spawnWorker`,
   `log`, `signal`, `workdir`, `sessionId`). Keine Hub-Internas, keine
   Imports aus `@ancientvoid/core` oder `@ancientvoid/hub` in Adaptern.
3. **K5-Disziplin:** Payloads ≤ 4 KB; alles Große via `ctx.blob()` auslagern.
   Der EventStore erzwingt es, Adaptern soll es trotzdem nicht egal sein.
4. **K7-Disziplin:** Zustand ist aus JSONL + Snapshot rekonstruierbar. Jede
   neue State-Quelle muss einen Recovery-Pfad haben.
5. **Kein Scope-Creep:** Jedes Feature braucht eine Messlatten-Referenz
   (PRD §9, K1–K10). Epic-Scopes in `epics/EPIC-P*.md` gelten.
6. **Fail loud:** Unbekannte Provider-Formate, Adapter-Ausfälle etc. werden
   als Events/Status sichtbar, nie still gedroppt.

## Conventions

- Node 22.18+ / 24 / 26+, ESM, TypeScript strict, **kein Build-Schritt für Server-Code**
  (Node strip-types). Deshalb: **keine Parameter-Properties, keine Enums,
  keine Namespaces** — nur strip-taugliche TS-Syntax. PWA baut via Vite.
- Imports mit `.ts`-Endung (`./foo.ts`), `import type` wo möglich.
- npm workspaces; neue Pakete nach `packages/`, Name `@ancientvoid/<name>`.
- Persistenz: `node:sqlite` (keine nativen Module).
- Zeitstempel ISO-8601 UTC. IDs: `crypto.randomUUID()`.
- Kommentare sparsam, auf Deutsch oder Englisch, Warum statt Was.

## Kommandos

> **CI-Geltung (Umzug auf GitHub, 16.11.2026; Laufzeit-Split 16.11.2026):**
> Gehostete CI ist GitHub Actions auf GitHub-gehosteten Runnern: PRs gate
> den schnellen Kern (`.github/workflows/ci.yml`, Job `verify`: schnelle
> Tests, Lint, Typecheck, Build) — Required Check; die volle Messlatte
> (komplette Testsuite inkl. Slow-Liste, E2E, K8) fährt
> `.github/workflows/nightly.yml` auf `ci/full-suite` zweimal täglich
> (03:00/15:00 UTC). Jeder Merge nach `main` synchronisiert den Testbranch
> über den unabhängigen Workflow `pipeline-sync.yml`;
> Fehler erzeugen automatisch GitHub-Bugs (`nightly-bugs.yml`). Die
> lokalen Gates unten bleiben **zusätzlich** und unverändert voll
> verbindlich. Rote CI blockiert;
> ist die Ursache nachweislich nur die Umgebung (z. B. Runner-Flake), wird das
> benannt und einmal neu gestartet — nie als Pass gemeldet. Keine self-hosted
> Runner für das öffentliche Repo (Fork-PRs führen fremden Code aus).
> Details: `docs/ci-runbook.md`.

```bash
npm test                 # vitest: die volle Suite (Tier A + B zusammen)
npm run test:fast        # vitest Tier A: schneller Loop (parallel; ohne die Dateien aus scripts/slow-tests.json)
npm run test:slow        # vitest Tier B: die langsamen Dateien (VITEST_SET=slow, seriell)
npm run test:e2e         # Playwright-E2E-Gate gegen einen echten Hub (docs/testing-e2e.md)
npm run lint             # eslint
npm run typecheck        # tsc --noEmit
npm run gate             # check:* + typecheck + lint + volle Suite + test:e2e
npm run skills:curate    # Skill-Kur: Run-Auswertung, Regeln, Mining (kein LLM; docs/skill-curation.md)
npm run loadtest         # K8: 20 Sessions × 30 ev/s
npm -w @ancientvoid/pwa run build
```

Pflicht vor jedem Commit-Vorschlag: `lint`, `typecheck` und **die Tests, die genau
die geänderte Verhaltensweise prüfen** — Unit-/Route-/Spec-Dateien beim Namen genannt,
rot-dann-grün. Die zugehörige Spec in `e2e/specs/` ist Teil der Änderung, kein
Zusatzprogramm.

**Kein breit laufender Test als Standard (Nutzerentscheid 16.11.2026):** `npm test`
(Tier A), `npm run test:slow`, ein volles `npm run test:e2e` oder ganze Suiten/
Matrizen fahren wir nur auf ausdrücklichen Auftrag. Die volle Messlatte liegt bei
Gate und CI (`ci.yml` schnell, `nightly.yml` vollständig) — dort läuft sie ohnehin.

**Test-Tiers:** Tier A ist `npm run test:fast` (die PR-Gate-Messlatte aus
`ci.yml`; lässt alles weg, was lang ist, Ports bindet oder auf Wanduhr-Zeit
prüft), Tier B ist `npm run test:slow` (genau diese Dateien aus
`scripts/slow-tests.json`, seriell — ~25 min lokal, auf den Hosted-Runnern
deutlich weniger, weil dort Adapter-Suiten sichtbar skippen). `npm test` und
`gate` fahren **beide Tiers zusammen** — nichts fällt still weg. **Im
Arbeitsloop ist der gezielte Fall der Standard, nicht die breite Suite.** Wer
eine Datei auf die Slow-Liste setzt, schreibt die gemessene Dauer in den
Commit (Generator `scripts/gen-slow-tests.mjs`; der Nightly-Lauf schlägt Drift
vor, der Commit bleibt Handarbeit); neue langsame Tests bleiben dort, solange
BUG-0170 offen ist.

## Testing

- Rezept für Agenten: Skill [`write-tests`](.claude/skills/write-tests/SKILL.md)
  (Unit / Integration / E2E, rot-dann-grün, Skip-Muster).
- Unit/Contract-Tests in `packages/*/test/*.test.ts` (vitest, forks pool).
- Neue Integrations-Tests: `*.integration.test.ts` (Vorbild:
  `apps/hub/test/server.test.ts`).
- E2E in `e2e/` (Playwright Chromium). Fehlt der Browser, skippt der Test
  sichtbar — analog tmux / ADR-0002. Nicht als Pass zählen.
- Adapter bekommen die Suite aus `@ancientvoid/adapter-testkit` — grün =
  hub-integrierbar.
- tmux-Tests skipped automatisch, wenn tmux fehlt.
- Fixtures für echte CLI-Streams (P1): aufgezeichnet, anonymisiert,
  secret-gescannt — nie Roh-Logs committen.

## Datadir & Sicherheit

Ausgelagerte Jobs einer Session über `hubctl activity <sessionId> <id> run -- <Kommando>`
mit vorhandenem Hub-Zugang registrieren (ADR-0074). Der Wrapper meldet Start,
Heartbeat und Ende. Kein bloßes „läuft im Hintergrund“ als Abschlussnachweis;
bei fehlendem Reporter-Zugang im Vordergrund bleiben.

`data/` (SQLite, JSONL, Blobs, Worker-Logs) ist git-ignored und bleibt es.
Keine Secrets in Config-Commits; Tokens nur als Hash. Kein Code, der Agenten-
Output als Instruktion interpretiert (Prompt-Injection-Grenze, PRD §8.5).

## Arbeitsweise für Agenten

Skills unter `.claude/skills/` sind die ausführbare Form dieser Regeln —
sie duplizieren nichts hier, sie wenden es an. Index: `.claude/skills/README.md`.

- Defekt: Skill `bugfix` (Reproduce → Fix → Re-verify → Finalize). Handoff an `pr-review`.
- Neuer Bug ohne Fix: Skill `bug-report` → `bugs/bug-NNNN-slug.md`.
- Issue-Lebenszyklus (Anlage-Klassen, Triage, `Fixes #`-Pflicht für Defekt-PRs, Auto-Close für CI-Bugs): [docs/issues.md](docs/issues.md).
- Vor jedem PR: Skill `gates` (= `npm test && npm run lint && npm run typecheck`, betroffene Packages; bei UI-/Ablauf-Änderungen plus `npm run test:e2e`, vor Epic-Abschluss `npm run gate`) und danach `pr-review` (6 Dimensionen inkl. Future-Fragility: Contract-Bruch, K5/K7-Verletzung, Adapter-Isolation).
- **Wohin neuer Code gehört** ([ADR-0020](docs/adr/0020-modular-monolith-structure.md)): Fachlogik in `packages/core/src/modules/<modul>/` (öffentlich nur über dessen `index.ts`), Verträge in `packages/contracts/src/<modul>/`, HTTP-Routen in `apps/hub/src/modules/<modul>/<modul>.routes.ts`, PWA-Ansichten in `apps/pwa/src/features/<feature>/`, Gemeinsames der PWA in `apps/pwa/src/shared/`, Adapter in `packages/adapters/<name>/`. `npm run check:arch` (im Gate) prüft die Grenzen.
- Commit-Zusammenfassung und PR-Titel: **Commit-Notation** `<Risiko> <Absicht> <bereich>: <Satz>` (`^ F pwa: …`, `. d adr: …`, `! B core: …`) nach [`docs/commit-notation.md`](docs/commit-notation.md) — Risiko nach belegtem Gate/Testumfang, eine Verhaltensänderung pro Commit, PR-Titel nie `@`. Hook `.githooks/commit-msg` und `npm run check:commits` prüfen es.
- Commit/Branch/PR: Skill `git-workflow` — inkl. **fester Kadenz**: Task-Abschluss → commit; Bugfix- oder Epic-Abschluss → commit + push + PR (`gh pr create --base main`). Solo-Projekt: Self-Merge des eigenen PRs zulässig, PR bleibt Pflicht-Log. Kein Force-Push, kein Push/Commit auf `main` außerhalb der dokumentierten Bootstrap-Ausnahme. **Merge auf Zuruf: sind die lokalen Gates grün, die der Commit belegt, wird der PR mit `gh pr merge --auto --merge` eingestellt und merge-t sich selbst, sobald `verify` grün ist — ein ausdrückliches Merge-Kommando pro PR ist nicht mehr nötig. Der Merge selbst passiert ausschließlich über `gh pr merge [--auto] --merge` (Merge-Commit mit PR-Titel, kein Squash)/GitHub-UI nach grüner CI — nie über ein lokales `git merge` von einem Feature-Branch nach `main`, auch nicht als Notlösung wenn der Remote gerade nicht erreichbar ist** (dann bleibt der Branch offen und ungelöscht — siehe `git-workflow`, real nötig geworden am 2026-09-18). **Post-Merge:** Source-Branch lokal+remote löschen (`--delete-branch`, `git fetch --prune`); PR-Ziel ist `main` (Epic-Ketten nur kurzlebig) — siehe `git-workflow` und `CONTRIBUTING.md` § Branches and pull requests.
- Neue Phase: Skill `epic-creation` bzw. Agent `epic-planner` — Vorbild `epics/EPIC-P3-adapter-flotte-sprachsuche.md`, Premortem nie überspringen.
- **Permanentes Abnahme-Epic:** [`epics/EPIC-000-testsuite-fuer-menschen.md`](epics/EPIC-000-testsuite-fuer-menschen.md) ist die dauerhafte Sammelstelle für alle Menschen-Testabnahmen (Gerätetermine, echte Stimmen/Remotes, Nutzer-Verifikation fester Bugs). Ein Epic kann abgeschlossen werden, sobald Code + automatisierte Tests fertig sind; die verbleibende Menschen-Abnahme wandert dorthin (Delegationsvermerk „nach P000 verschoben“ im Ursprungsepic, abgehakt wird nur in P000) — damit der Epics-Counter ehrlich bleibt. Epics mit reinem Agentenrest bleiben offen.
- **Bild verarbeitet? Immer einen anklickbaren Link dazugeben** — Bild hochladen, nackte
   URL ins Chat-Fenster (`#/anhang/<id>` bzw. session-intern); ein Klick öffnet das Vollbild.
   Rezept: [docs/bild-links-fuer-agenten.md](docs/bild-links-fuer-agenten.md). Kein Bild als
   Dateipfad abliefern — auf dem Handy ist ein Pfad nichts wert.
- Tests schreiben: Skill `write-tests`.
- Architekturfragen/Schichten: Skill `architecture-best-practices`.
- Diff wirkt überkonstruiert: Skill `ponytail-review` (Tags `delete`/`stdlib`/`native`/`yagni`/`shrink`, Invarianten via `_shared/ancientvoid-protected-invariants.md`).

Kein Branch für nicht angewiesene Arbeit (unter einer stehenden
Autonomie-Anweisung für eine Aufgabe/ein Epic ist ein Branch **pro
Aufgabe** davon gedeckt, siehe `git-workflow`). Self-Merge des eigenen PRs
ist zulässig (Solo-Projekt) — was **nicht** zulässig ist: den PR selbst zu
überspringen und stattdessen lokal nach `main` zu mergen. Kein
`--no-verify`-Äquivalent (der `commit-msg`-Hook prüft die Commit-Notation;
der `pre-push`-Hook erzwingt Lint und Typecheck; Tests über die Kommandos oben, das Gate und die GitHub-Actions-CI).

Neue `.md`-Dateien: `docs/` (flach, kein Unterordner-Wildwuchs) oder `epics/`
für Epics. Bewährte Ausnahmen: `docs/adr/` (ADRs), `docs/guide/` (EPIC-P62:
englischer Guide + Inventar), `docs/videos/` (EPIC-P62: Video-Skripte).
Eingefrorene Analysen (Audits, Evaluierungen, Berichte) bekommen
das Datum in den Namen (`JJJJ-MM-TT_*` bzw. `*JJJJ-MM-TT`) — sie sind
referenzfrei zulässig und altern bewusst. ADRs nach `docs/adr/NNNN-*.md`.
Kein `*-STATUS.md`/`*-SUMMARY.md` auf Top-Level. Über Zeilen-Budgets, Links,
Referenzen, Script-Inventar und Frischhalte lebender Dokumente wacht
`npm run check:context` (Regeln: [docs/check-context.md](docs/check-context.md)).

## Definition of Done (repo-weit, P0-Standard)

Tests + Lint + Typecheck grün; neue Komponenten haben Contract-Bezug;
Messlatten-Verletzungen werden als Testfehler sichtbar; kein TODO ohne
Epic-Referenz.
