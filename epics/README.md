# AncientVoid — Epic-Paket (P0–P4.5 und Planungsentwürfe bis P83)

**On hold seit 15.11.2026 (Nutzerentscheid): P30 und P31.** Beide bleiben
im Inventar, sind aber aus Empfehlungen für die nächste Arbeit ausgeschlossen.
Keine automatische Wiederaufnahme nach grünen Vorgängern; nur auf ausdrücklichen
Nutzerauftrag. Davon abhängige Arbeit bleibt bis zur erfüllten Voraussetzung
blockiert; diese Zurückstellung hebt kein anderes Epic-Gating auf.

**Dauerhafte Menschen-Abnahmen (seit 18.11.2026): [EPIC-P000](EPIC-000-testsuite-fuer-menschen.md).**
Epics schließen, sobald Code und automatisierte Tests fertig sind; die
verbleibende Menschen-Abnahme (Gerät, echte Stimmen/Remotes,
Nutzer-Verifikation) ist dorthin delegiert (Delegationsvermerk
„nach P000 verschoben“) und wird nur dort abgehakt. Epics mit reinem
Agentenrest oder offenen Entscheidungen bleiben offen. Die Statusspalten
unten sind Stand der Migration; aktuell zeigt `npm run epics:status`.

**Erstellt:** 12.09.2026 · **Basis:** PRD AncientVoid v1.0 (2026-09-12-PRD-Unified-AI-Agent-Command-Center.md)
**Workflow:** Vault-Standard — jedes Epic enthält Premortem, Messlatten-Bezug (K1–K10), Definition of Done.

**Bestandsaufnahme 2026-09-21:** [Audit mit Code-Evidenz, UI-Sichtung und
Laya-Bewertung](../docs/remote-control-audit-2026-09-21.md). „Implementiert“
ist nicht gleich „Exit-Kriterien grün“: P0/P1/P1.5/P1.6 haben offene reale
Abnahmen; P2/P3 dokumentierte Teillücken; P4 externe und Release-Restarbeit.
Der Offline-Reload-Fehler [BUG-0015](../bugs/bug-0015-offline-reload-token-gate.md)
blockiert K10. Historische grüne Überschriften sind keine Vollumfang-Freigabe.

## Enthaltene Epics

| Datei | Phase | Titel | Dauer (Agenten-Wochen) |
|---|---|---|---|
| [P000 — Testsuite für Menschen (Abnahmen durch Nutzer und Contributor)](EPIC-000-testsuite-fuer-menschen.md) | Dauerhaft offenes Sammel-Epic (Nachfolger des P35-Endabnahme-Blocks): alle Menschen-Testabnahmen mit Herkunftsbezug — Gerätetermine, echte Stimmen/Remotes, Nutzer-Verifikation fester Bugs; Epics schließen ohne ihre Menschen-Abnahme mitzunehmen | permanent, öffnet nie; Aufnahme nach Aufnahmeregel §2 | laufend |
| EPIC-P0-hub-kern.md | P0 | Hub-Kern: Sessions, EventStore, tmux-Worker, Tailscale-serve, PWA-Gerüst | 1 |
| EPIC-P1-claude-codex-monitor.md | P1 | Adapter claude + codex, Monitor-Dashboard, Chat-Tail mit Filtern | 1–1,5 |
| EPIC-P1.5-control-center-ux.md | P1.5 | Kontingent statt Budget, Projekt-Autoerkennung, Sprach-Composer, Skill-Overlay | 1–1,5 |
| EPIC-P1.6-futuristic-ui-system.md | P1.6 | Futuristisches UI-System: Bottom-Dock, Bericht-Ansicht, Design-System-Referenz | 1 |
| EPIC-P2-diff-approvals-budgets.md | P2 | Diff-Ansicht, Approval-Gates, Budgets, Messlatten im CI | 1 |
| EPIC-P3-adapter-flotte-sprachsuche.md | P3 | swarm/zai/local-llm-Adapter, cursor-clip, Sprachsuche + Prompt-Composer | 1,5 |
| EPIC-P4-brain-windows-mcp-oss.md | P4 | Brain-Digest-Skill, gpubox/Windows, MCP-Gateway, Veröffentlichungs-Aufbereitung (source-available) | 1–2 |
| [EPIC-P4.5-testing-observability.md](EPIC-P4.5-testing-observability.md) | P4.5 | Testpyramide, write-tests-Skill, strukturiertes Logging, Health/Ready/Metrics | 0,5–1 |

## Vollständige Fernsteuerung — Planungsentwürfe vom 2026-09-21

Alle folgenden Epics sind **offen / Umsetzung blockiert**. Der ausdrückliche
Auftrag, für sämtliche Lücken Epics zu schreiben, erlaubt ihre Planung vor
Abschluss der Vorgänger; er hebt kein Umsetzungs-Gate auf. Bestehende Restarbeit
bleibt unter ihren ursprünglichen Task-/AC-IDs (Zuordnung: Audit §7, Gate G0).
Kein zweites Häkchen für bereits umgesetzte Funktionen, keine neue Architektur
ohne ADR bei späterer Implementierung. Schätzungen ohne G0-Restarbeit.

| Epic | Ergebnis | Abhängigkeit | Agenten-Wochen |
|---|---|---|---|
| [P5 — Session-Discovery, Handoff, Recovery](EPIC-P5-session-discovery-handoff-recovery.md) | dieselbe Session PC↔Handy, auch nach Neustart — **abgeschlossen 2026-09-23** (Retro) | P4.5 grün; P4-externe Restpunkte bleiben offen | 2–4 |
| [P6 — Multi-Host-Flotte](EPIC-P6-multi-host-fleet.md) | alle eigenen Rechner in einer Oberfläche — **abgeschlossen 2026-09-23** (Retro) | P5 grün | 1–2 |
| [P7 — Harness-/Tool-Parität](EPIC-P7-harness-tool-parity.md) | echte Rückfragen/Freigaben, Anhänge und Tools — **abgeschlossen 2026-09-24** (Retro; aider/Swarm → P12) | P6 grün | 2–4 |
| [P8 — Mobiler Arbeitsplatz](EPIC-P8-mobile-workspace-ux.md) | einfache UI, Inbox, Entwürfe, Push/Offline — **abgeschlossen 2026-09-24** (Retro; Gerätetests → P12) | P7 grün | 1–2 |
| [P9 — AI-Steuerung und Eingaben](EPIC-P9-ai-command-input.md) | jeder Hub-Flow per natürlicher Sprache/Text — **abgeschlossen 2026-09-24** (Retro) | P8 grün | 1–2 |
| [P10 — Echtzeit-Sprache und Laya](EPIC-P10-realtime-voice-laya.md) | lokale Streaming-STT, gemessene Laya-Entscheidung | P9 grün | 1–3 |
| [P10.5 — Medien- und Video-Analyse](EPIC-P10.5-media-video-analysis.md) | YouTube/Videos: Transkript, Schlüsselbilder, Kapitel, Zusammenfassung als Session-Material | P7 T7.10 + P10 grün | 1–3 |
| [P11 — Desktop-Companion](EPIC-P11-desktop-companion.md) | systemweite Eingabe und definierte GUI-Flows | P10 grün | 2–4 |
| [P12 — Betriebsreife](EPIC-P12-operational-readiness.md) | Verschlüsseltes Produktivbackup + isolierter Restore belegt; Code und Doku gemergt (!112–!115); **offen: externe Geräte-/Provider-Abnahmen** (T12.1–T12.5, T12.7, T12.8, T12.10, T12.12) | P11 abgeschlossen mit Restnachweisen | 1–2 |
| [P13 — Hermes-Adapter](EPIC-P13-hermes-adapter.md) | Hermes Agent als CLI-Adapter (Spawn/Resume/Events, live verifiziert 03.10.2026) — **abgeschlossen 2026-10-03** (Ralph-Loop) | P3-Adaptermuster | 1 |
| [P14 — Session-Worktree-Hygiene](EPIC-P14-session-worktree-hygiene.md) | Archivieren räumt saubere Worktrees auf, `hubctl worktrees [prune]` — **abgeschlossen 2026-10-08** (produktiver `prune --apply` steht aus) | keine fachliche (BUG-0027 behoben) | 0,5 |
| [P15 — Session-Steuerung](EPIC-P15-session-steuerung.md) | Modus/Modell wählen, Pause, Queue, Sync Handy↔PC, klare Titel — **abgeschlossen — Entscheidung nach P000 verschoben (ADR-0034)** (ADR-0033/0034/0035; Live-Sync am PC offen, Entscheidung bei Jan) | keine offene | 1–2 |
| [P16 — Handy-Abnahme](EPIC-P16-handy-abnahme.md) | E2E auf dem Pixel 9 Pro XL: Token-Seite, DevTools-Abbruch, Code-Suche; Querformat-Lauf nicht als Produktbefund — **abgeschlossen mit Restabnahmen in P35 (T35.10)** | P15-Code liegt; P12-Geräteabnahme bleibt offen | 0,5–1 |
| [P17 — Laufzeit-Robustheit](EPIC-P17-laufzeit-robuheit.md) | Resume-Referenzen im Adapter-Contract, Wait-Pinning/-Idempotenz, stabile `ANCIENTVOID_*`-Pane-Marker (Herdr-Ideen, Option C der [Evaluation 2026-10-26](../docs/herdr-evaluation-2026-10-26.md)) — **abgeschlossen 2026-10-26** (ADR-0036/0037; AC-P17-1: 100 % Marker-Zuordnung in 282 ms) | keine fachliche (P13/P14-Präzedenz, läuft neben P12) | 1–1,5 |
| [P18 — Desktop-Workspace](EPIC-P18-desktop-workspace.md) | Widescreen ohne 1680-px-Deckel, bis zu vier Sessions als Kacheln (Layouts 1/2/1+2/2×2), Tastatur nach Hyprland-Art, Persistenz pro Gerät, K2 mit vier Kacheln — **abgeschlossen 2026-10-27 (Roll-out nach P000 verschoben)** | keine fachliche (baut auf P8-Split, AC-P8-6) | 1–1,5 |
| [P19 — Loop / Dark Factory](EPIC-P19-loop-dark-factory.md) | Auswahldimension „Loop“: `securesight-factory` (vormals Entwurfsname securesight-harnez; Orchestrator `self`/Hermes) und `aSPARK-Factory` (MQTT-Leitstand, Modus dark) als austauschbare `LoopConnector`-Pakete ([ADR-0038](../docs/adr/0038-loop-dark-factory.md), [Analyse](../docs/loop-analyse-2026-10-27.md)) — **gebaut seit 2026-10-28 (T19.1–T19.8: Contract, `loopAsAdapter`, beide Connectors, Auswahl, Abzeichen, Panel); Messlauf und Retro 2026-10-28 (3 🟢 / 5 🟡), manuelle Handy-Abnahme offen** | keine fachliche (P13/P14/P17-Präzedenz); P18 noch offen, Gating-Frage im ADR | 2–3 |
| [P24 — pi, omp, maki](EPIC-P24-pi-omp-maki.md) | Erkennung und Übernahme von pi-, oh-my-pi- und maki-Sessions — **Code abgeschlossen, Live-Abnahme offen** | P5, P22 | 0,5 |
| [P23 — Desktop-Navigation, Reste](EPIC-P23-desktop-navigation-reste.md) | „AncientVoid“ führt in die Übersicht (letzte Session markiert), einheitliche Statusleiste am Desktop — **abgeschlossen 2026-10-28 (Roll-out nach P000 verschoben)** | P18, P20, P21 | 0,5 |
| [P22 — Session-Entdeckung](EPIC-P22-session-entdeckung.md) | Titel/Vorschau/„läuft woanders“, Suche vor dem Paging, Übernahme ohne Prompt und als Kopie — **Code abgeschlossen, Live-Abnahme offen** | P5, P21 | 0,5 |
| [P21 — Icon-Leisten, Übergabe, Metriken, Fragen](EPIC-P21-icon-leiste-uebergabe-metriken-fragen.md) | Desktop-Icon-Leisten und klickbare Kürzel (fertig), Provider-Ausfall erkennen und übergeben, Lauf-Metriken mit Restzeit-Schätzung, Fragen-Dialog — **Code abgeschlossen** | keine fachliche | 1–2 |
| [P25 — Slash-Commands](EPIC-P25-slash-commands.md) | Harness-Commands (/clear, /compact …) steuerbar im Composer: `capabilities().commands` ([ADR-0042](../docs/adr/0042-slash-commands-im-adapter-contract.md), [Analyse](../docs/slash-commands-analyse-2026-10-29.md)), Autocomplete scope-gefiltert, Fail-loud-Hinweis statt stiller Fehlleitung — **Mechanik abgeschlossen 2026-10-29; Live-Verifikation der CLI-Listen offen (T25.6-Rest)** | keine fachliche | ~1 |
| [P26 — Factory-Integration](EPIC-P26-factory-integration.md) | `securesight-factory` Ende-zu-Ende aus AncientVoid: Projekt anlegen (PRD → `factory init`), Lauf auslösen (Treiber-Session `/factory` + Beobachter-Loop), beobachten, Rückfragen beantworten, human-only steuern; Connector-Modus `project` (Zielprojekte ohne `betrieb.py`), Namensbereinigung — **Code abgeschlossen 2026-11-09 (T26.1–T26.10, AC-P26-1…9 belegt); manuelle Abnahme mit echter Factory `not_run`** | keine fachliche offene (P19 gebaut, manuelle Abnahme offen; P7, P25) | 2–3 |
| [P27 — Unterbrochene Sessions](EPIC-P27-interrupted-sessions.md) | Unterbrechungen (Worker-Kill, Hub-Restart, Adapter-Down) als Status `interrupted` mit Grund sichtbar machen, offene Züge ordentlich per `session.turn_end(interrupted)` abschließen (Endreport stimmt), im Chat Weitermachen (ADR-0036-Resume, Mensch-ja/Agent-nein) oder Archivieren anbieten; Auto-Resume nur deklarativ sicher (`resume.auto`) — **abgeschlossen (05.11.2026, [MR !293](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/293), 1181 Tests / 295 E2E-Pässe, K8 grün); CI-Quota-Befund an P28 übergeben** | keine fachliche offene (P5/P15/P17 als Basis; parallel zu P26, Präzedenz P13/P14/P17) | ~1 |

„Alle / 100 %“ bezieht sich auf die Pflichtmatrix aus Audit §4. Eine unbekannte
oder technisch blockierte Fähigkeit verhindert diesen Claim; Monitor-only und
Kontext-Fork zählen nicht als native 1:1-Steuerung. Mac ist bisher Demo-Kontext,
kein bestätigter zusätzlicher Zielhost.

## Paseo-Impulse — Planungsentwürfe vom 2026-11-05

Ausdrücklicher Planungsauftrag auf Basis der
[Vergleichsanalyse](../docs/2026-11-05_paseo-vs-ancientvoid.md).
[Bestandskorrekturen, Quellen und Entscheidungsregister](../docs/2026-11-05_paseo-umsetzungsplanung.md)
erläutern den Umfang. **Alle sechs Epics sind Planungsentwürfe, Umsetzung gesperrt.**
Die Planung hebt keine Vorgänger-Abnahme auf; P27 und dessen wirksame
Vorgänger-Exits müssen vor Start von P28 nachweislich grün sein. Historische
Statuszeilen gelten nicht als aktueller Abschlussnachweis.

| Epic | Ergebnis | Abhängigkeit | Agenten-Wochen |
|---|---|---|---|
| [P28 — Reproduzierbare CI](EPIC-P28-reproduzierbare-ci.md) | Diagnose, isolierter Runner, vollständige Gate-/K8-Evidenz — **abgeschlossen (06.11.2026)**: selbstverwalteter Docker-Runner `av-docker` ([ADR-0049](../docs/adr/0049-selbstverwalteter-ci-runner.md)), Gate-Parität inkl. K8 20×30 in `verify`, Skip-Bericht in `e2e`, zwei Negativproben rot, drei SHA-gebundene grüne Gesamtläufe (8895473), 5 CI-Funde als BUG-0092–0096 | P27 samt Vorgänger-Exits grün | 1–2 |
| [P29 — Worktree-Workspace-Runtime](EPIC-P29-worktree-workspace-runtime.md) | Manifest, Dateiübernahme, Setup/Teardown, Services/Ports, mobiler Zugang — **abgeschlossen 07.11.2026 (T29.1–T29.7, AK-Matrix 6× 🟢, Retro angehängt; Doku-Nachzüge als AI-P29-1/2 eingestellt)** | P28 grün; P2/P14/P26 geprüft | 3–5 |
| [P30 — Adapter-/Sink-Plugins](EPIC-P30-adapter-sink-plugins.md) | Manifest, lokale/Git-Installation, Testkit, sicherer Lifecycle — **On hold seit 15.11.2026; nicht einplanen** | P29 und P34 grün | 2–3 |
| [P31 — ACP-Provider-Katalog](EPIC-P31-acp-provider-katalog.md) | kuratierte Provider, explizite Probe, getrennte Fähigkeitsnachweise — **On hold seit 15.11.2026; nicht einplanen** | P30 grün | 2–3 |
| [P32 — Mobile-Client-Entscheidung](EPIC-P32-mobile-client-entscheidung.md) | Gerätebefund + Go/No-go; optional interne Android-Shell — **Evaluations-Exit „vertagt" 2026-11-08** ([Dokument](../docs/2026-11-08_p32-evaluations-exit.md)); T32.3–T32.6 gesperrt bis neues Go | P12/P16 geprüft (P31 per Umpriorisierung 08.11.2026 nach P36) | 0,5–1; optional +2–4 |
| [P33 — Englischer Einstieg](EPIC-P33-englische-einstiegsdokumentation.md) | Bedarfsentscheid, README/Contracts/Quickstart; keine Publikation — Evaluations-Exit „vertagt" 2026-11-08; **Doku-Kern per GO durch P62 T62.4 eingelöst** (16.11.2026: englischer Guide `docs/guide/README.md` mit Screenshots); Rest von T33.2–T33.4 (Übersetzung weiterer Einstiegsflächen) bleibt bis zu einem neuen Go gesperrt | P32-Evaluations-Exit „vertagt" abgenommen (08.11.2026) | 0,5–1,5 |

Neue Kette: **P27 → P28 → P29 → P34 → P35 → P30 → P31 → P32 → P33** (P34 auf Entscheidung vom 2026-11-07 eingeschoben, P35 auf Auftrag vom 2026-11-07, siehe unten; P30 wartet damit zusätzlich auf P34 und P35).
Bei P32/P33 ist ein dokumentierter Evaluations-Exit (No-go/vertagt) vom
Implementierungsabschluss getrennt. Keine Antwort ist kein Go. Bei P32-Go
wartet P33 auch auf den Implementierungs-Exit; bei Vertagung muss der gültige
Evaluations-Exit ausdrücklich festgehalten werden. Keine automatische App-/OSS-Freigabe.

## Arbeitsfläche — eingeplant am 2026-11-07

UI-Epic auf Wunsch von Jan, in die Kette zwischen P29 und P30 geschoben. Es
startet, sobald P29 abgeschlossen ist; P30 wartet auf P34.

| Epic | Ergebnis | Abhängigkeit | Agenten-Wochen |
|---|---|---|---|
| [P34 — Arbeitsfläche und eigene Fenster](EPIC-P34-arbeitsflaeche-und-fenster.md) | Navigation bereinigt, Einstellungen neu mit Farbwähler und Schriftwahl, Session-Erkennung mit echten Projekten plus Codex/Hermes und neuem Design, Kacheln und Werkzeuge als eigene Fenster — **umgesetzt, Gate grün; Live-Abnahme AC-P34-13 (Jan) offen** | P29 grün (P18/P20/P22/P23 als Basis) | 2–3 |

## Harness-Parität — eingeplant am 2026-11-07

Auftrag von Jan nach Nutzermeldung (Resume-Probleme, Popout-Ränder,
gewählter Harness startete nicht, Inventar-Zellen unbelegt). P35 schließt an
die P34-Implementierung an; die offene Live-Abnahme AC-P34-13 wird gemeinsam
mit der P35-Abnahme gemacht. P30/P31 bauen auf dem P35-Contract-Muster auf.

| Epic | Ergebnis | Abhängigkeit | Agenten-Wochen |
|---|---|---|---|
| [P35 — Harness-Parität: Fortsetzen, Erkennung, Provider-Modularität](EPIC-P35-harness-paritaet-fortsetzen-provider.md) | „Weitermachen“ live belegt für claude/opencode/pi/maki/omp/copilot/hermes, Discovery-Lücken belegt oder begründet (copilot-Scanner neu, dsh zstd-begründet), Popout-Vollfläche, gewählter Harness startet tatsächlich, Modell-/Custom-Provider-Muster als Config-Standard (ADR-0054, Fundament für P30/P31) — **umgesetzt 07.11.2026, Gate grün; Live-Abnahme AC-P35-7 (Jan, gemeinsam mit AC-P34-13) offen** | P34-Implementierung grün (Live-Abnahme gemeinsam) | 2–3 |

## Orca-Impulse — Planungsauftrag vom 08.11.2026

[Vergleich](../docs/2026-11-08_orca-vs-ancientvoid.md) und
[Planungsgrundlage mit Codeübernahmeregister](../docs/2026-11-08_orca-epic-planung.md)
halten Nutzerentscheidungen, Bestand und gepinnte Orca-Quellen fest.
**Alle folgenden Epics sind Planungsentwürfe, Umsetzung gesperrt.**
Der ausdrückliche Auftrag erlaubt Planung vor grünen Vorgängern, keine
Implementierung oder Aufhebung offener Abnahmen. PWA bleibt primärer Client;
Voidwarden bleibt separat. Zugang ohne Tailscale ist nur Evaluation, kein
Account-/Relay-/Veröffentlichungsauftrag. Plugin-Basis bleibt P30,
Provider-Katalog P31; P32 erhält die aktuelle PWA-Präferenz.

| Epic | Ergebnis | Vorgänger-Exit | Agenten-Wochen |
|---|---|---|---|
| [P36 — Diff-Review](EPIC-P36-diff-review-feedback.md) | Notizen und gesammeltes Agenten-Feedback; vorhandene Zustellung auditieren — **umgesetzt 08.11.2026** (ADR-0055, T36.1–T36.6, Gate grün; Live-Journey am Gerät → Endabnahme-Block T35.16) | P33 grün (Evaluations-Exit vertagt 08.11.2026) | 1–2 |
| [P37 — GitLab-Kontext](EPIC-P37-gitlab-review-ci.md) | Issues, MRs, CI und Review-Rückgabe | P36 grün | 2–3 |
| [P38 — Session-Arbeitsort](EPIC-P38-session-arbeitsort.md) | Eigener Worktree oder Projekt direkt; Sandbox getrennt — **umgesetzt 09.11.2026** (ADR-0057, T38.1–T38.5, Gate siehe Epic; echte Scratch-Repo-Abnahme mit Harness offen → Endabnahme-Block) | P37 grün | 1–2 |
| [P46 — Projekt-Explorer/Dateiansicht](EPIC-P46-projekt-explorer-dateiansicht.md) | Rechte Sidebar, vollständige Datei-/Formatansichten und Sprachdiagnosen — **in Umsetzung seit 09.11.2026** (ADR-0058: Baum, Text-/Bytezugriff, Viewer inkl. Markdown/JSON/CSV/Notebook/Office/ZIP, Syntaxfarben, Diagnosen, Datei-Feedback; offen: Pixel-/Geräte-Abnahme, Offline-Bereichsstatus, Remote-Projektliste) | P38 grün | 3–5 |
| [P39 — Browser-Testarbeitsplatz](EPIC-P39-browser-testarbeitsplatz.md) | Host-Chromium in der PWA: Navigation, Tests, Design-Auswahl — **umgesetzt 09.11.2026, Geräte-/Tailscale-Abnahme ausstehend** (ADR-0059) | P46 (Abnahme ausstehend, Start auf Nutzeranweisung) | 3–5 |
| [P40 — Hermes-Orchestrierung](EPIC-P40-hermes-orchestrierung.md) | Gemischte Harnesses/Provider mit Tasks, Dispatches, Fragen | P39 grün | 3–5 |
| [P41 — Automationen](EPIC-P41-automationen.md) | Zeitpläne, Prechecks, Laufhistorie, Recovery — **Code steht, Exit offen (Abschluss-Gate T41.6)** ([Stand und Reste](EPIC-P41-automationen.md#8-stand-und-exit-lücken-abgleich-11112026); u. a. `unknown` ohne Referenz ohne Auflösungsweg, keine Live-Fehlerpfade); P42 bleibt blockiert | P40 grün | 2–3 |
| [P42 — Android-Testgeräte](EPIC-P42-android-testgeraete.md) | AVD-/Host-Spike, Bild/Input und Android-Tests — **abgeschlossen 12.11.2026** (echter AVD belegt) | P41 grün | 0,5–1 + 2–4 |
| [P43 — UX Next Level](EPIC-P43-ux-next-level.md) | Start als Warteschlange, Session in Zügen, Zustands- und Bewegungssprache, Tablet/PC, Herauslösen überall, Nyx-Blatt; Funktionsinventar als Gate — **Exit grün 11.11.2026** (Closeout: 11 AC grün; Geräte-Reste AI-P43-5 → T35.16, Inventar-Schnellsuche → P51 T51.11, Breiten → P50 T50.6, BUG-0120/0121 offen) | P42 grün | 4–6 |
| [P43.5 — Quellenchips/Presets/Layouts](EPIC-P43.5-darstellungs-presets-quellenchips.md) | Quellenübergabe in den Prompt, Darstellungs-Presets, benannte Layouts (aus dem bisherigen P43 abgetrennt) — **abgeschlossen 14.11.2026** (T43.5-1–6, sechs AC, Gate/Build/Abnahme/Retro grün) | P43 grün | 1,5–2 |
| [P44 — UI-Plugins](EPIC-P44-plugin-panels-themes.md) | Panels/Themes als Erweiterung des P30-Lifecycles | P43.5 grün | 2–3 |
| [P45 — Zugangsevaluation](EPIC-P45-zugang-ohne-tailnet-evaluation.md) | Transport/Account-Optionen; expliziter Go/No-go/vertagt-Entscheid — **fertiggestellt 10.11.2026, Exit „No-go“ (kein öffentlicher Zugang; Tailnet bleibt) — [Bericht](../docs/2026-11-10_p45-zugangs-entscheidungsbericht.md)** | P44 grün (Start vorgezogen auf Nutzeranweisung) | 0,5–1 |

Erweiterte Kette: **P27 → P28 → P29 → P34 → P35 → P32 (Evaluations-Exit) → P33 → P36 → P30 → P31 → P37 → P38 → P46 → P39 → P40 → P41 → P42 → P43 → P43.5 → P44 → P45**.
P32/P33 brauchen weiterhin einen ausdrücklich gültigen Evaluations-/Umsetzungs-Exit;
PWA-Präferenz allein schließt sie nicht. AC-P34-13/AC-P35-7 bleiben offen.

**Umpriorisierung 2026-11-08 (Nutzerentscheid Jan):** P32 ist mit dem gültigen
Evaluations-Exit „vertagt" abgeschlossen
([Entscheidungsdokument](../docs/2026-11-08_p32-evaluations-exit.md));
T32.3–T32.6 bleiben bis zu einem neuen ausdrücklichen Go gesperrt. P30 und
P31 waren danach eingeordnet; seit 15.11.2026 sind beide ausdrücklich
**On hold**, ohne automatische Folgearbeit nach P36. P44 baut weiterhin auf
P30 auf. Live-Abnahmen bleiben gebündelt im Endabnahme-Block (EPIC-P35 §8).
P46 wurde auf den Folgeauftrag vom 08.11.2026 zwischen P38 und P39 eingefügt:
rechte Projekt-Sidebar, komplette Dateiansicht und echte Sprachdiagnosen
waren in P43 nicht abgedeckt. Bestehende Epic-Nummern bleiben stabil.
P45 endet mit Evaluation und erfasst den ausdrücklichen Nutzerentscheid getrennt;
ohne Antwort bleibt der Entscheid offen. Eine spätere Implementierung benötigt
einen eigenen Auftrag und Umfang. Zahlen sind grobe Größenordnungen, keine
Terminzusage. Browser/Emulator-Spikes sind kein fertiger Feature-Exit.

## Nutzerauftrag vom 10.11.2026 — Übersicht, Repo-Graph, Knowledge Vault

Ausdrücklicher Implementierungsauftrag von Jan (gleiche Form wie P36-Präzedenz:
Auftrag erlaubt Umsetzung, hebt keine offenen Abnahmen auf). Offene
Live-Abnahmen (Endabnahme-Block T35.16, P46-Reste T46.1/T46.9) bleiben
unberührt; der offene Popout-Rest aus T46.8 wird in P48 mitgebaut und bei
Abschluss in EPIC-P46 nachgetragen.

| Epic | Ergebnis | Abhängigkeit | Agenten-Wochen |
|---|---|---|---|
| [P47 — Übersicht: Sessions/Projekte/Hosts](EPIC-P47-uebersicht-sessions-projekte-hosts.md) | Ansichtsumschalter in der Übersicht, Projekt-/Host-Ansichten, Host-Chips und duplizierte Einstellungen-Schaltfläche weg | keine fachliche offene (P6/P34/P35/P46-Basis) | 0,5 |
| [P48 — Repo-Graph](EPIC-P48-repo-graph-pulsierendes-netz.md) | Pulsierendes Datei-Netz im Chat-Fenster (Import-/Verweiskanten, Farbgruppen, tote Dateien, Diagnosen rot), Datei-Tab, Popout-Ziele `graph`/`file` | P47; P46-Dateizugriff/Diagnosen; ADR-0053-Fenster | 2–3 |
| [P49 — Knowledge Vault](EPIC-P49-knowledge-vault-notizen.md) | Notizen-Tab mit Ordnerwahl (SettingsStore), Markdown-Editor mit Revision-Guard, Vault-Popout | P47; P48 (Popout-/Datei-Tab-Muster) | 1–2 |


## Zoom-Robustheit — eingeplant am 10.11.2026

Quer-Epic (Bugfix-Klasse) aus der Nutzermeldung „doppelte Scrollbars im
Chat-Fenster" und dem Repo-Scan vom 10.11.2026: Das UI-Zoom-Teilungs-Muster
wurde nach jedem Zoom-Bug einzeln nachgetragen; P50 macht es zur geprüften
Invariante. Läuft parallel zur P47-Kette.

| Epic | Ergebnis | Abhängigkeit | Agenten-Wochen |
|---|---|---|---|
| [P50 — Zoom-robuste Flächen](EPIC-P50-zoom-robuste-flaechen.md) | Fenster füllen bei jedem UI-Zoom exakt, html/body und eigene Fenster scrollen nie, Zoom-Matrix-E2E — **abgeschlossen 11.11.2026** (BUG-0113/0122 done, T50.1–T50.6) | keine fachliche offene (Bugfix-Klasse, Präzedenz P13/P14/P17) | ~1 |

Reihenfolge: **P47 → P48 → P49** (jeweils eigener Feature-Branch/MR nach main); P50 quer als Bugfix-Klasse, P51 quer als Nutzerauftrag.

## Nutzerauftrag vom 11.11.2026 — Vault-Erreichbarkeit, Glocke, Tastatur-first

Ausdrücklicher Planungsauftrag von Jan nach Nutzermeldungen (Vault-Ordner im
Picker unsichtbar/nicht erreichbar + Wunsch nach manueller Pfad-Eingabe;
Benachrichtigungsglocke am PC ins Fenstereck; komplette Tastaturbedienung mit
Hinweis-Overlay, Settings-Schalter und Omarchy-Super-Key-Koexistenz).
Abgestimmte Entscheidungen: Jeder Ordner mit Guards (ADR-0063-Ergänzung), ein
Epic, „?“-Übersicht aus T43.6 hierher gezogen, Alt-Schema +
Hyprland-`pass`-Snippet-Doku statt Grab-Override, Overlay nur bei
existierendem Shortcut. Läuft quer zur Kette (Präzedenz P47–P50).

| Epic | Ergebnis | Abhängigkeit | Agenten-Wochen |
|---|---|---|---|
| [P51 — Vault-Erreichbarkeit & Tastatur-first](EPIC-P51-vault-erreichbarkeit-tastatur.md) | Jeder Ordner als Vault wählbar (Symlink-sicher, Pfad-Eingabe, ehrliche Fehler, ADR-0063-Ergänzung); Glocke am PC im Fenstereck; zentrale Shortcut-Registry, fehlende Kürzel (Esc/Fokus, View-Wechsel, Listen-Navigation), `?`-Cheat-Sheet, Hinweis-Overlay mit Setting, Omarchy-/Firefox-Kollisions-Doku — **Code abgeschlossen 14.11.2026** (T51.1–T51.9/T51.11; Eck-Glocke löst T8.5-Spaltenposition ab, Split schrumpft unter Toasts statt zu scrollen); Live-Abnahme am Gerät offen | keine fachliche offene (P49/P18/P34 als Basis; Nutzerauftrag) | 2–3 |

Reihenfolge: P51 quer wie P50 (je Aufgabe eigener Branch/MR nach main; ADR-0063-Ergänzung vor dem ersten Verhaltens-Merge).

## Nutzerauftrag vom 12.11.2026 — Repo-Graph als Galaxie

Nutzermeldung: Die Graph-Ansicht wirkt wie ein Kasten; gewünscht ist eine Galaxie nach dem
Vorbild `brain-galaxy`, simpel, mit Suche, genauer Sicht auf Zusammenhänge und Vollbild am
Handy. Läuft quer zur Kette (Präzedenz P47–P51), baut auf P48 auf.

| Epic | Ergebnis | Abhängigkeit | Agenten-Wochen |
|---|---|---|---|
| [P52 — Repo-Galaxie](EPIC-P52-repo-galaxie.md) | Bereiche als Spiralsysteme, Fokus, Suche, Vollbild — **Code steht (T52.1–T52.7, T52.8 gemessen); Exit offen (Frame-Abstand, Gate-Nachweis); Handy nach P000** | keine fachliche offene (P48, ADR-0062, ADR-0053) | 1,5–2,5 |

Reihenfolge: P52 quer wie P50/P51 (je Aufgabe eigener Branch/MR nach main).

## Projektdoku und One-Command-Setup — Nutzerauftrag vom 11.11.2026

Ausdrücklicher Auftrag von Jan: README und Screenshots auf echten Stand bringen,
One-Command-Setup (Wizard, **erster Schritt: ersten Provider anbinden**, dazu ein
dedizierter Wizard-Agent), beides als Epic dokumentiert. Quer-Epic ohne fachliche
Abhängigkeit (Präzedenz P50–P52); nur Doku, Setup-Skript und Agenten-Skills — keine
Laufzeit-Architektur. Schwester-Epic: VoidWarden P14 (gemeinsame
Installations-Kaskade, in beiden Epics beschrieben).

| Epic | Ergebnis | Abhängigkeit | Agenten-Wochen |
|---|---|---|---|
| [P53 — Projektdoku und One-Command-Setup](EPIC-P53-projektdoku-setup-wizard.md) | README mit Ist-/Plan-Stand und Screenshots, wiederholbares Screenshot-Skript (Demo-Hub, secret-frei), `setup.sh`-Wizard + `npm run setup` (Provider zuerst, idempotent, fail loud), Wizard-Skill `setup-wizard`, Zusammenspiel-Abschnitt AncientVoid ↔ VoidWarden — **abgeschlossen 11.11.2026** (MR !379/!380; Retro im Epic; VoidWarden P14 gegengelesen) | keine fachliche offene (Quer-Epic) | 1,5–2,5 |
| [P54 — Ralph-Loop für alle Adapter und LLMs](EPIC-P54-ralph-fuer-alle-adapter.md) | Hub-getriebener Ralph-Connector `@ancientvoid/loop-ralph-hub` ([ADR-0110](../docs/adr/0110-ralph-im-hub.md)): Ziel + beliebige promptbare CLI + Turn-Budget im Start-Formular; Saat aus Epic, Grind bis `wartend`; Hermes-Beobachter `ralph` bleibt zweiter Weg — **abgeschlossen 2026-11-22** (PR #281; T54.5 Produktiv-Rauch; T54.6 → T000.31) | keine fachliche offene (Quer-Epic; P19/ADR-0038) | ~0,5 |
| [P57 — Doku und Onboarding](EPIC-P57-doku-onboarding.md) | Diátaxis-Ordnung, Tutorial „Erste 15 Minuten“, generierte Referenz + Drift-Regeln in `check:context`, PWA-Erststart, TTFS-Messlauf (M5-Median 0,5 min automatisch; manuelle Handy-Messung offen), Abgrenzung zu VoidWarden — **abgeschlossen 13.11.2026** ([Recherche](../docs/2026-11-13_doku-onboarding-recherche.md), [TTFS-Bericht](../docs/messlauf/2026-11-13-ttfs.md)) | P53 abgeschlossen (Quer-Epic); P33 bleibt vertagt | 2–3 |

Reihenfolge: P53 quer wie P50–P52 (Epic-Planung als eigener Branch/MR vor der
Umsetzung, damit andere Agenten das Epic sehen; dann Umsetzung je Aufgabe).

## Nutzerauftrag vom 14.11.2026 — Feinschliff, Typewriter, KI-Server-Metriken

Ausdrücklicher Planungsauftrag von Jan (vier Punkte). Recherche mit
Code-Evidenz und Zuordnung: [2026-11-14](../docs/2026-11-14_recherche_verfeinerungen_typewriter_metriken.md).
Zum Zeitpunkt des Planungsauftrags gingen zwei Punkte in die damals offenen
Epics P47 und P43.5 (neue Tasks/AC); andere laufende Epics wurden nicht
angefasst. Die P47-Ergänzung und P43.5 sind inzwischen umgesetzt (14.11.2026).

| Epic | Ergebnis | Abhängigkeit | Agenten-Wochen |
|---|---|---|---|
| [P47 — Ergänzung](EPIC-P47-uebersicht-sessions-projekte-hosts.md) | Discovery als vierter Umschalt-State der Übersicht, eigener Menüpunkt entfällt (Design-Entscheidung §3.4; Deeplink/Chip bleiben; umgesetzt 2026-11-14); T47.5/T47.6, AC-P47-5/6 | wie bisher (keine fachliche offene) | +0,25 |
| [P43.5 — Ergänzung](EPIC-P43.5-darstellungs-presets-quellenchips.md) | Composer-Maximieren-Button als Icon-Button statt Fullscreen-Fläche; T43.5-6, AC-P43.5-6 — **abgeschlossen 14.11.2026, MR !470** | P43 grün (erfüllt) | +0,1 |
| [P58 — Typewriter-Effekt](EPIC-P58-typewriter-effekt.md) | Chat und Thinking/Reasoning werden bei Live-Zuwachs getippt; Settings-Schalter; History sofort; K2-Messlauf — **umgesetzt 2026-11-14** (T58.1–T58.6, Gate grün, K2-Messlauf mit Animation PASS; Live-Abnahme am Gerät → Jan) | keine fachliche offene (Quer-Epic; P57 abgeschlossen) | ~1 |
| [P59 — KI-Server-Metriken](EPIC-P59-ki-server-metriken.md) | Neue Metrik-Seite: CPU, GPU, Tokens/s, Prefill, Decode, KV-Cache des lokalen KI-Servers; ADR vor Contract-Änderung; Abgrenzung zu P56 | keine fachliche offene (Quer-Epic; P57 abgeschlossen) | 1–2 |

Reihenfolge: P58/P59 quer wie P50–P53 (je Aufgabe eigener Branch/MR nach
main); P47/P43.5-Extras sind mit ihren jeweiligen Abnahmen umgesetzt. Kein Start vor
grünen Exit-Kriterien der wirksamen Vorgänger; P56 bleibt der einzige
Aggregationsort (P59 liefert nur direkte Proben).

## P56 — unabhängiger Statistik-Grundlagenstart (15.11.2026)

Nutzerauftrag: sinnvollsten Start aus P44/P55/P56 wählen. P56 beginnt mit
vorhandenen Zug-/Session-Fakten; T56.1a ist abgeschlossen (24 neue Tests,
vollständiges lokales Gate grün). [Metrikdefinitionen](../docs/statistik-metriken.md)
und [Epic](EPIC-P56-statistiken-page-metrik-suite.md). P30/P31 bleiben On hold;
T56.5, Katalognormalisierung/EUR-Preise und P55-Compression bleiben gesperrt.
Die Grundlage ist keine Freigabe des gesamten Epics und keine fertige PWA-Seite.

## Nutzerauftrag vom 14.11.2026 — Agenten-Teams (ehemals Runs)

Nutzermeldung nach erster Nutzung der P40-Fläche: Run-Seite visuell
unbefriedigend, Begriff „Run" nicht selbsterklärend; gewünscht: Übersicht
mit Karten je parallel laufendem Agenten (wie Session-Übersicht),
tatsächliche Parallelisierung unabhängiger Aufgaben durch den Koordinator,
vorab wählbare Adapter/Modelle. Entscheidungen (Jan, 14.11.2026): Name
wird **Team** („Factory"/„Orchestrator" kollidieren mit Loop-Factory P19/P26
bzw. Core-Klasse/Hermes-Rolle), Umbenennung überall sauber definiert — auch
Contracts. Quer-Epic auf P40-Basis (Präzedenz P47–P53); der offene P41-Exit
bleibt unberührt, die Automationen-Kopplung wird mitmigriert.
Nummernhinweis: Die Planung lief parallel zum Vier-Punkte-Auftrag auf
veraltetem main-Stand als „P58"; da P58 bereits an das Typewriter-Epic
vergeben war, führt das Epic die Nummer **P60** weiter (Repo-Regel
„Bestehende Epic-Nummern bleiben stabil", Präzedenz P46).

| Epic | Ergebnis | Abhängigkeit | Agenten-Wochen |
|---|---|---|---|
| [P60 — Agenten-Teams: Umbenennung, Kartenübersicht, Parallelität, Modellwahl](EPIC-P60-agenten-teams.md) | Run→Team vollständig umbenannt (Contracts, `/api/teams`, Policy `team.*`, Journal-Migration, `#/teams`-Redirects), Team-Detail mit Karten je Worker, breite DAGs + belegte Gleichzeitigkeit, Modell-Allowlist mit Formularauswahl (schließt ungeprüfte `task.model`-Lücke) — **umgesetzt 14.11.2026** (ADR-0077, MR !467/!468 + Abschluss-MR; Geräte-Abnahme → Endabnahme-Block) | keine fachliche offene (P40 umgesetzt, Gate grün; Live-Lauf-Block P39 unberührt) | 2–3 |

Reihenfolge: P60 quer wie P50–P53 (je Aufgabe eigener Branch/MR nach main; ADR vor der ersten Contract-Änderung).

## Nutzerauftrag vom 15.11.2026 — Mehrsprachigkeit (Veröffentlichung)

| Epic | Ergebnis | Abhängigkeit | Agenten-Wochen |
|---|---|---|---|
| [P61 — Mehrsprachigkeit: Englisch/Spracheinstellung](EPIC-P61-mehrsprachigkeit-englisch.md) | Eigen-i18n der PWA (typisierte Kataloge `de`/`en`, `t()`, Sprachwahl pro Gerät, **Default Browsersprache** mit Fallback Englisch, manuell wählbar+persistiert — entschieden 17.11.2026, Sprachliste modular für weitere Sprachen), Nachrichtenschlüssel für Notifications/Push/API-Fehler (ADR vor Contract), `hubctl --lang`, STT-Sprache, Ratchet-Gate gegen hart codierte Strings; gemessen ~2.660 Text-Kandidaten in 134 PWA-Dateien — **Code steht, Exit offen (AC-Nachweise im Epic §8; K6 nach P000 T000.29)** | keine fachliche offene (Quer-Epic; P60 umgesetzt) | 4–6 |

## Nutzerauftrag vom 16.11.2026 — Öffentliche Anleitung, Videos, Promo-Seite (nach GitHub-Umzug)

| Epic | Ergebnis | Abhängigkeit | Agenten-Wochen |
|---|---|---|---|
| [P62 — Öffentliche Anleitung (EN), Feature-Videos und Promo-Seite void.securesight.ai](EPIC-P62-public-guide-videos-promo.md) | Feature-Inventar als Contract (`docs/guide/inventory.md` + Drift-Test, AC-P62-1); englischer Guide mit per Playwright reproduzierbaren Demo-Seed-Screenshots (`npm run demo:seed`, `npm run guide:shots`, Hash-Abgleich in CI); deterministischer Leak-Guard (`check:media` + OCR in CI, neuer `pre-commit`, `avt_`-Token-Präfix, Aufnahme-Regeln `docs/demo-media.md`); Video-Pipeline: 8 Skripte mit Sprechtext fertig — **Aufnahme/Publish (YouTube) und Playlist sind Nutzeraufgaben**; statische Promo-Seite `apps/site` (`content.json`, youtube-nocookie, Smoke-Spec) mit Lighthouse-Gates (lokal belegt: Perf 100/A11y 100); Deployment per [ADR-0082](../docs/adr/0082-promo-seite-github-pages.md) (GitHub Pages, github.io-Fallback; CNAME = Nutzeraufgabe); löst P33s Doku-Kern per GO ein — **abgeschlossen 2026-11-21 — Aufnahme/Publish/Playlist und Live-DNS nach P000 verschoben** | keine fachliche offene (Quer-Epic wie P58–P61; P57 abgeschlossen, P60 umgesetzt); P61 unberührt; P30/P31 bleiben On hold | 3–4 |
| [P63 — UI-Konsolidierung: standardisiertes Design-System, Token-Treue, CSS-Hygiene](EPIC-P63-ui-konsolidierung.md) | Token-Architektur in drei Schichten (`00-tokens.css`), Leitern, Bausteine `Button`/`Chip`/`Card`/`Sheet`/`EmptyState`, BUG-0187 geschlossen, Ratchets auf 0, `design-system.md` als Vertrag (generierte Token-Tabelle + `design-tokens-fresh`), Probe `e2e/fixtures/ds-probe/`; T63.11 SessionTail-Zerlegung bewusst übersprungen (Premortem 3); Live-Geräte-Abnahme Nutzeraufgabe — **abgeschlossen 17.11.2026** | keine fachliche offene (Quer-Epic; P43 grün) | 1 |
| [P64 — Benachrichtigungs-Glocke: fester Platz im Listenkopf, Glow nach Dringlichkeit](EPIC-P64-glocke-listenkopf-dringlichkeits-glow.md) | Glocke am PC aus dem `position: fixed`-Overlay in den Kopf der Übersichtsliste (Flow, symmetrische Insets, 44 px — größer als umliegende Icons), pulsierender Glow nach höchster offener Dringlichkeit aus Semantik-Tokens (rot Fehler/`--err`, gelb offene Frage/`--warn`, grün Lauf beendet/`--ok`), statischer Ring bei `prefers-reduced-motion`, Dringlichkeits-Ableitung rein+getestet, Read-Marks löschen den Glow; Panel-Anker = Glocken-Anker in jedem Layoutzustand (Lücke im 700–1279-px-Bereich geschlossen — nie mittig im Bild), Handy/zugeklappte Liste unverändert in der Fensterecke — **abgeschlossen 2026-11-17** | keine fachliche offene (Quer-Epic); Koordinierung mit P63 (gleiche CSS-Dateien, vor T63.5) | ≤1 |
| [P65 — Status-Sounds: akustische Rückmeldung ohne VoidWarden](EPIC-P65-status-sounds.md) | `shared/audio.ts` (WebAudio-Synthese, kein Asset, Autoplay-Unlock, Rate-Limit je Kategorie 10 s), je Status ein eigener Sound aus 3–4 wählbaren Varianten bei neu ankommenden Notifications (Fehler/offene Frage/Lauf beendet/Info, gleiche Taxonomie wie P64-Glow, kein Replay beim Laden), Settings-Abschnitt „Töne“ (Master; je Kategorie an/aus, Varianten-Auswahl mit Vorschau, Lautstärke), Lautsprecher-Stumm-Knopf im Benachrichtigungs-Panel, Vibration am Handy, offline (K10), VoidWarden-Nutzer schalten einfach ab — **abgeschlossen 2026-11-17 (Geräteabnahme nach P000)** | keine fachliche offene (Quer-Epic); nach P64 empfohlen (beide berühren `Notifications.tsx`) | ≤1 |
| [P66 — Metrik-Konsolidierung: alles an einem Ort, aufgeräumt und klappbar](EPIC-P66-metrik-konsolidierung-refinement.md) | `#/statistik` wird die eine Metrik-Zentrale: System- und KI-Server-Sektionen aus dem unveränderten `GET /api/aimetrics`-Report (keine zweite Wahrheit), klappbare Sektionen mit Reload-stabilem Zustand, Filter-Dauerhaftigkeit + Zurücksetzen, Design-System-Ratchets grün; EUR (P31)/Compression (P55)/Input-Output-Token-Split (unbelegt) bleiben draußen — **abgeschlossen 2026-11-17 (Nutzerabnahme nach P000)** | EPIC-P56 grün (T56.1a–T56.4, PR #123; T56.6-Abnahme parallel); EPIC-P59 grün | 0,5–1 |
| [P67 — Main-Sync: frischer Main beim Start, laufende Synchronisation, einstellbar](EPIC-P67-main-sync.md) | Stufe 1: neue Session startet auf `origin/<Hauptbranch>` (Fetch mit Timeout, Fallback + sichtbares Event, nur auf dem Hauptbranch); Stufe 2: Sync-Engine (hinter/vor, Probelauf per `merge-tree`, Merge mit Abbruch, nur bei wartender Session) und Scheduler (ein Fetch je Projekt) mit Modi `notify`/`ask`/`auto`; Stufe 3: Einstellungen global + je Projekt (Takt, autonom/mit Bestätigung, Auto-Merge), PWA-Indikator „N hinter main“, `hubctl main-sync`; Hub-Checkout selbst aktualisieren bleibt Out — **umgesetzt (T67.1–T67.9, PRs #149–#158, `verify` grün); T67.10 Abnahme am echten Remote offen (Nutzeraufgabe, Schritte im Epic-Abschluss-Block)** | keine fachliche offene (Quer-Epic); P30/P31 On hold unberührt | 2–3 |
| [P68 — Prompt verbessern: lokales Modell zuerst, Projektkontext, Skill-Vorschläge pflegen](EPIC-P68-prompt-enhance-lokal-skill-pflege.md) | Engine-Kette lokal (`assistant.model`, Auslastung via `/slots`/503) → gewählter Adapter → OpenCode mit sichtbarem Grund je Stufe; gerahmter Projektkontext (Leitfaden, README, Manifest, Skills; ≤ 6 000 Zeichen); Skill-Empfehlung zeigt vorhandene Einträge (`mode: update`), Anpassen/Modell-Vorschlag/Speichern mit Hash-Sperre statt Dubletten (ADR-0089) — **abgeschlossen 2026-11-18 (Live-Abnahme nach P000 verschoben)** | keine fachliche offene (Quer-Epic); P30/P31 On hold unberührt | 1 |
| [P70 — Release-Notes: pro PR nachvollziehen, was geändert wurde und warum](EPIC-P70-release-notes-pr-nachvollziehbar.md) | Release-Notes-Seite `#/releasenotes` aus dem lokalen Git-Verlauf (kein Netzwerk, [ADR-0093](../docs/adr/0093-release-notes-aus-git-verlauf.md)): gemergte PRs chronologisch mit Kurzfassung aus der Commit-Notation (Risiko/Absicht/Bereich/Satz, PR-Nummer, ±Zeilen aus einem `git log --merges --shortstat`-Lauf), je PR aufklappbar Was (Branch-Commits `P1..P2` mit eigener Notation, Dateien) und Warum (PR-Beschreibung aus dem Merge-Body); zwei Routen Liste/Detail (K5-Geist, Caps + `truncated`), Subjects ohne Notation roh sichtbar statt gefiltert (fail loud), Session-Worktrees zeigen PRs bis zum Branch-Punkt — **umgesetzt 18.11.2026 (PR #172, `verify` grün; main-seitige E2E-Röte benannt, volle Messlatte im Nightly)** | keine blockierende (Quer-Epic; P67 umgesetzt, T67.10-Abnahme Nutzeraufgabe ohne gemeinsame Codeflächen); P30/P31 On hold unberührt | 0,5–1 |
| [P71 — Issue-Lebenszyklus: Anlegen, Triage, Abarbeiten, Schließen](EPIC-P71-issue-lebenszyklus.md) | Standardisierter Lebenszyklus für GitHub-Issues Ende-zu-Ende: Anlage-Klassen normiert (Template/`bug-report`/`nightly-bugs.yml`), Pflicht-Zuordnung jeder Issue zu `BUG-NNNN`/`EPIC-Pn` + Triage-Schritt, `Fixes #`-Verknüpfungspflicht auch für Epic-Task-PRs, automatischer Evidenz-Close für CI-Bug-Issues bei grünem Nightly-Job (`ci-pipeline.mjs closeResolved`), Namespace-Migration der toten Tracker-Links (14 Dateien) und Einordnung/Migration der 11 offenen Issues (#84 geschlossen+Evidenz, #83→BUG-0217, #85→BUG-0218) — **umgesetzt 18.11.2026 auf Nutzervotum; erster Live-Auto-Close mit dem nächsten Nightly (Retro §8, AI-P71-2)** | keine blockierende (Quer-Epic wie P58–P70; P70 umgesetzt); P30/P31 On hold unberührt; P69 durch Umbenennung zu EPIC-000 belegt | 2–3 Agenten-Tage |
| [P72 — Skill-Pflege nach Runs: deterministisch, per Skript, wenig Tokens](EPIC-P72-skill-pflege-nach-runs-deterministisch.md) | Bestandsaufnahme 18.11. (232 Sessions, `turn_metrics`, Skill-Zuordnung nur in ≈ 30 Runs, ≈ 39 % Shell-Aufrufe ohne Befehl bei maki/opencode); Token-Diät beim Laden (keine Doppel-Injektion Kette + nativer `/skill`, Kette nur einmal bei `nativeResume`, Contract-Fähigkeit `nativeSkills`); `check:skills` im Gate (Budgets, Links, npm-Skripte, Anker, Regel ↔ Regressionsfall; Altlasten `factory`/`git-workflow`); Skript-Skill-Muster + ≤ 2 Piloten; Run-Extraktor, Regelkatalog mit `scope: project`, Sequenz-Mining → Skript-Kandidaten, Kurator `skills:curate` (≥ 2 Runs, max. 2 Lektionen, Revert bei Rot); Auslöser per Automation-Skriptziel (ADR-0080); kein LLM, kein Auto-Commit — **abgeschlossen 2026-11-21 (T72.1–T72.12; Automation/Pilot nach P000 T000.28)** | keine blockierende (Quer-Epic; P70 grün, P71 umgesetzt, keine gemeinsamen Codeflächen); P30/P31 On hold unberührt | 1,5 |
| [P73 — Issue-Session-Bridge und sichtbare Auto-Jobs](EPIC-P73-issue-session-bridge.md) | ADR-0094: Der Hub pollt outbound nach Issues mit Trigger-Label (Standard `session`) und startet je Issue eine eigene Session (Worktree, Datenblock-Prompt unter festen Aufträgen — PRD §8.5); Dedupe/Lebenstatus im Journal (JSONL+Snapshot, K7), Start-/Ergebnis-Kommentar auf der Issue, Schließen bleibt `Fixes #`-PR; `ExternalJobInfo` (flacher Contract, kein Automation-Target) für `GET /api/automations/external` — GitHub-Actions-Läufe (TTL-Cache, K10-staleError) + Bridge-Zustand; PWA-Sektion „Externe Automatismen" mit Offline-Kopie (Snapshot v2); Sync-Marker `labels:`+`forge:` in bug-report-Skill und `docs/issues.md` — **abgeschlossen 21.11.2026 (Status-Sync, Live-Beleg AC-P73-1)** | keine blockierende (Quer-Epic; P71 umgesetzt, liefert Anlage-Klassen/Label-Basis); P30/P31 On hold unberührt; CI-Bugs labelen nicht automatisch (Out) | ~1 |
| [P74 — Knowledge-Anbindung: MCP-Backends, modulare Quellen, teamübergreifender Brain](EPIC-P74-knowledge-mcp-brick.md) | [ADR-0096 + Nachtrag](../docs/adr/0096-knowledge-source-mcp-client.md): `KnowledgeSource`-Contract in `packages/contracts` (Quelle = Konfiguration, kein Fabrik-Modul — F5 entschieden); generischer MCP-Client (Streamable HTTP, Auth `none/bearer/header` write-only) verbindet den Hub an JEDEM MCP-Knowledge-Backend (§3.3.1-Tools `kb_overview/kb_search/kb_read` + optional `kb_graph/kb_add`, Fusion/minScore sichtbar, Caps+`truncated`); Wissen-Tab im Notizen-Bereich (`#/notizen/wissen`) mit Offline-Kopie (K10), Schreiben IMMER durchs Freigaben-Gate (auch für Menschen, AC-P74-4), Agenten erreichen die k-Tools über gateway-mcp (`knowledge.list/search/read/add`, Policy `knowledge.read`/`knowledge.add`, K4 < 300 Tokens/Lookup) — AV-Seite umgesetzt (T74.2/3/6/7/9); offen: T74.4 Librarian-MCP-Fassade, T74.5 Konnektor-SDK (Checkpoint, deterministische IDs, Piloten `filesystem-markdown`+`git-repo`), T74.8 Retrieval-Benchmark (EPIC-134) + AC-P74-2 Live-Interop — alles HiveMind-Seite (F8-Schnitt); Phase 3 A2A/Agenten-Teams bewusst Out — **Code steht (AncientVoid), Exit offen (HiveMind-Fassade/Interop/Benchmark; ADR-0096-Nutzerreview = Gate)** | keine blockierende (Quer-Epic; gateway-mcp-Meta-Tool-Muster + P49 Vault-Tab als Anknüpfung); Librarian-Deployment (Kerrigan/Nemesis) als externe Abhängigkeit benannt | 2–3 (+1–2 Librarian-Seite) |
| [P76 — Aktuelle, adapterspezifische Modellkataloge](EPIC-P76-adapterspezifische-modellkataloge.md) | Native Quellen je Registrierung, Refresh/Invalidierung, sichtbare Fehler und Fallbacks; 6.2-Verfügbarkeit/Preise eingeordnet, „Kolex“ unbestätigt als Codex vermutet — **Planungsentwurf, Umsetzung gesperrt** | P75 Exit grün; P30/P31 bleiben On hold | 1–2 |
| [P77 — Separate mobile Session-Instanzen](EPIC-P77-mobile-session-instanzen.md) | Plattform-Spike, stabile Session-Einstiege
| [P78 — Token-effiziente MCP-Anbindung: Progressive Disclosure statt Tool-Flut](EPIC-P78-token-effiziente-mcp-anbindung.md) | ADR-0098-Regel: fixer Contract / Dynamic Tool Search / Code Mode; getriggerter Prototyp erst ab >1 Backend mit >20 Tools |, belegte Session-App-Installation oder benannter Tab-Fallback; Lifecycle/Recovery ohne Hauptfenster — **Planungsentwurf, Umsetzung gesperrt** | P76 Exit grün; P32 bleibt vertagt, P30/P31 On hold | 0,5–1 Evaluation + 1–2 Umsetzung |
| [P79 — Token-Tempo lokaler Inferenz in der PWA (eigener Menüpunkt)](EPIC-P79-inferenz-token-tempo.md) | Request-bezogene Verteilungen (Perzentile, KV-Reuse, TTFT) eigener Menüpunkt; tokdeck-Muster: externes Tool wird Hub-Modul — **Code steht (T79.1–T79.5, PR #264), Exit offen (T79.6/Geräteprüfung)** | — | — |
| [P80 — Pentest-Seite: Scan ausgewählter Projekte über die SiLenT-Deck-API](EPIC-P80-pentest-scanseite.md) | Neue PWA-Seite + Contract/Core-Modul/Hub-Routen; generische MCP-Anbindung (Muster ADR-0096: Backend = Konfiguration, Allowlist-Gate), SiLenT-Deck bleibt Execution-Backend und bekommt MCP-Fassade (SiLenT_Tz EPIC-04/4.9, Übergang HTTP-Adapter); K5 Blob-Grenzen, K7-Journal, K9/K10 Degeneration ohne Deck; LLM-Analyse bleibt im Deck (Injection-Grenze) — **Code steht (T80.1–T80.7, ADR-0118), Exit offen (Gate auf dem Abschluss-PR, Menschen-Abnahme → P000 T000.37)** | keine blockierende (Quer-Epic); P30/P31 On hold unberührt; externe Abhängigkeit: laufendes SiLenT-Deck | 1–2 Agenten-Tage |
| [P81 — Host-Monitoring und Strom: alle Werte aller Hosts](EPIC-P81-host-monitoring-strom.md) | Neuer Reiter „Hosts“ unter `#/statistik` (omarchy, evox2, Server, NAS; Watt/kWh ohne Euro), 90 Tage Verlauf, gemeinsame Chart-Bausteine für Statistik/Metriken/Inferenz; powermeter als Stilvorlage, nicht 1:1 — **in Umsetzung, ausgerollt 23.11.2026; Abschluss-Gate offen** | keine blockierende (Quer-Epic); ADR-0117 vor Contract | 3–4 |

## Nutzerauftrag vom 20.11.2026 — Sprachausgabe (TTS) im Chat

| Epic | Ergebnis | Abhängigkeit | Agenten-Wochen |
|---|---|---|---|
| [P75 — Sprachausgabe: Chat-Nachrichten und Fragen vorlesen](EPIC-P75-sprachausgabe-chat-vorlesen.md) | Play-Button an Agent→User-Nachrichten (Assistant-Blasen, Frage-/Approval-Karten) synthetisiert über den Hub ([ADR-0097](../docs/adr/0097-sprachausgabe-tts-hub-proxy.md): `POST /api/tts` → derselbe Hivemind-/tts-Dienst wie VoidWardens Nyx-Ansagen, Policy `voice.speak` nur Menschen, Audio transient — K5, Serialisierung max 1 wegen geteilter Box, ehrliche Verfügbarkeitsprobe nach BUG-0214-Muster); TTS-Eintrag in den Einstellungen (SettingsStore, Hörprobe, ohne Restart); kein Auto-Vorlesen, kein Cloud-TTS, kein Ghost-Processing — **abgeschlossen 2026-11-17 (Geräteabnahme nach P000)** | keine fachliche offene (Quer-Epic; P65-Audiobasis) | ~0,5 |

## Nutzerauftrag vom 24.11.2026 — Audit-Räumen (Inventar, Monolith-Schnitt, Härtung)

| Epic | Ergebnis | Abhängigkeit | Agenten-Wochen |
|---|---|---|---|
| [P82 — Audit-Räumen: Inventar, Monolith-Schnitt, Härtungsdetails](EPIC-P82-audit-raeumen-inventar-schnitt-haertung.md) | Knip-Inventar räumen und `check:knip` ins Gate; `session-manager.ts` entlang Modulnaht teilen (reines Verschieben); WS-Revocation-Recheck aus aufgelöstem Auth; Session-Tail-Tickets nach STT-/Terminal-Muster; SQL-Whitelist-Kommentare — **Abgeschlossen (25.11.2026)** | keine blockierende (Quer-Epic); P81/P79/P80-Ausläufe unberührt; P30/P31 On hold unberührt; Tracker #412 | 1–2 |
| [P83 — Team: gemeinsam arbeiten über mehrere Instanzen](EPIC-P83-team-kollaboration.md) | Nutzerauftrag 24.11.2026: gekoppelte Hubs mehrerer Menschen (mTLS im Overlay, kein öffentlicher Port), Aufgaben, Räume, Agentengrenze, geteilte Sessions, Chat mit animierten Begleitern; ADR-0118–0123 — **Planungsentwurf, Start nach grünem P82** | P82 grün; P45-No-go bleibt; Tracker #421 | 13–18 |

## Reihenfolge & Gating

Reihenfolge: **P0 → P1 → P1.5 → P1.6 → P2 → P3 → P4 → P4.5 → P5 → P6 → P7 → P8 → P9 → P10 → P10.5 → P11 → P12 → P13 → P14 → P15 → P16 → P17 → P18 → P19 → P21 → P22 → P23 → P24 → P26** (P13/P14/P17/P18/P19 unabhängig: Adaptermuster aus P3, Worktree-Hygiene bzw. Laufzeit-Robustheit auf bestehendem P5/P7/P15-Code; P16 ist die Handy-Liste, kein Start vor geklärter P12-Abnahme).

Jedes Epic endet mit messbarem Exit-Kriterium. Das folgende Epic startet erst,
wenn alle Exit-Kriterien des Vorgängers grün sind (Eval-Frage-Regel aus PRD §9.1.6).

**E2E-Gate (ab P5, 2026-09-23):** Ein Epic ist erst abgeschlossen, wenn
`npm run gate` lokal grün ist **und** die GitHub-Actions-CI (`verify`, `k8`,
`e2e`) auf dem Abschluss-PR grün ist (seit 16.11.2026; Rot allein wegen der
Umgebung wird benannt, nie als Pass gezählt — `docs/ci-runbook.md`). Ältere
Epic-DoDs, die „Pipeline-Job `e2e` auf dem Abschluss-MR“ nennen, meinen
seitdem diesen GitHub-Lauf; lokale Tests, E2Es und echte Geräte-/Provider-Abnahmen bleiben unverändert.
Jede im Epic gebaute UI-Funktion und jeder Ablauf hat
einen Spec in `e2e/specs/`. Offene Lücken stehen als `test.fixme` mit Task-
oder Bug-ID im Gate, nie als gelöschter Test. Details:
[`docs/testing-e2e.md`](../docs/testing-e2e.md).

**Ausnahme P1.5 — bewusste Umpriorisierung, kein umgangenes Gate:** Nach dem
ersten echten Einsatz der P1-Oberfläche wurde P1.5 auf Nutzerwunsch vor P2 und
den Rest von P3 gezogen, weil P2s Budget-Teil für eine reine
Subscription-Nutzung teilweise gegenstandslos ist (gebraucht wird
Kontingent-/Limit-Transparenz, kein Dollar-Budget pro Session) und interaktive
Steuerung — antworten, diktieren, mit Skill/Agent starten — aktuell mehr Wert
schafft als Diff-/Approval-UI. P3s T3.6/T3.7/T3.9 (Sprache, Prompt-Composer)
sind dabei anteilig nach P1.5 vorgezogen; P2, P3 und P4 bleiben inhaltlich
unverändert. Begründung im Detail: Vorbemerkung in
[`EPIC-P1.5-control-center-ux.md`](EPIC-P1.5-control-center-ux.md).

**Ausnahme P4.5 — dritte Umpriorisierung (2026-09-21):** P5–P12 waren als
Planungsentwürfe hinter vollständig grünem P4/G0 gesperrt. Der Nutzer hat
ausdrücklich angeordnet, zuerst Testing/Logging/Monitoring zu bauen und erst
dann P5–P12 nacheinander umzusetzen. P4s externe Restpunkte (T4.3/T4.4/T4.5/
T4.8/T4.11) bleiben offen und blockieren P4.5 nicht. Begründung:
[`EPIC-P4.5-testing-observability.md`](EPIC-P4.5-testing-observability.md).

**Ausnahme P1.6 — zweite Umpriorisierung nach demselben Muster:** P1.5s
formale DoD-Zeile (ein echter Live-Handy-Lauf) steht noch aus, aber der
Nutzer hat die P1.5-Oberfläche nach dem ersten Blick abgelehnt und über
einen eigenen Mockup-Vergleich durch eine neue Informationsarchitektur samt
„Futuristisch"-Bedienrahmen ersetzt haben wollen — den ausstehenden
Live-Test jetzt mit der bereits verworfenen Oberfläche zu machen wäre
verschwendete Zeit. P1.6 baut **keine neuen fachlichen Funktionen**, nur den
Bedienrahmen für die in P1.5 bereits gebauten; danach folgt ein gemeinsamer
Live-Handy-Test, der P1.5s und P1.6s offene Punkte gemeinsam abschließt.
Begründung im Detail: Vorbemerkung in
[`EPIC-P1.6-futuristic-ui-system.md`](EPIC-P1.6-futuristic-ui-system.md).
## Referenz-Messlatten (aus PRD §9)

K1 Approve-Latenz < 5 s · K2 Tail ohne Frame-Lag bei 30 Events/s · K3 Diff-Payload ≤ 50 KB
K4 MCP-Gateway < 1.000 Tokens statisch · K5 Adapter-Events ≤ 4 KB unchunked
K6 Sprach-Transkript ≤ 1,5 s · K7 State-Restore 100 % in < 3 s · K8 20 parallele Sessions ohne Verlust
K9 Cursor-Breakage sichtbar < 60 s · K10 PWA-Offline mit Zeitstempel
