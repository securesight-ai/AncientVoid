# EPIC-P41 — Automationen mit Zeitplan, Precheck und Laufhistorie

**Status:** Code steht, Exit offen (Abschluss-Gate T41.6, §8) · **Umsetzung:** laufend · **Phase:** P41
**Dauer:** 2–3 Agenten-Wochen (grobe Schätzung, ohne Vorgänger-Restarbeit)
**Abhängigkeit:** P40 mit nachweislich grünen Exit-Kriterien; wirksame Vorgänger-Abnahmen bleiben bindend.

Quelle: [Orca-Vergleich](../docs/2026-11-08_orca-vs-ancientvoid.md) und [Planungsgrundlage mit Übernahmeregister](../docs/2026-11-08_orca-epic-planung.md).
**Planungsauftrag 08.11.2026:** Nutzer beauftragt diese Epics ausdrücklich vor Abschluss der Vorgänger. Das erlaubt Planung, keine Implementierung und keine Aufhebung des Epic-Gatings. Vor T41.1 aktuellen Code-/Test-/Abnahmestand prüfen; historische Überschriften reichen nicht.

## 1. Ziel

Wiederkehrende Aufträge in AV planen, gezielt starten und ihre tatsächlichen Ergebnisse verfolgen. Zeitpläne starten bestehende Sessions oder P40-Runs, ohne zweite Ausführungsengine. K1/K5/K7/K8/K10.

## 2. Scope (In / Out)

**In:** Stunden-/Tages-/Wochen-/Werktags-Presets und begrenztes 5-Feld-Cron, IANA-Zeitzone, Vorschau nächster Termine, enable/disable/run-now, registrierter Precheck, Historie, Offline-/Missed-/Restart-Regeln.
**Out:** beliebige Shell-Eingabe vom Handy, ungefragtes Nachholen aller verpassten Läufe, extern bereits geschedulte Factory erneut planen, vollständiger RRULE-Standard, implizite Modell-/Permission-Ersetzung.

## 3. Design-Details

### 3.1 Ausführung wiederverwenden
Bestand P40/LoopConnector/registrierte Aktionen/Workspace-Runtime prüfen. Neues `automations`-Modul besitzt Termine und Startaufträge, Session-/Run-Manager besitzt Ausführung. Ein Schedule hat feste Host-ID/Eigentümergeneration, Projekt, Arbeitsort (Worktree Standard), Harness/Modell oder vorhandene Run-Vorlage, Prompt-Blob und genehmigten Ausführungsrahmen. Vorhandene externe Zeitpläne nur lesen/verlinken oder explizit übernehmen, nicht doppelt ausführen. Direct-Checkout unterliegt P38-Lease; bei Konflikt sichtbarer Skip, kein heimlicher Wechsel.

### 3.2 Kalender und Zustände
UTC-Zeitstempel speichern; IANA-Zeitzone und Calendar-Ausdruck gesondert. Präzise DST-Regel: ungültige Lokalzeit überspringen, doppelte Lokalzeit einmal; Vorschau zeigt UTC/Ortszeit. Tests mit kontrollierter Uhr, Europe/Berlin und anderer Zone. Expliziter Dedupe-Key aus Schedule-ID+Generation+Occurrence, atomare Claim-Operation mit Recovery-Journal; `dispatched` heißt nicht `succeeded`. Unklarer Start bleibt unklar, kein blindes Replay. Scheduler liegt auf Ausführungshost, Fleet aggregiert nur; Failover nicht im MVP.

### 3.3 Bedienung und Befugnisse
Neu zunächst deaktiviert, Mensch sieht Ziel/Plan/Precheck/Arbeitsort/Permissions und aktiviert. `run-now` erhält eigene Operation, führt den Precheck standardmäßig ebenfalls aus; eine spätere Bypass-Aktion wäre gesondert zu bestätigen. Precheck nur registrierte argv-Aktion mit Frist, kein aus Orca übernommener Shellstring. Nicht null Exit, Timeout, fehlende Anmeldung, Quota und Host-Ausfall sind getrennte Gründe. Offline erzeugt kein neues Aktivieren/Starten. Fällige Läufe im zulässigen Grace-Fenster höchstens einmal nachholen, außerhalb `skipped_missed`. Überlappung standardmäßig skip statt endloser Queue.

### 3.4 Historie und Recovery
Journal/Snapshot für Definition, Generation, Claims, Run-IDs und Resultate; große Ausgaben Blobs. Neue Definition oder andere Befugnisse invalidiert alte Freigabe. Stop/Disable verhindert neue Dispatches, beendet laufende Jobs nur mit separater Aktion. Retention löscht nicht belegrelevante Artefakte aktiver Runs. K7-Replay unabhängig von langsamen Prechecks/Host-Probes. PWA Automationen-Tabelle mit nächster Ausführung, Host, Status, Fehler und gezieltem Retry.

### Orca-Referenzen und Übernahmegrenzen

Alle Links auf Commit `bdeb388d75120b6e36dd619291286de0cc9aae02`. Einstufung ist eine geprüfte Port-Hypothese, keine behauptete fertige AV-Kompatibilität. Vor Übernahme Imports/Lizenz/Tests/Strip-Type-Tauglichkeit erneut prüfen; keine großen Orca-Subsysteme blind kopieren.

| Quelle | Verwendung in AV |
|---|---|
| [src/shared/automation-schedule-parsing.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/automation-schedule-parsing.ts) | Port-Kandidat für begrenztes Parsing, Abhängigkeiten (cron-field/occurrence/clipboard) mitprüfen; kein pauschaler RRULE-Claim. |
| [src/shared/automation-schedule-dst.test.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/automation-schedule-dst.test.ts) | Testfall-Referenz; eigene dokumentierte DST-Semantik bleibt verbindlich. |
| [src/shared/automation-schedule-occurrences.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/automation-schedule-occurrences.ts) | Zeitzonen-/Next-run-Referenz samt Imports und Testuhr prüfen. |
| [src/main/automations/service.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/automations/service.ts) | Owner-/Lifecycle-/Missed-Referenz; nicht Orca Store/Runtime übernehmen. |

## 4. Aufgaben (Checkliste T41.m)

- [x] **T41.1** Bestands-/Owner-Abgleich, ADR/Contracts für Zeitplan, Claim, Runstatus und genehmigten Rahmen; keine Doppelautorität. **K5/K7**.
- [x] **T41.2** Begrenzten Schedule-Parser/Occurrence-Berechnung auswählen; Orca-Port gegen Library/kleinen Eigenbau abwägen, DST-/Oversize-/unmögliche Termine prüfen. **K5/K7**.
- [ ] **T41.3** Host-Scheduler, atomare Claim-/Dedupe-/Overlap-/Missed-Regeln und Recovery mit Fake Clock und Crash-Proben implementieren. **K7/K8**. *(Implementiert, Fake-Clock- und simulierte Crash-Proben grün; offen: echter Prozess-Crash zwischen Claim und Dispatch, K8 mit großer Schedule-Menge — §8.)*
- [ ] **T41.4** Registrierte Prechecks und Session-/Run-Dispatch mit Auth-/Quota-/Lease-Fehlern, deaktivierten Plänen und menschlicher Freigabe bauen. **K1/K5/K7**. *(Implementiert und gegen dummy-Harness belegt; Fehlerklassifikation aus Fehlertext nicht live gegen Provider/P38-Lease belegt — §8.)*
- [x] **T41.5** PWA/CLI Liste/Editor/Vorschau/Run-now/Disable/Verlauf; Orchestrierungsruns verlinken. **K1/K2/K10**. (Editor/Update in PWA und `hubctl automations update`; Run-Links per E2E belegt.)
- [ ] **T41.6** `e2e/specs/automations.spec.ts`, echter kurzer isolierter Zeitplan-Lauf plus Restart und Negativprobe; Gate/PWA-Build/K8. **K1/K5/K7/K8/K10**.

## 5. Acceptance Criteria (AC-P41-k)

- **AC-P41-1:** Ein aktivierter Schedule startet den gewählten Harness/Run auf dem gewählten Host/Arbeitsort und zeigt das Ergebnis.
- **AC-P41-2:** DST doppelt/fehlend, Missed-Grace und Zeitzonenwechsel stimmen mit dokumentierter Vorschau überein.
- **AC-P41-3:** Crash um Claim/Dispatch erzeugt keinen zweiten blind gestarteten Lauf; Unsicherheit ist sichtbar.
- **AC-P41-4:** Nicht erfüllter Precheck, Quota, Direct-Lease oder Auth führt zum zutreffenden Skip-/Fehlergrund.
- **AC-P41-5:** Disable stoppt zukünftige Termine, verändert laufende Arbeit nicht unbemerkt; run-now hat nachvollziehbare ID.
- **AC-P41-6:** Nach Reload/Restart sind Definition, letzte/nächste Ausführung und Artefakte erhalten; offline nur datierte Projektion.

## 6. Premortem (Failure-Modi + Mitigation)

1. Cron feuert nach Neustart doppelt → persistenter Occurrence-Claim plus generationengebundene Startoperation.
2. DST führt zu Überraschung → festgeschriebene Einmal-/Skip-Regel und Vorschau mit Uhrtests.
3. Scheduler erfindet Erfolg nach Spawn → Completion aus Session-/Run-Ergebnis, dispatched getrennt.
4. Precheck wird freie Shell → registrierte argv-Aktion und unveränderte Actor-/Approval-Prüfung.

## 7. Definition of Done

Alle T41.* und AC-P41-* mit aktueller Evidenz, Vorgänger-Exit ausdrücklich grün. `npm run gate` und PWA-Build grün; Pipeline-Job `e2e` grün bzw. Infrastrukturfall nach `docs/ci-runbook.md` nachgezogen, niemals als Pass gezählt. Jede neue UI-Funktion/jeder Ablauf hat einen Spec in `e2e/specs/`; benötigte echte Browser-/Provider-/Geräte-Nachweise separat, Skip ≠ Pass. Neue APIs/Tools/Ansichten sind registriert, in Hub/PWA/hubctl erreichbar und dokumentiert. ADR vor Contract-Änderung, K5/K7/K8 entsprechend Scope nachgewiesen; keine offene TODO ohne Epic-Bezug. Übernommene Orca-Teile mit Commit/Pfad/Hash/Lizenz/Änderungsnotiz und eigenen Tests gemäß Planungsgrundlage.

## 8. Stand und Exit-Lücken (Abgleich 11.11.2026)

Die [Übergabeprüfung vom 10.11.2026](../docs/2026-11-10_p41-uebergabepruefung.md)
beschreibt den Stand `8f25ef7`. Die danach gemergten Commits (ADR-0065:
`2d8c71e`, `df108c7`, `1fb9a40`, `b6266ae`) haben die dort kritischen Lücken
bereits im Code geschlossen; Branch `feat/p41-exit-luecken` gleicht Epic und
Nachweise gegen `main` (`efaa952`) ab und ergänzt, was noch ohne Beleg war.
**P42 bleibt gesperrt**, bis die offenen Punkte unten entschieden sind.

| AC / Aufgabe | Stand | Nachweis |
|---|---|---|
| AC-P41-1 Run-Ziel, Ergebnisrückführung | **Code + Test grün** (dummy-Harness). Run-Ziele dispatchen über den geteilten Orchestrator mit eingefrorener Vorlage; `inspect`/`reconcile` rechnet Session-/Run-Ergebnisse ab und gibt `maxParallel` wieder frei. | `core/automations/lifecycle.test.ts` (settle → Folgetermin), `hub/automations/lifecycle.integration.test.ts` (echte `turn_end`-Belege, Run-Dispatch genau einmal), E2E `automations-lifecycle.spec.ts` |
| AC-P41-2 DST/Grace/Zeitzone | **Unit grün.** Neu: gefeuerte Termine == Vorschau über Frühjahrs-/Herbstwechsel in Europe/Berlin und America/New_York (Minutentakt-Uhr); Zeitzonenwechsel = neue Generation, deaktiviert. | `core/automations/exit-criteria.test.ts`, `schedule.test.ts`, `scheduler.test.ts` (Grace) |
| AC-P41-3 Crash/unsicherer Start | **Unit + echter Crash grün.** Dienst-Neustart nach persistiertem Claim ohne Dispatch → `unknown`, kein Replay (auch bei weiterem Neustart); CLI zeigt die `unknown`-Begründung. Neu (12.11.): E2E-Drill mit `SIGKILL` des Hub-Prozesses, während eine langsame Vorprüfung läuft — danach `unknown`, keine Session, kein neuer Precheck, ein weiterer Start wird `overlap`. | `exit-criteria.test.ts`, `lifecycle.test.ts`, `hubctl/test/automations.test.ts`, E2E `automations-crash.spec.ts` |
| AC-P41-4 getrennte Gründe | **Unit grün** für alle sieben Precheck-Urteile und fünf Dispatch-Gründe sowie `unknown` bei unsicherem Start; jeder Contract-Grund ist in der PWA beschriftet. Lease und Auth am echten Hub belegt (12.11.: fremder P38-Lease → `lease`, Projekt außerhalb der Wurzeln → `auth`, jeweils ohne Start); Quota kommt weiterhin per Textmuster aus Launcher-Fehlern (`mapLaunchFailure`), ohne Live-Beleg. | `exit-criteria.test.ts`, `hub/automations/automations.test.ts`, `pwa/test/features/automation-labels.test.ts`, E2E `automations-provider.spec.ts` |
| AC-P41-5 Disable/Änderung während Precheck | **Code + Test grün.** Host, Generation und Definitionsrevision werden nach dem Precheck erneut geprüft (Disable, Generationswechsel, Disable→Enable). Laufende Arbeit bleibt unangetastet. | `lifecycle.test.ts` (drei Varianten) |
| AC-P41-6 Recovery/offline/History | **Code + E2E grün.** Datierte Offline-Projektion (Liste und — neu — Verlauf), Mutationen gesperrt; Verlaufsfehler erscheinen als Fehler, ein früher abgerufener Verlauf wird bei Abruffehler datiert als veraltet markiert, nie als leerer/frischer Verlauf. | `automations-lifecycle.spec.ts` (Flugmodus, Verlaufsfehler, veralteter Verlauf; neue Fälle rot vor dem Fix) |
| T41.5 Editor | **geschlossen.** PWA „Bearbeiten“ ruft `setEditing`, Speichern erzeugt neue Generation (deaktiviert); `hubctl automations update` vorhanden. | E2E `automations-lifecycle.spec.ts`, `hubctl/test/automations*.test.ts` |
| Contract Claim/History | **geschlossen.** `AutomationHistoryEntry` (ADR-0065) ist der einzige Vertrag; Core (`ClaimState`), PWA und hubctl importieren ihn, keine Parallel-Typen. | `contracts/src/automations/automation.ts` |

**Gate-Evidenz (Arbeitsbaum dieses Branches, lokal, 11.11.2026):** `npm run gate` Exit 0 — Typecheck, Lint, Workspace-Links, Commit-Notation, `check:arch`, Namens-/Adapter-Matrix, 1847 Unit-/Integrationstests (4 Skips) und **537 E2E-Pässe / 3 Skips** (Android-AVD P42 ohne `ANCIENTVOID_E2E_ANDROID=1`, zwei bekannte mobile Handoff-Duplikate; Skips zählen nicht als Pass). Pipeline-Job `e2e` und PWA-Build-Artefakt separat nicht geprüft.

**Bewusst offen (kein Exit ohne Entscheidung/Nachweis):**

1. ~~`unknown` ohne Referenz blockiert dauerhaft.~~ — entschieden in [ADR-0072](../docs/adr/0072-automationen-unklaren-start-aufgeben.md) (12.11.2026): `POST /api/automations/:id/resolve` (Policy `automations.manage`, Agenten `deny`), `hubctl automations resolve`, PWA-Taste „Aufgeben…“ am Verlaufseintrag. Ergebnis `abandoned` statt erfundenem `failed`, Pflichtnotiz, gibt das Budget frei. Nachweis: `exit-criteria.test.ts` (ADR-0072), `hub/automations/automations.test.ts`, `hubctl/test/automations.integration.test.ts`, E2E `automations-crash.spec.ts` (nach echtem `SIGKILL` in der PWA aufgegeben, nächster Start läuft wieder).
2. ~~Echter Crash-Test~~ — belegt durch `automations-crash.spec.ts` (12.11.2026). P38-Lease und Projekt-Auth sind am echten Hub belegt (`automations-provider.spec.ts`). Offen bleibt nur ein **echtes Provider-Kontingent/-Login** gegen einen Live-Account; dafür gibt es weiterhin nur das Textmuster-Mapping.
3. ~~Ergebnisabrechnung nur gegen den dummy-Harness~~ — `session.turn_end` kommt vom SessionManager für jeden Adapter; seit 12.11.2026 auch mit dem prozessbasierten opencode-Adapter belegt (Erfolg → `succeeded`, Exit-Code ≠ 0 → `failed`, Session-Verweis), E2E `automations-provider.spec.ts`. Ein Lauf gegen einen echten Provider-Account bleibt Teil der Live-Abnahme (Punkt 2).
4. ~~K8 mit großer Schedule-/Catch-up-Menge~~ — gemessen 12.11.2026 mit 128 Minutenplänen (Kontingent-Maximum): der Tick wuchs linear mit der Laufzeit (249 ms nach 6 h, jede Sekunde) → [BUG-0148](../bugs/bug-0148-automations-tick-waechst.md) behoben (Snapshot nur bei Änderung, Journal-Kompaktierung, Verlauf je Plan auf 200 abgeschlossene Claims begrenzt); danach flach bei rund 50 ms. Nachweis `core/automations/k8.test.ts`.
5. **T41.6/Definition of Done:** Pipeline-Job `e2e` und Vorgänger-Exit (P40) wurden hier nicht neu belegt.
