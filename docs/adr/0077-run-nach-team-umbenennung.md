# ADR-0077 — Run→Team: Orchestrierungs-Fläche umbenennen, Journal migrieren, Modell-Allowlist erzwingen

**Status:** akzeptiert; Benennung (§1, §2) ab T83.1 ersetzt durch [ADR-0123](0123-swarm-und-team.md) · **Betrifft:** `packages/contracts/src/orchestration/`,
`packages/core/src/modules/orchestration/`, `apps/hub/src/modules/orchestration/`,
`apps/hub/src/platform/policy.ts`, `packages/contracts/src/approvals/policy.ts`,
`packages/contracts/src/automations/automation.ts`, `apps/hubctl/src/automations.ts`,
`apps/pwa/src/features/orchestration/`, `apps/pwa/src/app/route.ts`, EPIC-P60
(Nutzerauftrag 14.11.2026). Erweitert ADR-0064 (Orchestrierung-Engine) und
ADR-0065 (Run-Vorlagen in Automationen); Statusübergänge und Invarianten aus
ADR-0064 bleiben unverändert.

## Kontext

Nach der ersten Nutzung der P40-Fläche ist der Begriff „Run" nicht
selbsterklärend (er sagt nicht, was die Fläche tut), und die Seite wirkt
visuell unbefriedigend. Nutzerauftrag (Jan, 14.11.2026): vollständige
Umbenennung in **Team** — überall sauber definiert, auch in den Contracts —
plus Kartenübersicht je Worker, belegte Parallelität und vorab wählbare
Adapter/Modelle. Namensfindung: „Factory" kollidiert mit der Loop-Factory
(P19/P26), „Orchestrator" mit der Core-Klasse bzw. der Hermes-Rolle.

## Entscheidung

### 1. Begriffsabgrenzung

**Team = Orchestrierungseinheit über Agenten-Sessions** (ehemals Run): der
eine große Auftrag, den der Mensch eintippt und der automatisch auf mehrere
Agenten-Sessions (Worker) verteilt wird. Der Begriff ist im Code und in der
Doku **reserviert** und wird nicht für Menschengruppen/Multi-User oder
Zugriffsrollen besetzt (Guard gegen künftige Doppelverwendung). Weiterhin
unbenommen: Loop-Factory-Begriffe (P19/P26) und die Hermes-Rolle
„Orchestrator" (P54) bleiben unangetastet.

### 2. Namensmappe (Contracts first)

| Vorher | Nachher |
|---|---|
| `OrchestrationRun` / `OrchestrationRunStart` / `OrchestrationRunStatus` | `Team` / `TeamStart` / `TeamStatus` |
| `OrchestrationFrame` / `OrchestrationPlan` / `OrchestrationTaskPlan` / `OrchestrationTaskStatus` | `TeamFrame` / `TeamPlan` / `TeamTaskPlan` / `TeamTaskStatus` |
| `OrchestrationDispatch` / `OrchestrationDispatchStatus` / `OrchestrationGate` / `OrchestrationGateAction` / `OrchestrationDelivery` | `TeamDispatch` / `TeamDispatchStatus` / `TeamGate` / `TeamGateAction` / `TeamDelivery` |
| `ORCHESTRATION_ERRORS` | `TEAM_ERRORS` |
| Contracts-Ordner `orchestration/orchestration.ts` | `team/team.ts` |
| Core `modules/orchestration/` (`Orchestrator`, `OrchestrationStore`, `OrchestrationSessionPort`, `OrchestrationError`, `OrchestrationRecoveryReport`) | `modules/team/` (`TeamCoordinator`, `TeamStore`, `TeamSessionPort`, `TeamError`, `TeamRecoveryReport`) |
| Hub `modules/orchestration/` (`createHubOrchestration`, `HubOrchestration`) | `modules/team/` (`createHubTeam`, `HubTeam`) |
| Routen `/api/orchestration/runs…` | `/api/teams…` (alte Pfade entfallen ohne Redirect; einziger Consumer ist die PWA, hubctl/Gateway greifen nicht zu — Inventur §Anhang) |
| Policy `orchestration.manage` | `team.manage` (human-only wie bisher) |
| Policy (Text) `orchestration.read` | `team.read` wird als eigene Operation registriert mit dem Allow-Set des bisherigen generischen `read` der Fläche — reine Benennung, kein Verhaltenswechsel |
| Store-Dir `data/orchestration/` (`runs.jsonl`, `snapshot.json`) | `data/team/` (`teams.jsonl`, `snapshot.json`) — Migration siehe §3 |
| PWA Page-ID `orchestrierung`, Slug `#/runs`, Query `?run=`, Dock „Runs", Titel „Orchestrierung" | Page-ID `teams`, Slug `#/teams`, Query `?team=`, Dock „Teams", Titel „Agenten-Teams" |
| PWA Testids `runs-pane`, `run-detail`, `run-gate`, `run-new`; Styles `34-orchestration.css` (`runs-*`, `run-*`) | `teams-pane`, `team-detail`, `team-gate`, `team-new`; `34-teams.css` (`teams-*`, `team-*`) — löst auch die `.run-meta`-Doppeldefinition gegen `15-run-strip.css` (Session-Fläche) auf |
| Plan-Fence ` ```orchestration ` im Koordinator-Prompt | ` ```team `; der Parser akzeptiert beide Fences (alte Pläne/Newsgates brechen nicht) |
| Actor-String `"orchestration"` beim SessionPort.create | `"team"` |

Nicht umbenannt (abgegrenzt): Session-Turn-Metriken (`modules/runs/`,
`/api/metrics/turns`, P21), Loop-Factory (P19/P26), Hermes-Rolle
„Orchestrator" (P54/P56), `AutomationHistoryEntry.kind: "run_now"`
(bedeutet „jetzt starten", nicht die Run-Entität), Session-Statuszeile
(`15-run-strip.css`, `run-progress.ts`).

### 3. Persistenz-Migration (K7)

`TeamStore.init()` liest künftig `data/team/snapshot.json` +
`data/team/teams.jsonl`. Existiert `data/team/` noch nicht, wohl aber
`data/orchestration/`, wird der Altbestand einmalig gelesen und als
`teams.jsonl` + `snapshot.json` im neuen Verzeichnis geschrieben
(Migrationspfad mit eigener Altdaten-Fixture-Testreihe, rot-grün). Die
alten Dateien werden **nie gelöscht** (bis zum ersten erfolgreichen
Snapshot-Umschrieb mindestens; danach bewusst als Datengrab liegen
gelassen — der Hub räumt keine Nutzdaten weg). Kaputte Zeilen werden wie
bisher gezählt und übersprungen, nie versteckt; der Recovery-Report
erhält Migrations-Zähler (`migratedTeams`, `migratedSkippedLines`).
Zustand bleibt aus Journal + Snapshot rekonstruierbar (K7 unverändert).

### 4. Persistierte Automationen (ADR-0065-Kopplung)

Automationen betten eine Run-Vorlage als eingefrorenes SHA-Blob ein und
tragen `target.kind: "run"` sowie `runId`-Felder in History/Claims. Alles
Persistierte wird **tolerant gelesen** und beim nächsten Schreiben
migriert — Bestand bricht nie:

- `AutomationTarget`-Zweig `kind: "run"` → `kind: "team"`; das Zod-Schema
  akzeptiert beim Lesen beide Literale und normalisiert auf `"team"`.
- Eingefrorene Template-Blobs enthalten `OrchestrationRunStart`-JSON. Die
  Umbenennung ist rein typseitig (Feldnamen bleiben), alte Blobs parsen
  weiterhin. Mit der Modell-Allowlist (§6) ändert sich die Frame-Form
  (`model` → `models`) — das Lesen akzeptiert die Altedform und bildet
  `model: m` auf `models: m ? [m] : []` ab.
- `AutomationHistoryEntry.runId` / Claim-Feld `runId` → `teamId`; beim
  Parsen alter Journalzeilen wird `runId` übernommen, falls `teamId` fehlt.
- `kind: "run_now"` bleibt unverändert (andere Bedeutung).
- hubctl (`automations.ts`) validiert und zeigt künftig `team`; die
  CLI-Eingabe `run` bleibt als Alias lesbar und wird auf `team`
  normalisiert (kein Bruch für Skripte).

### 5. Parallelität (K8)

Der Zod-Deckel für `TeamFrame.maxParallel` steigt von 4 auf **8**
(Default bleibt 2; Formular erlaubt 1–8). Die harte Obergrenze bleiben die
bestehenden Session-Grenzen (K8 unberührt); der Rahmen wird weiterhin
serverseitig bei jedem Dispatch geprüft (ADR-0064 §5). Der
Planungs-Prompt macht **breite DAGs zur Vorgabe** („so breit wie möglich,
so tief wie nötig"; `dependsOn` nur bei echtem Informationsbedarf) inkl.
Beispiel mit zwei parallelen Tasks; ein Integrationstest belegt N
**gleichzeitig aktive** Dispatch-Sessions (Überlappung, nicht nur
nacheinander erzeugte).

### 6. Modell-Allowlist statt freiem Modell-String (Contract-Break)

`TeamFrame` ersetzt `model: string|null` durch **`models: string[]`**
(leer = nur Adapter-Standardmodell). `validatePlan` prüft fortan auch
`task.model ∈ frame.models ∪ {null}` — bisher ging jedes Task-Modell
ungeprüft bis `SessionPort.create` durch (Divergenz zur
Adapter-Allowlist; Lücke). Ein ungültiges Modell im Plan erzeugt **eine**
klare Rückfrage (Retry_plan), nicht pro Task ein Gate. Der
Planungs-Prompt listet die erlaubten Modelle; die Koordinator-Session
nutzt das erste erlaubte Modell oder den Adapter-Standard. Persistierte
Automation-Blobs mit Altedform werden toleriert gelesen (§4).

## Konsequenzen

- Contract-Breaks (Typnamen, Policy-Operation, `kind`-Literal,
  Frame-Form) sind über dieses ADR abgesegnet; die Engine-Invarianten
  (Statusübergänge, stale-Verweigerung, Retry-Deckel) bleiben unangetastet.
- Alte PWA-Links `#/runs…`/`?run=` (auch der Automationen-Deep-Link und
  Browser-History) werden clientseitig permanent auf `#/teams…`/`?team=`
  umgeleitet; ein Redirect ist E2E-gedeckt.
- Die Umbenennung ist kein API-Stabilitätsversprechen über `team/` hinaus;
  `orchestration/`-Namen verschwinden (kein Alias-Zeitraum auf
  HTTP-Ebene, da die PWA der einzige Consumer ist).
- Inventur aller Verwender Stand 14.11.2026: siehe Anhang.

## Anhang — Verwender-Inventur (grep-Protokoll, Stand 14.11.2026, main cd2c327)

- **Contracts:** `orchestration/orchestration.ts` (alle `Orchestration*`-Typen,
  `ORCHESTRATION_ERRORS`, `maxParallel`-Deckel 4, `model` in Frame/Task/Dispatch);
  `approvals/policy.ts` (`orchestration.manage`, POLICY-Zeile 82/152);
  `automations/automation.ts` (`kind:"run"` Z. 141, `runId` Z. 171/188,
  `run_now` Z. 172 bleibt).
- **Core:** `modules/orchestration/{index,engine,store,coordinator}.ts`;
  Verdrahtung `modules/automations/{service,store,scheduler}.ts`
  (Run-Vorlage als SHA-Blob, `runId` in Claims/DispatchResult);
  `contextPacket`-Überschrift; Fence ```orchestration (Parser + Prompt).
- **Hub:** `modules/orchestration/{orchestration.routes,orchestration-service,index}.ts`
  (5 Routen `/api/orchestration/runs…`); `platform/policy.ts` (Präfix-Regel);
  `routes.ts`, `route-context.ts`, `app.ts`, `main.ts` (Boot, geteilter Owner
  mit Automationen, ADR-0065); `modules/automations/automations-{service,routes}.ts`
  (Template-Ausgabe, Launch, Inspect über `claim.runId`).
- **PWA:** `features/orchestration/RunsPane.tsx`; `app/route.ts`
  (Page-ID `orchestrierung`, `PAGE_SLUG: runs`, `#/runs?`-Sonderfall);
  `app/Dock.tsx`, `shared/TabIcon.tsx` (`runs`), `app/App.tsx`,
  `features/shell/ToolPane.tsx` (Titel); `features/commands/quick.ts`;
  `shared/command-context.ts`; `shared/api.ts` (`orchestrationRuns/Start/…`,
  Z. 1381–1388); `features/automations/{AutomationsPane,AutomationForm,AutomationDetail}.tsx`
  (Labels, `?run=`-Deep-Link, gemeinsame `run-*`-CSS-Klassen);
  `app/styles/34-orchestration.css` (+ Import in `index.css`); Fenster/Popout
  generisch über `TOOL_PAGE_IDS` (`features/windows/protocol.ts`).
- **hubctl:** keine Orchestrierungs-Befehle; nur `automations.ts`
  (kind-Validierung, Template-Ausgabe, `runId`-Anzeige) und Hilfe in `cli.ts`.
- **Tests/E2E:** `packages/core/test/modules/orchestration/orchestration.test.ts`
  (Engine, Store-Recovery inkl. kaputtem `runs.jsonl`, Lebenszyklus, Fence);
  `apps/hub/test/modules/orchestration/orchestration.integration.test.ts`;
  `apps/hub/test/modules/automations/lifecycle.integration.test.ts`;
  `e2e/specs/orchestration.spec.ts` (wird `team.spec.ts`);
  `e2e/specs/automations-lifecycle.spec.ts` (Deep-Link `#/runs?run=`);
  `e2e/specs/{navigation,dock-visibility,funktionsinventar}.spec.ts`
  (Dock-Label „Runs", G06-Spiegel); adapter-testkit ohne Bezug.
- **Doku (lebendig):** `docs/funktionsinventar.md` (G06/G51),
  `docs/architecture.md`, `docs/referenz-hubctl.md`, `docs/design-system.md`,
  `README.md`; ADR-0064/0065/0068/0072 bleiben als historische Entscheidungen
  unumgeschrieben (dieses ADR tritt für die Benennung an deren Stelle);
  eingefrorene Analysen und Epics (P40/P41/P43) werden nicht rückwirkend
  umbenannt.
- **Kein Bezug:** EventStore/WS (die Fläche emittiert keine Events — Polling
  alle 3 s), SQLite, Loops/Factory, Session-Turn-Metriken (`modules/runs/`),
  Session-Statuszeile (`15-run-strip.css`).
