# EPIC-P1.5 — Control-Center-UX: Kontingent statt Budget, Projekt-Autoerkennung, Sprach-Composer, Skill-Overlay

**Status:** abgeschlossen 2026-11-18 (Code + automatisierte Tests grün) — Menschen-Abnahme nach P000 verschoben · **Phase:** P1.5 (bewusst zwischen P1 und P2 eingeschoben) · **Dauer:** 1–1,5 Agenten-Wochen · **Abhängigkeit:** P1 mechanisch fertig (Adapter `claude`/`codex` live verifiziert)

> **Konsolidierung 2026-10-29 (Zustands-Scan):** Alle Aufgaben T1.5-1 – T1.5-11 sind umgesetzt (siehe Häkchen unten). Der alte Status „offen" war ein Relikt: Die formale DoD-Live-Abnahme der *ursprünglichen* P1.5-Oberfläche entfiel, weil der Nutzer sie nach der ersten Nutzung verwarf und durch P1.6 ersetzte (Begründung: `epics/README.md` §„Ausnahme P1.6", Vorbemerkung in [`EPIC-P1.6`](EPIC-P1.6-futuristic-ui-system.md)). Der offene K6-Rest aus T1.5-7 (Handy-Messung) ist in P10/T12.10 weitergeführt. Kein separates P1.5-Exit mehr zu erfüllen.
**Ziel-Machine:** Omarchy (Entwicklung + reale Nutzung), home-server (Staging)

---

> **Vorbemerkung: bewusste Umpriorisierung, kein Übersehen des Epic-Gatings.**
> `AGENTS.md` (erster Abschnitt) und `epics/README.md` §„Reihenfolge & Gating"
> verlangen: P(n) startet erst, wenn P(n-1) grün ist — und regulär wäre als
> Nächstes P2 (Diff/Approvals/Budgets) dran. Diese Phase überholt P2 und den
> Rest von P3 **auf ausdrückliche Anweisung des Nutzers**, aus zwei konkreten
> Gründen:
>
> 1. **P2s Budget-Teil ist für die reale Nutzung teilweise gegenstandslos.**
>    Der Nutzer arbeitet ausschließlich mit Coding-**Subscriptions**, nicht mit
>    API-Guthaben. Ein Dollar-Budget pro Session (heute `SessionSpec.budgetUsd`,
>    `packages/pwa/src/App.tsx:130-140`) beantwortet die Frage, die er
>    tatsächlich hat, nicht: „wie viel meines Kontingents ist verbraucht, wann
>    laufe ich ins Limit?" P2 bleibt vollständig bestehen; nur die
>    Reihenfolge-Annahme, dass Budget-Enforcement das dringlichste
>    Steuerungsthema sei, wurde durch echte Nutzung widerlegt.
> 2. **Interaktive Steuerung schlägt Diff-/Approval-UI im aktuellen
>    Nutzungsbild.** Die PWA kann heute Sessions *anschauen* und *stoppen*,
>    aber keinen einzigen Folge-Prompt senden: `POST /api/sessions/:id/steer`
>    existiert serverseitig (`packages/server/src/routes.ts:93-101`), wird in
>    `packages/pwa/src/` aber **nirgends aufgerufen** (verifiziert per grep über
>    `packages/pwa/src/*`). Antworten, Diktieren und „mit Skill X starten" sind
>    damit näher an „vom Handy voll arbeitsfähig" als eine Approval-Queue.
>
> Diese Phase ist damit eine **echte Priorisierungsentscheidung mit Begründung**,
> kein umgangenes Gate. P2 und P3 bleiben unverändert in der Reihenfolge
> danach — mit der Ausnahme, dass T3.6/T3.7/T3.9 (Sprache, Prompt-Composer)
> hierher vorgezogen werden (siehe §3.3/§3.4 und die Vermerke in
> [`EPIC-P3-adapter-flotte-sprachsuche.md`](EPIC-P3-adapter-flotte-sprachsuche.md) §4).

## 1. Ziel

Die PWA wird vom **Beobachtungsfenster zum Bedienpult**. Vier Dinge, die der
Nutzer nach dem ersten echten Einsatz der P1-Oberfläche konkret vermisst hat:

1. **Kontingent statt Budget** — sichtbar machen, wie viel des
   Subscription-Kontingents verbraucht ist und wann das Limit fällt (bzw. bei
   API-Abrechnung: wie viel Guthaben übrig ist). Das Dollar-Budget-Feld
   verschwindet aus der Oberfläche.
2. **Projekte werden erkannt, nicht getippt** — auf dem Host konfigurierte
   Repo-Wurzeln, der Hub scannt, das Handy wählt aus einer Liste.
3. **Eingabe per Sprache + Prompt-Enhancer** — Diktat statt Handy-Tastatur,
   optional zu einem brauchbaren Coding-Agent-Prompt umformuliert, immer
   editierbar vor dem Absenden.
4. **Skill-/Agent-Overlay beim Absenden** — statt nur „Senden" auch „Senden
   mit …": eine Auswahl der Skills/Agents, die im **Zielprojekt selbst**
   liegen; die zuletzt gewählte ist pro Projekt der Default, sichtbar und
   überschreibbar.

Diese Phase liefert **keine Approvals, keine Diffs, kein Budget-Enforcement** —
das bleibt P2. Wer hier eine Approval-Queue einbaut, verletzt den Scope.

## 2. Scope

### In
- Kontingent-/Quoten-Erfassung auf **Adapter-Account-Ebene** (nicht pro Session)
  aus dem realen `rate_limit_event` von claude; neuer Lese-Endpunkt
  (`GET /api/adapters/:id/usage`) + Anzeige in der PWA
- Ehrliches „unbekannt" für codex (belegt: kein Quota-Event im Stream, kein
  Quota-Subkommando in der CLI) — R9.7-Regel, wie schon bei T1.11s Kosten
- Entfernen des Budget-Eingabefelds aus der PWA (Contract-Feld `budgetUsd`
  bleibt unangetastet — P2 baut darauf auf)
- `projectRoots` in `HubConfig`, Scanner für Git-Repos, `GET /api/projects`,
  Projekt-Picker in der PWA statt Freitext-Pfad
- Prompt-Composer als eigene PWA-Komponente — beim Anlegen **und** als
  Folge-Prompt in einer laufenden Session (`hubApi.steer()`, existiert noch nicht)
- Spracheingabe (aus P3 vorgezogen, MVP: Browser-STT; Whisper.cpp dokumentierter
  Ausbaupfad), Transkript immer editierbar
- Prompt-Enhancer (aus P3 vorgezogen): Roh-Eingabe → strukturierter Prompt,
  Split-Preview, „Original senden" bleibt immer möglich
- Skill-/Agent-Overlay: Scan von `<projekt>/.claude/skills/*/SKILL.md` und
  `<projekt>/.claude/agents/*.md`, Anzeige der Auswahl, Per-Projekt-Default
- Zwei ADRs (Account-Usage-Modell, Skill-Invocation-Mechanismus) als echte
  Vorbedingungen, nicht als Nachdokumentation

### Out
- Diff-Ansicht, Approval-Gates, Budget-**Enforcement** — bleibt P2
- Sprachsuche über Projekt-Index (S5, Qdrant) — bleibt P3 (T3.8)
- Sprach-Direktiven-Parser („stopp", „Budget 3 Dollar" als Aktionen) — bleibt
  P3 (T3.10); hier wird Sprache nur zu **Text**, nie zu einer Aktion
- Learning-Loop-Storage des Optimizers (P3 T3.9s zweiter Teil) — hier nur der
  Optimizer selbst
- Weitere Adapter (swarm/zai/local-llm/copilot/cursor-clip) — bleibt P3
- Web-Push-Infrastruktur (offen aus AC-P1-5) — nicht Teil dieser Phase

## 3. Design-Details

### 3.1 Kontingent-Modell: Account-Ebene, nicht Session-Ebene

**Ground Truth (live in dieser Session aus dem echten claude-Stream erfasst):**

```json
{"type":"rate_limit_event","rate_limit_info":{
  "status":"allowed","resetsAt":1789473600,"rateLimitType":"five_hour",
  "overageStatus":"rejected","overageDisabledReason":"out_of_credits",
  "isUsingOverage":false,
  "unifiedWindows":{
    "five_hour":{"utilization":0.43,"resetsAt":1789473600},
    "seven_day":{"utilization":0.28,"resetsAt":1789891200}}},
  "uuid":"…","session_id":"…"}
```

Das ist **genau** die Information, die „wie viel ist übrig bis zum Limit"
beantwortet: `utilization` als 0.0–1.0 pro rollendem Fenster (5h und 7d),
`resetsAt` als Unix-Zeitstempel. `overageStatus`/`overageDisabledReason`
decken zusätzlich den API-Guthaben-Teil der Frage ab („wann 0 $ erreicht sind").

Der Hub **verwirft diese Daten heute**: `packages/adapter-claude/src/normalize.ts:55-58`
mappt `rate_limit_event` auf ein generisches, unbeschriftetes System-Event
(`summary: "claude: rate-limit status update"`, `payload.info` roh). Kein
Feld, kein Endpunkt, keine Anzeige.

**Die architektonisch entscheidende Eigenschaft:** Rate Limits gelten pro
**Account** (dem gesamten `claude`-Login der Maschine) und werden von *allen*
Sessions dieses Adapters geteilt. Damit sind sie strukturell etwas anderes als
`SessionRecord.costUsd` (ADR-0003), das pro Session summiert wird. Zwei parallele
Sessions haben zwei getrennte Kostensummen, aber **ein** gemeinsames Kontingent.

Konsequenz: Ein neues Feld auf `SessionRecord` wäre falsch (es würde suggerieren,
jede Session habe ihr eigenes Kontingent, und beim Summieren im Dashboard —
`packages/pwa/src/Dashboard.tsx:57` summiert `costUsd` genau so — käme Unsinn
heraus). Gebraucht wird ein **Usage-Snapshot pro Adapter-Id**: der Hub merkt sich
das jeweils letzte beobachtete `rate_limit_event` je Adapter samt Beobachtungs-
zeitpunkt und liefert es über einen eigenen Endpunkt aus.

Das berührt die Contracts (`packages/contracts/src/adapter.ts`): entweder
bekommt `AdapterCapabilities` ein `usage: boolean`, oder `HealthReport` einen
optionalen Usage-Teil, oder der `Adapter` eine neue optionale Methode
(`usage?(): Promise<UsageReport | null>`) — **diese Wahl ist offen und gehört
in ein ADR, bevor Code entsteht** (AGENTS.md Regel 1: „Änderungen am
Adapter-/Event-/Worker-Contract brauchen ein ADR"). Behandlung analog zu
[`docs/adr/0001-swarm-adapter-context.md`](../docs/adr/0001-swarm-adapter-context.md),
das vor T3.1 genau diese Vorarbeit leistet. Siehe T1.5-1.

**codex hat dazu kein Gegenstück — belegt, nicht vermutet.** In den realen
`codex exec --json`-Captures (`packages/adapter-codex/test/fixtures/`, codex-cli
0.153.4) treten ausschließlich `thread.started`, `turn.started`,
`turn.completed`, `item.started`, `item.completed` und `file_change` auf — kein
Quota-/Rate-Limit-Ereignis. Auch `codex login status`, `codex --help` und
`codex login --help` kennen unter einem ChatGPT-Plan-Login **kein**
Usage-/Quota-Subkommando (in dieser Session gegen die echte CLI geprüft). Damit
gilt für codex dieselbe Regel wie bei T1.11 für Kosten: **„unbekannt" anzeigen,
niemals schätzen, niemals 0 % suggerieren** — und ausdrücklich *nicht* über
eine undokumentierte Web-API ausweichen.

### 3.2 Projekt-Autoerkennung über `projectRoots`

Heute ist das Projekt ein Freitext-Pfad: `SessionSpec.project`
(`packages/contracts/src/session.ts`) und ein `<input placeholder="/home/user/repo">`
in `packages/pwa/src/App.tsx:114-121` — auf einem Handy die unangenehmste
denkbare Eingabe und gleichzeitig ein Pfad, den der Client frei bestimmt.

Reale Struktur auf der Zielmaschine: unter
`/mnt/data/30_repos/arch/arbeitsbaeume/` liegen mehrere
Geschwister-Repos (`AncientVoid`, `custom-rag`, weitere) nebeneinander.
„Automatisch erkannt" heißt deshalb:

- Neues Feld `projectRoots: string[]` in `HubConfig`
  (`packages/core/src/config.ts:21-39`, Default `[]`), Beispiel in
  `packages/server/hub.config.example.json`, Doku in
  [`docs/configuration.md`](../docs/configuration.md).
- Der Hub scannt die **direkten** Unterverzeichnisse jedes Roots (Tiefe 1, keine
  Rekursion) und nimmt auf, was ein `.git` enthält. Ergebnis: stabile
  Projekt-Id (z. B. `<root-index>/<verzeichnisname>`), Anzeigename, absoluter
  Pfad, optional der aktuelle Branch.
- Neuer Endpunkt `GET /api/projects` (neben `/api/adapters`,
  `packages/server/src/routes.ts:41-47`).
- **Sicherheitsmuster aus ADR-0001 übernehmen** (dort für `swarm` beschrieben:
  „Client sendet nur einen `allowlist_key`, nie einen Pfad; Server löst gegen
  `roots` auf, Symlink-Escape wird verweigert"). Für AncientVoid heißt das: Ist
  `projectRoots` gesetzt, muss `POST /api/sessions` einen Pfad außerhalb der
  Roots ablehnen. Ist `projectRoots` leer, bleibt das heutige Verhalten
  unverändert (keine Breaking Change für bestehende Configs).

### 3.3 Spracheingabe — aus P3 vorgezogen, mit expliziter MVP-Umkehr

Ursprünglich geplant als [EPIC-P3](EPIC-P3-adapter-flotte-sprachsuche.md) T3.6
(Whisper.cpp-Server als **Primärpfad**) und T3.7 (Browser-STT als **Fallback**).

**Vorgeschlagene Umkehr der Reihenfolge, bewusst benannt statt still gedreht:**
Für den MVP dieser Phase kommt **Browser-STT zuerst** (T3.7s ursprünglicher
Scope), weil es keinerlei Serverinfrastruktur braucht — kein Whisper-Build,
kein Modell-Download, keine GPU-Konkurrenz auf Omarchy (exakt das
P3-Premortem-Risiko 1). Der Whisper.cpp-Pfad (T3.6) bleibt als dokumentierter
Ausbau-/Ersatzpfad für Browser ohne native STT bestehen und wandert **nicht**
aus P3 heraus, sondern wird dort nur als „von P1.5 teilweise vorgezogen"
vermerkt.

Die Umkehr hat einen realen Preis, der in der UI benannt werden muss: Die
`SpeechRecognition`-API in Chrome überträgt Audio typischerweise zur
Erkennung an einen Google-Dienst — das steht im Spannungsverhältnis zum
local-first-Anspruch des Projekts (README „Sicherheit"). Deshalb: kein stilles
Aktivieren, sondern ein sichtbarer Hinweis und der Whisper-Pfad als bewusste
lokale Alternative. Siehe Premortem-Risiko 6.

Unverändert aus P3 übernommen: **Das Transkript ist immer editierbar vor dem
Absenden — kein Fire-and-forget.** Messlatte K6 (Transkript ≤ 1,5 s) bleibt
gültig und bekommt einen `docs/messlauf/`-Eintrag.

### 3.4 Prompt-Enhancer — aus P3 (T3.9) vorgezogen, mit einer echten offenen Frage

Übernommen aus [EPIC-P3](EPIC-P3-adapter-flotte-sprachsuche.md) §3
„Prompt-Optimizer": Systemprompt strukturiert die Roh-Eingabe in
Ziel / Scope / Constraints / Erfolgskriterium, Split-Preview (roh | optimiert),
„Original senden" bleibt jederzeit erreichbar, Optimierung ist **optional**
(„wenn gewünscht", Nutzerwortlaut).

**Offene Design-Frage, hier bewusst nicht beantwortet:** *Welches Modell führt
die Umformulierung aus?* Zwei plausible Wege mit unterschiedlichen Kosten:

- **(a) Der aktuell gewählte Coding-Adapter selbst**, über einen kurzen
  Wegwerf-Aufruf. Vorteil: nichts Zusätzliches zu installieren, nutzt die
  ohnehin eingeloggte Subscription. Nachteil: verbraucht genau das Kontingent,
  das §3.1 sichtbar machen soll, und startet einen zweiten Prozess pro Eingabe.
- **(b) Ein separates, leichtgewichtiges lokales Modell** (P3 §3 sah dafür
  einen Qwen-Finetune auf Omarchy vor). Vorteil: kontingent-neutral, wirklich
  local-first. Nachteil: neue Abhängigkeit, Latenz unbekannt, in diesem Repo
  noch nirgends verdrahtet.

Diese Frage ist **mit Beleg zu entscheiden** (Messung von Latenz und
Kontingent-Wirkung beider Wege), nicht per Bauchgefühl — genauso wie ADR-0001
seine offene Steer/Approval-Abhängigkeit ausdrücklich als offen führt, statt
sie wegzuraten. Teil von T1.5-8, Risiko 4 im Premortem.

### 3.5 Skill-/Agent-Overlay — Quelle ist das Zielprojekt, Default ist pro Projekt

**Entschieden (Nutzer-Rückfrage 1, keine offene Frage mehr):** Die Quelle ist
das **ausgewählte Zielprojekt selbst**, nicht eine hub-weite zentrale
Registry. Gescannt wird die Konvention, die dieses Repo selbst benutzt:

- `<projekt>/.claude/skills/<name>/SKILL.md` — YAML-Frontmatter mit `name` und
  `description` (real geprüft, z. B. `.claude/skills/bugfix/SKILL.md`)
- `<projekt>/.claude/agents/<name>.md` — YAML-Frontmatter mit `name`,
  `description`, `model` (real geprüft, z. B. `.claude/agents/hub-dev.md`)

Reale Zählung in `AncientVoid` zum Planungszeitpunkt: **11 Skills** mit
`SKILL.md` (`architecture-best-practices`, `bugfix`, `bug-report`,
`concept-phase`, `epic-creation`, `gates`, `git-workflow`, `messlauf`,
`ponytail-review`, `pr-review`, `retro`) und **3 Agents** (`epic-planner`,
`hub-dev`, `pwa-dev`). Der Scanner muss die realen Ausnahmen aushalten:
`.claude/skills/_shared/` enthält **kein** `SKILL.md` (Hilfsverzeichnis) und
`.claude/skills/README.md` sowie `.claude/skills/skill-template.md` sind keine
Skills. Alle drei dürfen nicht in der Liste landen.

**Zu „Workflows" (dritter vom Nutzer genannter Typ):** In diesem Repo existiert
**keine** verifizierte Workflow-Konvention — unter `.claude/` liegen genau
`agents/` und `skills/`, sonst nichts. Der Typ wird daher im Datenmodell
vorgesehen (`kind: "skill" | "agent" | "workflow"`), aber erst befüllt, wenn
eine reale Konvention belegt ist. Keine erfundene Verzeichnisstruktur.

**Entschieden (Nutzer-Rückfrage 2):** Der Default-Speicher „zuletzt gewählt"
ist **pro Projekt**, nicht global — Schlüssel z. B. `ancientvoid.skill.<projekt-id>`.
Speicherort ist gerätelokales `localStorage`, exakt wie der Filter-State aus
T1.6 (`packages/pwa/src/SessionTail.tsx`, `loadFilter()`): kein
Server-Roundtrip, überlebt Reload, ist von Natur aus gerätespezifisch.
Die Auswahl ist immer **sichtbar** und immer **überschreibbar** („so dass man
nicht immer auswählen muss aber kann").

**Die offene Kernfrage — und sie ist nicht kosmetisch:** *Wie wird „Nutzer hat
Skill X gewählt" dem darunterliegenden CLI-Prozess pro Adapter tatsächlich
mitgeteilt?* Beide Adapter haben dafür **strukturell verschiedene, hier nicht
verifizierte** Mechanismen:

- **claude:** Die `.claude/skills/`-Konvention ist Claude Codes eigene.
  Vermutlich erfolgt der Aufruf über einen Slash-Command-artigen Präfix im
  Prompttext oder über ein CLI-Flag — **beides unbestätigt**. Der Adapter
  setzt den Prompt heute als reines Positional-Argument (`claude -p "<prompt>"`,
  plus `--resume` beim Steer).
- **codex:** Kennt eine eigene, strukturell unverwandte `plugin`-/Profil-Welt
  (`codex --help` listet ein `plugin`-Subkommando). Eine 1:1-Entsprechung zu
  claudes Skills ist **nicht** belegt.

Die Annahme „ein einheitlicher Mechanismus funktioniert für beide" wäre genau
die Art von Vermutung, die T1.2/T1.3 bei den Event-Formaten schon einmal
widerlegt haben (P1-Retro, Erkenntnis 1). Deshalb: eigene Untersuchung an den
echten CLIs **vor** der Implementierung, Ergebnis als ADR — analog zu
ADR-0001s Rolle vor T3.1. Siehe T1.5-9; Premortem-Risiko 1.

### 3.6 Prompt-Composer als gemeinsame Komponente (und die Steer-Lücke)

Der Nutzerwunsch beschreibt **eine** Eingabefläche mit drei Ausgängen:
„Senden", „Diktieren", „Verbessern" und dem Overlay „Senden mit …". Diese
Fläche wird an zwei Stellen gebraucht:

1. Beim Anlegen einer Session (heute: `prompt`-Feld in `CreateSession`,
   `packages/pwa/src/App.tsx:122-129`)
2. **Als Folge-Prompt in einer laufenden Session** — heute schlicht nicht
   vorhanden: `packages/pwa/src/SessionTail.tsx` hat nur Filter-Chips, einen
   Zurück- und einen Stop-Button; `hubApi` (`packages/pwa/src/api.ts:51-73`)
   kennt `createSession`/`stopSession`, aber **kein** `steer`. Der Server
   kann es längst (`POST /api/sessions/:id/steer`), und `adapter-claude`
   implementiert `steer(prompt)` via `--resume` (T1.2), `adapter-codex` via
   `exec resume` (T1.3). Es fehlt nur der Client-Pfad.

Deshalb ist der Composer eine eigene, an beiden Stellen wiederverwendete
Komponente — und nicht zweimal derselbe Code.

## 4. Aufgaben

> **Task-ID-Konvention dieser Phase:** `T1.5-m` (Bindestrich), **nicht**
> `T1.5.m` — sonst kollidiert die Notation optisch mit P1s bereits vergebenem
> `T1.5` (Monitor-Dashboard).

- [x] **T1.5-1** **ADR: Account-Level-Usage-Modell** — entschieden, siehe
  [`docs/adr/0004-account-level-usage-quota.md`](../docs/adr/0004-account-level-usage-quota.md):
  ein hub-seitiger In-Memory-Cache pro Adapter-Id (Option c aus der Aufgabe),
  gespeist über ein neues optionales `usageQuota`-Feld auf
  `EmittedEvent`/`NormalizedEvent` (Muster von ADR-0003), **kein** Feld auf
  `SessionRecord`, bewusst nicht K7-persistiert (Begründung im ADR).
  `AdapterCapabilities` bekommt `usage: boolean` (claude: `true`, codex:
  `false` — real gegen die CLIs geprüft: `claude auth status --json` und
  `codex login status` bieten keinen On-Demand-Abfrageweg, nur das reale
  `rate_limit_event` im claude-Stream liefert die Daten). Optionen (a) neue
  Adapter-Methode `usage?()` und (b) `HealthReport`-Erweiterung wurden geprüft
  und explizit verworfen (Begründung im ADR: kein On-Demand-Weg bei beiden
  CLIs bzw. falscher semantischer Ort — `HealthReport` ist an ein
  `SessionHandle` gebunden, nicht an einen Account).
- [x] **T1.5-2** **Kontingent-Erfassung + `GET /api/adapters/:id/usage`.**
  `packages/contracts/src/event.ts`: neue `UsageWindow`/`UsageQuota`-Typen +
  optionales `usageQuota`-Feld auf `NormalizedEvent`/`EmittedEvent` (ADR-0004).
  `packages/adapter-claude/src/normalize.ts` zieht `unifiedWindows` jetzt
  strukturiert heraus (`normalizeUsageQuota()`), inkl. Unix-Sekunden→ISO
  (`toIsoTimestamp()`) und `overageAvailable`/`overageBlockedReason` aus
  `overageDisabledReason`/`isUsingOverage` — nie geraten, `undefined` wenn
  beide Signale fehlen. `AdapterCapabilities.usage` ergänzt (claude `true`,
  codex/dummy `false`). `packages/core/src/sessionmanager.ts`: neue
  `usageByAdapter`-Map (adapter-id-Schlüssel), aktualisiert in `emitEvents()`,
  **kein** Feld auf `SessionRecord`/SQLite — bewusst nicht K7-persistiert
  (Kommentar am Code). Neuer Endpunkt `GET /api/adapters/:id/usage`
  (`packages/server/src/routes.ts`) liefert `{adapterId, supported, quota,
  observedAt}` — `supported` aus `capabilities().usage`, `quota`/`observedAt`
  `null` solange keine Meldung vorliegt (nie 0 %). Getestet: real gegen die
  bestehenden Fixtures (`trivial-text.jsonl` enthält bereits einen echten
  `rate_limit_event`, kein neuer Capture nötig), SessionManager-Test beweist
  „keine Summierung, keine Überschreibung über Sessions hinweg falsch"
  (letzte Beobachtung gewinnt), Routen-Test für `supported:false`/`404`.
  98/98 Tests grün.
- [x] **T1.5-3** **PWA: Budget raus, Kontingent rein.** Budget-Eingabefeld aus
  `CreateSession` entfernt (`packages/pwa/src/App.tsx`) — Contract-Felder
  (`SessionSpec.budgetUsd`, `SessionRecord.budgetUsd`, `hubApi.createSession`s
  `budgetUsd`) unverändert, nur die Eingabe ist weg. Neue Kontingent-Zeile
  im Dashboard (`UsageRow` in `packages/pwa/src/Dashboard.tsx`): pro
  bekanntem Adapter entweder die Fenster-Auslastung (`5h X% · reset HH:MM ·
  7d X% · reset HH:MM`, `resetsAt` in lokaler Zeit), oder bei aktivem
  Overage-Block den Guthaben-Hinweis (`overageDisabledReason`), oder ein
  explizites „unbekannt (Adapter meldet kein Kontingent)" für Adapter ohne
  Datenlage (dummy, codex) — nie 0 %, nie eine leere Zeile. `App.tsx` holt
  `hubApi.adapterUsage(id)` für jeden bekannten Adapter im selben Poll-Zyklus
  wie Sessions/Adapter (kein zweiter Timer). **K10:** `packages/pwa/public/sw.js`
  cached jetzt auch `/api/adapters/:id/usage` (bisher nur `/api/sessions`) —
  die bereits bestehende globale „Daten vom … (offline)"-Anzeige
  (`main.tsx`, `ancientvoid:stale-data`) deckt die Kontingent-Zeile damit automatisch
  mit ab, kein zweiter, redundanter Alters-Indikator nötig.
  **Echt im Browser geprüft** (Playwright, nicht nur `vite build`): Create-Form
  zeigt kein „Budget" mehr, Dashboard zeigt reale Werte einer echten
  claude-Session (`5h 20% · reset 02:50 · 7d 36% · reset 10:00 ·
  out_of_credits`) neben ehrlichem „unbekannt" für dummy/codex —
  Screenshots verifiziert, dark theme und Handy-Breite intakt.
- [x] **T1.5-4** **`projectRoots` + Repo-Scanner + `GET /api/projects`.**
  `projectRoots: string[]` (Default `[]`) in `HubConfig`
  (`packages/core/src/config.ts`). Scanner (`packages/core/src/projects.ts`,
  `discoverProjects()`): Tiefe 1, nimmt auf, was ein `.git` enthält (Datei
  oder Verzeichnis — funktioniert auch für Git-Worktrees), liefert
  absoluten Pfad (dient direkt als `SessionSpec.project`, keine separate
  Id-Indirektion nötig), Anzeigename, Branch aus `.git/HEAD` (best effort,
  `null` bei detached HEAD). Nicht existierende/nicht lesbare Roots landen
  als Eintrag in `warnings[]` — geloggt einmal beim Hub-Start
  (`createHubApp()`) und zusätzlich in jeder `/api/projects`-Antwort, kein
  stiller Leerzustand (BUG-0009-Muster). **Sicherheitsteil umgesetzt:**
  `isProjectPathAllowed()` löst Symlinks beidseitig auf (`fs.realpath`) und
  prüft echte Pfad-Enthaltenheit — `POST /api/sessions` lehnt jeden Pfad
  außerhalb der konfigurierten Roots mit 422 ab, inklusive Symlink-Escape
  (ADR-0001-Muster). Leere `projectRoots` (Default) ändert das bisherige
  Verhalten nicht (jeder Pfad erlaubt). `hub.config.example.json` mit
  Beispiel/Doku-Kommentar ergänzt. Getestet: 9 Unit-Tests
  (`packages/core/test/projects.test.ts`, inkl. echtem Symlink-Escape-Fall)
  + 3 Routen-Tests (`packages/server/test/server.test.ts`: reale Discovery,
  Ablehnung außerhalb, Annahme innerhalb). **Live gegen echte Repos
  verifiziert:** `projectRoots: ["/mnt/.../arbeitsbaeume"]` fand alle 7
  echten Geschwister-Repos mit ihren tatsächlichen aktuellen Branches; ein
  echter `curl`-Versuch mit einem Pfad außerhalb wurde real mit 422
  abgelehnt.
- [x] **T1.5-5** **PWA: Projekt-Picker statt Freitext.** `CreateSession`
  (`packages/pwa/src/App.tsx`) lädt `hubApi.projects()` beim Öffnen des
  Formulars; bei ≥1 gefundenem Projekt ersetzt ein `<select>` (Anzeige
  „Name (Branch)") das Freitextfeld, erstes Ergebnis vorausgewählt (kein
  Tippen nötig). Bei leerer Liste (kein `projectRoots` konfiguriert, oder
  `/api/projects` nicht erreichbar) bleibt das ursprüngliche Freitextfeld
  als Rückfallebene, mit Hinweistext „keine Projekt-Wurzeln konfiguriert —
  siehe docs/configuration.md" (BUG-0006-Lektion: Onboarding-Pfade dürfen
  nie unerreichbar werden). **Echt im Browser geprüft** (Playwright, nicht
  nur `vite build`, P1-Retro Erkenntnis 2): `hub.config.json` mit
  `projectRoots` auf das echte Geschwister-Verzeichnis gesetzt, Dropdown
  zeigt real alle 7 gefundenen Repos mit ihren tatsächlichen Branches
  (`aSPARK (docs/metrics-third-machine)`, `custom-rag (dev)`, `AncientVoid
  (main)`, …) — Screenshot verifiziert, dark theme und Handy-Breite intakt.
- [x] **T1.5-6** **Prompt-Composer-Komponente + `hubApi.steer()`.** Neue
  `packages/pwa/src/Composer.tsx`: Textfeld + Aktionsreihe, eingesetzt an
  beiden Stellen aus §3.6 (Erstell-Formular in `App.tsx` **und** neu als
  Antwortfeld in `SessionTail.tsx`). `hubApi.steer()` ergänzt
  (`packages/pwa/src/api.ts`) — bewusst **nicht** über den generischen,
  werfenden `api<T>()`-Helper geführt, weil ein abgelehnter Steer
  (`{ok:false, detail}`, HTTP 422) sonst nur als nichtssagendes „422
  Unprocessable Entity" ankäme statt mit dem echten `detail`-Text; beide
  Fehlerformen (Ack-Ablehnung **und** Zod-Validierungsfehler `{error}`) auf
  eine gemeinsame `Ack`-Form normalisiert. Ehrliches Verhalten umgesetzt:
  `SessionTail` fragt `capabilities().steer` für den jeweiligen Adapter ab
  und zeigt das Antwortfeld nur, wenn es wirklich unterstützt wird; ein
  `ok:false` erscheint sichtbar als Fehlertext, wird nicht verschluckt.
  Mikrofon- und „Verbessern"-Knopf sind sichtbare, deaktivierte Platzhalter
  mit Tooltip auf T1.5-7/T1.5-8. **Layout-Fehler live gefunden und
  behoben:** ein erster Versuch (separates `position: fixed`-Element für
  den Composer) überlappte sichtbar die letzten Tail-Zeilen (Screenshot
  vor dem Fix) — behoben durch Zusammenlegen von Composer und
  Button-Reihe in einen gemeinsamen fixen Block
  (`.bottom-actions-column`) mit angepasstem Scroll-Bereich. **Echter
  Ende-zu-Ende-Beweis (AC-P1.5-7):** ein Folge-Prompt wurde über die
  echte PWA-UI an eine laufende `claude`-Session gesendet — die reale
  Antwort („CONFIRMED") erschien im Tail, Kosten korrekt verbucht
  ($0.0058), Session blieb `working` (BUG-0008-Fix hält).
- [x] **T1.5-7** **Spracheingabe (Browser-STT-MVP). 🟡 Code fertig, K6-Messung
  bewusst auf den Handy-Test verschoben.** Neue `packages/pwa/src/speech.ts`
  (`recognizeOnce()`, Web-Speech-API-Wrapper mit 10s-Timeout) + Mikrofon-Knopf
  in `Composer.tsx`. Transkript landet immer im editierbaren Feld
  (`onChange`), nie automatisch abgesendet. Sichtbarer Datenschutz-Hinweis
  während des Zuhörens ("Cloud-Dienst des Browsers"), kein stilles
  Aktivieren. Browser ohne API: deaktivierter Knopf mit Tooltip.
  **Realer Fund, der den Timeout überhaupt nötig machte:** diese
  Entwicklungsmaschine (Chromium 151, Arch-Paket statt echtem Google
  Chrome) hat die `SpeechRecognition`-Konstruktoren, aber ein echter
  `.start()`-Aufruf liefert nie ein Ergebnis (kein Google-API-Schlüssel in
  Open-Source-Chromium-Builds) — ohne eigenen Timeout bliebe die UI für
  immer im „höre zu…"-Zustand hängen. **Echt im Browser geprüft**
  (Playwright, drei reale Szenarien mit Screenshots): Zuhören-Zustand mit
  Hinweis, Timeout/Fehlerpfad (sichtbare Fehlermeldung statt Hängen),
  deaktivierter Zustand ohne API. **K6-Messung selbst bewusst nicht
  durchgeführt** — braucht eine echte Stimme an einem echten Mikrofon,
  die von hier aus nicht erzeugt werden kann; siehe
  [`docs/messlauf/2026-09-16-k6-stt-device-matrix.md`](../docs/messlauf/2026-09-16-k6-stt-device-matrix.md)
  für die Geräte-Fähigkeits-Matrix (T3.7s ursprünglicher Auftrag, hier
  eingelöst) und den expliziten Verweis auf den geplanten Handy-Test. Der
  Whisper.cpp-Pfad (P3 T3.6) bleibt out of scope, nur als Ausbaupfad
  vermerkt.
- [x] **T1.5-8** **Prompt-Enhancer.** Entscheidung aus §3.4 **mit echten
  Messungen getroffen, nicht per Annahme**: Weg (a), der aktuell gewählte
  Coding-Adapter selbst — Weg (b) (separates lokales Modell) hat schlicht
  keine Infrastruktur in diesem Repo (P3s Qwen-Finetune wurde nie gebaut),
  es gibt also nichts, wogegen man real messen könnte. Reale Zahl für
  claude (2026-09-16, `claude -p ... --output-format json --tools ""
  --dangerously-skip-permissions`): **6617 ms, $0,065402** für eine
  Umformulierung — ein echter, spürbarer Kontingent-Preis pro Klick.
  codex-Versuch am selben Tag traf real auf „you've hit your usage limit"
  (echter Beleg für genau das Szenario, das T1.5-2/3 sichtbar machen
  sollen) — kein echter codex-Wert vorhanden, Codepfad aber identisch
  implementiert. Neue `packages/server/src/enhance.ts`
  (`parseClaudeEnhanceOutput()`/`parseCodexEnhanceOutput()` als reine,
  testbare Funktionen, getrennt vom Subprozess-Aufruf — 7 Unit-Tests mit
  echten aufgezeichneten Ausgabeformen, kein Mocking von `child_process`
  nötig), neuer Endpunkt `POST /api/prompt-enhance` (400/422/502 real
  getestet, `packages/server/test/server.test.ts`). PWA: Split-Preview
  (roh|optimiert) inkl. Kosten/Latenz-Anzeige direkt am Ergebnis, „Original
  senden" bleibt erreichbar, Auslösung nur per Klick. **Kontingent-Sichtbarkeit
  bewusst anders gelöst als in T1.5-3s Aggregat-Anzeige:** der Enhancer läuft
  über `claude`s nicht-streamendes `--output-format json`, das gar kein
  `rate_limit_event` trägt (nur der Streaming-Modus tut das) — eine
  Einspeisung in ADR-0004s Cache hätte den vollen Streaming-Adapter-Pfad
  gebraucht, unverhältnismäßig für einen leichtgewichtigen Einzelaufruf.
  Stattdessen: Kosten/Latenz direkt am Ergebnis dieses einen Aufrufs
  sichtbar — eine bewusste, benannte Abwägung, keine stille Lücke.
  **Echter Fund während des Bauens:** der erste Versuch lief im
  Arbeitsverzeichnis des Hub-Servers selbst statt im ausgewählten Projekt
  (`claude`s eigene Projekt-Erkennung verriet die falsche Codebasis in der
  Antwort) — behoben durch Weiterreichen von `project` als `cwd`, mit
  demselben `isProjectPathAllowed()`-Schutz wie bei der Session-Erstellung.
  **Echt im Browser geprüft** (Playwright, echter `claude`-Subprozess über
  die UI ausgelöst): Split-Preview mit echten Werten
  („Verbessert · $0,0376 · 15,1s"), „Verbessertes übernehmen" ersetzt den
  Composer-Text korrekt. P3s Over-Engineering-Heuristik übernommen (kurze
  Imperative bräuchten keine Optimierung — hier nicht weiter umgesetzt,
  da außerhalb des Kern-Scopes). Learning-Loop-Storage bleibt in P3.
- [x] **T1.5-9** **ADR: Skill-/Agent-Invocation-Mechanismus pro Adapter** —
  entschieden, siehe
  [`docs/adr/0005-skill-agent-invocation-mechanism.md`](../docs/adr/0005-skill-agent-invocation-mechanism.md).
  Gegen die echten CLIs verifiziert (nicht aus Doku-Erinnerung): claude hat
  **zwei** echte, verschiedene Mechanismen — Skills über einen `/skill-name`-
  Präfix im Prompttext (live getestet: `claude -p "/bugfix ..."` lädt die
  Skill-Instruktionen nachweislich auch im nicht-interaktiven Modus), Agents
  über das `--agent <name>`-CLI-Flag (live getestet:
  `claude -p --agent hub-dev "..."` — die Antwort bestätigt selbst die
  aktive Persona). codex hat **kein** Gegenstück (`codex plugin list` zeigt
  ein global installiertes Marketplace-System, unabhängig vom Zielprojekt;
  kein `--skill`/`--agent`-Flag, kein projekt-lokales Konzept). Kein neuer
  Contract-Bruch nötig — beide Mechanismen laufen über das bereits
  bestehende `SessionSpec.args` (adapterspezifischer Freiraum). Offen und im
  ADR benannt: ob `--agent` bei einem `steer(prompt)`-Resume noch wirkt,
  bleibt vor T1.5-10s Umsetzung empirisch zu klären.
- [x] **T1.5-10** **Skill-/Agent-Overlay.** Zwei Teile, beide gebaut und real
  verifiziert. **(a) Scanner** (`packages/core/src/skills.ts`,
  `scanProjectSkills()`): liest `<projekt>/.claude/skills/*/SKILL.md` und
  `<projekt>/.claude/agents/*.md`, extrahiert `name`/`description` aus dem
  YAML-Frontmatter, ignoriert Verzeichnisse ohne `SKILL.md` (`_shared/`) und
  lose Dateien (`README.md`, `skill-template.md`). Ausgeliefert als
  `GET /api/skills?project=<pfad>` (`packages/server/src/routes.ts`), hinter
  demselben `isProjectPathAllowed()`-Schutz wie Session-Erstellung/Enhancer.
  Projekt ohne `.claude/` → leere Liste, kein Fehler (Testfall in
  `packages/core/test/skills.test.ts`). **Echter Fund während des Bauens:**
  ein Playwright-Screenshot der Overlay zeigte für `bug-report` die
  Beschreibung als wörtliches `>-` statt echtem Text — der erste
  zeilenbasierte Frontmatter-Parser kannte YAMLs gefaltetes Block-Scalar
  (`description: >-` mit eingerückten Folgezeilen) nicht. Sweep über alle 14
  echten Skill-/Agent-Dateien bestätigte: **nur `bug-report/SKILL.md`**
  nutzt dieses Format, die anderen 13 einzeiliges `key: value`. Behoben in
  `parseFrontmatter()` (erkennt `>`/`>-`/`|`/`|-`, sammelt eingerückte
  Folgezeilen, faltet bzw. erhält Zeilenumbrüche); Regressionstest gegen die
  echte Datei in `skills.test.ts` (`bug-report`s Beschreibung ≠ `">-"`, exakt
  der reale Text) plus ein synthetischer Fall. Nach Fix per echtem
  Server-Neustart + Playwright erneut geprüft: Overlay zeigt jetzt `bug-report`s
  vollen Text (Screenshot `/tmp/ancientvoid-pwa-verify/skill-overlay-open.png`).
  **(b) Overlay-UI** (`packages/pwa/src/SkillOverlay.tsx`, `SkillPicker`):
  Chip zeigt die aktuelle Auswahl **immer sichtbar** (auch bei geschlossenem
  Overlay), öffnet auf Tap eine Liste aller Skills/Agents mit Beschreibung,
  „Ohne Skill/Agent senden" bleibt jederzeit erreichbar. Zuletzt gewählter
  Eintrag ist **pro Projekt** vorbelegt (`localStorage`-Key
  `ancientvoid.skill.<project>`, Muster wie `loadFilter()` in `SessionTail.tsx`) —
  live per Playwright bestätigt: 14 Einträge sichtbar, Auswahl von `bugfix`
  persistiert, Chip zeigt `Skill: bugfix`. Für `codex` (kein belegter
  Mechanismus laut T1.5-9) zeigt der Picker ehrlich „für diesen Adapter nicht
  verfügbar" statt eines wirkungslosen Overlays — eine bestehende Auswahl wird
  beim Adapterwechsel weg von `claude` automatisch verworfen statt still
  weiterzuwirken. Die tatsächliche Übergabe an die CLI folgt exakt dem in
  T1.5-9 belegten Mechanismus (`SessionSpec.args` → `adapter-claude`s
  `withSkill()`/`--agent`). **Nachvollziehbarkeit im Tail (AC-P1.5-12):**
  `sessionmanager.ts`s `session.created`-System-Event trägt jetzt `args`; neu
  in `packages/pwa/src/SessionTail.tsx` ein dediziertes Rendering für dieses
  Event, das bei vorhandenem `args.skill`/`args.agent` ein Badge „Gestartet
  mit Skill: …"/„Agent: …" zeigt. Real verifiziert: Session mit `dummy`-Adapter
  und `args:{skill:"bugfix"}` über die echte HTTP-API angelegt, per Playwright
  im Tail bestätigt — `#1 · system session.created · Gestartet mit Skill:
  bugfix` erscheint sichtbar (Screenshot
  `/tmp/ancientvoid-pwa-verify/tail-skill-badge-scrolled.png`), kein Prompttext wurde
  dabei umgeschrieben. **Bewusste Scope-Entscheidung:** der
  Folge-Prompt-Composer in `SessionTail.tsx` (T1.5-6, `steer()`) bekommt
  **keinen** eigenen Skill-Picker. Begründung: `--agent` wirkt laut ADR-0005
  nachweislich nur beim initialen Spawn (nicht bei `--resume`), und
  `SteerInput` hat schlicht keinen Kanal für eine neue Pro-Turn-Skill-Wahl —
  ein Picker an dieser Stelle wäre entweder wirkungslose Dekoration oder
  hätte einen neuen Contract-Pfad gebraucht, den kein AC verlangt. `claude`s
  `steer()` wendet weiterhin automatisch den beim Start gewählten Skill erneut
  an (`withSkill()` in `adapter-claude/src/index.ts`, aus T1.5-9), das war
  bereits ausreichend. Gates nach Fix: `npm test` 134/134 grün, `npm run
  lint`/`npm run typecheck` sauber, `npm -w @ancientvoid/pwa run build`/`typecheck`
  sauber.
- [x] **T1.5-11** **Registrierung & Erreichbarkeit** (DoD-Teil, nicht Kosmetik).
  Alle Stellen aktualisiert: `projectRoots` dokumentiert in
  `packages/server/hub.config.example.json` (Inline-`$comment`) **und**
  einem neuen Abschnitt „Projekt-Wurzeln" in
  [`docs/configuration.md`](../docs/configuration.md) (Containment-Regel,
  Symlink-Sicherheit, Freitext-Fallback bei leerer Liste erklärt). Die neuen
  Endpunkte (`GET /api/adapters/:id/usage`, `GET /api/projects`,
  `POST /api/prompt-enhance`, `GET /api/skills`) sind im
  [`docs/architecture.md`](../docs/architecture.md)-Serverabschnitt gelistet,
  je mit zugehöriger Task-/ADR-Referenz; die ADR-Kurzform-Tabelle dort trägt
  jetzt auch 0004 und 0005. Die Kontingent-Fähigkeit ist eine neue Spalte in
  der README-Adapter-Status-Matrix (✓/—/`?`, mit Legende — nie geraten) und
  ein neuer Abschnitt „Kontingent-Fähigkeit" in
  [`docs/adapters.md`](../docs/adapters.md) (plus ein Abschnitt zur
  Skill-/Agent-Übergabe über `SessionSpec.args`, damit ein neuer
  Fremd-Adapter weiß, was von ihm erwartet wird, falls er das unterstützen
  will). Ehrlichkeitsklausel eingehalten: `claude` in der Matrix als ✓
  (real gemessen, ADR-0004), `codex` als — (verifiziert abwesend), alle
  ungebauten P3-Adapter als `?` statt eines geratenen Symbols.

## 5. Acceptance Criteria

- **AC-P1.5-1: 🟡 teilweise — Wert real bestätigt, aber noch nicht „vom Handy
  gestartet".** T1.5-3s Playwright-Lauf zeigt reale `unifiedWindows`-Werte
  einer echten `claude`-Session (`5h 20% · reset 02:50 · 7d 36% · reset
  10:00 · out_of_credits`), Prozentwert und Reset-Zeit direkt aus der
  Rohzeile abgeleitet (keine Umrechnung dazwischen, die verfälschen könnte).
  Was fehlt: dieselbe Session **vom Handy über Tailscale** gestartet, statt
  von der Entwicklungsmaschine aus — das ist Teil des noch ausstehenden
  Live-Phone-Tests (EPIC-DoD), nicht separat vorgezogen, um keinen
  AC-P1-1-artigen 🟡-Ausgang zu wiederholen, ohne ihn zu benennen.
- **AC-P1.5-2: 🟢 erfüllt.** Eine `codex`-Session zeigt an derselben Stelle wörtlich
  **„unbekannt"** mit abrufbarer Begründung — nie 0 %, nie 100 %, nie ein leeres
  Feld. Die CLI-Grenze (kein Quota-Event im `--json`-Stream, kein
  Quota-Subkommando) ist mit CLI-Version und Prüfdatum dokumentiert, analog zur
  Quellenangabe in `packages/adapter-codex/src/pricing.ts` (T1.11). Beleg:
  `Dashboard.tsx`s `UsageRow` (`supported:false` → „unbekannt (Adapter meldet
  kein Kontingent)"), Routen-Test in `server.test.ts`.
- **AC-P1.5-3: 🟢 erfüllt.** Im Erstell-Formular der PWA existiert kein Budget-Eingabefeld
  mehr (prüfbar per `grep -rn "budget" packages/pwa/src/ --ignore-case` → kein
  Treffer in einem Eingabe-Element). Gleichzeitig sind `SessionSpec.budgetUsd`
  und `SessionRecord.budgetUsd` in `packages/contracts/src/session.ts`
  unverändert und alle bestehenden Tests grün — die Entfernung ist eine
  UI-Änderung, **kein** Contract-Bruch. Beleg: T1.5-3s Playwright-Screenshot
  (Create-Form ohne Budget-Feld).
- **AC-P1.5-4: 🟢 erfüllt.** Mit `projectRoots: ["/mnt/data/30_repos/arch/arbeitsbaeume"]`
  listet `GET /api/projects` genau die direkten Unterverzeichnisse mit `.git`
  (u. a. `AncientVoid`, `custom-rag`) — kein Nicht-Repo, kein Eintrag aus Tiefe 2,
  kein Eintrag außerhalb der Roots. Ein nicht existierender Root erzeugt eine
  sichtbare Warnung statt einer stillen Leerliste. Beleg: T1.5-4s echter
  `curl`-Lauf gegen alle 7 echten Geschwister-Repos, `projects.test.ts` (9 Tests).
- **AC-P1.5-5: 🟢 erfüllt.** Bei gesetzten `projectRoots` wird ein `POST /api/sessions` mit
  einem `project`-Pfad außerhalb der Roots mit 4xx abgelehnt; ein Symlink
  innerhalb eines Roots, der nach außen zeigt, ebenfalls. Beides als Test.
  Beleg: T1.5-4s echter `curl`-Versuch (422 real beobachtet), Symlink-Escape-
  Testfall in `projects.test.ts`.
- **AC-P1.5-6: 🟢 erfüllt.** Eine Session lässt sich vom Handy **ohne Tippen eines Pfades**
  anlegen (Auswahl aus der Projektliste). Bei leerer/unkonfigurierter Liste
  bleibt der Hub bedienbar (Rückfall-Freitextfeld, BUG-0006-Lektion). Beleg:
  T1.5-5s Playwright-Screenshot (Dropdown mit 7 echten Repos + Branches).
- **AC-P1.5-7: 🟢 erfüllt.** In einer laufenden `claude`-Session wird aus dem Tail heraus ein
  Folge-Prompt abgesetzt → Server antwortet mit `ok:true` auf
  `POST /api/sessions/:id/steer`, und die Antwort des Agenten erscheint im
  Tail. (Heute unmöglich: die PWA ruft `steer` nirgends auf.) Ein `ok:false`-Ack
  wird als sichtbare Fehlermeldung angezeigt, nicht verschluckt.
- **AC-P1.5-8 (K6): 🟡 teilweise — Code fertig, Messung braucht das echte Handy.**
  20 Diktate aus einem fachbegriffslastigen Testsatz (`git`, `diff`,
  `worktree`, `JSONL`, `tool_use`, `Codex`, `Claude`, `tmux`, `MCP`) →
  Transkript in ≤ 1,5 s bei mindestens 90 % der Läufe, jedes Transkript vor
  dem Absenden editierbar (Editierbarkeit strukturell verifiziert, siehe
  T1.5-7). Die eigentliche Latenz-/Erfolgsquoten-Messung braucht eine echte
  Stimme an einem echten Mikrofon — nicht von dieser Entwicklungsmaschine
  aus durchführbar (siehe
  [`docs/messlauf/2026-09-16-k6-stt-device-matrix.md`](../docs/messlauf/2026-09-16-k6-stt-device-matrix.md)),
  bewusst auf den geplanten Live-Test auf dem Handy des Nutzers verschoben,
  nicht übersprungen oder vorgetäuscht.
- **AC-P1.5-9: 🟢 erfüllt.** Der Enhancer verwandelt eine vage Eingabe („mach das mit dem
  Login besser") in einen strukturierten Prompt mit Ziel/Scope/Constraints/
  Erfolgskriterium; die Split-Preview zeigt beide Fassungen, „Original senden"
  ist immer erreichbar, und die Optimierung läuft **nie** ungefragt. Das
  gewählte Enhancer-Backend ist mit Messwerten (Latenz, Kontingent-Wirkung)
  begründet dokumentiert.
- **AC-P1.5-10: 🟢 erfüllt.** Für das Projekt `AncientVoid` listet das Overlay genau die real
  vorhandenen Einträge: **11 Skills** (aus `.claude/skills/*/SKILL.md`) und
  **3 Agents** (aus `.claude/agents/*.md`) — ohne `_shared/`, ohne
  `.claude/skills/README.md`, ohne `skill-template.md`. Ein Projekt ohne
  `.claude/` liefert eine leere Liste mit Hinweis, keinen Fehler. Beleg:
  `packages/core/test/skills.test.ts` (Real-Inventar-Test, 8/8 grün),
  Playwright-Screenshot `skill-overlay-open.png` (14 Einträge live gerendert,
  inkl. korrekt gefaltetem `bug-report`-Text).
- **AC-P1.5-11: 🟢 erfüllt.** Nach einer Auswahl im Overlay ist derselbe Eintrag beim
  nächsten Öffnen **desselben** Projekts vorausgewählt und bei einem **anderen**
  Projekt nicht (Per-Projekt-Speicher, überlebt Reload). Die aktuelle Auswahl ist
  ohne Öffnen des Overlays sichtbar und lässt sich mit einer Interaktion ändern
  oder abwählen. Beleg: `SkillOverlay.tsx` (`ancientvoid.skill.<project>`-Key),
  Playwright `skill-selected.png` (Chip zeigt „Skill: bugfix" nach Auswahl,
  ohne Overlay sichtbar).
- **AC-P1.5-12: 🟢 erfüllt.** Nach dem Absenden ist im Tail nachvollziehbar, mit welchem
  Skill/Agent gestartet wurde (Chip oder System-Event). Für einen Adapter, für
  den T1.5-9 keinen Mechanismus belegen konnte, zeigt das Overlay „für diesen
  Adapter nicht verfügbar" — und es wird nachweislich **kein** Prompttext
  heimlich umgeschrieben. Beleg: `SessionTail.tsx`s dediziertes
  `session.created`-Rendering + `tail-skill-badge-scrolled.png` (Badge
  „Gestartet mit Skill: bugfix" real im Tail sichtbar, echte Session über die
  HTTP-API angelegt).
- **AC-P1.5-13 (K2, Regression): 🟢 erfüllt.** Die neuen Composer-/Overlay-/Kontingent-
  Elemente verschlechtern die in
  [`docs/messlauf/2026-09-15-k2-frame-lag.md`](../docs/messlauf/2026-09-15-k2-frame-lag.md)
  gemessene Tail-Performance nicht: 30 Events/s über 10 min, weiterhin kein
  Frame-Lag > 200 ms (Wiederholungslauf mit `scripts/k2-frame-lag.mjs`).
  Beleg:
  [`docs/messlauf/2026-09-16-k2-frame-lag-p1.5-regression.md`](../docs/messlauf/2026-09-16-k2-frame-lag-p1.5-regression.md) —
  18135/18135 gematchte Events unter Budget, median 4ms, max 19ms (vs. P1s
  median 3ms/max 8ms — leicht höher, aber ~10-fache Marge zum 200ms-Budget,
  keine Regression im Sinne des ACs).

## 6. Premortem

**Es ist Ende P1.5 und das Epic ist gescheitert. Warum?**

1. ***Das Skill-Overlay ist eine schöne Attrappe.*** Die Auswahl wird
   gespeichert, angezeigt, hübsch gerendert — aber der gewählte Skill erreicht
   den CLI-Prozess nie, weil der Mechanismus bei `claude` anders aussieht als
   vermutet und bei `codex` überhaupt nicht existiert. Der Agent arbeitet
   einfach so weiter wie ohne Auswahl, und niemand merkt es, weil das Ergebnis
   ja *irgendein* plausibler Output ist. Mitigation: T1.5-9 (echte Untersuchung
   an beiden CLIs + ADR) ist **harte Vorbedingung** für T1.5-10 — kein
   Overlay-Code vorher. Kein einheitlicher Mechanismus per Annahme (die
   P1-Retro-Erkenntnis 1 gilt hier doppelt: die vereinfachte Vorstellung war
   schon bei den Event-Formaten falsch). Wo kein Mechanismus belegbar ist, sagt
   die UI das ehrlich (Fail loud, AGENTS.md Regel 6) statt Prompttext zu
   basteln. Und AC-P1.5-12 verlangt, dass die Wirkung im Tail **sichtbar** ist —
   eine Attrappe fiele dort auf.
2. ***Das Kontingent landet doch als Feld auf der Session.*** Weil es der
   kürzeste Weg zur Anzeige ist, wandert `utilization` neben `costUsd` in den
   `SessionRecord` — und das Dashboard summiert es, wie es `costUsd` schon
   summiert (`packages/pwa/src/Dashboard.tsx:57`). Ergebnis: zwei parallele
   Sessions melden „86 % verbraucht", wo es real 43 % sind. Der
   `costUsd`-Overload, den AI-P1-4 bereits als Schuldposten führt, verdoppelt
   sich. Mitigation: T1.5-1 (ADR) vor jeder Zeile Code; das ADR muss die
   Abgrenzung zu ADR-0003 ausdrücklich enthalten; ein Test hält fest, dass ein
   Usage-Wert nirgends über Sessions summiert wird.
3. ***Die Kontingent-Anzeige bleibt leer und wirkt kaputt.*** Wie oft `claude`
   ein `rate_limit_event` schickt, ist **nicht** verifiziert — der eine reale
   Capture beweist, dass es vorkommt, nicht, dass es in jeder kurzen Session
   vorkommt. Bei einem 20-Sekunden-Turn sieht der Nutzer womöglich nie einen
   Wert und hält das Feature für defekt. Mitigation: Der Snapshot ist
   adapter-global und überlebt die einzelne Session, trägt sein Alter sichtbar
   („Stand: HH:MM") und sagt im Leerfall „noch keine Meldung von diesem Adapter"
   statt nichts. Niemals eine erfundene 0.
4. ***Der Enhancer frisst genau das Kontingent, das diese Phase sichtbar machen
   soll.*** Weg (a) aus §3.4 wird stillschweigend gewählt, weil er ohne neue
   Infrastruktur auskommt — und jede Prompt-Verbesserung kostet einen echten
   Modell-Aufruf aus derselben Subscription. Am Monatsende ist das Limit früher
   erreicht als vorher, ausgerechnet wegen des Features, das davor warnen sollte.
   Mitigation: Die Entscheidung ist in T1.5-8 **mit Messung beider Wege** zu
   treffen und zu dokumentieren; fällt sie auf (a), muss die Kontingent-Wirkung
   des Enhancers in T1.5-3s Anzeige auftauchen; Optimierung bleibt opt-in.
5. ***Die Projektliste wird zum Pfad-Escape.*** Der Picker ist gebaut, aber
   `POST /api/sessions` nimmt weiterhin jeden Pfad an, den ein Client schickt —
   und der Client ist ein Handy im Tailnet. Ein kompromittiertes Gerät startet
   einen Coding-Agenten mit Schreibrechten in `$HOME`. Mitigation: Die
   serverseitige Root-Prüfung ist **Teil** von T1.5-4, nicht ein Folgeticket;
   ADR-0001s Allowlist-Muster wird übernommen; AC-P1.5-5 testet Escape und
   Symlink-Escape.
6. ***Die Spracheingabe widerspricht dem local-first-Versprechen.*** Browser-STT
   schickt das Audio zur Erkennung an einen Cloud-Dienst — und ausgerechnet
   ein Projekt, dessen P3-Scope einen Egress-Test im CI vorsieht (AC-P3-6),
   baut sich damit einen Cloud-Pfad in die Eingabe. Mitigation: sichtbarer
   Hinweis in der UI, keine stille Aktivierung, der Whisper.cpp-Pfad (P3 T3.6)
   bleibt als dokumentierte lokale Alternative bestehen und wird in der
   Geräte-Matrix aus T1.5-7 als solche geführt; diese Phase erklärt Browser-STT
   ausdrücklich zum **MVP**, nicht zum Endzustand.
7. ***„Control-Center" wird zum Sammelbecken.*** Jeder weitere UI-Wunsch findet
   in dieser Phase ein Zuhause, weil sie ohnehin „die UX-Phase" ist, und P2
   verschiebt sich um Wochen. Mitigation: dieselbe Regel wie in P1
   (Premortem 4): jede Zusatz-UI braucht einen Task **und** einen
   Messlatten-Bezug (AGENTS.md Regel 5). Alles, was §2 „Out" nennt — Approvals,
   Diffs, Sprachsuche, Sprach-Direktiven, Learning-Loop —, bleibt draußen, auch
   wenn es „gerade gut passen würde".

## 7. Definition of Done

Alle ACs grün **und**:

- Beide ADRs (`docs/adr/0004-*` Account-Usage-Modell, `docs/adr/0005-*`
  Skill-Invocation-Mechanismus) existieren mit Status **entschieden** — nicht
  „offen", nicht nachträglich zur bereits gebauten Lösung geschrieben.
- Kontingent-Anzeige **mit Quellenangabe pro Adapter** (claude: nativ aus
  `rate_limit_event`, CLI-Version + Datum; codex: belegt „unbekannt", geprüfte
  CLI-Version + Datum) — dieselbe Ehrlichkeitsdisziplin wie bei T1.11s
  Preistabelle.
- **Erreichbarkeit ist Teil der Fertigstellung** (T1.5-11): `projectRoots` steht
  in `packages/server/hub.config.example.json` und `docs/configuration.md`, die
  neuen Endpunkte in `docs/architecture.md`, die Kontingent-Fähigkeit in der
  README-Status-Matrix und `docs/adapters.md`. Ein Feature, das nur im Code
  existiert und in keiner Konfiguration oder Matrix auftaucht, gilt als nicht
  fertig.
- Mindestens ein **echter Ende-zu-Ende-Lauf vom Handy** pro Kernfluss
  (Projekt auswählen → diktieren → optional verbessern → mit Skill senden →
  Antwort im Tail → Kontingent sichtbar), dokumentiert — damit diese Phase nicht
  denselben 🟡-Ausgang nimmt wie AC-P1-1/AC-P1-2 (P1-Retro: „nie als Live-Lauf
  ausgeführt", AI-P1-1).
- K6-Messlauf unter `docs/messlauf/` mit Prüfstand/Datum/Commit; K2-Regressions-
  lauf wiederholt und dokumentiert.
- `npm test`, `npm run lint`, `npm run typecheck` grün; kein TODO-Kommentar ohne
  Ticket-Referenz; Premortem-Mitigationen, wo testbar, als Tests abgebildet
  (mindestens: Root-Escape, Symlink-Escape, „Usage wird nie über Sessions
  summiert", Scanner ignoriert `_shared`/`README.md`/`skill-template.md`).

## Retro-Nachtrag Abnahmestand (2026-11-09)

Read-only-Abgleich der Epic-Datei gegen Repo-Stand (`git log`, Gate-Skripte, `epics/EPIC-P35-*.md` §8.1). Keine offenen MRs.

- **Status:** Code abgeschlossen, Geräteabnahme offen (T35.10/T35.11)
- **Belegt:** T1.5-1..11 abgehakt; Oberfläche durch P1.6 ersetzt
- **Offen:** AC-P1.5-1 Session vom Handy über Tailscale → T35.10; AC-P1.5-8 K6 mit echter Stimme → T35.11
- **Gating:** Nachfolger-Epics laufen unter der dokumentierten Umpriorisierung; die Restpunkte sind im P35-Endabnahme-Block gebündelt und werden dort abgenommen, nicht hier erneut abgehakt.
