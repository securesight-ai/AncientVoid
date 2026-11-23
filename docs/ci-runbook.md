# CI-Runbook: GitHub Actions, rote Läufe, lokale-vs-CI-Regel

**Art:** how-to

Stand: 16.11.2026 · Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) ·
Inventar: [CI-Gate-Inventar](ci-gate-inventar.md) · Historie: [EPIC-P28](../epics/EPIC-P28-reproduzierbare-ci.md),
[ADR-0049](adr/0049-selbstverwalteter-ci-runner.md)

## 0. Geltung seit 16.11.2026

Das Projekt liegt öffentlich auf GitHub (`securesight-ai/AncientVoid`). Die gehostete
CI ist **GitHub Actions** auf GitHub-gehosteten `ubuntu`-Runnern.

| Nachweis | Pflicht für PRs nach `main` |
|---|---|
| Lokale Gates (`AGENTS.md`, Abschnitt Kommandos) | ja, vor jedem PR |
| GitHub Actions PR-Gate (`ci.yml`, Job `verify`: schnelle Kern-Tests, Lint, Typecheck, Build) | ja, Required Check per Branch-Protection |
| GitHub Actions volle Messlatte (`nightly.yml`: volle Vitest-Suite inkl. Slow-Tests, `k8`, `e2e` als Shard-Matrix) | nein — sie läuft auf `ci/full-suite` zweimal täglich im Zeitlauf (laufzeit-Beschluss 16.11.2026) |

- Beide Nachweise gelten **zusätzlich**, keiner ersetzt den anderen.
- Ein roter Lauf blockiert den Merge. Liegt die Ursache nachweislich nur in
  der Umgebung (Runner-Flake, Dienst-Ausfall, Netz beim `npm ci`), wird das im
  PR benannt und der Lauf **einmal** neu gestartet (§3) — nie als Pass gemeldet.
- `cancelled`/fehlende Jobs sind kein Pass. Abgebrochene oder veraltete
  Läufe (älterer SHA) zählen nicht. Auf PRs läuft bewusst nur der schnelle
  Gate (`verify`); die vollen Läufe (Zeitplan, manueller Start) müssen voll
  durchlaufen — dort ist jeder Skip und jeder fehlende Job kein Pass.
- **Keine self-hosted Runner** für dieses öffentliche Repo (§4).
- Produktfunktionen für GitLab (Forge-Modul, EPIC-P37) sind davon unberührt;
  diese Regel betrifft nur die CI dieses Repos.

**Historie:** Bis 16.11.2026 lag das Projekt privat auf `gitlab.com`; die
Pipeline (`.gitlab-ci.yml`) lief auf dem selbstverwalteten Projekt-Runner
`av-docker` ([ADR-0049](adr/0049-selbstverwalteter-ci-runner.md),
EPIC-P28). Ab 15.11.2026 galt sie dort nicht mehr als Merge-Gate. Alte
Links auf `gitlab.com/SiLenT_Tz/…` zeigen auf das private Archiv.

## 1. Jobs

| Job | Inhalt | Lokales Gegenstück |
|---|---|---|
| `verify` (`ci.yml`, PR-Gate) | `npm ci` (aus `node_modules`-Cache nur bei exaktem Lockfile-Treffer), Typecheck, Lint, Checks (`check:*`), schnelle Kern-Tests (ohne Slow-Liste), PWA-Build — die Kern-Tests laufen im Hintergrund parallel zu Guards und Build | `npm run test:fast && npm run lint && npm run typecheck` |
| `cache-warm` (`cache-warm.yml`, Push auf main bei Lockfile-Wechsel) | frische Installation aus dem Lockfile auf main und Speichern des `node_modules`-Caches — PR-Zweige sehen nur Caches vom eigenen Zweig und von main; der Kaltlauf-Beweis bleibt hier | `npm ci` |
| `vitest-full` (`nightly.yml`) | die komplette Vitest-Suite inkl. Slow-Tests (Liste `scripts/slow-tests.json`, Generator `scripts/gen-slow-tests.mjs`, Drift-Vorschlag im Log) | `npm test` |
| `k8` (`nightly.yml`) | Lasttest 20 Sessions × 30 ev/s | `npm run loadtest` |
| `e2e-shards` + `e2e` (`nightly.yml`) | Playwright Chromium gegen einen echten Hub, danach Skip-Bericht (4 Shards parallel, Browser-Cache); der Aggregations-Job `e2e` fasst die Shard-Berichte nach denselben Regeln zusammen (fehlender Bericht, null Tests, Failures — `scripts/ci-e2e-aggregate.mjs`) | `npm run test:e2e` |

Der PR-Gate läuft auf jedem PR (auch reine Doku- und Dependabot-PRs);
`dependabot-automerge.yml` stellt auf jedem Dependabot-PR mit **Patch-/Minor**-Bump
Auto-Merge ein (Merge-Commit, Branch weg) — der Merge feuert erst, wenn der
Ruleset `main-gate` den grünen `verify` sieht; rote PRs bleiben offen und
sichtbar. **Major-Bumps** mergt bewusst niemand automatisch: API-Brüche deckt
nur die volle Messlatte im Nightly auf, und Exaktpins (z. B. `typescript`)
gehen solche Bumps gar nicht erst ein. Security-Advisories übersteuern nicht —
auch sie laufen durch den PR-Gate (2026-11-24).
Die vollen Läufe (`nightly.yml`) laufen um 03:00/15:00 UTC und per
`workflow_dispatch`; alle Jobs prüfen denselben beim Start festgehaltenen SHA.
Dafür wartet `prepare` bis zu 90 s, bis `ci/full-suite` dem main-HEAD entspricht
— ein manueller Start direkt nach einem Merge kann sonst den Vorgänger-Stand
testen, während `pipeline-sync` noch läuft (gesehen 16.11.2026). Nach Ablauf
scheitert der Resolve laut statt still einen veralteten Stand zu prüfen.
Ein Push startet nur die Branch-Synchronisierung, keine Vollsuite.
Der Sync-Workflow hat eine eigene Concurrency-Gruppe und wartet nicht auf
einen laufenden Volltest. Nightly liest den Testbranch mit Leserechten.
Laufende Vollsuiten werden durch neue Pushes nicht abgebrochen. Die genaue Schrittfolge
steht ausschließlich in `ci.yml` und `nightly.yml`. **K8 bleibt
20 Sessions × 30 Events/s**, lokal wie in CI; keine Job-Konfiguration darf
diese Messlatte entschärfen. Fehlt in CI der Browser, muss `e2e` rot enden,
nicht still skippen.

### Parallelitaet der Test-Tiers

Tier A (`test:fast`, PR-Gate) laeuft parallel mit **max. 16 Forks, hoechstens Kerne minus
zwei**; Tier B (`test:slow`) bleibt
seriell (`maxWorkers: 1`), weil dort die zeit- und portbasierten Dateien stehen
(`scripts/slow-tests.json`). Stufe ohne Code-Aenderung verstellbar: `VITEST_WORKERS=4`.

Gemessen auf einem Windows-Desk mit 20 Kernen (2026-11-17): Tier A **23 s** (16 Forks, automatisch skaliert)
gegen 36 s (8 Forks), 246 s (seriell) und 451 s (Ausgangslage mit kaputtem Attrappen-Spawn).
Ein Hosted-Runner mit 4 Kernen faehrt dabei 2 Forks, nicht 16 — der Lauf laeuft nicht gegen
den Runner-Arbeitsspeicher. Drei zeitkritische Dateien (`handover`, `steer-wait-timeout`,
`turn-state`) wechseln ihre Rot/Gruen-Zugehoerigkeit zwischen Laeufen: gemeldet als Issue #85.

## 2. Einen Lauf lesen

```bash
gh pr checks <nr>                         # Status aller Checks eines PRs
gh pr checks <nr> --watch                 # bis zum Ende verfolgen
gh run list --branch <branch> --limit 5   # Läufe eines Branches
gh run view <run-id>                      # Jobs und Schritte
gh run view <run-id> --log-failed         # nur die Logs der fehlgeschlagenen Schritte
gh run download <run-id> -n e2e-report-shard-1 -D e2e-report-shard-1   # Artefakt laden
```

Artefakte (14 Tage): `vitest-junit` aus `verify`/`vitest-full` (JUnit-XML) und
`e2e-report-shard-<n>` aus den Shard-Jobs (`playwright-report/` mit Traces/Screenshots,
`test-results/` mit JUnit-XML, `ci-artifacts/e2e-report.md` mit benannten
Skips). `gh run view <run-id>` listet sie. Artefakte sind im öffentlichen Repo für
alle sichtbar — daher keine Secrets, Hostnamen oder Home-Pfade in Test-Output.

Lokaler Nachbau eines Linux-Laufs im Container (Default-Image `node:26`, per
`CI_REPRO_IMAGE` änderbar — CI nutzt Node 24; kalt ohne Cache):

```sh
scripts/ci-repro.sh            # verify inkl. K8
scripts/ci-repro.sh --e2e      # zusätzlich Playwright/Chromium
scripts/ci-repro.sh --warm     # mit npm-Cache-Volume (Schnelltest, kein Kaltbeweis)
```

## 3. Fehlerklasse und Re-run

Vor jedem Re-run die Klasse aus `--log-failed` bestimmen:

| Befund | Klasse | Maßnahme |
|---|---|---|
| Test-, Lint-, Typ- oder Check-Fehler | Produkt/Test | **kein Re-run** — Ursache lesen, Fix pushen; lokal mit demselben Kommando reproduzieren |
| Nur in CI rot, lokal grün | Umgebung **oder** latenter Bug | erst `scripts/ci-repro.sh` (Linux, kalt); reproduziert → Bug (`bug-report`) |
| Runner-Abbruch, Timeout ohne Testbezug, Netzfehler bei `npm ci`/Browser-Download | Infrastruktur | **einmal** neu starten, beide Läufe im PR benennen |

```bash
gh run rerun <run-id> --failed     # nur fehlgeschlagene Jobs wiederholen
gh run rerun <run-id>              # kompletter Lauf
```

Produktfehler werden nie durch Wiederholen grün. Zeitkritische Tests, die
nur auf langsameren Runnern rot werden, sind Bugs (Vorbild BUG-0092), keine
Flakes zum Wegklicken.

## 4. Sicherheit für das öffentliche Repo

**Keine self-hosted Runner.** Ein öffentliches Repo führt Workflows für
Pull Requests aus Forks aus; ein eigener Runner würde fremdem Code
Zugriff auf einen persönlichen Rechner und dessen Netz geben (persistente
Prozesse, Cache-Vergiftung, Netzzugriff). GitHub-gehostete Runner sind pro
Job frisch und isoliert.

Einstellungen (*Settings → Actions → General*) und Workflow-Regeln:

- **Fork-PR-Workflows brauchen Freigabe** („Require approval for all
  external contributors“). Vor der Freigabe den Diff lesen — besonders
  Änderungen an `.github/`, `package.json`-Skripten, Lockfile und `scripts/`.
- **`GITHUB_TOKEN` standardmäßig read-only** („Read repository contents
  permission“); Workflows setzen `permissions:` explizit und minimal.
- Trigger ist **`pull_request`, nie `pull_request_target`** — sonst liefe
  Fork-Code mit Schreib-Token und Secrets des Basis-Repos.
- **Actions per Commit-SHA gepinnt** (`uses: owner/action@<sha> # vX.Y`),
  nicht per Tag.
- **Dependabot** hält die gepinnten Actions aktuell (`.github/dependabot.yml`,
  Ökosystem `github-actions`); Updates laufen als normale PRs durch dieselbe CI.
- **Keine Secrets** in Workflows. Braucht ein Job je eines, nur über
  Environments mit Freigabe und nie in Jobs, die Fork-Code ausführen.
- Branch-Protection auf `main` (Ruleset `main-gate`, aktiv seit 16.11.2026):
  Required Check ist `verify` (der schnelle PR-Gate aus `ci.yml`, ohne
  Auto-Update-Regel — der Gate prüft ohnehin den Merge-Ref); kein
  Force-Push (non-fast-forward), kein Löschen von `main`. Direkter Push auf
  `main` aktualisiert ebenfalls den Testbranch; normale Arbeit geht per
  PR. Die vollen Läufe (`nightly.yml`) sind kein PR-Gate.

## 5. Lokale-vs-CI-Regel

- Lokal vor jedem Commit-Vorschlag: `npm test`, `npm run lint`,
  `npm run typecheck`; bei PWA/Server-Routen/SessionManager/Adaptern
  zusätzlich `npm run test:e2e`; vor Bugfix-/Epic-PRs `npm run gate`.
- Keine schweren lokalen Läufe (Loadtest, Voll-E2E) parallel zueinander auf
  einem ausgelasteten Arbeitsrechner — der timing-sensible K7-Recovery-Test
  scheitert sonst
  ([BUG-0092](../bugs/bug-0092-k7-recovery-test-flaky-parallel-last.md)).
- Lokal betroffene Packages testen; vollständiges E2E nur bei UI-/Routen-/
  SessionManager-/Adapter-Änderungen (AGENTS.md). Die Vollsuite fährt `k8`/`e2e` auf dem synchronisierten Testbranch.

## 6. Negativproben (jährlich oder nach Workflow-Umbau)

1. **Absichtlich fehlerhafter Test:** Wegwerf-Branch mit rotem Test als PR
   → `verify` muss rot sein, Merge-Button gesperrt; PR schließen, Branch löschen.
2. **Fehlender Chromium:** Wegwerf-Branch, der den Browser-Install aus `e2e`
   entfernt → Job muss rot enden (kein stiller Skip).
3. Danach denselben sauberen Commit erneut laufen lassen und grün sehen.

Belege (Run-IDs) im jeweiligen PR bzw. Epic unter Abschlussnachweisen.

## 7. Automatische CI-Bugs (EPIC-P28, K1–K10)

`nightly-bugs.yml` reagiert auf fehlgeschlagene `nightly`- und
`pipeline-sync`-Läufe, auch wenn
das Setup oder die Branch-Synchronisierung scheitert. Pro fehlgeschlagenem
Job entsteht ein GitHub-Issue mit Label `bug`, SHA, Branch, Run-/Job-Link
und Reproduktionshinweis. Ein vorhandener offener Bug desselben Jobs wird
auf das jüngste Auftreten aktualisiert; nach Schließen erzeugt ein neuer
Fehler einen neuen Bug.

**Auto-Close (EPIC-P71, 18.11.2026 — löst die frühere Regel „Grüne Läufe
schließen Bugs nicht automatisch" ab):** Jeder abgeschlossene `nightly`-Lauf
(auch teilweise grün; Abbrüche ausgenommen) schließt offene CI-Bug-Issues
der Jobs, die in diesem Lauf grün waren, mit Evidenz-Kommentar (Run-ID,
SHA, Job-Link) — das Muster des manuellen Schließens von #54–#57, jetzt
automatisch (`closeResolved` in `scripts/ci-pipeline.mjs`, Close-Job in
`nightly-bugs.yml`, dieselbe Concurrency-Gruppe, Code nur von `main`).
Bewusster Trade-off: Flaked ein Job zufällig grün, erzeugt ein erneutes
Auftreten wie bisher eine neue Issue; Re-Open per `gh issue reopen <nr>`
(Lebenszyklus: `docs/issues.md`). „workflow startup"-Bugs schließt nur ein
insgesamt grüner Lauf. CI-Bugs von `pipeline-sync`-Jobs bleiben vom
Auto-Close unberührt (Sync-Ausfall, kein Testversagen) und werden manuell
geschlossen. Abgebrochene Läufe erzeugen keinen Produktbug, schließen
nichts und bleiben als Abbruch sichtbar.

Der Reporter führt ausschließlich Code von `main` aus, liest Job-Metadaten
über die API und führt weder Logs noch Artefakte aus. Nur dieser Workflow
hat `issues: write`; nur `pipeline-sync.yml` hat `contents: write`. Tests selbst
haben Leserechte. Die Implementierung und Negativfälle stehen in
`scripts/ci-pipeline.mjs` und `scripts/ci-pipeline.test.mjs`.

Historische Fehler lassen sich per `gh workflow run nightly-bugs.yml -f run_id=<ID>`
nacherfassen (z. B. nach einem Reporter-Ausfall). Es werden nur fehlgeschlagene
`nightly`-/`pipeline-sync`-Läufe ausgewertet, keine PR-Workflows.
