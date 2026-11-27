# Adapter-Contract — eigene Provider, Coding-Tools & lokale Coding-Systeme

**Art:** referenz

Der Adapter-Contract ist die einzige Nahtstelle zwischen Hub und Fremdwelt.
Alles, was der Hub von einem Provider weiß, steht in
`packages/contracts/src/harness/adapter.ts`.

## Die fünf Fragen eines Adapters

| Frage | Antwort im Contract |
|---|---|
| Was kannst du? | `capabilities()` → `{reasoning, tools, cost, steer, usage}` |
| Wie startest du? | `start(spec, ctx) → handle` |
| Was passiert? | `ctx.emit(EmittedEvent)` — jederzeit, push-Modell |
| Wie steuert man? | `steer(handle, input, ctx) → Ack` (prompt/stop/park/resume) |
| Wie gesund bist du? | `status(handle) → HealthReport` |

Optional: `recover(sessionId, lastSeq, ctx)` — Reattach/Neustart nach
Hub-Crash (K7). Ohne `recover` gilt eine Session nach Crash als `error`
(sicher, aber nicht resilient).

## AdapterContext — das ganze SDK

[ADR-0076](adr/0076-session-aktivitaet-und-wiederaufnahme.md) ergänzt optional
`activity()` (strukturierte offene Arbeit), `interrupt()` (unbeabsichtigter
Laufverlust) und `turnActive` (Wiederanlauf eines offenen Hauptzugs).
`promptDelivery: "next-turn"` delegiert Folgeeingaben an die persistente
Hub-Queue. Adapter mit echtem Eingabekanal im laufenden Zug erklären zusätzlich
`midTurnInput: true` (Pi; claude via Streaming-Input-Prozess, ADR-0098) —
dann ist „jetzt lenken“ wählbar und `sendQueuedNow` liefert mitten im Zug.
Details: [Wiederaufnahme und Hintergrundarbeit](interrupted-sessions.md).

| Mittel | Zweck | Regel |
|---|---|---|
| `ctx.sessionId` | Identität | für `handle.sessionId` nutzen |
| `ctx.emit(event)` | Events senden | Hub setzt `seq`/`ts`; `summary` ≤ 200 Zeichen |
| `ctx.blob(data)` | Großes auslagern | alles > ~2 KB gehört in den Blob (K5) |
| `ctx.spawnWorker(cmd)` | Prozess starten | **nie** selbst `child_process` — nur über den Runner (attachbar, reapbar) |
| `ctx.log(level, msg)` | Diagnose | geht in Hub-Log, nie in den Event-Stream |
| `ctx.signal` | Stop/Park | muss jeden laufenden Fetch/Stream sofort abbrechen |
| `ctx.workdir` | Arbeitsverzeichnis | Projekt bzw. (ab P2) Worktree |
| `ctx.spawnWorker(cmd, { stdin: "pipe", persistent: true })` | dauerhafter Agent (JSON-RPC über stdio; claude Streaming-Input, ADR-0098) | Züge dann selbst mit `ctx.turn("working"/"idle")` melden (ADR-0013 Nachtrag) |
| `ctx.requestToolPermission(req)` | vor einem Tool fragen (T7.2) | Antwort `deny` heißt: nicht ausführen; nie selbst „immer erlauben“ |
| `ctx.permissionBridge()` | MCP-Brücke für CLIs, die per MCP fragen (claude `--permission-prompt-tool`) | Token darin nie loggen |

### ACP-Harnesses ohne eigenen Code

Jeder Agent, der das Agent Client Protocol spricht, läuft über
`@ancientvoid/adapter-acp` — nur Konfiguration:

```json
{ "id": "copilot-acp", "module": "@ancientvoid/adapter-acp", "config": { "preset": "copilot" } }
{ "id": "opencode-acp", "module": "@ancientvoid/adapter-acp", "config": { "preset": "opencode" } }
{ "id": "dsh", "module": "@ancientvoid/adapter-acp", "config": { "preset": "dsh" } }
{ "id": "mein-agent", "module": "@ancientvoid/adapter-acp", "config": { "command": ["mein-agent", "--acp"], "label": "Mein Agent" } }
```

**dsh (DeepSeek Harness, `dst` ist nur dessen Terminal-Oberfläche):** Der Hub startet
`dsh --profile acp`, der PC `dst` mit dem Profil `dsh-tui`. Beide Profile haben eigene Einstellungen
(`~/.dsh/profiles/<profil>/cordis.patch.yml`) und erben nichts voneinander. Damit Handy und PC
dieselben Provider und Modelle sehen, steht derselbe Provider-Block in beiden:

```yaml
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      zai:     { apiKeyEnv: ZAI_API_KEY }          # GLM-4.7 … GLM-5.3 (7 Modelle)
      google:  { apiKeyEnv: GEMINI_API_KEY }       # Gemini (23 Modelle)
      evo-local:                                    # llama.cpp auf gpubox, OpenAI-kompatibel
        displayName: Evo Local (gpubox)
        api: openai-completions
        baseURL: https://gpubox.tailnet-example.ts.net/v1
        apiKeyEnv: GPUBOX_API_KEY
        models: [{ id: halogen-qwen3.8-flash-next-uncensored-iq4xs, name: Halogen Qwen3.8 Flash, contextWindow: 216064, maxTokens: 65536, input: [text] }]
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config: { provider: zai, model: glm-5.3 }
```

Die Schlüssel stehen **nicht** im Patch, sondern in `~/.dsh/.env` (Modus 0600; `dsh` liest sie selbst, auch
ohne Variablen in der Shell oder im Hub-Dienst): `ZAI_API_KEY`, `GEMINI_API_KEY`, `GPUBOX_API_KEY`. Das
Rechte-Preset steht nur im PC-Profil (`danger-full-access`); der Hub setzt `DSH_PERMISSION_MODE=read-only`
und fragt am Handy. Die Modellliste (alle Provider und Modelle von dsh) holt der Adapter über ACP
`session/new`; den Default fürs Startformular setzt `"model": "zai/glm-5.3"` in der Adapter-Config.
Weitere Provider: dort ergänzen, den Schlüssel in `~/.dsh/.env` ablegen; sie erscheinen ohne Codeänderung.

**Nicht über dsh nutzbar:** Claude, Codex, Cursor und Copilot laufen über Abonnements ohne API-Schlüssel.
Sie sind im Hub eigene Adapter (`claude`, `codex`, `cursor`, `copilot`) und am Handy wie am PC verfügbar,
aber nicht als Provider in `dst`.

Ein Befehls-Framework ohne eigenes Binary (z. B. der SecureSight-Factory,
der als Slash-Commands in Claude-Code/opencode-Sessions lebt) wird als
eigene opencode-Instanz registriert — mit Default-Modell und damit
Modell-Dropdown im Startformular:

```json
{ "id": "securesight-factory", "module": "@ancientvoid/adapter-acp",
  "config": { "preset": "opencode", "label": "SecureSight Factory", "model": "zai-coding-plan/glm-5.3" } }
```

`model` ist der Default (im Dropdown vorausgewählt und markiert, läuft bei
Sessions ohne eigene Wahl); der Katalog kommt bei `… acp`-Agenten
automatisch über die `models`-Variante des Kommandos (opencode:
`opencode models` — glm-5.3 von zai und die Zen-Claude-Modelle), explizit
über `modelsCommand`.

Tool-Freigaben kommen als `session/request_permission` aufs Handy. Ob ein
Agent überhaupt fragt, ist seine Einstellung — das opencode-Preset setzt dafür
`permission: ask`; andere Agenten in `docs/harness-matrix.md` prüfen.

Ein laufender Zug, in dem der Agent für `stuckTurnMs` (Default 30 min,
`0` schaltet ab) keine Meldung mehr schickt, wird vom Hub abgebrochen
(`session/cancel`, danach notfalls erzwungen beendet) und als
`provider.error` sichtbar — wartende Tool-Freigaben zählen nicht als
stumm (BUG-0032).

`contextWindowTokens` (acp und claude, [ADR-0032](adr/0032-kontextfenster-transparenz.md)):
die Kontextfenstergröße der Modelle dieser Instanz, konfiguriert — kein
Harness meldet sie im Band. Der Input-Token-Anteil der letzten Anfrage
(`payload.usage.input` auf dem Zugende-Event) ist die gemessene Füllung;
die PWA zeigt daraus „Kontext x %" nur, wenn beide Zahlen echt sind.

**Je Modell statt je Instanz**: `@ancientvoid/models` pflegt eine kuratierte
Tabelle (`contextWindowFor`, Quelle models.dev — dieselbe Datenbank, die
opencode nutzt; Stand im Quellverlauf). Der Adapter legt das Fenster des
gewählten Modells auf sein `acp.model`-/`opencode.model`-Event
(`payload.contextWindowTokens`) — das gewählte Modell gewinnt gegen die
statische Capability. Einzelne Werte überschreiben oder ergänzen:
`"contextWindows": { "glm": 1000000 }` (Substring-Match auf Modell und
Rohwert). Wichtig z. B. bei GLM: glm-4.7 hat 204.800 Tokens, glm-5.2/5.3
1.000.000 — eine Zahl je Instanz wäre falsch. Unbekannte Modelle bleiben
ohne Fenster, die PWA zeigt dann keine Prozentzahl.

## Hermes Agent (CLI) — `@ancientvoid/adapter-hermes` (P13)

Hermes Agent (Nous Research) als vollwertiger CLI-Adapter — **ein Prozess
pro Zug** (Print-Modus, wie claude vor ADR-0098), native Resume über die
Session-ID.

```json
{ "id": "hermes", "module": "@ancientvoid/adapter-hermes",
  "config": { "command": "/pfad/zu/hermes", "extraArgs": [] } }
```

- **Spawn:** `hermes chat -q <prompt> --yolo -Q --pass-session-id`
  (Antwort auf stdout, `session_id: <sid>` auf stderr — im Hub-tmux-PTY
  aber interleaved im stdout-Pane-Capture; der Adapter parst deshalb
  stdout zeilenweise mit ANSI-Strip und nutzt stderr als Zweitquelle).
- **Resume:** erste `session_id:` wird `hermes.native_session`-Event;
  jeder Folgeprompt spawnt `hermes chat -q … --resume <sid>`. Adoption
  externer Sessions via `spec.adoptNativeSessionId`.
- **Antwort-Hygiene:** Warning-Zeilen (`Warning: …`, live per `od -c`
  verifiziert) und Resume-Chrome (`↻ Resumed session …`,
  `Model restored …`) werden herausgefiltert (in den Hub-Log geloggt),
  ANSI-Terminal-Queries und CRLF vom PTY werden gestrippt.
- **Modell:** optional `spec.model` als `model[:provider]` →
  `-m`/`--provider`; ohne Angabe gilt die hermes-eigene config.yaml
  (Provider-Unabhängigkeit).
- **Capabilities, ehrlich:** `tools` (läuft mit `--yolo`/bypass), native
  `nativeResume` (live verifiziert 03.10.2026), kein reasoning/cost/
  usage-Stream in `-Q`. Ein-Turn-Prozess: clean exit 0 = Zug beendet,
  Session idle — nicht down (BUG-0008-Lektion).
- **Live-Smoke (03.10.2026):** Session im Hub gestartet, saubere Antwort,
  native_session-Event, Resume-Steer mit Codewort-Rückruf erfolgreich,
  exit 0. Siehe `epics/EPIC-P13-hermes-adapter.md`.

## NormalizedEvent — die gemeinsame Sprache

Typen: `user | assistant | thinking | tool_use | tool_result | gate | error | system`.

- Provider-spezifische Events **müssen** gemappt werden; Unbekanntes →
  `system`-Event mit Hinweis (`adapter.degraded`-Muster), **niemals droppen**.
- Reasoning → `thinking` (komplett in Blob, Anker im Stream).
- Der Hub erzwingt K5 (Payload ≤ 4 KB) mechanisch — trotzdem bewusst emit-ten.

## Kontingent-Fähigkeit (`usage`, ADR-0004)

`capabilities().usage: boolean` sagt, ob ein Adapter jemals einen echten
`usageQuota` auf einem `NormalizedEvent` setzt (Account-Level-Fenster wie
claudes "five_hour"/"seven_day" — nicht pro Session, siehe
[ADR-0004](adr/0004-account-level-usage-quota.md)). `false` bedeutet
**verifiziert abwesend**, nie geraten — wenn eine CLI kein Quota-Signal im
Stream trägt (heute: `codex`), bleibt `usage: false` und die PWA zeigt
„unbekannt" statt eines erfundenen Prozentwerts. Ein Adapter darf `usage:
true` nur setzen, wenn er das Feld tatsächlich befüllt — sonst zeigt der Hub
eine Zahl, für die es keine Quelle gibt.

## Resume-Befehl deklarieren (`resume`, ADR-0036)

`capabilities().resume?: { argv, ref }` benennt den CLI-Aufruf, mit dem ein
Mensch die Session **außerhalb des Hubs** fortsetzt — Template mit
`{sessionId}`/`{token}`-Platzhalter, Anzeige-only (der Hub führt ihn nie
aus). Gilt nur mit Beleg gegen die installierte CLI-Version (Handlauf oder
Adapter-Nutzung + `--help`, in der MR beschrieben); ohne Beleg wird **nichts**
deklariert — das ist der ehrliche Zustand, kein Fehler. Das Adapter-Testkit
prüft die Form (nicht-leer, Platzhalter vorhanden, gültiges `ref`); `hubctl
show` und der „PC offen"-Hinweis rendern den Befehl. Beziehung zu
`nativeResume`: unabhängig — jenes beschreibt In-Hub-Steuerung, dieses die
Fortsetzung außerhalb.

**`hub: true` (ADR-0044, EPIC-P35 T35.3):** Der Adapter opt-in't zusätzlich in
das hub-seitige „Weitermachen" nach einer Unterbrechung. Voraussetzung: der
Adapter nimmt `start({ args: { resumeSessionId } })` **ohne Prompt** an und
bleibt dabei idle (kein Prozess, keinFake-Zug) — der nächste Prompt setzt die
native Session fort. Aktuell deklariert: claude, opencode, pi, copilot, hermes
sowie maki/omp über ACP (BUG-0101). codex nicht — `codex exec resume` braucht
einen Prompt; ACP-Presets ohne Beleg bleiben draußen. Die promptlose
Übernahme meldet jeder Adapter als sichtbares System-Event (fail loud); ein
gescheitertes Fortsetzen trägt eine erkennbare Provider-Ursache als
`provider.error` (T35.4). Live-Läufe je CLI nach Hub-Neustart: ausstehend
(Aufgabe AC-P35-3).

**Verlorene native ID (BUG-0126, ADR-0070):** Kennt der Agent die übergebene
`resumeSessionId` nicht mehr („Resource not found"), wirft der Adapter sie nicht
fatal — er meldet `acp.context_lost` (`lostSessionId`, `cause`) und startet eine
frische native Session; der Prompt läuft dort, die neue Bindung folgt dem
`acp.native_session`-Fold. Die PWA bietet dazu „Hier weitermachen (Kontext neu
aufbauen)" (`POST /api/sessions/:id/repair`: tote Bindung raus, Übergabe-Entwurf
als nächster Prompt) und die Übergabe an eine andere Session.

## Slash-Commands deklarieren (`commands`, ADR-0042)

Die [Harness-Matrix](harness-matrix.md) zeigt die deklarierten Commands und
ihren Geltungsbereich. `npm run check:adapter-matrix` prüft beides gegen die
Adapter-Factorys, einschließlich Codex Exec, ACP-Presets und Direktadapter.

| Adapter/Harness | Evidenz für den getriebenen Modus |
|---|---|
| Claude | `/clear` und `/compact` sind für Headless dokumentiert. Claude Code 2.1.330 hat beide Befehle im Stream-JSON-Modus in einer leeren Session ohne Modellzug akzeptiert. Der Browser-Test prüft den Dispatch mit der Claude-Attrappe. |
| Codex App Server | `thread/compact/start` und `contextCompaction` sind im App-Server-Protokoll deklariert. Der Browser-Test prüft Aufruf, Abschluss und den folgenden Prompt. |
| Pi | Pi 1.6.0 hat über RPC mit synthetischer Historie und lokalem Testendpunkt eine Compaction in der verifizierten Session-Datei persistiert. |
| Aider | Aider 0.86.2 hat `/clear`, `/reset`, `/tokens` und `/add` mit `--message` ausgeführt. Der Versuch nutzte eine synthetische Datei und einen lokalen Dummy-Endpunkt. |
| ACP Copilot | 1.0.114 meldet `/compact` und `/usage` beim Start einer leeren ACP-Session. |
| ACP OMP | 19.1.1 meldet und verarbeitet `/fresh` und `/compact`. `/fresh` startet einen neuen Provider-Kontext. `/compact` wurde ohne Modell aufgerufen und meldete den fehlenden Modellzugang. |
| ACP OpenCode | OpenCode 2.1.4 hat `/compact` live ausgeführt und dabei Start und Abschluss gemeldet ([BUG-0192](../bugs/bug-0192-slash-commands-nicht-bei-allen-anbietern.md)). |
| ACP Maki | `bridgeCommands: true` aktiviert ausschließlich `/new` über einen neuen ACP-Session-Start. Die frühere init.lua-Brücke setzt ACP-Kommandos nicht zuverlässig um. |
| Direktadapter | `/compact` kürzt die nächste Anfrage. [ADR-0115](adr/0115-nativer-compact-und-direktadapter.md) beschreibt den Settings-Schalter und die Messung. |

Der Composer filtert Vorschläge nach dem Geltungsbereich. Der Hub lehnt
`/compact` bei fehlender Unterstützung ab. Andere unbekannte Slash-Eingaben
können mit einem Hinweis als Prompt gesendet werden. Für zusätzliche native
Befehle ist ein Nachweis im tatsächlich getriebenen Modus erforderlich.

## Skill-/Agent-Übergabe (`SessionSpec.args`, ADR-0005)

Es gibt **keinen** eigenen Contract-Kanal für „starte mit Skill X" — jeder
Adapter, der Skills/Agents unterstützt, liest sie aus dem bereits
bestehenden `SessionSpec.args` (adapterspezifischer Freiraum) selbst aus und
entscheidet, was das für seine CLI bedeutet (siehe
[ADR-0005](adr/0005-skill-agent-invocation-mechanism.md) für die beiden
echten, unterschiedlichen `claude`-Mechanismen). Ein Adapter ohne
verifizierten Mechanismus **ignoriert** `args.skill`/`args.agent` nicht
still — er emittiert ein sichtbares `system`-Event, das die Wahl als
wirkungslos meldet (Fail loud, `AGENTS.md` Regel 6), siehe
`packages/adapters/codex/src/index.ts`.

## Config-Validierung

Adapter-Config kommt aus `hub.config.json`. Validiere sie beim
Factory-Aufruf (zod o. ä.) und fail laut — der Hub surface-t den Fehler beim
Start und markiert den Adapter als nicht geladen.

## Testen (Pflicht vor Integration)

```bash
npm i @ancientvoid/adapter-testkit
```

```ts
import { runContractTests, assertContractGreen } from "@ancientvoid/adapter-testkit";
import { createAdapter } from "./adapter.ts";

const results = await runContractTests(createAdapter);
assertContractGreen(results);
```

Die Suite prüft: Identität, Capabilities, Handle-Lebenszyklus,
Event-Schema-Validität, Health, Stop, Recovery-Signatur. Grün = der Hub kann
deinen Adapter laden — ohne dass der Hub dich kennt.

> **Bekannte Lücke (BUG-0004):** `runContractTests()` kann aktuell keinen
> Adapter prüfen, der `ctx.spawnWorker` aufruft — sein interner Kontext
> wirft dort immer. Betrifft jeden echten (nicht-synthetischen) Adapter.
> Workaround, bis das behoben ist: eigene Lifecycle-Tests direkt auf
> `makeRecordingContext({ spawnWorker: ... })` — siehe
> `packages/adapters/claude/test/adapter.test.ts` oder
> `packages/adapters/codex/test/adapter.test.ts` als Vorlage.

## Fixtures aufzeichnen (T1.4)

Ein Adapter-Mapping wird gegen echte, aufgezeichnete CLI-Streams getestet,
nicht gegen geratene Feldnamen — beide bisherigen Adapter (`claude`,
`codex`) wurden so gebaut, und beide zeigten dabei Abweichungen von der
ursprünglich angenommenen Event-Struktur.

```bash
node scripts/capture-adapter-fixture.mjs \
  --out packages/adapter-<name>/test/fixtures/<fall>.jsonl \
  -- <cli-kommando mit JSON-Streaming-Flag>
```

Das Skript (siehe Kopfkommentar für Details):

1. führt das Kommando aus und fängt stdout ab,
2. anonymisiert Home-Verzeichnis und Socket-Pfade,
3. scannt das Ergebnis auf secret-ähnliche Strings und **verweigert das
   Schreiben**, falls etwas auffällt (Fund muss von Hand geprüft werden),
4. schreibt erst dann die Datei.

Ein sauberer Scan heißt „nichts hat auf ein bekanntes Secret-Muster
gepasst" — nicht „nichts Sensibles enthalten". Datei vor dem Commit lesen.

In Tests: `checkFixture(path, normalizeFn)` aus `@ancientvoid/adapter-testkit`
lädt die Fixture, wendet den Normalizer auf jede Zeile an und prüft jedes
Ergebnis-Event gegen den `NormalizedEvent`-Contract (Schema, Summary-Länge)
— das ist der geteilte Teil dieses Musters. Die Mapping-Logik selbst bleibt
pro Adapter in dessen eigener `normalize.ts` (T1.1: mit nur zwei echten
Adaptern ist die tatsächliche Schnittmenge ~15 Zeilen generisches
String-Handling, keine eigene Bibliothek wert).

## Laden: drei Wege

1. **Lokale Datei/Ordner**: `"module": "./adapters/my-provider/adapter.ts"`
   (relativ zur Config-Datei).
2. **npm-Paket**: `"module": "ancientvoid-adapter-foo"` — exportiere
   `createAdapter`.
3. **Fork/PR**: Adapter nach `packages/adapter-<id>/`, Registrierung als
   Built-in + Eintrag in der README-Status-Matrix (ehrlich: `unproven`, bis
   Fixtures + Contract-Tests grün sind).

## Custom-Provider ohne Code (EPIC-P35 T35.8, ADR-0054)

Ein neuer Provider/ein neues Modell braucht **keinen Adapter-Code**, wenn ein
vorhandener Adapter das CLI erreicht. Zwei Pfade:

**1. ACP-fähige CLI** — zweite Registration desselben Adapters mit eigenem
Kommando und Label (live belegt 07.11.2026: „Mein Zweit-OpenCode“ auf
`opencode acp`, Session antwortete regulär):

```json
{
  "id": "mein-agent",
  "module": "@ancientvoid/adapter-acp",
  "config": {
    "command": ["<cli>", "acp"],
    "label": "Mein Zweit-OpenCode",
    "envFiles": { "ZHIPU_API_KEY": "~/.config/ancientvoid/glm-coding.key" },
    "stuckTurnMs": 600000
  }
}
```

`command` ersetzt das Preset (copilot/opencode/dsh/maki/omp); `label` Name im
Startformular; `envFiles` hält Schlüssel aus der Config draußen. Der Eintrag
erscheint wie jeder Adapter, mit den ehrlichen Fähigkeiten des Protokolls
(ohne Beleg deklariert ACP kein hub-Resume — oben nachlesen).

**2. Modell-Katalog ohne Code** — `modelsCommand` (ADR-0054) für claude,
codex, pi, copilot, hermes und opencode: ein Kommando, das ein Modell pro
Zeile druckt (`provider/modell` oder nackte Id, optionales Label nach Tab):

```json
{ "id": "pi", "module": "@ancientvoid/adapter-pi",
  "config": { "model": "gpubox/…", "modelsCommand": ["pi", "models"],
              "contextWindows": { "flash-next": 65536 } } }
```

pi braucht dafür keine Config mehr: ohne `modelsCommand` listet es `pi --list-models`
(ADR-0060). **Eigene Modelle und Endpunkte** legt die App an („＋ Eigenes Modell /
Endpunkt“ am Modell-Dropdown): ein Eintrag im Hub-Register (alle oder gewählte
Harnesses) bzw. für pi ein Provider in `~/.pi/agent/models.json` — siehe ADR-0060.

**Anmeldung über Env (Nutzerwunsch 27.11.2026):** `pi --list-models` und `/model`
zeigen nur Provider mit nutzbarer Anmeldung — z.ai/GLM ist in pi eingebaut, taucht
aber ohne Schlüssel nie im Katalog auf. Der pi-Adapter nimmt deshalb `env` und
`envFiles` (wie ACP; Wert aus der Datei, `~/` aufgelöst — Schlüssel nie in der
Config) und reicht sie an jedes pi-Kommando durch, Listing wie Züge:

```json
{ "id": "pi", "module": "@ancientvoid/adapter-pi",
  "config": { "envFiles": { "ZAI_API_KEY": "~/.secrets/zai.key" } } }
```

Damit listet `pi --list-models` die zai-Modelle von selbst (GLM-4.7 … GLM-5.4),
wählbar im Startformular und lauffähig in den Sessions — ohne `pi /login` auf
dem Host. Alternativ bleibt `pi auth login zai` (OAuth/Key in
`~/.pi/agent/auth.json`) oder ein Provider-Eintrag in `models.json`.

## Modellanbindung je Harness (Nutzerentscheid 27.11.2026)

claude, cursor und codex laufen bewusst auf ihren Standard-Modellen (Abonnement-
CLIs, keine Config-Fläche). Alle modellflexiblen Harnesses folgen **einem** Muster:
Credentials per `env`/`envFiles` (Variable → Datei, `~/` aufgelöst — Schlüssel nie
in der Config), Katalog und Züge laufen mit derselben Env:

| Harness | Modelle erscheinen über | Beispiele lokal + Cloud |
|---|---|---|
| pi | `pi --list-models` (Provider mit Anmeldung) | Cloud: `ZAI_API_KEY` (GLM-4.7 … 5.4); lokal: Provider in `~/.pi/agent/models.json` (z. B. gpubox, llama.cpp, Ollama — `openai-completions`, baseUrl) |
| ACP: dsh, maki, omp | Agent-Antwort der ACP-Session (`probeModelCatalog`) bzw. `modelsCommand` | Keys je Agent, z. B. `ZHIPU_API_KEY`/`ZAI_API_KEY` via `envFiles`; dsh-Provider in dessen eigener Config (`apiKeyEnv`) |
| opencode | `opencode models` (konfigurierte Provider) | Cloud: Keys der Provider aus `~/.config/opencode/opencode.json` via `envFiles`; lokal: Ollama/Llama-Provider in der opencode-Config |
| aider | kein List-Kommando verifiziert — Auswahl über das Hub-Register (ADR-0060), freie Eingabe | Cloud: litellm-Keys (`ZAI_API_KEY`, `OPENROUTER_API_KEY`) via `env/envFiles`, Modell `zai/glm-5.3`; lokal: `apiBase`/`apiKeyFile` auf Ollama/gpubox, Modell `openai/<id>` |

Fehlt die Anmeldung, scheitert der Zug sichtbar beim Provider (ADR-0054/0060 —
nie ein Ersatzmodell). Session-eigene Env (`spec.env`) gewinnt überall über die
Config-Env.

Ohne `modelsCommand` bleibt die Modellwahl sonst freie Eingabe (Durchreichen an die
CLI — ein unbekanntes Modell scheitert sichtbar beim Provider, nie still als
Ersatzmodell). `contextWindows` (opencode, pi) schlägt die kuratierte
Tabelle aus ADR-0032. Die Abgrenzung zu P30 (Plugin-Distribution) und P31
(kurativer ACP-Katalog mit Probe) steht in ADR-0054.

## Anti-Patterns (Review-Blocker)

- Imports aus `@ancientvoid/core` / `@ancientvoid/server` oder direkter Dateisystem-Zugriff
  auf Hub-Daten.
- Eigenes `child_process.spawn` statt `ctx.spawnWorker`.
- Polling-Schleifen ohne `ctx.signal`-Abbruch.
- `capabilities()`, die mehr verspricht als der Code hält.
- Secrets in Events, Logs oder Config-Defaults.
