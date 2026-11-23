# EPIC-P60 — Agenten-Teams: Run→Team umbenennen, Kartenübersicht, echte Parallelität, Modellwahl

**Status:** abgeschlossen 14.11.2026 (Retro unten) · **Phase:** P60 · **Dauer:** 2–3 Agenten-Wochen · **Abhängigkeit:** keine fachliche offene (P40 umgesetzt, Gate grün; Live-Lauf-Block P39-Endabnahme bleibt unberührt — Parallelität/Modellwahl ist mit Testkit-Adaptern belegbar)

**Nummernkorrektur 14.11.2026:** Dieses Epic wurde parallel zum
Vier-Punkte-Auftrag auf veraltetem main-Stand als „P58" geplant; P58 war
zu diesem Zeitpunkt bereits an das Typewriter-Epic vergeben (heute
gemergt und abgeschlossen). Nach der Repo-Regel „Bestehende
Epic-Nummern bleiben stabil" (Präzedenz P46) führt es die Nummer **P60**
weiter; inhaltlich unverändert.

Nutzerauftrag von Jan 14.11.2026 nach erster Nutzung der P40-Fläche:
Die Run-Seite ist visuell unbefriedigend, der Begriff „Run" sagt nicht,
was die Fläche tut; gewünscht sind eine Übersicht mit einzelnen Karten je
parallel laufendem Agenten (wie die Session-Übersicht), tatsächliche
Parallelisierung unabhängiger Aufgaben durch den Koordinator sowie
vorab wählbare Adapter/Modelle.
Entscheidungen (Jan, 14.11.2026): Name wird **Team** („Factory" kollidiert
mit Loop-Factory P19/P26, „Orchestrator" mit der Core-Klasse/Hermes-Rolle);
Umbenennung **überall sauber definiert** — auch Contracts, nicht nur UI.

## 1. Ziel

Ein Team ist der eine große Auftrag, den der Mensch eintippt und der
automatisch auf mehrere Agenten-Sessions verteilt wird. Nach P60: Die
Fläche heißt durchgängig „Teams", sieht wie der Rest der PWA aus (P43-
Sprache), zeigt jeden Worker als eigene Karte live an, arbeitet
unabhängige Aufgaben nachweislich parallel ab, und Adapter sowie Modelle
sind vorab wählbar und serverseitig erzwingbar. K1 (Antwort-Latenz),
K2 (Frame-Lag), K5, K7 (Restore), K8, K10 (Offline-Stand).

## 2. Scope (In & Out)

**In:** Vollständige Umbenennung Run→Team über Contracts, Core, Hub-Routen,
Policy, Store/Journal, PWA (Ordner, Slug `#/teams`, Dock, Texte) inkl.
Redirects für alte Links; Journal-Migration der Bestände (K7); visuelle
Überarbeitung von Liste, Detail, Rückfragen (Gates) und Anlege-Formular im
P43-Design; Kartenübersicht pro Worker (Status, Adapter/Modell,
Session-Link, Ergebnis-Vorschau); breite DAGs als Planungsvorgabe +
sichtbare, erzwingbare Parallelität (maxParallel-Anhebung); Modell-Allowlist
im Rahmen + Formular-Auswahl (schließt die Lücke, dass `task.model` heute
ungeprüft durchgeht).

**Out:** Worker-spawn-Worker (Tiefe 1 bleibt, ADR-0064), Cross-Host-Dispatch,
automatische Merge-Freigaben, Cron/Trigger (P41 bleibt Eigentümer), neue
Engine-Semantik (Statusübergänge/Invarianten aus ADR-0064 unverändert),
Umbenennung der Loop-Factory-Begriffe (P19/P26), Dashboard-/Kachel-Ebene
der Session-Übersicht selbst.

## 3. Design-Details

### 3.1 Benennung und Abgrenzung (ADR-pflichtig, Contract-Änderung)

Begriffs-Abgrenzung im ADR: **Team = Orchestrierungseinheit über
Agenten-Sessions** (ehemals Run), nicht Menschengruppen/Multi-User — das
schützt den Begriff vor künftiger Doppelbesetzung. Namensmappe:

| Vorher | Nachher |
|---|---|
| `OrchestrationRun` / `OrchestrationRunStart` | `Team` / `TeamStart` |
| `OrchestrationFrame` / `OrchestrationPlan` / `OrchestrationTaskPlan` | `TeamFrame` / `TeamPlan` / `TeamTaskPlan` |
| `OrchestrationDispatch` / `OrchestrationGate` / `OrchestrationDelivery` | `TeamDispatch` / `TeamGate` / `TeamDelivery` |
| Contracts `orchestration/`, Core/Hub `modules/orchestration/`, PWA `features/orchestration/` | je `team/` |
| Routen `/api/orchestration/runs…` | `/api/teams…` |
| Policy `orchestration.manage` / `orchestration.read` | `team.manage` / `team.read` |
| Store-Dir `data/orchestration/`, Journal `runs.jsonl` | `teams.jsonl` (Migration, §3.2) |
| PWA-Slug `#/runs`, Query `?run=`, Dock „Runs", Titel „Orchestrierung" | `#/teams`, `?team=`, „Teams", „Agenten-Teams" |
| UI-Texte „Neuer Run", „Run stoppen", „wartet auf Antwort" | „Neues Team", „Team stoppen", Gate-Fläche heißt „Rückfrage" |

Vor der ersten Umbenennung steht die Inventur aller Verwender
(grep-Protokoll als ADR-Anhang): Contracts, Core-Engine/Coordinator/Store,
Hub-Routen/Policy/Automations-Kopplung, PWA (Dock, CommandBar `quick.ts`,
`AutomationDetail`-Deep-Link, `TabIcon`), `e2e/specs/orchestration.spec.ts`,
Doku/README. Hubctl hat keine Orchestrierungs-Befehle (geprüft 14.11.2026).
Alte Hashes `#/runs…` werden permanent auf `#/teams…` umgeleitet
(`?run=`→`?team=` mitgeführt) — auch der Link aus Automationen.

### 3.2 Persistenz-Migration (K7)

`OrchestrationStore.init()` liest Bestand aus `snapshot.json`+`runs.jsonl`.
Migration: einmaliges Einlesen der Altbestände und Weiterschreiben als
`teams.jsonl` (alte Datei bleibt bis zum ersten erfolgreichen
Snapshot-Umschrieb liegen); kaputte Zeilen werden weiterhin gezählt und
übersprungen, nie versteckt. Restore-Test mit echter Altdaten-Fixture
(rot-grün). Persistierte **Automationen**, die eine Run-Vorlage
(`OrchestrationRunStart`-Form) einbetten, werden tolerant gelesen (altes
Feld/alt neuer Name) und beim nächsten Speichern migriert — Bestand bricht
nie.

### 3.3 PWA: Kartenübersicht und visuelle Überarbeitung (K2/K10)

Team-Detail oben: **Kartenraster je Task** (mobil 1-spaltig, Desktop
mehrspaltig) nach dem Muster der Session-Kacheln (P18/P43): Titel,
Adapter+Modell, Status-Pill, aktueller Versuch (Generation), Fortschritt
(x/y erledigt), Session-Link ↗, Ergebnis-Vorschau bei done (wie heute
gekappt, Blob-Referenz sichtbar). Parallele Worker stehen nebeneinander —
Parallelität ist auf einen Blick sichtbar. Rückfragen (Gates) werden als
auffällige Rückfrage-Karten über dem Raster gezeigt (Antwortknöpfe +
„Team stoppen", K1). Liste, Detail, Formular und leere Zustände werden in
die P43-Design-Sprache überführt; das Anlege-Formular folgt dem Muster
„Neue Session" (schrittweise, Adapter- und Modellwahl integriert).
Aktualisierung ohne Flackern: diff-basiertes Rerender mit stabilen Keys;
ob Poll (3 s) oder bestehende WS-Events der Worker-Sessions die Karten
speisen, entscheidet die Concept-Phase (T60.5) — K2 bleibt Messlatte.
Offline: letzter Stand mit Zeitstempel (K10, unverändert).

### 3.4 Echte Parallelität (K8)

Heute kann die Engine bereits bis `maxParallel` parallel dispatchen
(`nextDispatches`), aber der Planungs-Prompt ermutigt keine unabhängigen
Aufgaben und das Formular defaultet auf 2 — es wirkt serialisiert. P60:

- Planungs-Prompt an den Koordinator macht **breite DAGs zur Vorgabe**:
  unabhängige Aufgaben ausdrücklich erwünscht, `dependsOn` nur bei echtem
  Informationsbedarf („so breit wie möglich, so tief wie nötig"), inkl.
  Beispiel mit zwei parallelen Tasks im JSON-Vorbild.
- `TeamFrame.maxParallel`: Zod-Deckel von 4 auf **8** anheben (ADR), Default
  bleibt 2, Formular erlaubt 1–8. K8 bleibt unberührt: die bestehenden
  Session-Grenzen bleiben die harte Obergrenze; der Rahmen wird weiterhin
  serverseitig bei jedem Dispatch geprüft (ADR-0064 §5).
- Nachweis: Integrationstest mit N unabhängigen Tasks und `maxParallel ≥ N`
  zeigt N **gleichzeitig aktive** Dispatch-Sessions (nicht nur nacheinander
  erzeugte) — Engine-Test ergänzt um Aktivitäts-Überlappung.

### 3.5 Adapter- und Modell-Vorauswahl (schließt Enforcement-Lücke)

`TeamFrame` bekommt statt `model: string|null` eine **Modell-Allowlist**
`models: string[]` (leer = nur Adapter-Standardmodell; Contract-Break, ADR).
`validatePlan` prüft fortan auch: `task.model ∈ frame.models ∪ {null}` —
heute geht jedes Task-Modell ungeprüft bis `SessionPort.create` durch
(Divergenz zur Adapter-Allowlist). Der Planungs-Prompt listet die
erlaubten Modelle; ein ungültiges Modell im Plan erzeugt **eine** klare
Rückfrage (Retry_plan), nicht pro Task ein Gate. Formular: je gewähltem
Adapter Modell-Chips/-Eingabe nach dem bestehenden Modellmuster (P15,
ADR-0054, `CustomModelDialog`) — damit ist vorab wählbar, welche
Sessions/Adapter und welche LLMs das Team nutzen darf. Koordinator-Session
nutzt das erste erlaubte Modell oder den Adapter-Standard.

## 4. Aufgaben (Checkliste T60.m)

- [x] **T60.1** ADR Run→Team: Namensmappe, Begriffsabgrenzung, Verwender-Inventur (grep-Protokoll), Routen-/Policy-/Journal-Migration, maxParallel-Deckel 8, `models`-Allowlist-Break. **Vor jedem Contract-Edit.** — Vorlage: ADR-0064-Ergänzung oder neues ADR
- [x] **T60.2** Contracts umbenennen (`Team*`-Typen, Namespace `team/`) + Core (engine/coordinator/store, Modulordner `team/`) + Journal-Migration `runs.jsonl`→`teams.jsonl` mit Altdaten-Fixture; Unit-/Restore-Tests rot-grün. **K5/K7**
- [x] **T60.3** Hub: Routen `/api/teams…`, Policy `team.manage|read`, Automations-Kopplung tolerant lesen + migrieren; Integrationstests (Start/Cancel/Gate/List, Agent-Deny). **K1/K4**
- [x] **T60.4** PWA-Umbenennung: Feature-Ordner `team/`, Slug `#/teams` + `?team=`, Redirect von `#/runs`/`?run=` (auch Automationen-Deep-Link), Dock „Teams", CommandBar, `TabIcon`, alle UI-Texte; Redirect-Spec. **K10**
- [x] **T60.5** Visuelle Überarbeitung Liste/Detail/Formular/Leerzustände im P43-Design; Rückfragen als Rückfrage-Karten mit Antwortknöpfen und Stopp (K1). E2E-Spec deckt den neuen Ablauf ab.
- [x] **T60.6** Kartenübersicht je Worker (Adapter/Modell/Status/Versuch/Fortschritt/Session-Link/Ergebnis-Vorschau), diff-basiertes Rerender, stabile Keys, Offline-Stand mit Zeitstempel. **K2/K10**
- [x] **T60.7** Echte Parallelität: Planungs-Prompt breite DAGs (inkl. Parallel-Beispiel), `maxParallel` 1–8, Integrationstest N unabhängiger Tasks → N gleichzeitig aktive Dispatches; Rahmen-Server-Enforcement bleibt. **K8**
- [x] **T60.8** Modell-Vorauswahl: `TeamFrame.models`-Allowlist + `validatePlan`-Modellprüfung (Lücke), Formular-Modellwahl je Adapter (ADR-0054-Muster), Negativtests 422 (ungültiges Modell, leerer Allowlist-Missbrauch), Planungs-Prompt listet erlaubte Modelle. **K4/K5**
- [x] **T60.9** E2E erneuern (`orchestration.spec.ts` → `team.spec.ts`: Anlegen, DAG, Gate, Cancel, Redirect) + Doku-Nachzüge (README-Statusmatrix, `check:arch`/`check:context`), Gate grün. **K1–K10-Bezug je Spec**

## 5. Acceptance Criteria (AC-P60-k)

- **AC-P60-1 ✅:** Die PWA spricht durchgängig von Teams (Dock, Titel, Texte, CommandBar); kein nutzersichtbares „Run" mehr. `#/runs`- und `?run=`-Links (auch aus Automationen) landen per Redirect auf `#/teams`/`?team=` (E2E-Spec).
  — *Beleg:* `e2e/specs/team.spec.ts` „Alte Run-Links landen per Redirect…"; `redirectLegacyRunHash` in `apps/pwa/src/app/route.ts`; Restprüfung grep nach nutzersichtbaren „Run"-Texten in PWA/hubctl leer (14.11.2026).
- **AC-P60-2 ✅:** Contracts, Core, Hub-Routen (`/api/teams…`) und Policy (`team.*`) heißen sauber Team, ADR liegt vor; Bestands-Journal wird migriert und ist zu 100 % rekonstruierbar (Restore-Test mit Altdaten-Fixture, K7), persistierte Automationen brechen nicht.
  — *Beleg:* [ADR-0077](../docs/adr/0077-run-nach-team-umbenennung.md) vor jedem Contract-Edit (MR !466); Migrations-Tests in `packages/core/test/modules/team/team.test.ts` („migriert Altbestand einmalig…", „kein Doppelimport", „kaputte Altzeilen", „frame.model normalisiert"); Automationen: `lifecycle.integration.test.ts` grün, tolerantes `kind:"run"`/`runId`-Lesen in `packages/contracts/src/automations/automation.ts`.
- **AC-P60-3 ✅:** Das Team-Detail zeigt jeden Worker als Karte (Adapter, Modell, Status, Versuch, Fortschritt, Session-Link, Ergebnis-Vorschau); parallele Worker stehen nebeneinander; Aktualisierung ohne Frame-Lag (K2), offline letzter Stand mit Zeitstempel (K10).
  — *Beleg:* `e2e/specs/team.spec.ts` (team-task-card ×2, team-progress, „Session ↗", Offline-Test mit datiertem `time`-Element, „Neues Team" disabled); K10-Cache `team-cache.ts` + Unit-Tests; K2-Konstruktionsbeleg: stabile Keys je Task-ID + diff-basiertes Rerender im 3-s-Poll — die Fläche trägt keinen 30-ev/s-Strom, ein separater Messlauf wurde bewusst nicht gefahren (Entscheidung s. Retro).
- **AC-P60-4 ✅:** Ein Team mit unabhängigen Aufgaben arbeitet nachweislich parallel: Integrationstest mit N unabhängigen Tasks und `maxParallel ≥ N` belegt N gleichzeitig aktive Dispatch-Sessions; der Planungs-Prompt macht breite DAGs zur Vorgabe; Obergrenzen werden serverseitig erzwungen (K8 unberührt).
  — *Beleg:* `team.test.ts` „T60.7: N unabhängige Tasks…" (3 aktive Dispatches gleichzeitig, T4 wartet, rückt nach) + „maxParallel 8 erlaubt, 9 abgewiesen"; Prompt in `coordinator.ts` („so breit wie möglich…", Parallel-Beispiel); Enforcement unverändert über `nextDispatches`.
- **AC-P60-5 ✅:** Vor dem Start sind Adapter und Modelle wählbar; ein Plan-Task mit nicht freigegebenem Modell wird serverseitig abgewiesen bzw. als eine klare Rückfrage sichtbar (422/Gate, Tests) — `task.model` geht nie mehr ungeprüft durch.
  — *Beleg:* 422-Integrationstest `model_not_allowed` in `team.integration.test.ts`; Modell-Gate-Test (eine Rückfrage mit `retry_plan`, nie Tasks) in `team.test.ts`; Formular-Feld „Erlaubte Modelle" in `TeamsPane.tsx`; Legacy-Toleranz `TeamFrame`-Preprocess.
- **AC-P60-6 ✅:** Liste, Detail, Formular und Rückfragen folgen der P43-Design-Sprache; der komplette Ablauf (anlegen → parallel laufen sehen → Rückfrage beantworten → fertig/stoppen) ist als E2E-Spec grün.
  — *Beleg:* `e2e/specs/team.spec.ts` „Kompletter Ablauf über die Fläche…" (Formular → Rückfrage-Karte → abbrechen) + Karten-/DAG-Test; P43-Bausteine StatusDot/card/Ruf-Kante/card-plan in `TeamsPane.tsx`/`34-teams.css`.

## 6. Premortem (Failure-Modi + Mitigation)

1. **Großflächige Umbenennung reißt versteckte Verwender** (Automationen, E2E, Doku, Icons) → T60.1 Inventur vor dem ersten Edit; ein Commit pro Verwenderschicht; Redirect statt Link-Bruch; `check:arch`/`check:context` im Gate.
2. **Journal-Migration verliert Bestands-Teams** (K7-Bruch) → Migration nur mit Altdaten-Fixture-Test; Altdatei bleibt bis zum ersten erfolgreichen Snapshot liegen; kaputte Zeilen zählbar, nie versteckt.
3. **Parallelität frisst Kontingent/überlastet den Host** → Deckel bleibt im Contract (8), Server erzwingt bei jedem Dispatch, Default konservativ (2), K8-Messlatte unangetastet.
4. **Kartenübersicht flackert/laggt bei häufigen Updates** (K2-Verstoß) → diff-basiertes Rerender, stabile Keys, Entscheidung Poll vs. WS in der Concept-Phase mit Messbeleg.
5. **„Team"-Begriff wird später doch anders besetzt** (z. B. Menschengruppen/Multi-User) → ADR grenzt den Begriff explizit ab (Orchestrierungseinheit über Agenten-Sessions).
6. **Modell-Allowlist macht die Planung spröde** (Hermes wählt ungültige Modelle → Gate-Spam) → Prompt listet erlaubte Modelle; Verstoß erzeugt genau eine Rückfrage mit Retry_plan, nicht pro Task eins.

## 7. Definition of Done

Alle T60.* und AC-P60-* mit aktueller Evidenz; `npm run gate` grün und
Pipeline-Job `e2e` grün (bzw. Infrastrukturfall nach `docs/ci-runbook.md`
nachgezogen, nie als Pass gezählt). Jede neue UI-Funktion/jeder Ablauf hat
einen Spec in `e2e/specs/` (orchestration.spec.ts wird zu team.spec.ts,
inkl. Redirect-Spec). ADR vor jeder Contract-Änderung; K5-Payloads und
K7-Recovery nachgewiesen; neue Flächen sind registriert und erreichbar
(Dock, CommandBar, Automationen-Deep-Link); Commit-Notation und Hooks
grün. Visuelle Gerät-Abnahme durch Jan wird im Endabnahme-Block
mitgenommen. Keine offene TODO ohne Epic-Bezug.

## Retro (14.11.2026)

**Zeitraum:** 14.11.2026 (eine Session) · **Commits/MRs:** ADR + Planung
(!465/!466), Umbenennung T60.2–T60.4 (!467, 5 Schicht-Commits),
T60.5–T60.8 (!468, 7 Commits), Abschluss (dieser MR). **Nummernkorrektur:**
P58 doppelt vergeben (parallele Planung auf veraltetem main) → P60.

### AK-Matrix

6 🟢 / 0 🟡 / 0 🔴 / 0 ⚪ — Belege je AC oben an der AC-Zeile.

### Concept-Entscheidung Poll vs. WS (T60.5/T60.6)

**Poll (3 s) bleibt.** Team-Zustandsübergänge leben im Team-Store, nicht im
EventStore; die Worker-Session-WS liefert Kirsch-Ereignisse der Sessions,
keine Team-Projektion. Karten sind reine Projektion des einen Team-Objekts
mit stabilen Keys — ein WS wäre eine zweite Wahrheit für dieselbe Fläche.
K2: kein separater Messlauf — die Fläche trägt keinen 30-ev/s-Strom
(Poll-Takt 3 s); Konstruktionsbeleg stabile Keys + In-place-Diff.

### Premortem-Bilanz

Eingetreten (1 von 6, abgefangen): **Nr. 1** — versteckte Verwender:
zwei Restvorkommen fanden sich erst im E2E-Retrofit
(`automations-lifecycle.spec.ts` nutzte noch `/api/orchestration/runs` und
„Run-Vorlage"-Labels; Commit b4a7948) sowie als echter Bug im neuen
Formular (Projekt-**Name** statt **Pfad** im select — E2E fand es, Fix in
!468). Die vorgesehene Inventur (ADR-Anhang) hatte beide Stellen gelistet,
die E2E-Spec selbst aber nicht als Verwender endgültig abgearbeitet.
Nicht eingetreten: 2 (Fixture-Tests grün, Altdateien bleiben liegen),
3 (Deckel 8/Default 2, Enforcement unverändert), 4 (kein Flackern —
stabile Keys; kein Messlauf nötig, s. o.), 5 (ADR-Abgrenzung), 6 (eine
Rückfrage mit retry_plan, Test belegt).

### Erkenntnisse (max. 5, mit Beleg)

1. **Epic-Nummern sind nicht reserviert:** Zwei Sessions planten am
   14.11. parallel „P58" auf unterschiedlichem main-Stand (e414815 vs.
   Merge b0065d7) — Planungs-Commits laufen ohne fetch/Sperre gegen
   veraltete Remotes. Beleg: Nummernkorrektur-Notiz oben; dieser Fall.
2. **Worktree ohne eigenes node_modules typt gegen das Haupt-Repo:** der
   erste typecheck lief gegen stale contracts (main-Stand 13.11.) und
   meldete fremde Fehler — `npm install` im Worktree löst es. Beleg:
   typecheck-Rot am 14.11. 16:30 ohne eigene Code-Änderung.
3. **Die CI-Umgebung ist seit dem 11.11. durchgehend rot** (4 vorab rote
   Tests: tmux-successor, setup BUG-0132, k8-automations,
   steer-wait-occupant; letzte grüne Pipeline 3054739446 vom 11.11.) —
   alle MRs seitdem mergen mit dokumentiertem Infra-Fall; lokal sind
   dieselben Suites grün (npm test 2131 passed, E2E 656 passed am 14.11.).
   Beleg: main-Pipelines 3068442926…3068661495.
4. **E2E bleibt der ehrlichste Reviewer:** Formular-Projekt-Bug und
   Offline-Reload-Grenze (serviceWorkers in der Suite blockiert —
   Offline-Stand daher ohne Reload geprüft, Cache separat unit-getestet)
   waren in Unit/Integration unsichtbar. Beleg: team.spec.ts Commits.
5. **Schicht-Commits machten die ~100-Dateien-Umbenennung reviewbar:**
   Contracts → Core → Hub → PWA in vier MR-Commits, kein Merge-Konflikt,
   Gate nach jeder Schicht. Beleg: MR !467.

### Action Items

- **AI-P60-1:** CI-Runner-Umgebung reparieren (die 4 vorab roten Tests;
  blockiert jedes Pipeline-DoD repo-weit) — zurück als: Bug-Report
  bugs/bug-0161… fortlaufend / eigener Auftrag.
- **AI-P60-2:** Worktree-npm-install-Falle für Agenten dokumentieren —
  zurück als: Zeile in CONTRIBUTING (Git-Hygiene/Worktrees).
- **AI-P60-3:** Live-Nachweis Modell-Allowlist mit echtem
  Koordinator-Harness (ungültiges Modell → genau eine retry_plan-Rückfrage
  am Gerät) — zurück als: Endabnahme-Block (EPIC-P35 §8) zusammen mit der
  visuellen Gerät-Abnahme dieser Fläche.

**Status:** EPIC-P60 abgeschlossen 14.11.2026 (6/6 AC grün; visuelle
Gerät-Abnahme und Live-Koordinator-Lauf wie im DoD vorgesehen im
Endabnahme-Block offengehalten).
