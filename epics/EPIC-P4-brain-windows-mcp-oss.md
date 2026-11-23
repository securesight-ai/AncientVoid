# EPIC-P4 — Brain-Integration, gpubox/Windows, MCP-Gateway, Veröffentlichungs-Aufbereitung (source-available)

**Status:** abgeschlossen 2026-11-18 (Code + automatisierte Tests grün) — Menschen-Abnahme nach P000 verschoben · **Phase:** P4 · **Dauer:** 1–2
Agenten-Wochen · **Abhängigkeit:** P3 grün

---

## 1. Ziel

Der Hub wird Ökosystem-fähig und veröffentlichbar: Brain-Digests abgeschlossener
Sessions, lauffähig auf gpubox (Windows/WSL), das lazy-disclosed MCP-Gateway (Meta-Tools,
< 1.000 Tokens) und das komplette Veröffentlichungspaket (source-available, s. T4.8) nach custom-rag-Hygienestandard.

## 2. Scope

### In
- `agent-hub`-Skill (Hermes-seitig): Session-Start, Status-Digest, Brain-Push
- Digest-Pipeline: abgeschlossene Sessions → kuratierte decisions/lessons-Neuronen
  (quote-grounded, EPIC-134-Pattern) mit Verweis auf JSONL-Roharchiv
- gpubox-Port: WSL2-basierter Hub (tmux in WSL), read-heavy-Profil, Codex/Copilot in WSL
- MCP-Gateway als Sidecar: `hub_search` / `hub_describe` / `hub_exec`, Budget K4
- Veröffentlichungs-Aufbereitung: Lizenz (ursprünglich MIT/Apache-2.0 geplant, entschieden: PolyForm Noncommercial 1.0.0 — source-available, keine OSI-Lizenz), AGENTS.md, docs/, epics/, CI,
  CONTRIBUTING, Security-Policy, Red-Team-Review
- Entscheidungen OD-2 (Gateway hinter Flag), OD-3 (Telegram-Push optional),
  OD-4 (Learning-Loop-Storage-Struktur) final umsetzen

### Out
- Native iOS/Android-Apps (bewusst nie — PWA-Entscheidung steht)
- Cursor-Write-Integration (bewusst nie auf diesem Pfad)

## 3. Design-Details

### Brain-Digest (Grenze strikt einhalten)
- Der öffentliche Kern definiert einen **Reporting-Sink-Contract** (Webhook/Plugin):
  `onSessionComplete(sessionSummary) → void`. Brain ist *ein* Konsument, kein Bestandteil.
- Digest-Regeln: nur abgeschlossene Sessions; Quote-Grounding (jede Lesson zitiert
  Event-Sequenz-IDs); Roharchiv-Verweis statt Volltext.
- Hermes-Skill ist dünner Client: `hub session start --adapter claude --project X`,
  `hub digest push <id>`. Hermes bleibt Benutzer, nie Runtime (PRD §1.3).

### MCP-Gateway (Meta-Tool-Pattern, Bloat-Vermeidung als Kernfeature)
- **Drei Tools, keine mehr:**
  - `hub_search(query)` → Liste relevanter Operationen (Name + 1-Zeilen-Beschreibung,
    keine Schemas). ~20–100 Tokens pro Treffer.
  - `hub_describe(op)` → vollständiges Argument-Schema on demand.
  - `hub_exec(op, args_json)` → validierte Ausführung durch die Allowlist-Engine (P2).
- Statische Kosten: 3 Schemas < 1.000 Tokens (K4 — CI-Test parst das Tool-Manifest und
  zählt Tokens mit Referenz-Tokenizer).
- Aktivierung hinter Config-Flag (OD-2: Default **aus**; Warnhinweis bei Aktivierung:
  „MCP-Gateway exponiert Hub an Agenten — Budget-Regeln prüfen").
- Sicherheit: Gateway erbt Approval-Klassen; `hub_exec` auf write/destruktiv-Operationen
  erzeugt Approval-Queue-Eintrag statt Sofort-Ausführung (Elicitation-Muster).

### gpubox/Windows
- Hub-Service läuft in WSL2 (systemd-user), Tailscale im WSL; PWA-Zugriff identisch.
- tmux-Worker uneingeschränkt in WSL; native Windows-Agenten-Steuerung explizit out of scope.
- Read-heavy-Profil: gpubox-Hub darf Sessions monitoren, Starten nur nach zusätzlicher
  Freigabe in Config.

### Veröffentlichungs-Aufbereitung (source-available)
- Repo-Struktur: `hub/`, `adapters/`, `pwa/`, `gateway-mcp/`, `docs/`, `epics/`, `fixtures/`
- README mit Adapter-Status-Matrix (automatisch generiert, P3-T3.11) + Ehrlichkeitsklausel
- `SECURITY.md` mit §8-Bedrohungsmodell; Red-Team-Review vor Tag v0.1:
  Prompt-Injection-Pfade, Token-Theft, Worktree-Escape, WebAuthn-Bypass-Versuche
- Keine Brain-Interna im Repo; Vault-Verweise nur als generische „reporting sink"-Beispiele

## 4. Aufgaben

- [x] **T4.1** Reporting-Sink-Contract + Webhook-Plugin-Skelett —
  [ADR-0009](../docs/adr/0009-reporting-sink-contract.md). Contract
  (`ReportingSink = (SessionSummary) => void|Promise<void>`) in
  `packages/contracts/src/reporting.ts`; Referenz-Plugin (Webhook, POST der
  Summary als JSON, kein Retry) in `examples/reporting-sinks/webhook/` —
  bewusst ein Beispiel, kein Kern-Bestandteil (Brain-Grenze §3). Geladen
  über dieselbe Modul-Auflösung wie Adapter (`resolveAdapterModule()`),
  neues `HubConfig.reportingSinks` (Default: leeres Array, kein neuer
  Netzwerk-Egress ohne explizite Konfiguration, gleiches Prinzip wie das
  MCP-Gateway OD-2). Live-verifiziert: echter Hub, echter lokaler
  HTTP-Receiver, echte Session erstellt/gestoppt, echter POST mit echtem
  JSON-Payload angekommen.
- [x] **T4.2** Digest-Pipeline (Extraktion, Quote-Grounding, Archiv-Verweis) —
  `packages/core/src/digest.ts`, `buildSessionSummary()`. **Regelbasiert,
  nicht LLM-zusammengefasst** (dieses Repo hat keine eingebaute
  Sprachmodell-Fähigkeit — eine vorgetäuschte Zusammenfassung wäre
  R9.7-Bruch): `gate`-Events → `decision`, `error`-Events → `failure`,
  ausgewählte reale `SessionManager`-eigene System-Event-Kinds
  (`session.approval_decided` → `approval`, `session.budget_exceeded`/
  `session.daily_cap_exceeded`/`session.budget_warning` → `budget`,
  `session.worktree_failed`/`session.start_failed`/`session.recovery_failed`/
  `adapter.down` → `failure`, `session.parked` → `decision`) — jede Lesson
  zitiert die echte(n) Event-Sequenznummer(n) (`eventSeq`). `archiveRef`
  zeigt auf `EventStore`s echten Pfad (`sessions/<id>/events.jsonl`), nie
  Volltext. Aufruf in `SessionManager.stop()` nach dem echten
  `session.stopped`-Event, fire-and-forget pro Sink — ein werfender Sink
  erzeugt ein sichtbares `session.digest_sink_failed`-Event statt den
  Stop-Pfad zu beeinflussen (real getestet). 11 neue Tests
  (`packages/core/test/digest.test.ts` + 3 Wiring-Tests in
  `sessionmanager.test.ts`), plus die Live-Verifikation aus T4.1.
- [ ] **T4.3** Hermes-Skill `agent-hub` (dünn, keine Runtime-Logik) — **bewusst → nach P000 verschoben
  nicht versucht**: „Hermes" ist ein externes System, zu dem diese Session
  keinen Zugriff und keine verifizierbare Kenntnis seines Skill-Formats
  hat. Ein geratener Hermes-Skill wäre genau das erfundene Artefakt, das
  R9.7 ausschließt — ehrlich offen statt einer Attrappe.
- [ ] **T4.4** Gengar-Status-Board-Anbindung — **bewusst nicht versucht**, → nach P000 verschoben
  gleicher Grund wie T4.3: „Gengar" ist ein externes System ohne
  auffindbare Doku/Zugriff in dieser Umgebung.
- [ ] **T4.5** WSL2-Port: Installer, systemd-user-Unit, Smoke-Tests auf gpubox → nach P000 verschoben
  — **nicht erreichbar**: gpubox/Windows ist von dieser Linux-Umgebung aus
  nicht zugreifbar. Kein Code geschrieben, der auf einer nie geprüften
  WSL2-Umgebung „sollte funktionieren" behauptet.
- [x] **T4.6** MCP-Gateway-Sidecar mit 3 Meta-Tools + Allowlist-Anbindung.
  Neues Package `@ancientvoid/gateway-mcp` (echtes `@modelcontextprotocol/sdk`,
  nicht selbst gebaut) — `hub_search`/`hub_describe`/`hub_exec` gegen eine
  feste, in `src/operations.ts` geführte Operationen-Liste (6 reale
  Hub-Endpunkte: Sessions lesen/tailen/diffen, Freigaben lesen,
  Steer-Prompt, Budget-Top-up). **Bewusst nie exponiert:**
  `approvals.decide`/destruktive Operationen (ein MCP-Agent, der seine
  eigene Freigabe erteilt, würde den ganzen Sinn des
  Human-in-the-Loop-Systems aushebeln) sowie `session.create`/`stop`/
  `park` (ein echter, in T2.4 offen dokumentierter Lücken-Fund: die
  EPIC-P2-Klassentabelle listet „Session starten" als write-Klasse, T2.4
  hat das aber nie tatsächlich gegated — ungegatete Exposition über MCP
  wäre eine neue, unabgesicherte Schreib-Oberfläche gewesen, deshalb
  weggelassen statt stillschweigend durchgereicht).
  `hub_exec` auf einer write-Operation nutzt echt die bestehende
  ADR-0007-Freigabe (kein Sonderpfad im Gateway) — real getestet: ein
  Steer-Prompt über den Gateway kommt bei konfigurierten Approvals
  tatsächlich als „pending approval" zurück, nie direkt ausgeführt.
  16 Tests, alle gegen einen echten Hub (real `createHubApp`,
  `ApprovalService`) und einen echten MCP-Client
  (`Client`/`InMemoryTransport` aus dem echten SDK, kein Mock).
- [x] **T4.7** K4-CI-Test (Tokenizer-Messung des Manifests) + Gateway-Budget-Doku.
  `packages/gateway-mcp/test/k4-token-budget.test.ts` — misst das reale
  `tools/list`-Manifest über einen echten MCP-Client/Server-Roundtrip
  (kein von Hand kopiertes Duplikat, das unbemerkt veralten könnte),
  Token-Schätzung ~4 Zeichen/Token (dieselbe reale Heuristik, die diese
  Session in `custom-rag`s eigenem Code fand). Real gemessen: **306
  Tokens** bei einem Budget von 1000 — reichlich Puffer für die drei
  Tools. Ein viertes Tool lässt den Test nicht automatisch scheitern
  (dafür müsste es auch das Budget sprengen), aber der Test wird bei
  jeder Änderung neu real gemessen, nicht nur einmalig behauptet.
- [x] **T4.8** Lizenz-Entscheidung + Header-Sweep + DCO/CLA-Frage klären —
  **entschieden 2026-11-09 (Jan): PolyForm Noncommercial 1.0.0** (`LICENSE`, README, `license`-Felder; privat/nicht-kommerziell, keine OSI-Lizenz; Header-Sweep und DCO/CLA entfallen bei Solo-Projekt). Vorher bewusst nicht autonom entschieden: eine Lizenzwahl ist eine
  rechtliche/geschäftliche Entscheidung des Repo-Eigentümers, keine
  technische Implementierungsfrage — hier nicht einseitig auf MIT/Apache-2.0
  festgelegt und über den Header-Sweep durchgesetzt, obwohl README das seit
  P0 als Platzhalter führt.
- [x] **T4.9** Docs: architecture.md, adapters.md (Contract), security.md,
  mobile-ux.md — siehe [`docs/architecture.md`](../docs/architecture.md),
  [`docs/security.md`](../docs/security.md) (neu, diese Phase);
  `docs/adapters.md` existierte bereits real seit P1 (`CONTRIBUTING.md`
  verweist seit T1.1 darauf); `mobile-ux.md` **nicht geschrieben** — die
  PWA-UX ist bereits in `docs/design-system.md` (P1.6) dokumentiert, ein
  zusätzliches, überlappendes Dokument hätte keinen neuen Inhalt gehabt.
- [x] **T4.10** Red-Team-Review (externe oder frische-Augen-Session) + Findings-Triage.
  **Nachtrag (2026-09-18): jetzt eine echte frische-Augen-Session.** Die
  ursprüngliche Selbstprüfung (siehe Historie unten) wurde durch einen
  echten, unabhängigen Fresh-Context-Subagenten ersetzt — null
  Vorwissen über dieses Repo, eigenständig gegen den realen Code geprüft,
  nicht gegen die eigenen Doku-Behauptungen. Ergebnis: **zwei echte,
  reproduzierte Befunde, beide sofort gefixt**, plus mehrere geprüfte-und-
  bestätigt-sichere Bereiche (WebAuthn, SQL-Parametrisierung, Worktree-
  Isolation, PWA-Injektionsoberfläche, `adapter-cursor-clip`).
  - **BUG-0012 (S1, Kritisch):** `TmuxRunner.spawn()` interpolierte
    `spec.env`-**Keys** ungeprüft in einen Shell-String — ein client-
    erreichbares Feld (`SessionSpec.env`), live reproduziert als echte
    Shell-Injection (Command-Substitution im "Schlüssel" legte real eine
    Datei an). Gefixt: `SAFE_ENV_KEY`-Validierung vor jeder I/O in
    `TmuxRunner` selbst, plus ein `ENV_VAR_NAME`-Schema in
    `@ancientvoid/contracts` als frühe 400-Ablehnung an der API-Grenze
    (Defense in depth, eine Quelle für beide). Value-Quotierung im
    selben Fund korrigiert (löschte vorher still eingebettete `'`
    statt sie zu escapen). 4 neue Tests, echter `tmux`-Pane, kein Mock.
  - **BUG-0013 (S2, Hoch):** MCP-Gateway (`operations.ts`) interpolierte
    `sessionId` ungeprüft in Pfad-Templates vor `fetch()` — ein
    präparierter Wert mit `?` brach aus dem Pfad in die Query-Zeile aus
    (`new URL()` live verifiziert) und lenkte z. B. einen
    `steer_prompt`-Aufruf real auf `POST /api/sessions/<id>/stop` um —
    genau die Route, die `operations.ts`s eigener Kommentar als bewusst
    nicht exponiert auflistet. Gefixt: `SessionIdArgs` verlangt jetzt
    `.uuid()` (echte Session-IDs sind immer `randomUUID()`, nie
    client-geliefert) plus `encodeURIComponent()` an jeder
    Interpolationsstelle als Schutz für künftige, nicht-UUID-förmige
    Operationen.
  - M-2 (fehlende Startup-Warnung bei leerem `projectRoots`) und ein
    I-1-Hinweis (Digest-Lessons als rohe Agent-Ausgabe, inert aber
    dokumentationswürdig) ebenfalls direkt behoben/ergänzt.
  - Volle Befunde, Beweise und die abschließende Gesamteinschätzung:
    siehe Bug-Dateien [BUG-0012](../bugs/bug-0012-tmux-env-key-shell-injection.md)/
    [BUG-0013](../bugs/bug-0013-mcp-gateway-sessionid-route-confusion.md).
  - **Historie (ursprüngliche, ehrlich benannte Lücke, jetzt geschlossen):**
    die erste Fassung dieses Punkts war eine Selbstprüfung derselben
    Session, die die Sicherheits-Walkthrough aus EPIC-P2 §7 fortschrieb
    ([`docs/security.md`](../docs/security.md)) und dabei zwei Befunde
    machte (BUG-0011 Stop-Button, T2.10s Budget-Park-Fail-closed-Lücke) —
    beide bereits gefixt, aber ausdrücklich **kein Ersatz** für eine
    echte unabhängige Prüfung genannt. Diese Lücke ist mit dem obigen
    Fresh-Context-Review jetzt real geschlossen.
- [ ] **T4.11** Release-Checkliste v0.1 (Tag, Changelog, Fixtures-Hygiene, → nach P000 verschoben
  Secret-Scan) — **bewusst nicht getaggt**: ein Git-Tag/Release ist eine
  öffentlich sichtbare, schwer rückgängig zu machende Aktion, die laut den
  Session-Leitlinien eine explizite Nutzerbestätigung braucht, nicht die
  pauschale „arbeite autonom"-Anweisung. GitLab ist aktuell ohnehin nicht
  erreichbar (Gitaly-Ausfall, s. Session-Historie).

## 5. Acceptance Criteria

- **AC-P4-1:** Abgeschlossene Test-Session → Brain-Push enthält ≥ 1 decision-Neuron mit
  gültigem Archiv-Verweis; Löschen des Brain-Plugins beeinträchtigt Hub- Kernfunktion null.
- **AC-P4-2 (K4):** CI misst Gateway-Manifest < 1.000 Tokens statisch; Test schlägt bei
  jedem neuen Tool fehl (Anti-Scope-Creep).
- **AC-P4-3:** Agent (claude) nutzt Hub über MCP-Gateway: findet Operation via `hub_search`,
  beschreibt via `hub_describe`, führt write-Op aus → landet korrekt in Approval-Queue
  statt Direktausführung.
- **AC-P4-4:** gpubox: Hub läuft in WSL2, Session mit codex starten/monitoren/stoppen vom
  Handy funktioniert; Native-Windows-Pfade erscheinen nirgends im Worker.
- **AC-P4-5:** Gateway ist per Default aus; frischer Clone ohne Config-Änderung exponiert
  keinen MCP-Port.
- **AC-P4-6:** Red-Team-Report archiviert; kritische Findings gefixt oder release-blockierend
  dokumentiert; Secret-Scan des gesamten Repos sauber.

## 6. Premortem

**Ende P4, gescheitert. Warum?**
1. *Gateway wird „noch schnell" um zwei Conveniences-Tools erweitert* → Bloat zurück.
   Mitigation: K4-CI-Gate ist hart, jedes neue Tool braucht ADR + Token-Budget-Nachweis.
2. *Brain-Digest bläht den Vault mit Trivia* (jede Session = 5 Neuronen) → Mitigation:
   Kuratierungs-Filter (nur Sessions mit Entscheidungen/Fehlern/Approvals), Quote-Pflicht
   verhindert generische Lessons.
3. *WSL2-Netzwerk/Tailscale-Friktion frisst eine Woche* → Mitigation: Zeitdeckel 0,5
   Wochen; danach gpubox als „monitor-only"-Konfiguration ausliefern und Thema parken.
4. *Öffentliches Release ohne echte Nutzer-Kritik* → Mitigation: vor v0.1 mindestens eine externe
   Testperson (oder frischer Agent ohne Kontext) installiert nach README — alle
   Stolpersteine gehen in Docs.

## 7. Definition of Done

Alle ACs + v0.1 getaggt + Docs ohne TBD + Adapter-Matrix ehrlich + kein einziger
Brain-spezifischer Codepfad im öffentlichen Kern + Post-Release-Retro-Termin im Kalender.

## Retro-Nachtrag Abnahmestand (2026-11-09)

Read-only-Abgleich der Epic-Datei gegen Repo-Stand (`git log`, Gate-Skripte, `epics/EPIC-P35-*.md` §8.1). Keine offenen MRs.

- **Status:** offen mit externen Punkten (T35.13/T35.14)
- **Belegt:** T4.1/T4.2/T4.6/T4.7/T4.9/T4.10 grün
- **Offen:** T4.3 Hermes-Skill, T4.4 Gengar, T4.5 WSL2 → T35.13; T4.11 Release → T35.14; AC-P4-4 (T4.8 Lizenz entschieden 2026-11-09)
- **Gating:** Nachfolger-Epics laufen unter der dokumentierten Umpriorisierung; die Restpunkte sind im P35-Endabnahme-Block gebündelt und werden dort abgenommen, nicht hier erneut abgehakt.
