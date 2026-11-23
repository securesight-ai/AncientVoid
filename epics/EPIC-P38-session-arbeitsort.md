# EPIC-P38 — Session-Arbeitsort: eigener Worktree oder Projekt direkt

**Status:** abgeschlossen 2026-11-18 (Code + automatisierte Tests grün) — Menschen-Abnahme nach P000 verschoben · **Phase:** P38
**Dauer:** 1–2 Agenten-Wochen (grobe Schätzung, ohne Vorgänger-Restarbeit)
**Abhängigkeit:** P37 mit nachweislich grünen Exit-Kriterien; wirksame Vorgänger-Abnahmen bleiben bindend.

Quelle: [Orca-Vergleich](../docs/2026-11-08_orca-vs-ancientvoid.md) und [Planungsgrundlage mit Übernahmeregister](../docs/2026-11-08_orca-epic-planung.md).
**Planungsauftrag 08.11.2026:** Nutzer beauftragt diese Epics ausdrücklich vor Abschluss der Vorgänger. Das erlaubt Planung, keine Implementierung und keine Aufhebung des Epic-Gatings. Vor T38.1 aktuellen Code-/Test-/Abnahmestand prüfen; historische Überschriften reichen nicht.

## 1. Ziel

Beim Start explizit wählen, ob Änderungen in einem isolierten Git-Worktree oder direkt im vorhandenen Projekt erfolgen. Die Wahl ist jederzeit sichtbar und steuert Lifecycle/Recovery. K5/K7/K8, K1/K10 für Bedienung.

## 2. Scope (In / Out)

**In:** Auswahl in „Neue Session“, sichere Voreinstellung Worktree, persistenter Arbeitsort, direkte Projekte mit Schreib-Besitzprüfung, CLI/API/Fleet-Parität, P29-Integration.
**Out:** Worktree als Sicherheits-Sandbox ausgeben, Container-Implementierung, implizites Umschalten laufender Sessions, automatische Git-Resets/Commits/Stashes, parallele Hub-Schreiber im selben direkten Checkout.

## 3. Design-Details

### 3.1 Drei unabhängige Begriffe
Die UI verwendet zwei beschriftete Radiokarten „Eigener Worktree“ (Standard) und „Projekt direkt“, keinen mehrdeutigen Sandbox-Schalter. Ein Worktree isoliert Git-Dateien, nicht Prozess-/Netzwerkrechte. Die Harness-Sandbox/Permission-Mode bleibt separat; beides ist am Start und Sessionkopf sichtbar. Nicht-Git-Projekte bekommen die ehrliche direkte Variante mit Begründung. Nicht unterstützte Kombinationen failen vor Spawn.

### 3.2 Verträge und Bestand
`SessionSpec`/`SessionRecord`, `AdapterContext.workdir`, `WorktreeManager`, WorkspaceIdentity/Code/Diff und P29 manifest/runtime inventarisieren. Arbeitsort im Session-Contract; frühere Datensätze über belegte Worktree-/Origin-Information migrieren, unklare als needs_attention statt raten. ADR vor Contract-/Worker-Änderung. Domäne im bestehenden Workspace-/Session-Modul; kein Adapter importiert Hub-Interna.

### 3.3 Direkte Projekte
Pfad über realpath/Git-common-dir/Checkout-Identität kanonisieren. Pro Checkout höchstens ein AV-Schreiber inklusive Orchestrator/Automation; Lease mit Eigentümer/Generation im Journal, Recovery vor Freigabe prüfen. Externe Editor-/CLI-Schreiber sind nicht zuverlässig sperrbar: UI nennt diese Grenze und zeigt erkannte Drift, behauptet keine universelle Exklusivität. Dirty-Start nur nach expliziter Übersicht und Bestätigung; nie vorhandene Änderungen staschen/überschreiben. HEAD/Branch-Drift erkennbar; Session-Diff gegen festgehaltene Baseline kennzeichnet bestehende Dirty-Inhalte, statt sie als Agentenleistung auszugeben.

### 3.4 P29 und Cleanup
Worktree-Setup/Include/Teardown nicht unbesehen direkt ausführen. Bei direct: keine Include-Kopie, kein worktree apply/remove/prune; Manifest-Schritte nur wenn Modus und konkrete Schritte ausdrücklich freigegeben wurden. Teardown darf nie Repo-Löschung bewirken. Stop/Archiv entfernt ausschließlich nachgewiesene sessioneigene Prozesse/Artefakte. Resume/Discovery erhält Arbeitsort; bei Konflikt kein stiller Fork/direct-Fallback. Browser, Orchestrator und Scheduler verwenden später denselben Vertrag.

### Orca-Referenzen und Übernahmegrenzen

Alle Links auf Commit `bdeb388d75120b6e36dd619291286de0cc9aae02`. Einstufung ist eine geprüfte Port-Hypothese, keine behauptete fertige AV-Kompatibilität. Vor Übernahme Imports/Lizenz/Tests/Strip-Type-Tauglichkeit erneut prüfen; keine großen Orca-Subsysteme blind kopieren.

| Quelle | Verwendung in AV |
|---|---|
| [docs/site/content/docs/model/worktrees.mdx](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/model/worktrees.mdx) | Produktvergleich Worktree/Folder; kein direkter AV-Contract-Port. |
| [docs/site/content/docs/model/orca-yaml.mdx](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/model/orca-yaml.mdx) | Referenz für unterschiedliche Setup-/Copy-/Share-Semantik, keine unveränderte Übernahme. |

## 4. Aufgaben (Checkliste T38.m)

- [x] **T38.1** Bestandsmatrix (create/adopt/fork/mirror/non-Git/Fleet/Loop), ADR/Contract und Migrations-/Diff-Baseline-Regel festlegen. **K5/K7/K8**. — ADR-0057 mit Bestandsmatrix; Migration 30 (worktree belegt, sonst `unknown`)
- [x] **T38.2** Canonical Checkout-ID, persistente Writer-Lease und Konflikt-/Driftprüfung mit Symlink-/Restart-/Dirty-/Branchwechseltests bauen. **K7/K8**. — `workspace/checkout.ts` (kanonische ID, Lease mit Generation, Baseline/Drift); Tests Symlink/Unterordner/Restart/Dirty/Branchwechsel
- [x] **T38.3** Startpfade und P29 nach Arbeitsort trennen; direkt nie Include/Worktree-Cleanup/Apply auslösen. **K5/K7**. — `resolveWorkplace`/`ensureWorkdir`-Guard; direct legt nie Worktree/Include/Teardown an
- [x] **T38.4** UI-Auswahl mit separater Sandbox-Erklärung, gewähltem Pfad, Dirty-Bestätigung und Session-Badge; CLI/API/Fleet gleich prüfen. **K1/K10**. — `WorkplaceChoice` + Badge + Diff-Markierung; API `workspaceMode`/`confirmDirty`, Preview/Status-Routen, hubctl; Fleet über dieselbe API
- [x] **T38.5** `e2e/specs/session-workspace-mode.spec.ts`: zwei Worktrees parallel, Direct-Konflikt, Resume, Archivieren; Zielrepo-Sentinel bleibt unverändert erhalten. **K7/K8**. — `e2e/specs/session-workspace-mode.spec.ts`, Sentinel/Dirty bleiben erhalten
- [ ] **T38.6** Gate, PWA-Build, Migrationstest und echte Scratch-Repo-Abnahme beider Varianten. **K1/K5/K7/K8/K10**. — Gate, Build, Migrationstest (`workplace-mode.test.ts`) und Runbook (`docs/workplace-runbook.md`) stehen; **offen:** echte Scratch-Repo-Abnahme mit echtem Harness (Runbook §3) → nach P000 verschoben

## 5. Acceptance Criteria (AC-P38-k)

- **AC-P38-1:** Standardstart nutzt weiterhin eigenen Worktree; direkter Start arbeitet exakt im angezeigten kanonischen Checkout.
- **AC-P38-2:** Arbeitsort und Harness-Sandbox werden getrennt angezeigt; Worktree wird nie als OS-Isolation beworben.
- **AC-P38-3:** Zweiter AV-Schreiber im gleichen direkten Checkout wird vor Spawn verweigert, auch über Fleet/Automation/Orchestrierung.
- **AC-P38-4:** Dirty-Start, Baseline und spätere Drift sind sichtbar; fremde bestehende Änderungen werden nicht übernommen oder gelöscht.
- **AC-P38-5:** Archiv/Stop/Recovery entfernt nie direktes Projekt oder fremde Prozesse, kein implizites git reset/stash/commit.
- **AC-P38-6:** Historische Sessions und Adoption/Resume erhalten belegten Arbeitsort oder einen sichtbaren Klärungsbedarf.

## 6. Premortem (Failure-Modi + Mitigation)

1. Checkbox suggeriert Sicherheit → verständliche Arbeitsort-Auswahl plus getrennte Sandbox-Capability.
2. Direct-Archiv löscht Repo → Besitz-/Modusguard und Sentinel-Negativtests vor Cleanup.
3. Symlink umgeht Exklusivität → kanonische Checkout-ID, generationengebundene Lease.
4. Vorhandene Arbeit erscheint im Agenten-Diff → Baseline inkl. Dirty-Zustand abbilden, Unsicherheit sichtbar lassen.

## 7. Definition of Done

Alle T38.* und AC-P38-* mit aktueller Evidenz, Vorgänger-Exit ausdrücklich grün. `npm run gate` und PWA-Build grün; Pipeline-Job `e2e` grün bzw. Infrastrukturfall nach `docs/ci-runbook.md` nachgezogen, niemals als Pass gezählt. Jede neue UI-Funktion/jeder Ablauf hat einen Spec in `e2e/specs/`; benötigte echte Browser-/Provider-/Geräte-Nachweise separat, Skip ≠ Pass. Neue APIs/Tools/Ansichten sind registriert, in Hub/PWA/hubctl erreichbar und dokumentiert. ADR vor Contract-Änderung, K5/K7/K8 entsprechend Scope nachgewiesen; keine offene TODO ohne Epic-Bezug. Übernommene Orca-Teile mit Commit/Pfad/Hash/Lizenz/Änderungsnotiz und eigenen Tests gemäß Planungsgrundlage.
