# Architektur

**Art:** erklaerung

Stand: 2026-11-23. Basis: PRD §4 und `epics/EPIC-P0-hub-kern.md` ff.; Epics
bis P56 (Statistik) und strukturrelevante Nachfolger (u. a. Teams P60,
Live-Deltas ADR-0083) sind eingearbeitet, soweit sie Struktur verändern —
fachliche Details und Verlauf leben in `epics/` (Index: `epics/README.md`).
Diese Doku beschreibt den umgesetzten Stand; Abweichungen = ADR-Pflicht. Der
P0-Grundriss gilt weiterhin, die Abschnitte „Erweiterungen“ fassen zusammen,
was seitdem dazugekommen ist, ohne den Grundriss neu zu schreiben.

## Topologie

```
Handy (PWA) ── Tailscale serve (HTTPS, keine öffentlichen Ports) ──> Hub-Daemon (Node, loopback)
                                                                      │
                                                          ┌───────────┴───────────┐
                                                     AdapterRegistry        WorkerRunner
                                                     (dummy, eigene …)      (tmux default, process fallback)
                                                                              │
                                                                    data/sessions/<id>/
                                                                    events.jsonl · snapshot.json · blobs/
```

## Code-Struktur (ADR-0020)

Modularer Monolith, nach Fach geschnitten. Jedes Modul hat eine `index.ts`
als einzige Schnittstelle; `npm run check:arch` (im Gate) prüft die Grenzen.

```
apps/                            lauffähige Programme
  hub/            (@ancientvoid/hub)        app.ts, routes.ts, modules/<modul>/<modul>.routes.ts + Dienste, platform/
  pwa/            (@ancientvoid/pwa)        app/ (Rahmen, Styles), features/<feature>/, shared/
  hubctl/         (@ancientvoid/hubctl)     CLI (auch `npm run hubctl`)
  gateway-mcp/    (@ancientvoid/gateway-mcp) MCP-Sidecar, nie vom Hub gestartet
  companion/      (@ancientvoid/companion)  Desktop-Companion (P11, ADR-0031): Diktat ins fokussierte Fenster
  site/           Promo-Seite (GitHub Pages, ADR-0082)
packages/                        Bibliotheken
  contracts/src/<modul>/         Verträge
  core/src/modules/<modul>/      aimetrics, approvals, attachments, automations,
                                 browser, code, commands, connections,
                                 custom-models, desktop, devices, diagnostics,
                                 discovery, fleet, forge, gatekeeper, git-graph,
                                 graph, handover, harness, hostmetrics, identity,
                                 inference, issues, knowledge, loops, media,
                                 notifications, observability, push,
                                 release-notes, reporting, reviews, runs, search,
                                 sessions, skills, statistics, team, vault,
                                 workspace
  core/src/platform/             db, eventstore, config, logger, metrics
  workers/                       WorkerRunner (tmux, process)
  adapters/<name>/               acp, aider, claude, claude-clip, codex, copilot,
                                 cursor, cursor-clip, dummy, hermes, jsonrpc,
                                 opencode, pi, testkit
  loops/<name>/                  austauschbare Loop-Connectoren (P19, ADR-0038):
                                 aspark-factory, ralph, ralph-hub (ADR-0110),
                                 securesight-factory
  models/                        Modell-Metadaten (Context-Fenster je Model-Id,
                                 ADR-0032)
```

Neuer Code: erst das Modul bestimmen, dann dort ablegen. Innerhalb eines
Moduls teilen sich große Klassen nach Verantwortung auf (Beispiel
`core/modules/sessions`: `session-manager.ts` orchestriert,
`approval-flow.ts` und `budget-guard.ts` sehen ihn nur über eine schmale
Host-Schnittstelle).

Beispiel für ein Modul, das nur liest und misst: `core/modules/inference`
(EPIC-P79, ADR-0102) beprobt lokale Inferenz-Engines (Strata, Halogen,
llama.cpp) in eigener Folge als `aimetrics` (P59) — Request-Historie als JSONL
(K7, quellen-getaggt), Perzentile über eigene Requests, Gegenwerte nur als
Gegenwerte. `null` heißt „Engine meldet nicht“ und wird nie zu `0`; die Antwort
ist vertraglich gekappt (12 Request-Zeilen, 120 Verlaufspunkte, 8 Hinweise).

Gleiche Bauart, anderer Gegenstand: `core/modules/hostmetrics` (EPIC-P81,
ADR-0117) misst den Rechner, auf dem der Hub läuft (`/proc`, hwmon, GPU, RAPL);
ein Host ohne Hub kommt als rein lesende SSH-Quelle dazu. Jeder Hub speichert
seinen eigenen Verlauf in `hostmetrics.db` (gestuft, 90 Tage); der Home-Hub führt
Peers erst beim Lesen zusammen. Die Datei ist entbehrlich: defekt wird sie
beiseitegelegt und neu begonnen (K7).

## Pakete & Abhängigkeitsrichtung

```
@ancientvoid/contracts   ← @ancientvoid/core ← @ancientvoid/hub → PWA (nur HTTP/WS)
       ↑              ↑
       ├── @ancientvoid/workers (WorkerRunner-Implementierungen)
       ├── @ancientvoid/adapter-* (packages/adapters/<name>)
       ├── @ancientvoid/adapter-testkit (Contract-Suite für Fremd-Adapter)
       ├── @ancientvoid/loop-* (packages/loops/<name>, via Loop-Contract)
       └── @ancientvoid/models (Modell-Metadaten)
```

Regeln:

- Abhängigkeiten zeigen **nur zu contracts**, nie quer zwischen
  Implementierungspaketen.
- Adapter (auch Fremd-Adapter) importieren ausschließlich `@ancientvoid/contracts`.
- Der Hub kennt Adapter nur über die Registry (Built-ins + dynamisches Laden).

## Kernkomponenten

### EventStore (`@ancientvoid/core`)

- Kanonisch: `data/sessions/<id>/events.jsonl`, append-only, eine Zeile pro
  `NormalizedEvent`.
- **K5-Enforcement:** serialisierter Payload > 4 KB → kompletter Payload in
  `blobs/<sha256>`, im Stream bleibt Anker (`{truncated, bytes, preview}`) +
  `blob_ref`. Adapter können vorher selbst via `ctx.blob()` auslagern.
- **Durability:** gebatchtes fsync (alle 100 ms oder 50 Events) — gerade
  genug für kill -9 ohne I/O-Thrashing bei 30 ev/s (Premortem P0-3).
- `replay()` überspringt defekte/torn Zeilen (Crash-Resilienz).

### SessionManager (`@ancientvoid/core`)

- Lifecycle-Statusmaschine: `idle → starting → working → waiting_approval →
  parked → stopping → stopped / error` (illegale Transitionen werfen).
- Jede Zustandsänderung ist `system`-Event + Snapshot (`snapshot.json`).
- `recoverAll()` (K7): SQLite-Rows + JSONL-Replay + optional
  `adapter.recover()` + tmux-Orphan-Reaping. Restore-Ziel < 3 s.
- Adapter bekommen nur `AdapterContext` — emit/blob/spawnWorker/log/signal
  plus `stream` für transient Live-Frames (ADR-0083, nicht JSONL).
- **Stop vs. Native-Binding (K7):** `stop()` bricht das Session-Signal ab,
  bevor der Worker-Exit-Flush ankommt. Events mit `nativeSessionId` werden
  nach dem Abort weiter journalisiert (Resume-Griff bleibt erreichbar);
  andere Post-Abort-Drops werden geloggt, `shuttingDown` verwirft weiter
  alles.

### AdapterRegistry (`@ancientvoid/core`)

- Built-ins (`dummy`) + `hub.config.json`-Einträge, dynamisch geladen via
  `import()` (relativer Pfad → File-URL; sonst npm-Package-Name).
- Shape-Check beim Laden (`createAdapter(config)` vorhanden?) — kaputte
  Adapter failen laut beim Hub-Start.

### WorkerRunner (`@ancientvoid/workers`)

- `TmuxRunner` (Default): Session `ancientvoid-<sessionId>`, `remain-on-exit` +
  `respawn-pane` (race-frei), Output via `pipe-pane` in Log-Datei (getailt),
  Exit-Marker `__ANCIENTVOID_EXIT__<code>`, attach-fähig für Notfall-Debug.
- `ProcessRunner` (Fallback ohne tmux): plain child_process, kein
  Restart-Überleben — explizit dokumentierter Trade-off.

### Hub (`@ancientvoid/hub`, `apps/hub`)

- Fastify, REST (`/api/health`, `/api/adapters`, `/api/sessions*`,
  `/api/tokens*` — die vollständige, gewachsene Routenliste lebt in
  `apps/hub/src/modules/` als SSOT, hier nur der P0-Kern) + WS
  `/api/events/:id/tail`.
- **T1.5-3/ADR-0004:** `GET /api/adapters/:id/usage` — Account-Level-
  Kontingent-Schnappschuss (ein Wert pro Adapter, nicht pro Session), aus
  `SessionManager.usageByAdapter` (In-Memory, nicht K7-persistiert, nicht
  über Sessions summiert). `supported:false` statt geratenem Wert für
  Adapter ohne Quota-Signal (heute: `codex`).
- **T1.5-4:** `GET /api/projects` — Host-Projekt-Erkennung aus
  `projectRoots` (`docs/configuration.md`), Tiefe 1, `.git`-Filter.
- **T1.5-5:** `POST /api/sessions` lehnt einen `project`-Pfad außerhalb der
  konfigurierten `projectRoots` mit 4xx ab (`isProjectPathAllowed()`).
- **T1.5-8:** `POST /api/prompt-enhance` — Prompt-Umformulierung über den
  bereits gewählten Coding-Adapter selbst (kein separates Modell, siehe
  EPIC-P1.5 §3.4), läuft mit `cwd` im Zielprojekt, hinter demselben
  Containment-Schutz wie Session-Erstellung.
- **T1.5-10/ADR-0005:** `GET /api/skills?project=<pfad>` — Skills/Agents aus
  `<projekt>/.claude/skills/` + `.claude/agents/` plus Workflows aus
  `.claude/workflows/` (`scanProjectSkills()`), gleicher Containment-Schutz.
  `POST /api/prompt-recommendation` wählt danach einen Treffer oder einen
  Entwurf, ohne zweiten Modellaufruf. `POST /api/skills` legt die Datei an
  und überschreibt nichts.
- Auth-Hook: Device-Token (Bearer/Query), optional Tailnet-Identitätszwang
  (`Tailscale-User-Login`-Header). `/api/health` bleibt offen.
- **WS-Delta-Protokoll (ADR-P0-4):** `hello{lastSeq}` → nummerierte
  `events`-Batches mit `highWater`; Client erkennt Lücken → `resync{since}`;
  **drop-on-slow**: Socket-Puffer max 100 Events, ältere werden gedroppt und
  `dropped:true` gesetzt → Client resynct. Kein Backpressure-Lag (K2).
- Statisches Serving der gebauten PWA (`pwaDir`), SPA-Fallback.

### PWA (`@ancientvoid/pwa`)

- Preact + Vite, dark-first, Thumb-Zone-Aktionen unten.
- Session-Liste (Auto-Refresh), Session-Tail mit gerätelokalen Filtern
  (localStorage), WS-Gap-Resync, Reconnect mit Backoff.
- Service Worker: Network-First für `/api/sessions`, Fallback auf Cache mit
  `X-AncientVoid-Cached-At` → Badge „Daten vom <Zeitstempel>" (K10).

## Persistenz-Schema (SQLite, `node:sqlite`)

- `sessions` (id, adapter, project, worktree_sha, model, status, created_at,
  budget_usd, adapter_version, last_seq)
- `device_tokens` (token_hash, label, created_at, last_used_at) — Plaintext
  wird genau einmal bei `token issue` gezeigt.
- `config` (key, value) · `_migrations` (Runner: `BEGIN/COMMIT` pro Migration).

## Erweiterungen (Zusammenfassung, Details in den jeweiligen Epics/ADRs)

Seit P5 ist die Fläche stark gewachsen; die Epics sind der fachliche
Fahrplan (Index: `epics/README.md`, Stand je Datei: `npm run
epics:status`). Struktur-relevant seitdem: Fleet/Multi-Host (P6,
Verbindungen + Invite-Pairing), Discovery & Session-Übernahme (P5/P22/P24:
hubctl-Sessions fremder Harnesses erkennen und adoptieren), Loops (P19,
ADR-0038: `packages/loops/*` als Connectoren hinter dem Adapter-Contract),
Automations-Host (P41), Vault/Notizen (P49), Datei-Galaxie (P52, vorher Repo-Graph P48,
ADR-0062), Git-Commit-Graph (ADR-0071),
Forge-Integration GitLab (P37), Browser-Testarbeitsplatz (P39,
ADR-0059), Desktop-Flächen (P18/P34, Companion P11/ADR-0031),
Live-Deltas über `ctx.stream` (ADR-0083, transient am WS-Tail),
Statistik-Modul + Rollup (P56, ADR-0079), Agenten-Teams (P60,
ADR-0077), einheitliche UI-Bausteine unter `shared/ui` als einzige Form der
Button-/Form-Sprache (P63), Terminal-Tab mit Allowlist-SSH und den installierten Login-Shells über den Hub —
keine nativen PTY-Module (ADR-0087), Volltextsuche über Sitzungen und Doku
auch über gekoppelte Hubs (`core/modules/search`) und Status-Sounds rein clientseitig als
WebAudio-Synthese, ohne Contract-Änderung und ohne Assets (P65),
Mehrsprachigkeit nach ADR-0101: typisierte Textkataloge statt Framework —
PWA in `apps/pwa/src/shared/i18n/`, serverseitiger Push-Katalog in
`packages/core/src/modules/notifications/i18n/`, `de` als Einzelsprungmarke,
`en` typgeprüft dagegen; `check:i18n` mit Baseline-Ratchet (P61) prüft zusätzlich, dass jeder literal benutzte `t("…")`-Schlüssel im de-Katalog steht — Parität allein fängt keinen Löschcommit, der einer Seite ihren Titel nimmt (P79).

### Adapter-Flotte (P1/P3)

`claude`/`codex` (P1, CLI-Streams normalisiert), `opencode`/`aider` (P3,
reale CLIs — `aider` ohne Strukturformat, ein `assistant`-Event pro Turn),
`deepseek`/`local-llm` (P3, über den generischen
`examples/adapters/openai-compat/`-Adapter konfiguriert, kein eigenes
Package). `swarm` bleibt real unimplementiert — siehe
[ADR-0001](adr/0001-swarm-adapter-context.md)s Nachtrag: die reale
`custom-rag`-API ist seit der ursprünglichen Notiz weitergezogen, und das
reale Event-`kind`-Vokabular war in der verfügbaren Zeit nicht auffindbar
— kein geratenes Mapping gebaut. Aktueller, generierter Stand aller
Adapter-Fähigkeiten: `npm run check:adapter-matrix` (T3.11) gegen die
README-Tabelle.

### Worktree-Isolation & Diff-Engine (P2, T2.1/T2.2)

Jede Session mit einem echten Git-Projekt bekommt ein eigenes
`git worktree` auf einem `ancientvoid/<sessionId>`-Branch, gepinnt an den echten
`base_sha` (`@ancientvoid/core`s `WorktreeManager`) — `SessionRecord.worktreeSha`
trägt diesen Wert, `AdapterContext.workdir`/`spawnWorker`'s `cwd` zeigen
auf den Worktree, nicht mehr auf den rohen Projektpfad. Ein Nicht-Git-Pfad
ist ein ehrlicher, sichtbarer Fallback (`session.no_worktree_isolation`),
kein stiller Bruch. Die Diff-Engine (`apps/hub/src/modules/sessions/diff.ts`) diff't
gegen diesen echten `base_sha`, liefert strukturierte Hunks mit gits
eigener Funktions-Anker-Heuristik, und kollabiert Hunk-Bodies unter K3
(> 50 KB) — real gemessen `< 50 KB` für eine echte ~2-MB-Diff (T2.9).
**Offene, benannte Lücke:** die Diff-Ansicht gruppiert nach Datei, nicht
nach Commit-Grenzen (AC-P2-1 nur teilweise erfüllt, siehe EPIC-P2 §5).

### Approval-System (P2, T2.4/T2.5/T2.8, ADR-0007/ADR-0008)

Drei Klassen (`read` frei, `write` Tipp-Bestätigung, `destructive`
WebAuthn-Biometrie) über `ApprovalService` (`packages/core/src/
modules/approvals/approvals.ts`) + `WebAuthnStore`/`apps/hub/src/modules/identity/webauthn.ts` (echtes
`@simplewebauthn/server`, keine eigene Krypto). `SessionManager.steer()`
parkt ein `prompt`-Steer als `write`-Approval, sobald ein
`ApprovalService` konfiguriert ist (`hub.config.json`s
`requireStepApprovals`, Default **aus** — die Kern-Chat-Interaktion ändert
sich nur nach bewusstem Opt-in). `destructive`-Entscheidungen laufen
ausschließlich über eine echte, verifizierte WebAuthn-Assertion
(`ApprovalService.decideBiometric()`), nie über den einfachen
HMAC-Signatur-Pfad der `write`-Klasse. Jede Entscheidung — genehmigt oder
abgelehnt — landet als `session.approval_decided` auf dem Session-Tail
(T2.8, „wer-wann-was").

### BudgetState (P2, T2.7, ADR-0008)

`SessionManager` warnt bei 80 % Budget (`session.budget_warning`, kein
echter Mobile-Push — keine Push-Infrastruktur vorhanden, ehrlich als
System-Event geführt) und parkt hart bei 100 %
(`session.budget_exceeded`). **Fail-closed real erzwungen**: `parkFor()`
sendet ein echtes `SteerInput{kind:"park"}` an den Adapter, bevor der
Hub-Status wechselt — ein früherer Fund zeigte, dass ein frei laufender
Adapter (z. B. ein echter CLI-Prozess) ohne dieses Signal einfach
weiterlief und weiter Kosten produzierte. `SessionRecord.parkReason`
(`"manual" | "budget" | "daily_cap"`) unterscheidet, ob ein
Budget-Top-up eine Session automatisch fortsetzen darf. Ein hub-weiter
Tages-Cap (`HubConfig.dailyCapUsd`) parkt bei Überschreitung jede laufende
Session, nicht nur die auslösende.

### MCP-Gateway-Sidecar (P4, T4.6/T4.7)

`@ancientvoid/gateway-mcp` — ein separater, **nie vom Hub selbst gestarteter**
Prozess (`apps/hub/src/main.ts` importiert ihn nicht, AC-P4-5:
default aus). Exponiert genau drei Meta-Tools (`hub_search`/
`hub_describe`/`hub_exec`, echtes `@modelcontextprotocol/sdk`) gegen eine
feste Operationen-Liste (`apps/gateway-mcp/src/operations.ts`) —
bewusst ohne `approvals.decide` und ohne Session-`create`/`stop`/`park`
(siehe dessen eigener Doku-Kommentar). `hub_exec` auf einer
`write`-Operation nutzt echt dieselbe ADR-0007-Freigabe wie jeder andere
Client, kein Sonderpfad. K4 (statische Manifest-Größe < 1000 Tokens) real
gemessen: 306 Tokens.

## Entscheidungs-Log (ADR-Kurzform)

| ADR | Entscheidung | Warum |
|---|---|---|
| P0-1 | Node statt Python; Fastify + ws | agent-bus-DNA, nativer WS/PWA-Stack |
| P0-2 | JSONL (Wahrheit) + SQLite (Indizes) | grep-/diff-able, Brain-kompatibel |
| P0-3 | tmux hinter `WorkerRunner` | attachbar, Restart-Überleben, gpubox-Fallback möglich |
| P0-4 | PWA ist Projektions-Renderer | Deltas + Seq + Resync statt Client-State-Monolith |
| P0-5 | Node-Strip-Types ohne Build | keine Parameter-Properties/Enums; `node src/main.ts` läuft direkt |
| P0-6 | `node:sqlite` statt better-sqlite3 | keine native Dependency, Node ≥ 22.5 |
| [0004](adr/0004-account-level-usage-quota.md) | Kontingent ist Account-, nicht Session-Zustand | ein `claude`-Limit gilt fürs ganze Konto, nicht pro Session — Summieren wäre falsch |
| [0005](adr/0005-skill-agent-invocation-mechanism.md) | Skill/Agent-Übergabe pro Adapter verifiziert statt angenommen | `claude` hat zwei echte Mechanismen (`/skill`-Präfix, `--agent`-Flag), `codex` keinen — beide laufen über `SessionSpec.args`, kein Contract-Bruch |
| [0003](adr/0003-event-cost-field.md) | `costUsd` optional auf `EmittedEvent`/`NormalizedEvent` | providerneutrale Kosten-Summierung ohne Adapter-Interna zu kennen |
| [0006](adr/0006-session-tokens-est-aggregation.md) | `tokensEst` nach demselben Muster wie `costUsd` | dasselbe Summierungs-Bedürfnis, ein zweites Mal auftauchend |
| [0007](adr/0007-approval-service-contract.md) | Approval-Signatur ist ein HMAC über den rohen Device-Token (write), nie eine Bool-Attrappe | ADR-0007 begründet, warum das kein Behelfs-Downgrade ist, bis T2.5s WebAuthn für `destructive` übernimmt |
| [0008](adr/0008-session-park-reason.md) | `SessionRecord.parkReason` unterscheidet manuell/budget/Tages-Cap | ein Budget-Top-up darf nur eine wegen Budget geparkte Session automatisch fortsetzen |
| [0087](adr/0087-pwa-terminal-ssh.md) | Terminal im Browser führt Shells über Allowlist-Konfiguration, nie über freie Client-Hostnamen | kein natives PTY-Modul; Auth und Containment bleiben beim Hub |

Neue Architekturentscheidungen: `docs/adr/` + PR.
