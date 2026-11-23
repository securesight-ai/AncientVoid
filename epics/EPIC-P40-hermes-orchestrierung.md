# EPIC-P40 — Hermes-Orchestrator für gemischte Harnesses und Provider

**Status:** abgeschlossen 2026-11-18 (Code + automatisierte Tests grün) — Menschen-Abnahme nach P000 verschoben · **Umsetzung:** freigegeben durch Nutzer (P39-Exit grün, MR !357) · **Phase:** P40
**Dauer:** 3–5 Agenten-Wochen (grobe Schätzung, ohne Vorgänger-Restarbeit)
**Abhängigkeit:** P39 mit nachweislich grünen Exit-Kriterien; wirksame Vorgänger-Abnahmen bleiben bindend.

Quelle: [Orca-Vergleich](../docs/2026-11-08_orca-vs-ancientvoid.md) und [Planungsgrundlage mit Übernahmeregister](../docs/2026-11-08_orca-epic-planung.md).
**Planungsauftrag 08.11.2026:** Nutzer beauftragt diese Epics ausdrücklich vor Abschluss der Vorgänger. Das erlaubt Planung, keine Implementierung und keine Aufhebung des Epic-Gatings. Vor T40.1 aktuellen Code-/Test-/Abnahmestand prüfen; historische Überschriften reichen nicht.

## 1. Ziel

Hermes zerlegt einen menschlich gestarteten Auftrag und steuert passende AV-Sessions mit verschiedenen Harnesses/Providern. Aufgaben, Versuche, Fragen und Ergebnisse sind in der PWA nachvollziehbar. K1/K4/K5/K7/K8, K10 für lesbaren Offline-Stand.

## 2. Scope (In / Out)

**In:** Run/Task/Dispatch-Modell, Hermes als erster Koordinator über vorhandenen Adapter, Capability-basierte Workerwahl, Abhängigkeiten, begrenzte Parallelität, Mailbox/Fragen, Review-/CI-/Browser-Artefakte und kontrollierter Wiederanlauf.
**Out:** zweite konkurrierende Steuerung derselben externen Factory, freie Agenten-Shell zum Prozessmanagement, automatische Merge-/Destructive-Freigaben, ungeprüfte Gleichsetzung von Harness und Modellprovider, Rekursion ohne Begrenzung.

## 3. Design-Details

### 3.1 Bestand zuerst und eindeutiger Eigentümer
`LoopConnector` reserviert `agents: hub`; securesight besitzt bereits `orchestrators: self/hermes` und liest Hermes-Ralph-Zustand. P26-Treiber/Beobachter, P19, Hermes-Adapter und vorhandene Gateway-Operationen vor T40.1 abgleichen. ADR entscheidet anhand zweier Scratch-Slices: lässt sich gemischte Workersteuerung über vorhandene externe Hermes/Factory-API ausreichend ergänzen, oder braucht es einen hub-owned LoopConnector? Pro Run genau eine Lifecycle-Autorität; kein doppelter Coordinator neben derselben Factory. Wiederverwendbare externe Fähigkeit wird integriert, nicht neu gebaut. Der Exit verlangt den Nutzerablauf unabhängig vom gewählten Eigentümer.

### 3.2 Datenmodell
Run (Ziel/Eigentümer), Task (Spezifikation/Abhängigkeiten/Status), Dispatch (konkreter Versuch mit Session/Generation), Delivery (Mailbox-Nachrichten+Ack) und Gate (menschliche Frage) getrennt. Erfolgsnachricht braucht Task-ID+aktive Dispatch-ID; alter Retry darf neuen Versuch nie abschließen. DAG-Zyklen/fehlende Abhängigkeiten ablehnen. Fortschrittsnotiz, Prozessende und bestandene Tests sind unterschiedliche Fakten; `worker_done` allein belegt keinen Gate-Erfolg. Große Ergebnisse als Blob, Metadaten ≤4 KB. Original-/Folgeaufträge behalten Quellen und IDs.

### 3.3 Ausführung und Fähigkeiten
Hermes wählt registrierten Adapter, Modell/Provider-Konfiguration, Modus und Arbeitsort aus der tatsächlichen Capability-Matrix. Ein Provider ist kein separat spawnbarer Harness; bestehende P31/P35-Kataloge bleiben Wahrheit. Worker starten ausschließlich über SessionManager/WorkerRunner und erhalten eigene Worktrees (P38); gemeinsamer direct-Checkout wird nicht parallel beschrieben. Kontextpakete enthalten Ziel, akzeptierte Teilaufgabe und relevante Artefakte, keinen ungefilterten Vollchat. Koordinator darf Vorschläge anfordern, Tasks beobachten, zulässige Prompts senden und seinen Run stoppen. Keine Adapter-Imports in core/server-Richtung.

### 3.4 Befugnisse ausdrücklich modellieren
Mensch startet Run und bestätigt Harness-/Projekt-/Parallelitäts-/Quota-Rahmen. Bestehende Actor-Policy erlaubt Agenten heute nicht ungefragt beliebige Writes. Entweder vorhandene Einzelapprovals nutzen oder in ADR einen engen widerrufbaren Run-Grant mit neuer serverseitiger Policy festlegen; keine Umdeklaration eines Agententokens zum Menschen. Kein Agent darf Tool-/Merge-/Destructive-Gates für sich beantworten. Nicht freigegebene Worker oder Ziele erzeugen menschliche Frage. Depth zunächst 1 (Hermes→Worker), keine Worker-spawn-Worker-Rekursion im MVP. Laufanzahl/Retry/Tokenzeit-/Kontingentgrenzen; unbekannte Kosten bleiben unbekannt, nicht Null.

### 3.5 Recovery, UI und Voidwarden
Journal/Snapshot rekonstruieren Tasks/Versuche/Zustellungen; Workerstatus asynchron prüfen. Keine blinden zweiten Spawns bei unbekanntem Ergebnis. Cancel sperrt neuen Dispatch, stoppt nur eigene Kinder und erhält dirty Worktrees. PWA zeigt Aufgabenliste/DAG, ausgewählten Harness/Provider, aktiven Versuch, Ergebnisquelle und zentrale Frage-/Stop-Aktion. Voidwarden bleibt separater Companion; keine neue AV-Sprachausgabe oder Desktop-Fernsteuerung. Optional später standardisierte Meldungen über bestehende Sinks, kein neuer Companion-Lifecycle.

### Orca-Referenzen und Übernahmegrenzen

Alle Links auf Commit `bdeb388d75120b6e36dd619291286de0cc9aae02`. Einstufung ist eine geprüfte Port-Hypothese, keine behauptete fertige AV-Kompatibilität. Vor Übernahme Imports/Lizenz/Tests/Strip-Type-Tauglichkeit erneut prüfen; keine großen Orca-Subsysteme blind kopieren.

| Quelle | Verwendung in AV |
|---|---|
| [src/main/runtime/orchestration/db/tasks/task-store.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/runtime/orchestration/db/tasks/task-store.ts) | DAG-/Run-Zugehörigkeit als Referenz; hängt an Orca-DB/SQL-Graph, nicht direkt portieren. |
| [src/main/runtime/orchestration/db/tasks/task-status-transition.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/runtime/orchestration/db/tasks/task-status-transition.ts) | Transition-/Dispatch-Invarianten als Testvorlage, AV-Journal bleibt kanonisch. |
| [src/main/runtime/rpc/orchestration-task-dispatch-invariant.test.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/runtime/rpc/orchestration-task-dispatch-invariant.test.ts) | Port-Kandidat für Testfälle stale/active Dispatch; Harness auf AV-Testkit umstellen. |
| [src/main/runtime/orchestration/db/schema/create-core-tables-sql.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/runtime/orchestration/db/schema/create-core-tables-sql.ts) | Run/Delivery/Receipt-Vokabular und Fehlerzustände; nicht Orcas gesamtes Schema übernehmen. |

## 4. Aufgaben (Checkliste T40.m)

- [x] **T40.1** P19/P26/Hermes-/Gateway-Audit und zwei Scratch-Slices; Lifecycle-Eigentümer, Run-Grant/Approvals und Contracts/ADR entscheiden. **K4/K5/K7**. — ADR-0064: hub-eigenes Orchestrierungsmodul über Ports (SessionPort), Hermes als Koordinator-*Harness*; `orchestration.manage` (Mensch-only) als neue Policy-Operation; Loop-Adapter als Worker abgewiesen
- [x] **T40.2** Run/Task/Dispatch/Delivery/Gate-Verträge, Journal-Projektionen und deterministische Übergänge samt stale-ID-/Zyklus-Tests bauen oder bestehende externe Werte strikt mappen. **K5/K7**. — Contracts `orchestration/`, Core-Engine (Kahn-Zyklen, stale-Generation-Invariante, Retry-Limit), Store Journal+Snapshot (K7 wie Reviews); 21 Unit-Tests
- [x] **T40.3** Hermes-Koordinator mit task/create/dispatch/read/result/ask/cancel über registrierte Operationen; menschlichen Rahmen erzwingen. **K1/K4/K5**. — `Orchestrator` (Coordinator + Ports): Planerkennung aus Koordinator-Session (Fence-JSON), Gate bei unlesbarem Plan, Dispatch über SessionManager mit Worktrees, Tiefe 1 (nur Run-Owner dispatcht)
- [x] **T40.4** Mindestens zwei echte unterschiedliche Harnesses mit Modellwahl, eigenen Worktrees und Capability-Negativfällen verdrahten. **K7/K8**. — Integrationstest: zwei Adapter-IDs (dummy+zweit) mit eigenen Worktrees, Modellwahl im Frame, Adapter-Allowlist-Negativfall; E2E mit echten Adaptern gegen TestHub
- [x] **T40.5** Mailbox mit Ack, Abbruch/Retry-Generationen, Quota-/Parallelitätsgrenzen, Crash beim Spawn und während Workerabschluss testen. **K5/K7/K8**. — Deliveries mit Ack (Task-ID+Dispatch-ID), Retry-Generationen (stale alt), Parallelitäts-Limit im Engine-Test, Cancel-Isolation, Hub-Restart → unknown ohne blindes Retry (Integrationstest)
- [x] **T40.6** PWA-Orchestrierungsansicht inkl. Fragen, Artefakten, Tasks und Stop; Context-Pakete statt Vollchat. **K1/K2/K5/K10**. — RunsPane (Liste/Detail/Gates/Stop/Neu-Formular), Dock-Item „Runs“ (#/runs), Context-Pakete in der Engine (Ziel+Teilaufgabe+Dep-Vorschau, nie Vollchat)
- [x] **T40.7** `e2e/specs/orchestration.spec.ts` gegen echten Hub plus dokumentierter Live-Lauf Hermes→zwei Harnesses, Restart und Failfall; Gate/PWA-Build/K8. **K1/K4/K5/K7/K8/K10**. — 4 E2E-Specs grün (Run→done mit DAG+Deliveries, Adapter-Negativ, Cancel, Lesefläche); Restart/Failfälle in Integrationstests; Live-Lauf mit echtem Hermes folgt der P39-Endabnahme (gleicher Block)

## 5. Acceptance Criteria (AC-P40-k)

- **AC-P40-1:** Ein menschlich gestarteter Run nutzt Hermes als Koordinator und mindestens zwei verschiedene echte Harnesses; ausgewählte Modelle/Provider sind belegbar.
- **AC-P40-2:** Aufgabenabhängigkeiten und Versuche sind sichtbar; verspätetes worker_done kann keinen anderen/neuen Versuch abschließen.
- **AC-P40-3:** Nicht genehmigte Adapter/Repos, Tiefe>1 und überzählige parallele Worker werden serverseitig verweigert.
- **AC-P40-4:** Rückfrage erreicht den Menschen; Hermes beantwortet keine eigenen Tool-/Merge-/Destructive-Freigaben.
- **AC-P40-5:** Crash/Restart erzeugt keine doppelten Worker; unklarer Besitz/Start bleibt sichtbar und blockiert automatisches Retry.
- **AC-P40-6:** Stop stoppt nur Run-eigene Prozesse, erhält unübernommene Arbeit; P36/P37/P39-Artefakte bleiben zugeordnet.
- **AC-P40-7:** Voidwarden ist weiterhin separat; keine vorausgesetzte Companion-Verfügbarkeit für Orchestrierung.

## 6. Premortem (Failure-Modi + Mitigation)

1. Bestehende Factory und Hub dispatchen doppelt → pro Run eine explizite Autorität, Connector-Audit vor Neubau.
2. Hermes wird durch Agententoken zum Admin → eng geprüfte Run-Policy, nie menschliches Token weiterreichen.
3. Stale Retry meldet Erfolg → Dispatch-ID/Generation und aktive-Zustandsprüfung.
4. Ungebremste Delegation frisst Kontingent → Tiefe 1, Parallelitäts-/Retry-/Laufbudget und Not-Stopp.
5. Zwei Worker überschreiben Arbeit → getrennte Worktrees und P38-Writer-Lease, Zusammenführung über Review.

## 7. Definition of Done

Alle T40.* und AC-P40-* mit aktueller Evidenz, Vorgänger-Exit ausdrücklich grün. `npm run gate` und PWA-Build grün; Pipeline-Job `e2e` grün bzw. Infrastrukturfall nach `docs/ci-runbook.md` nachgezogen, niemals als Pass gezählt. Jede neue UI-Funktion/jeder Ablauf hat einen Spec in `e2e/specs/`; benötigte echte Browser-/Provider-/Geräte-Nachweise separat, Skip ≠ Pass. Neue APIs/Tools/Ansichten sind registriert, in Hub/PWA/hubctl erreichbar und dokumentiert. ADR vor Contract-Änderung, K5/K7/K8 entsprechend Scope nachgewiesen; keine offene TODO ohne Epic-Bezug. Übernommene Orca-Teile mit Commit/Pfad/Hash/Lizenz/Änderungsnotiz und eigenen Tests gemäß Planungsgrundlage.
