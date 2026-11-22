# ADR-0038 — Loop / Dark Factory als Auswahldimension (Loop-Connector-Contract)

**Status:** akzeptiert (Nachtrag 2026-11-22: Gerüst und Connectors stehen — `securesight-factory`, `aSPARK-Factory` und `ralph` als
Beobachter des Hermes-Ralph-Goal-Gate-Runners; `agents: "hub"` entsperrt über [ADR-0110](0110-ralph-im-hub.md)). Die
Entscheidungen unten gelten, solange Jan nicht widerspricht. · **Betrifft:** EPIC-P19, `@ancientvoid/contracts` (neu `loops/`,
additiv `SessionSpec`), `packages/core` (Modul `loops`), Hub-Routen, PWA
(Start-Formular, Session-Kopf), neue Pakete `packages/loops/*` ·
**Grundlage:** [Analyse 2026-10-27](../loop-analyse-2026-10-27.md)

## Kontext

Neben Host, Adapter, Modell und Modus soll eine weitere Dimension wählbar sein:
**Loop / Dark Factory**, mit mehreren austauschbaren Implementierungen. Zuerst
zwei:

- **securesight-factory** (Entwurfsname bis 2026-10-27: `securesight-harnez`; Harnez-Loop-Runner mit Watchdog und
  Betriebsmodi a/b, Hermes als Orchestrator wählbar),
- **aSPARK-Factory** (Docker-„Lines“, Modus `dark` = Dark Factory, MQTT-Leitstand).

Beide sind **eigenständige Systeme, die ihre Agenten selbst ausführen** und über
eine eigene, dokumentierte Schnittstelle nach außen sprechen (Analyse §2.4, §3.4).
Sie sind keine Agenten-Runtime im Sinn des Adapter-Contracts (Prompt → Zug → Ende).

Randbedingungen aus `AGENTS.md`: Contracts first, Adapter sehen nur
`AdapterContext`, K5 (≤ 4 KB), K7 (Zustand aus JSONL + Snapshot), fail loud, kein
Scope-Creep, Modulstruktur nach ADR-0020, **Loops dürfen den Hub nicht an ihre
Interna koppeln**, die Hermes-Orchestrator-Wahl muss als Konfiguration des Loops
abbildbar sein.

## Entscheidung (Vorschlag)

### 1. Ein eigener, schmaler Contract: `LoopConnector`

`packages/contracts/src/loops/` bekommt den Vertrag. Der Adapter-Contract bleibt
**unverändert**. Ein `LoopConnector` verbindet den Hub mit **einem** Loop-System.
Er sieht nur den `AdapterContext` (Regel 2 gilt unverändert): `emit`, `blob`,
`log`, `signal`, `workdir`, `sessionId`, `spawnWorker`, und für Fragen das schon
vorhandene `requestToolPermission`.

### 2. Ein Loop-Lauf ist eine Hub-Session

Der Hub übersetzt einen `LoopConnector` per `loopAsAdapter()` (Modul
`packages/core/src/modules/loops/`) in einen internen Adapter. Damit laufen
SessionManager, EventStore, Recovery (`recover()`, K7), Freigaben, Push und PWA
**ohne Umbau**. Die Session trägt `loop_id` (neue nullable Spalte, Muster
ADR-0033 `permission_mode`); der Adapter-Name der Session ist `loop:<id>`.
`SessionSpec` bekommt additiv `loop?: { id: string; options?: Record<string, unknown> }`;
genau eines von `adapter` und `loop` ist gesetzt (Zod-`refine`, fail loud mit 400).

### 3. Anbindung nur über die dokumentierte Schnittstelle des Loop-Systems

| Loop | Verbindung | Was gelesen wird | Was geschrieben wird |
|---|---|---|---|
| `aspark-factory` | MQTT-Client als **Leitstand** (eigener Nutzer mit ACL, nicht der Admin) | `agent/<line>/…` (`info`, `state`, `progress`, `stats`, `report`, `ask`) | `answer` (nur `allow`/`deny` einmalig), `command` (`pause`, `resume`, `work`, `set-mode`, `next-steps`) |
| `securesight-factory` | CLI und Dateien, **kein** Leitwerk-HTTP (das ist intern) | `betrieb.py supervisor-status --json`, `.harness/notify/`, Transcript-Bus NDJSON, `harnez progress show`, bei Hermes-Orchestrierung `~/.hermes/ralph/<epic>-state.json` | nur `notify-ack`; „Fortsetzen“ als ausdrücklicher Tipp des Menschen (`betrieb.py cycle --once`), nie automatisch |

Nicht erlaubt: Docker- oder Prozess-Interna, Screen-Parsing von tmux, Schreiben in
fremde Zustandsdateien. Der Hub verhält sich gegenüber harnez wie ein **dritter
Supervisor** (Reaktionskatalog aus `docs/externer-supervisor.md`).

### 4. Fähigkeiten deklarieren, Oberfläche daraus erzeugen

```ts
// packages/contracts/src/loops/loop.ts (Skizze, strip-types-tauglich: keine enums)
export const LOOP_CONTROLS = ["pause", "resume", "stop", "setMode", "workNext"] as const;
export type LoopControl = (typeof LOOP_CONTROLS)[number];

export interface LoopOption {
  key: string;
  label: string;
  kind: "select" | "text" | "toggle";
  choices?: readonly { value: string; label: string }[];
  required?: boolean;
  /** Secrets are write-only: never echoed back by the API (rule of ADR-0022). */
  secret?: boolean;
}

export interface LoopCapabilities {
  /** Who runs the agents. "external": the loop system itself (both initial loops). "hub": reserved. */
  agents: "external" | "hub";
  /** Where the work comes from. */
  intake: readonly ("prompt" | "issues" | "backlog")[];
  /** The loop's own operating modes, provider-owned names (aSPARK: manual|supervised|autonomous|dark; harnez: a|b). */
  modes: readonly string[];
  /** Selectable orchestrators (harnez: self | hermes). Empty = none to choose. */
  orchestrators: readonly string[];
  controls: readonly LoopControl[];
  /** Gates the loop reports (aSPARK dark: policy|review|ci|merge). Informational. */
  gates: readonly string[];
  /** Questions the loop raises that the hub may answer. */
  asks: "none" | "permission" | "permission+question";
  /** Fields of the start form beyond mode/orchestrator. */
  options: readonly LoopOption[];
}

export interface LoopSpec {
  project: string;
  goal?: string;
  mode?: string;
  orchestrator?: string;
  options: Record<string, unknown>;
}

export interface LoopConnector {
  readonly id: string;
  readonly version: string;
  capabilities(): LoopCapabilities;
  start(spec: LoopSpec, ctx: AdapterContext): Promise<SessionHandle>;
  control(handle: SessionHandle, input: LoopControlInput, ctx: AdapterContext): Promise<Ack>;
  status(handle: SessionHandle): Promise<HealthReport>;
  stop(handle: SessionHandle, ctx: AdapterContext): Promise<void>;
  recover?(sessionId: string, lastSeq: number, ctx: AdapterContext): Promise<SessionHandle | null>;
}
```

Die Modi sind **providereigene Namen** und werden nicht vereinheitlicht (wie
`permissionModes`, ADR-0033). Die Oberfläche zeigt, was der Loop meldet. Sie nennt
das Feld **„Betriebsart“**, nicht „Modus“ (dort liegt der Adapter-Berechtigungsmodus).

### 5. Hermes als Orchestrator ist eine Option des Loops

`securesight-factory` deklariert `orchestrators: ["self", "hermes"]`. Gewählt wird
sie im Start-Formular wie jede andere Option und steht danach unveränderlich im
Event `session.loop`. Bedeutung:

- **`self`:** der Harnez-eigene Loop-Runner mit Watchdog (`betrieb.py cycle`, Modus a/b
  aus `policies/betriebsmodi.json`).
- **`hermes`:** Hermes führt die Rolle B aus (Ralph-Loop über Harnez-Iterationen). Der
  Connector **liest** deren Zustand (`~/.hermes/ralph/<epic>-state.json`: `status`,
  `tasks_done`/`tasks_total`, `current_task`, `user-gates`, `gate_fails`) und
  macht ihn zu Events. Das Starten ist **offen** (Frage 1).

### 6. Fragen und Freigaben ohne neuen Vertrag

aSPARK-`ask` wird auf das bestehende `ctx.requestToolPermission` abgebildet:
`kind: permission` → `ToolPermissionRequest{toolName, input, toolUseId}`,
`kind: question` → `toolName: "AskUserQuestion"` mit `ToolQuestion[]`
(Struktur identisch, Analyse §5.2). Antworten:

- nur **`allow`/`deny` einmalig**. **Kein „immer erlauben“** in v1: im Loop schreibt
  das per Pull Request eine Regel in `agent.yaml` des Projekt-Repos.
- Die Frage-`id` bleibt die Korrelation; `expiresAt`/`timeoutAction` zeigt die
  Oberfläche an, der **Ablauf bleibt Sache des Loops** (er räumt die Frage selbst).
- Doppeltes Antworten ist idempotent: der Loop ignoriert späte und doppelte Antworten,
  die Oberfläche zeigt dann „bereits beantwortet“ statt zu raten.

### 7. Ereignisse, K5, K7, fail loud

- Alles Loop-Eigene erscheint als `system`-Event mit `payload.kind` in
  `loop.started | loop.info | loop.state | loop.progress | loop.gate | loop.report |
  loop.cursor | loop.configured | loop.broken`. Inhalte, die der Loop als Agenten-Output
  liefert (harnez-Transcript), werden 1:1 auf `user`/`assistant`/`thinking`/`tool_use`/
  `tool_result` abgebildet (die Arten des Transcript-Bus entsprechen denen des Hub).
- **K5:** Payload ≤ 4 KB. Berichte, Diffs und lange Fragen über `ctx.blob()`. Die
  aSPARK-Kürzung auf 4.096 Byte ist kein Ersatz dafür, der Rahmen kommt dazu.
- **K7:** Zustand ist aus JSONL + Snapshot rekonstruierbar. `session.loop` hält Loop-Id
  und Konfiguration (Secrets geschwärzt). `loop.cursor` hält die Leseposition
  (harnez: `seq` des Transcript-Bus; aSPARK: `ts` der letzten Nachricht), damit der
  Wiederanlauf nichts doppelt oder gar nicht liest. aSPARK liefert beim
  Wiederverbinden den aktuellen Stand **retained** nach.
- **Fail loud (Regel 6):** unbekannte Schema-Version (`v` ≠ 1, `schema_version`
  unbekannt), unbekannter Topic- oder Ereignistyp, nicht parsebares JSON,
  Last Will `offline`, `supervisor-status` Exit 4/5 → `loop.broken` mit Grund,
  sichtbar in der Session und in der Übersicht, in **< 60 s** (Muster K9).

### 8. Sicherheit und Sicherheitsgrenzen

- **Agenten-Text ist Daten.** Fragen, Berichte und Transcript-Zeilen der Loops werden
  angezeigt, nie als Instruktion für den Hub oder einen Hub-Agenten interpretiert
  (PRD §8.5). Das Markdown-Rendering aus BUG-0067 (nur Daten-AST, keine
  HTML-Ausgabe) gilt auch hier.
- **Außenwirkung ist menschlich.** Start, Wechsel der Betriebsart (insbesondere nach
  `dark` bzw. `a`), `workNext` und „Fortsetzen“ sind Policy-Operationen
  **„Mensch ja, Agent nein“** (`packages/contracts/src/approvals/policy.ts`), mit
  ausdrücklicher Bestätigung für `dark`/`a`.
- **Zugangsdaten** (MQTT-Nutzer/Passwort des Hub-Leitstand-Nutzers, Pfade) stehen nur
  in `hub.config.json` bzw. im Hub-Secret-Speicher, nie in Event-Payloads, nie in
  API-Antworten, nie in Logs (Leak-Test wie bei den Provider-Schlüsseln).
- **Kapselung durch die Architekturprüfung:** `packages/loops/*` dürfen nur
  `@ancientvoid/contracts` importieren; eine neue `dependency-cruiser`-Regel (analog zu den
  Adaptern) macht das im Gate (`npm run check:arch`) sichtbar.

### 9. Pakete und Namen

```
packages/contracts/src/loops/              Contract, Zod-Schemas
packages/core/src/modules/loops/           Registry (hub.config.json: loops[]), loopAsAdapter
apps/hub/src/modules/loops/loops.routes.ts GET /api/loops, Gesundheit je Loop
packages/loops/aspark-factory/             @ancientvoid/loop-aspark-factory
packages/loops/securesight-factory/         @ancientvoid/loop-securesight-factory
packages/adapters/testkit/                 + runLoopContractTests()
apps/pwa/src/features/loops/               Start-Optionen, Loop-Panel
```

Loop-Ids haben einen **eigenen Namensraum**: `aspark-factory`, `securesight-factory`.
**Umbenennung (Jan, 2026-10-27):** Der bestehende Adapter `securesight-harnez` (opencode/ACP, `hub.config.json`) ist
der **Harness** und behält seinen Namen. Das System, das Loops betreibt, heißt Factory. Damit ist die Namenskollision
aus der Analyse (Befund 1) gelöst. Das fremde Repo heißt auf der Platte noch `securesight-harnez`, seine Umbenennung ist
nicht Sache des Hubs. Die Oberfläche kennzeichnet Loops mit einem Typ-Abzeichen „Loop“.

### 10. Abhängigkeit für MQTT

Empfehlung: das reine JavaScript-Paket **`mqtt`** (MIT, kein natives Modul, passt zu
„Persistenz/Laufzeit ohne native Module“), nur im Paket `@ancientvoid/loop-aspark-factory`.
Alternative `mosquitto_sub`/`mosquitto_pub` als Worker: keine Abhängigkeit im Hub, aber
Systempaket nötig und das Passwort stünde in der Prozessliste. **Neue Abhängigkeit
braucht Jans Freigabe** (Frage 3).

## PWA: Auswahl-Flow

Das Start-Formular behält Host, Adapter, Modell, Modus. Neu ist **eine** Zeile
„Loop“ direkt unter dem Host:

```text
Host      [ workstation            ▾]
Loop      [ keiner             ▾]   ← keiner | securesight-factory | aSPARK-Factory
          └ bei Auswahl eines Loops:
Betriebsart   [ dark ▾ ]            ← aus capabilities().modes
Orchestrator  [ self | hermes ▾ ]   ← nur wenn capabilities().orchestrators nicht leer
<Optionen>    Line / Repo / Epic …  ← aus capabilities().options
Adapter · Modell · Modus: „vom Loop bestimmt“ (ausgegraut, mit Begründung)
```

- Loop `keiner` verhält sich **exakt wie heute** (AC: keine Regression, auch mobil).
- Bei `agents: "external"` sind Adapter und Modell nicht wählbar. Die Oberfläche
  sagt, warum („aSPARK-Lines wählen ihr Modell selbst, siehe `LLM_PROVIDER`“), statt
  Felder stillschweigend zu verstecken.
- Ein bestätigungspflichtiger Dialog erscheint für Betriebsarten mit Außenwirkung
  (`dark`, `a`).
- Session-Kopf: Abzeichen „Loop · <Name> · <Betriebsart>“ plus Zustand `online/offline`.
  Loop-Panel mit Gates, Fortschritt, offenen Fragen und Tagesbericht. Fragen laufen
  durch die vorhandene Freigaben-Ansicht, mit Quellenkennzeichnung „von <Loop>“.

## Alternativen

| | Bewertung |
|---|---|
| **A. Loop als normaler Adapter** (`args` für alles) | Wiederverwendet am meisten, aber der Adapter-Contract kennt nur Prompt/Zug/Modell. Betriebsarten, Orchestrator, Gates und Steuerbefehle müssten als freie `args`/Events getarnt werden. Die Oberfläche könnte nichts aus Fähigkeiten erzeugen, jeder Loop bekäme Sonderbehandlung. **Verworfen als alleinige Lösung, aber als Unterbau übernommen** (Entscheidung 2). |
| **B. Worker-Prozess, der `factoryctl`/`harnez` in tmux startet** | Screen-Parsing, bricht bei jeder Formatänderung (K9), koppelt an Interna, in EPIC-P17 ausdrücklich ausgeschlossen. **Verworfen.** `spawnWorker` bleibt für einzelne CLI-Aufrufe **innerhalb** eines Connectors erlaubt. |
| **C. Eigener Loop-Contract + Adapter-Shim** (dieser ADR) | Ein neuer, kleiner Vertrag, deklarative Fähigkeiten, Testkit-Suite, aber SessionManager/EventStore/Recovery unverändert. Kosten: ein weiterer Contract mit Pflege. **Empfohlen.** |
| **D. Loops als Hub-eigene Schleife** (Hub treibt Adapter-Sessions in einer Schleife, „Ralph im Hub“) | Anderes Produkt: der Hub würde selbst zum Loop-System. Widerspricht „Loops sind austauschbar angebunden“ und dem Scope. **Nicht jetzt.** `agents: "hub"` ist als Wert reserviert, aber nicht implementiert. |

## Konsequenzen

- Additive Änderungen: `SessionSpec.loop`, Spalte `sessions.loop_id`, Event
  `session.loop`, Modul `loops`. Bestehende Adapter und Sessions ändern ihr Verhalten
  nicht.
- Zwei neue Pakete, ein Testkit-Zusatz, eine neue Abhängigkeit (`mqtt`, Frage 3).
- Der Hub bekommt Verantwortung für **Außenwirkung fremder Systeme** (Merges, Commits).
  Das ist ausdrücklich mit der Policy „Mensch ja, Agent nein“ begrenzt.
- **Messlatten:** K1 (Frage beantworten < 5 s), K2 (Transcript live ≥ 30 ev/s,
  kein Frame-Lag > 200 ms), K5, K7 (< 3 s Restore, 100 % identisch), K9
  (`loop.broken` < 60 s), K10 (Offline-Anzeige mit Zeitstempel). Details in
  [EPIC-P19](../../epics/EPIC-P19-loop-dark-factory.md).

## Offene Fragen an Jan

1. **Hermes starten:** Wie startest du den Ralph-Loop heute (Cron, Telegram,
   `hermes -z …` von Hand, der Hub-Adapter `hermes`)? Der Ralph-Skill
   `STANDARD.md` lag in den gelesenen Pfaden nicht vor. Davon hängt ab, ob der
   Connector Hermes **startet** (Kind-Prozess über `spawnWorker`) oder **nur
   beobachtet**. Empfehlung für v1: nur beobachten.
2. **Eigener Hub-Nutzer für aSPARK:** Darf ich im Entwurf einen eigenen MQTT-Nutzer
   „ancientvoid-leitstand“ mit ACL (nur Lesen auf `agent/#`, Schreiben auf `…/answer` und
   `…/command`) vorsehen? Ihn anzulegen wäre ein Schritt in `~/.aspark-factory`, den
   ich **nicht** ausführe, sondern als Anleitung dokumentiere.
3. **Neue Abhängigkeit `mqtt`** (Empfehlung) oder `mosquitto_sub`-Worker?
4. **Sichtbarkeit von „dark“:** Soll die Betriebsart `dark`/`a` am Handy überhaupt
   wählbar sein, oder nur lesbar (Wechsel nur am PC bzw. in `factoryctl`)? Empfehlung:
   wählbar, mit Bestätigung und Eintrag im Audit-Event.
5. **Reihenfolge:** Erst `aspark-factory` (klarer MQTT-Vertrag, passt 1:1 auf
   Freigaben) oder erst `securesight-factory`? Empfehlung: `aspark-factory` zuerst.
6. ~~Epic-Gating~~ erledigt: P18 ist seit 2026-10-27 gemergt, P19 darf nach Bestätigung dieses ADR starten.

## Nachtrag 2026-10-28: Einrichtung pro Repo und Umsetzung

- **Onboarding im Contract.** `LoopCapabilities.onboarding` (Felder + ein Geheimnis) und `LoopConnector.onboard()` richten ein
  Loop-System für ein neues Repo ein. Der Hub-Endpunkt `POST /api/loops/:id/onboard` ist die Policy-Operation `loops.onboard`
  (nur Mensch). Das Geheimnis geht nur durch diesen einen Aufruf: nicht in Config, Ereignisse, Logs oder Fehlertexte. Die Auswahl
  `LOOP_NEW` („+neu“) in der Startauswahl öffnet das Formular; vor dem Anbinden startet keine Session (422).
- **aSPARK geht die `factoryctl`-Schritte selbst.** Der Connector ruft `factoryctl new <linie> --repo … [--type] [--mode]
  [--gitlab-url]` und reicht das Repo-Token über stdin an dessen Prompt (`getpass`, ohne Terminal: eigene Sitzung). `setup`
  (Claude-Token, Broker) fragt mehrere Geheimnisse und bleibt eine einmalige Handlung im Terminal; fehlt es, nennt der Hub den
  Befehl. Eine vorhandene Linie für dasselbe Repo wird übernommen, für ein anderes Repo abgelehnt. Betriebsart `dark` gibt es beim
  Anbinden nicht; sie wird später mit Bestätigung gesetzt.
- **Frage 2 (eigener MQTT-Nutzer) abweichend entschieden:** Der Connector nutzt den vorhandenen Nutzer `leitstand` aus `factoryctl
  setup` (Passwort aus `factory.env`, Schlüssel `MQTT_LEITSTAND_PASSWORD`, nie in der Hub-Config). Dessen ACL ist weiter als im
  Entwurf (`agent/#` lesen und schreiben). Das ist für einen lokalen Broker vertretbar; ein eigener Nutzer bleibt möglich, wenn der
  Broker außerhalb des Rechners erreichbar wird.
- **securesight-harnez heißt jetzt securesight-factory** (Iteration 0055): der Fahrplan liegt unter `.factory/`; der Connector liest
  `.factory/progress.json` und fällt auf `.harnez/progress.json` zurück. `scripts/betrieb.py` und `.harness/` bleiben.
- **Benachrichtigungen:** `loop.hold`, `loop.broken` und `loop.notify` lösen eine Hub-Benachrichtigung aus (ADR-0015-Pfad).

