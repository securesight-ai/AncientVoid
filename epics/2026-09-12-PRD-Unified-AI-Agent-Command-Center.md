# PRD AncientVoid
## Product Requirements Document & Optimierte Systemarchitektur

**Version:** 1.0 · **Datum:** 12.09.2026 · **Status:** Freigabe angefragt — keine Umsetzungsentscheidung getroffen
**Auftraggeber:** Jan Pfrommer · **Erstellt von:** Perplexity AI (Systemic Review + PRD-Synthese)
**Vorgänger:** Machbarkeitsstudie AncientVoid (Agent-Host/Hermes, 11.09.2026)
**Kontext:** 3 Systeme (Omarchy, home-server, gpubox), Subscription-Tools (Codex, Cursor, z.ai, Copilot), lokale Modelle (llama.cpp, Qwen-Finetunes), bestehende Infra (Hivemind-Brain, Tailscale, handcam-Relay, bunker.ai-RAG, securesight-swarm)

---

## 0. Über dieses Dokument

**Planungserweiterung 2026-09-21:** Der neue Nutzerauftrag verlangt zusätzlich
vollständige externe Session-Discovery, echte PC↔Handy-Kontinuität, AI für alle
Eingaben sowie die Prüfung systemweiter Sprach-/Desktop-Steuerung.
[Audit und Zielmatrix](../docs/remote-control-audit-2026-09-21.md) und
[P5–P12](README.md) beschreiben diese Erweiterung. Das ursprüngliche
Supervisions-Nichtziel in §1.3 und Cursor-read-only in §5 beschreiben den
bisherigen Scope; P11 plant eine explizite Erweiterung, keine bereits
verfügbare Fähigkeit. Bestehende Messlatten und Umsetzungsgates bleiben bestehen.

**Planungserweiterung 2026-11-24 (Nutzerentscheid):** Mehrere Menschen dürfen über gekoppelte,
selbst betriebene Hubs zusammenarbeiten ([EPIC-P83](EPIC-P83-team-kollaboration.md)). §1.1 und §2
beschreiben weiter den bisherigen Einzelnutzer-Scope; „kein Cloud-Dienst, kein öffentlicher Port“
bleibt, als privater Weg sind neben Tailscale auch WireGuard und LAN vorgesehen. Geplant, nicht verfügbar.

Dieses PRD konsolidiert die Machbarkeitsstudie vom 11.09.2026 mit einer kritischen MCP-vs.-CLI-Recherche (zusammengefasst in Abschnitt 3) zu einem umsetzungsfähigen Produktdokument. Es ersetzt keine Engineering-Spezifikation, definiert aber alle Produktfunktions- und Architekturentscheidungen, die Messlatten und das Provider-Mapping.

**Drei wesentliche Korrekturen gegenüber dem Vorbericht:**

1. **MCP wird nicht mehr als positive Eigenschaft, sondern als kontextökonometrisches Problem behandelt.** Interne Hub-Kommunikation bleibt CLI/stream-json; MCP erscheint ausschließlich als lazy-disclosed Gateway mit 2–3 Meta-Tools.
2. **Das Event-Volume-Problem wird explizit spezifiziert.** Session-Streams werden byte-gecapped, Roh-stdout geht in ein Blob-Verzeichnis, die PWA sieht nur projizierte Anker — nie Volltext.
3. **Messlatten sind First-Class-Requirements (§9), nicht Beispiele.** Kein Feature ohne quantifizierbares Erfolgskriterium.

---

## 1. Vision, Ziele, Nicht-Ziele

### 1.1 Vision
Ein local-first, vendor-neutrales Command Center, in dem Jan vom Handy aus alle Coding-Agenten auf allen eigenen Maschinen sieht, ihnen spricht und ihnen zustimmt — mit perfektem Workflow-Feeling, minimalem Kontextverbrauch und voller Datenhoheit.

### 1.2 Ziele
- **G1** Jeder Agent, jeder Rechner, jeder Projekt-Workspace: überwachbar, steuerbar, auditierbar — vom Handy, ohne Laptop.
- **G2** Stimme als Primärinterface; Tippen als Fallback, Tastatur als Ausnahme.
- **G3** Kontext-Budgets werden erzwungen, nicht empfohlen. Jede Komponente hat eine Token-/Byte-Obergrenze.
- **G4** Der Hub läuft auf jedem Rechner autonom. Handy-Trennung stoppt nichts.
- **G5** Open-Source-Kern ohne Brain-Interna; Brain bleibt optionaler Reporting-Sink.

### 1.3 Nicht-Ziele
- **Kein Ersatz für Desktop-IDEs.** Der Hub ersetzt keine Editier-Erfahrung, sondern die mobile Supervision.
- **Kein GUI-Automation-Hack für Cursor als Kernpfad.** Lesen ja, Steuern nein.
- **Kein Cloud-Dienst.** Tailscale-only, kein öffentlicher Port, keine Telemetrie nach außen.
- **Kein Hermes als Runtime.** Hermes ist Skill-Nutzer des Hubs, nicht dessen Prozess.

---

## 2. Personas & Kern-User-Stories

### 2.1 Personas
- **P1 — Der mobile Kontrolleur (Hauptpersona):** Jan unterwegs, 6″-Display, einhändig, will wissen: „Läuft der Refactor? Darf ich approven? Was hat Codex gebaut?"
- **P2 — Der Architekt am Schreibtisch:** Gleiche Daten, breiter angezeigt, mehr Tiefe — aber das System wurde mobil gedacht, Desktop profitiert davon.
- **P3 — Der Agent selbst:** Claude Code, Codex, der Swarm — validierte, schema-basierte Clients des Hubs, nie freie Shell.

### 2.2 Kern-User-Stories
- **US-1:** Ich drücke auf den Mikro-Button, sage „Refactore den Auth-Flow in Projekt X, nutze den Swarm, Budget 5 $", sehe den Prompt optimiert zurückgespiegelt und tippe „Los".
- **US-2:** Ich öffne eine laufende Session, sehe sofort: Modell, Laufzeit, Kosten, letzte Aktion, wartet auf nichts / wartet auf mich.
- **US-3:** Eine Approval-Anfrage kommt als Push; ich sehe den Diff komprimiert, tippe auf die Datei, sehe Hunk für Hunk, approviere biometrisch.
- **US-4:** Ich frage per Sprache: „Wo ist die Rate-Limit-Logik implementiert?" — die Suche läuft lokal über bunker.ai-RAG, ich bekomme drei Dateien mit Zeilen-Ankern.
- **US-5:** Ich schalte Thinking-Ausgaben ab, weil ich nur die Tool-Calls sehen will; der Filter bleibt gerätebezogen gespeichert.
- **US-6:** Der Hub einer Box meldet: „Adapter down"; ich bekomme eine Push-Meldung, nicht nur einen grauen Status.

---

## 3. MCP vs. CLI — die kontextökonomische Entscheidung

### 3.1 Ausgangshypothese aus dem Briefing
„CLI ist immer besser als MCP, sofern man es sinnvoll einsetzen kann, da MCP-Server den Context aufblähen. Der Kontext muss präzise gehalten werden, der State der Dokumente muss erhalten bleiben."

### 3.2 Empirische Evidenz (Recherche 12.09.2026)

| Messung | Wert | Quelle (Auswahl) |
|---|---|---|
| Schema-Tax pro MCP-Tool | ~200–800 Tokens (dokumentierte Schemas), bis ~1.400 Tokens | mcp.directory, bex.co, GitHub MCP Spec Discussion #2812 |
| Typische Server-Bundles | ~17.600 Tokens (GitHub-MCP allein); 67.300 Tokens (7 Server) | usewire.io, mcp.directory |
| Anteil eines 200K-Fensters vor der ersten User-Nachricht | 60–80 % in Enterprise-Deployments | agentmarketcap.ai, bex.co |
| CLI vs. MCP bei identischer Aufgabe | 1.365 Tokens (CLI) vs. 44.026 Tokens (MCP) | blog.mornati.net |
| Faktor MCP→CLI je Messreihe | 4×–32× (Firecrawl), bis 137× (Mornati) | firecrawl.dev, blog.mornati.net |
| Anthropic-Code-Execution-Pattern (Tools als Dateisystem) | 150K → 2K Tokens (−98,7 %) | anthropic.com/engineering/code-execution-with-mcp |
| MCP Tool Search / Lazy Loading | Reduktion der Token-Kosten um 60–99 % | chatforest.com, contextpush.com |

### 3.3 Präzisierte Position (notwendige Korrektur zum Vorbericht)

**Die Hypothese ist überwiegend bestätigt, aber zu absolut formuliert.**

- **Richtig ist:** Native MCP-Server mit vollem Tool-Manifest sind kontextökonomisch für lokale, budgetierte Modelle inakzeptabel, wenn ~10–30 % des Kontextes für Schemata draufgehen, die der Agent zu 95 % nicht nutzt.
- **Zu kurz greift:** „CLI ist immer besser." CLI verlagert das Problem: ein unkontrolliertes `grep -r` oder `git log` kann 50K Tokens stdout in den Kontext kippen — schlimmer als jedes MCP-Schema. Die Disziplin kommt bei CLI nicht gratis, sondern nur durch Harness-Trunkierung, `--help`-Lazy-Loading und Output-Policies. MCP erzwingt per Design strukturierte, kleine Antworten; CLI erzwingt gar nichts.
- **MCP bietet strukturelle Vorteile, die CLI nicht hat:** standardisierte Capability-Negotiation, Elicitation (Server fragt gezielt beim Menschen nach), Interop — Cursor, Claude Code, Codex, Copilot sprechen MCP, keiner spricht „unser Hub-CLI mit unseren Flags".

**Gewählte Strategie: CLI-First innen, MCP als Lazy-Disclosed Gateway außen.**
- Adapter-Kommunikation im Hub: direkte CLI/Stream-JSON-Integration (kein MCP dazwischen).
- Der Hub exponiert sich nach außen (an IDEs, an andere Agenten) nicht als MCP-Server mit vollem Katalog, sondern als **Meta-Tool-Gateway** mit höchstens 2–3 Tools:
  - `hub_search` — semantische Suche über verfügbare Hub-Operationen
  - `hub_describe <op>` — Schema on demand
  - `hub_exec <op> <args>` — Ausführung mit Argument-Validierung
- Gesamtkosten dieses Gateways: < 1.000 Tokens statisch; < 300 Tokens pro Lookup.
- Alle übrigen MCP-Server auf den Agenten-Hostsystemen unterliegen derselben Budget-Regel: Lazy Loading oder Deaktivierung, Schema-Budget < 5 % des Modellkontextes.

---

## 4. Systemarchitektur

### 4.1 Topologie (gewählt: Hub-and-Spoke, PWA-Frontend)

```
┌─────────────┐        Tailscale (kein öffentlicher Port)        ┌──────────────┐
│   Handy     │ ◄── WebSocket (Events, Deltas) ── REST/WS ──────► │  PWA (SPA)   │
│  (PWA)      │                                                    │  served from │
└─────────────┘                                                    │   any Hub    │
     │ haptisch, biometrisch, Mikro                                └──────────────┘
     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ HOST: Omarchy / home-server / gpubox                                      │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                        AGENT-HUB DAEMON (Node.js oder Python)           │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────────┐ │  │
│  │  │ SessionMgr  │  │ AdapterMgr  │  │ BudgetMgr    │  │ EventStore      │ │  │
│  │  │ (Lifecycle) │  │ (Contracts) │  │ (harte Caps) │  │ (JSONL + Blobs) │ │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └────────────────┘ │  │
│  │  ┌─────────────────────────────────────────────────────────────────────┐ │  │
│  │  │                    ADAPTER REGISTRY                                │ │  │
│  │  │  codex | claude | copilot | swarm | zai | cursor-clip (read-only)   │ │  │
│  │  └─────────────────────────────────────────────────────────────────────┘ │  │
│  │  ┌─────────────┐  ┌──────────────────────────┐                            │  │
│  │  │ tmux-Worker │  │ Optional: MCP Gateway    │  (hub_search/describe/exec)│  │
│  │  │  (1/Session)│  │  (lazy, <1K tokens)      │                            │  │
│  │  └─────────────┘  └──────────────────────────┘                            │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
        │                    │                        │
        ▼                    ▼                        ▼
   bunker.ai-RAG       git worktrees            securesight-swarm
   (Projekt-Index)     (Session-Isolation)      (eigene Event-API)
```

### 4.2 Kernkomponenten

**1. Hub-Daemon (pro Rechner)**
- Sprache: Node.js (TypeScript) — bewährtes Muster aus agent-bus, native PWA/^WS-Stacks.
- Prozess-Modell: ein Daemon, beliebig viele Session-Worker (jeweils eigener tmux-Worker).
- Kaltstart < 2 s; Idle-Footprint < 80 MB.
- Persistenz: SQLite (Sessions, Budgets, Config) + JSONL-Event-Streams (append-only, checksummed).

**2. Adapter Registry**
- Jeder Adapter implementiert ein Contract-Interface:
  - `start(sessionSpec) → sessionHandle`
  - `poll() → NormalizedEvent[]`
  - `steer(input) → Ack`
  - `status() → HealthReport`
  - `capabilities() → {reasoning: bool, tools: bool, cost: bool, steer: bool}`
- Contract-Tests laufen gegen Mock-CLIs (Record/Replay). Formatbrüche werden als separater Status `adapter.broken` sichtbar, niemals still.

**3. Session-Store (State-Disziplin)**
- Jedes Session-Objekt ist rekonstruierbar aus: JSONL-Stream + Snapshot-Record (Worktree-SHA, Modellversion, BudgetState, Adapter-Version).
- Rohdaten (stdout/stderr, große Tool-Outputs) landen in `blobs/<session_id>/`, referenziert über Hash + Offsets im JSONL — **der kanonische Stream bleibt klein und präzise.**
- Überlebensregel: Hub-Restart = alle Sessions wiederherstellbar, PWA sieht exakt denselben Zustand.

**4. MCP Gateway (optional pro Hub)**
- Implementiert als schlanker Sidecar-Process.
- Katalog: nur die 3 Meta-Tools (siehe §3.3).
- CLI-optimiert: kein Schema-Preload, Argumente als JSON-RPC-Strings, nicht als verschachtelte Schemas.

**5. Mobile PWA**
- Tailscale serve; Auth = Tailnet-Identität + rotierender Device-Token; optional WebAuthn-Passkey für biometrische Approvals.
- Stack: Vanilla-TS + kleinem View-Layer (Preact oder Web Components), kein Framework-Schwergewicht — die PWA ist ein Renderer serverprojizierter Deltas, kein State-Monolith.
- Offline-Toleranz: letzte Projektion gecacht; bei Disconnect zeigt sie „Daten vom <Zeitstempel>".

**6. Projekt-Index (bunker.ai-RAG)**
- Adapter ruft Qdrant+Embeddings lokal auf das Projektverzeichnis; Index ist inkrementell (file-watcher).
- Semantische Suche bleibt vollständig lokal: Embedding-Modell lokal, Query nie in Cloud.

---

## 5. Provider-Mapping (final, mit Adapter-Status)

| Provider | Kontrollpfad | Reasoning lesbar? | Steuerung mobil | Bruchrisiko | Adapter-Name | MVP-Phase | Status |
|---|---|---|---|---|---|---|---|
| **Claude Code** | `claude -p --output-format stream-json` | Ja, separate `thinking`-Events | Über Hub-Steer-Kanal | sehr gering | `claude` | P1 | proven (Referenz) |
| **OpenAI Codex** | `codex exec` JSON-Events | Ja (granular, in Verbesserung) | Über Hub-Steer-Kanal | gering (Format lebt) | `codex` | P1 | proven, Contract-Tests Pflicht |
| **GitHub Copilot CLI** | `copilot --allow-all-tools` + SDK/JSON-RPC | Teilweise | Über Hub-Steer-Kanal | mittel (Parsing) | `copilot` | P3 | unproven |
| **Eigene Harnesses (Swarm)** | eigene Event-API | Ja, voll | nativ | sehr gering | `swarm` | P3 | proven |
| **z.ai / GLM** | API über Nemesis-Router :8788 | Ja (`reasoning_content`-Feld) | Über Hub-Steer-Kanal | gering | `zai` | P3 | proven |
| **lokale llama.cpp/Qwen-Server** | eigener API-Adapter | Ja (Roh-Streams) | Über Hub-Steer-Kanal | sehr gering | `local-llm` | P3 | proven |
| **Cursor Desktop** | state.vscdb-Watcher (read-only) | Teilweise (nur Chat-Historie) | **NEIN** — Umleitung auf Hub-CLIs | **hoch** (Reverse-Engineering) | `cursor-clip` | MVP+1 | unproven, may break |

**Architekturleitlinie zum Mapping:**
- Kursteuerpfad für Cursor = Umweg: Cursor-Aufgaben, die remote gesteuert werden sollen, werden nicht in Cursor, sondern im Hub-Worker (Claude/Codex/Swarm) ausgeführt. Cursor bleibt das lokale Tageswerkzeug am Schreibtisch.
- Für jeden Adapter gilt: Output trifft im Contract-Test ein Byte-Limit (Standard: max. 2 MB pro Session-Hour, per Config).

---

## 6. Mobile UX & „Perfect Feeling" — Feature-Deep-Dives

### 6.1 Design-Prinzipien
- **Einhändig erfolgreich:** Hauptaktionen (Sprache, Approve, Tail ansehen) sind im unteren Drittel erreichbar; Thumbs erreichen 90 % des Interaktionsbereichs.
- **Zustand dominiert Dekoration:** Jede Karte zeigt Status, Modell, Kosten, letzte Aktion. Keine Spielerei.
- **Deltas, nicht Volltexte:** Die PWA ist eine Projektion. Sie zeigt „was seit deinem letzten Blick passiert ist", nicht „alles, was jemals passiert ist".
- **Haptik:** kurze Vibration bei Approval-Anfragen, lang auslaufend bei Fehlern, dezent bei normalen Events. Biometrie bei destruktiven Aktionen.
- **Dark-first** (Coding-Ästhetik), mit Light-Theme als Accessibility-Option.

### 6.2 Bildschirmstruktur
- **S1 — Dashboard:** Rechner → Projekte → Sessions. Traffic-light-Status, Kosten-Zähler, Answer-to-Question-Marker („wartet auf mich").
- **S2 — Session-Tail:** Event-Stream mit Filtern (Alle / Nur Assistant / Nur Tool-Calls / Nur Denken / Compact). Thinking gedimmt kursiv, Tool-Calls als Chips mit Status-Icon, große Outputs mit „1 von 4.120 Zeilen"-Anker.
- **S3 — Diff-Ansicht:** Unified am Handy, Querformat → Side-by-Side. Commit-Grenzen als Anker; Tap auf Funktion zeigt Diff-Fenster, nicht ganze Datei.
- **S4 — Approval-Queue:** Globaler Posteingang aller Gates; jede Anfrage zeigt Begründung, Auswirkung, Risiko-Level, Timeout.
- **S5 — Sprachsuche:** Projekt auswählen → Mikro-Symbol → sprechen → Ergebnisse als Dateiliste mit Zeilen-Ankern.
- **S6 — Prompt-Composer:** Mikro → Transkript → Optimizer-Preview → „Los" / „Bearbeiten".

### 6.3 Spracheingabe (R3 + allgemeiner Input)
- **Aufnahme:** Android-Chrome `SpeechRecognition` API (bewiesen im handcam-Prototyp), alternativ MediaRecorder + Whisper.cpp serverseitig (bessere Präzision bei Fachbegriffen, lokaler Pfad).
- **Latenz-Ziel:** < 1,5 s von Ende-Sprache bis Transkript-Anzeige (lokale Whisper-Instanz auf Hub-Rechner oder dediziertem home-server).
- **Domänen-Anpassung:** Prompt-Layer beim Transkriptor („Erkenne gut: git, diff, worktree, JSONL, tool_use, Codex, Claude, Qdrant, tmux, MCP").
- **Prompt-Optimierung (automatisch, optional):**
  1. Roh-Transkript → lokaler Small-Model-Optimizer (Qwen-Finetune oder auf Omarchy gehostet) → strukturierter Prompt: Ziel, Scope, Constraints, Budget.
  2. Preview-Steuerung: links Roh-Transkript, rechts optimierte Version, Unterschiede markiert.
  3. Learning-Loop (lokal): verworfene Optimierungen werden gesammelt, um den Optimizer-Prompt iterativ zu schärfen — niemals in Cloud.
- **Sprach-Direktiven:** „Füge Budget bei 3 Dollar hinzu" wird als Constraint erkannt; „Stopp die Session" führt zur Approval-Abfrage, nicht zur sofortigen Ausführung.

### 6.4 Reasoning-Filter (R4)
- Filterstatus persisted **pro Gerät** in LocalStorage, kein Server-Roundtrip.
- Standard-Filter-Presets: „Überwachen" (nur Status + Approvals), „Debuggen" (alle Events, große Outputs angehakt), „Lesen" (Assistant-only, Denken aus).
- „Anker-Navigation": Tap auf Tool-Call-Chip springt zum zugehörigen Tool-Result und zurück.

---

## 7. Sensorik & Push (Stille-Ausfälle sichtbar machen)

- Hub-Heartbeat pro Adapter alle 30 s; Fehlschlag → Push-Benachrichtigung + rotes Badge auf dem Dashboard.
- Push-Kanal: Tailscale WebSocket, bei Disconnect → Web-Push (VAPID) oder Telegram-Fallback (optional, konfigurierbar).
- Ein „Hub-Health"-Screen zeigt je Adapter: letzter Heartbeat, letzte erfolgreiche Aktion, Contract-Test-Status.

---

## 8. Sicherheit & Governance (unverändert aus Vorbericht, präzisiert)

1. **Netz:** Kein öffentlicher Port. Tailscale-only. PWA-Auth: Tailnet-Identität + Device-Token + optional WebAuthn.
2. **Approval-Klassen:**
   - read (Suche, Diff ansehen): frei
   - write-vorschlag (Agent startet): bestätigungspflichtig
   - destruktiv (force-push, delete, deploy): biometrisch, Begründungsfeld, ins Audit-Log
3. **Befehls-Allowlist:** Der Hub führt nie freie Shell vom Handy aus — nur registrierte Adapter-Operationen mit Argument-Schema.
4. **Audit:** Jede Handy-Aktion landet im Session-JSONL (wer-wann-was), Brain-kompatibel.
5. **Prompt-Injection-Grenze:** Agenten-Output ist für die PWA **Daten**, niemals Instruktion. Kein „der Agent sagt dem Handy, es soll Knöpfe drücken".
6. **Kosten-Governance:** BudgetState pro Session/Tag; Überschreitung parkt die Session — nicht still weiterlaufen lassen.

---

## 9. Messlatten & Erfolgskriterien (First-Class-Requirements)

| ID | Metric | Zielwert |
|---|---|---|
| K1 | Mobile Approve-Latenz (Push → Biometrie → Hub-Ack) | < 5 s (95%percentile) |
| K2 | Session-Tail-Framerate bei 30 Events/s | kein Frame-Lag < 200 ms, drop-on-slow aktiv |
| K3 | Diff-Payload serverseitig komprimiert | ≤ 50 KB pro Ansichtsfenster |
| K4 | MCP-Gateway Schema-Gesamtkosten | < 1.000 Tokens statisch, < 300 Tokens pro Lookup |
| K5 | Standard-Adapter-Event-Größe | ≤ 4 KB unchunked; alles darüber Blob-verlagert |
| K6 | Sprach-zu-Transkript-Latenz (lokal) | ≤ 1,5 s |
| K7 | Hub-Restart State-Rekonstruktion | 100 % der Sessions identisch, < 3 s Restore |
| K8 | Dummy-Adapter-Loadtest | 20 parallele Sessions, keine Events verloren, keine Budget-Überschreitung |
| K9 | Cursor-Clip-Breakage | bei Format-Change: `adapter.broken` sichtbar in < 60 s, Kernnutzung ungestört |
| K10 | PWA-Offline-Anzeige | letzte Projektion + Zeitstempel, kein White-Screen |

---

## 10. Roadmap

| Phase | Umfang | Dauer | Abhängigkeiten |
|---|---|---|---|
| P0 | Hub-Kern: Sessions, JSONL, tmux-Worker, Tailscale-serve, PWA-Gerüst, Dummy-Adapter | 1 Woche | — |
| P1 | Adapter `claude` + `codex`; Monitor-Dashboard; Chat-Tail mit 3 Filtern | 1–1,5 Wochen | P0 |
| P2 | Diff-Ansicht; Approval-Gates + Budgets; Basis-Messlatten K1–K5 im CI | 1 Woche | P1 |
| P3 | `swarm`-, `zai`-, `local-llm`-Adapter; `cursor-clip` read-only; Sprachsuche (bunker.ai) | 1,5 Wochen | P2 |
| P4 | Brain-Digest-Skill; gpubox/Windows (WSL); MCP-Gateway (Meta-Tools); OSS-Aufbereitung | 1–2 Wochen | P3 |

---

## 11. Risiken (konsolidiert)

| Risiko | W'keit | Gegenmaßnahme |
|---|---|---|
| Codex-JSON-Event-Format ändert sich | mittel | Adapter-Versionierung + Contract-Tests, CLI-Pinning |
| Cursor-DB-Format bricht | hoch | Read-only, klarer `may break`-Status, Kernnutzung unabhängig |
| Kontext-Overflow PWA | mittel | Serverseitige Fensterung, Blob-Verlagerung, Filter-Presets |
| MCP-Gateway wird zur Bloat-Falle | mittel | Schema-Budget in CI hart geprüft; Gateway ist optionales Flag |
| Scope-Creep | hoch | Jede Erweiterung durch Messlatte in §9; MVP strikt |
| Spracherkennung schlecht bei Fachbegriffen | mittel | Domänen-Prompt + Whisper-Server-Fallback + Editier-Preview |
| Stille Adapter-Ausfälle | mittel | Heartbeat + Push (K9) |

---

## 12. Offene Entscheidungspunkte

- **OD-1:** Whisper-serverseitig (besser, lokal) vs. Android-Browser-STT (schneller, kein Server)? → Empfehlung: beides, Browser-STT erst als Fallback, Whisper als Ziel.
- **OD-2:** MCP-Gateway per Default aktiviert oder hinter Konfig-Flag? → Empfehlung: hinter Flag, mit Budget-Warnung.
- **OD-3:** Telegram-Push als Fallback-Kanal? → Empfehlung: optional, nicht im OSS-Kern als Pflicht-Pfad.
- **OD-4:** Soll der Optimizer-Prompt lokal verschärft werden (Learning-Loop) — mit welcher Speicherstruktur? → Brain-Digest-Pattern, niemals Cloud.

---

## 13. Quellen

1. OpenAI: „Work with Codex from anywhere" — openai.com/index/work-with-codex-from-anywhere/ (14.05.2026)
2. GitHub Issue openai/codex #4219 — Headless-Modus für Orchestrierung
3. Claude Code Headless — `--output-format stream-json`, `--json-schema`; Claude Agent SDK
4. GitHub Copilot CLI — `--allow-all-tools`, `@github/copilot-sdk` (devleader.ca, 27.07.2026)
5. Cursor-Chat-Extraktion (state.vscdb) — markwroberts0/cursor-chat-recovery; mikhailsal/cursor-chronicle; bbostock/CursorRecovery
6. Omnara — remote.omnara.com (mobile Steuerung Claude Code + Codex)
7. awesome-agent-orchestrators — andyrewlee (ccswarm/herdr, agent-squid)
8. AiderDesk — hotovo/aider-desk (Diff-Viewer + Approval-Gates)
9. tmux-MCP — nickgnd/tmux-mcp
10. MCP-Spezifikation 2026-07-28 — modelcontextprotocol.io
11. **MCP-Kontextkosten-Messungen (12.09.2026):** anthropic.com/engineering/code-execution-with-mcp; firecrawl.dev/blog/mcp-vs-cli; blog.mornati.net; usewire.io/blog/mcp-vs-skills-vs-cli-context-cost; bex.co/blog/2026/07/08/mcp-tool-schema-context-bloat; mcp.directory/blog/mcp-context-bloat-fix-2026-tool-search-code-mode-progressive-disclosure; stackone.com/blog/mcp-token-optimization; contextpush.com/guides/mcp-context-bloat; GitHub modelcontextprotocol Discussion #2812
12. Interne Quellen: CORE-SPEC v1.1; adSCAILE-Vergleichsreport (10.09.2026); handcam-phone-relay.md; agent-bus-README; Kerrigan Swarm-6-Punkte-Analyse; vault SSOT-CONTRACT v1.7

---

*Ende des PRD. Nächster Schritt: P0 als Epic anlegen (premortem-Pflicht) oder Rückfragen zu einzelnen Abschnitten.*
