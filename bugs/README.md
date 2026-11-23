# Bugs — beobachtete Defekte

Git/Markdown ist SSOT, analog zu `epics/`. Ein Bug ohne Repro ist eine
Vermutung; die Datei hier ist die Zusage, dass jemand den Defekt **gesehen**
hat. Das GitHub-Issue ist der Tracker für Zuweisung — nicht die zweite
Wahrheit (`gh issue create --label bug --body-file bugs/bug-NNNN-slug.md`;
Spalte „Forge“ = Issue- oder PR-URL auf `github.com/securesight-ai/AncientVoid`).

> **Hinweis zur öffentlichen Fassung:** Links auf `gitlab.com/SiLenT_Tz/…`
> (Issues, MRs, Pipelines) verweisen auf das private Entwicklungs-Repo
> (Archiv, Stand bis 16.11.2026) und sind öffentlich nicht erreichbar. Maßgeblich ist der Inhalt der Bug-Dateien;
> neue Meldungen bitte über die GitHub-Issues (siehe `CONTRIBUTING.md`).

Anlegen: Skill [`bug-report`](../.claude/skills/bug-report/SKILL.md).
Beheben: Skill [`bugfix`](../.claude/skills/bugfix/SKILL.md).

## Regeln

| Feld | Wert |
|---|---|
| Dateiname | `bugs/bug-NNNN-slug.md` — 4-stellig, kebab, ASCII |
| Vorlage | [`template.md`](template.md) |
| Nächste ID | max(existierende `NNNN`) + 1; die erste Datei ist `bug-0001-…` |
| Status | `open` · `in-progress` · `done` · `wont-fix` — im Frontmatter |
| Geschlossen | Datei **bleibt** hier; `status` und PR-Link nachziehen. Kein Archiv. |

Ein Bug ist **ein** Verhalten. Zwei Symptome → zwei Dateien.

## Index

| ID | Titel | Status | Schwere | Bereich | Forge |
|---|---|---|---|---|---|
| [BUG-0001](bug-0001-k7-recovery-race-under-load.md) | K7-Recovery-Test race unter CPU-Last | done | S3 | core | [#1](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/1) |
| [BUG-0002](bug-0002-cross-file-timer-delay-singlefork.md) | Zeitbasierte sessionmanager-Tests verzögert nach anderer Testdatei | done | S3 | core | [#2](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/2) |
| [BUG-0003](bug-0003-k7-seq-gap-unknown-cause.md) | K7-Test sah echte Sequenzlücke in CI (EventStore-Flush-Race) | done | S2 | core | [#3](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/3) |
| [BUG-0004](bug-0004-adapter-testkit-no-spawnworker-override.md) | adapter-testkit kann keinen spawnWorker-nutzenden Adapter testen | done | S2 | core | [#4](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/4) |
| [BUG-0005](bug-0005-hubctl-tail-invalid-ws-url.md) | hubctl tail -f konnte nie eine WS-Verbindung aufbauen | done | S1 | hubctl | [#5](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/5) |
| [BUG-0006](bug-0006-pwa-onboarding-unreachable.md) | Neue PWA konnte Onboarding-Flow nie durchlaufen | done | S1 | server | [#6](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/6) |
| [BUG-0007](bug-0007-ws-drop-on-slow-not-network-aware.md) | `dropped:true` reagiert nicht auf echtes gedrosseltes Netz | done | S2 | server | [#7](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/7) |
| [BUG-0008](bug-0008-heartbeat-false-error-after-normal-turn.md) | Heartbeat markiert erfolgreich abgeschlossenen Turn als `status:error` | done | S1 | core | [#8](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/8) |
| [BUG-0009](bug-0009-pwadir-silently-unresolved.md) | Fehlkonfigurierter `pwaDir` scheitert komplett still | done | S1 | server | [#9](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/9) |
| [BUG-0010](bug-0010-pwa-never-actually-typechecked.md) | `packages/pwa` wurde nie wirklich typgeprüft (oder gebaut) in CI | done | S2 | pwa | [#10](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/10) |
| [BUG-0011](bug-0011-stop-button-silently-broken.md) | "Stop"-Button sendete einen leeren Body mit JSON-Content-Type — echter 400, still verschluckt | done | S1 | pwa | — (GitLab derzeit nicht erreichbar) |
| [BUG-0012](bug-0012-tmux-env-key-shell-injection.md) | `TmuxRunner.spawn()`: unvalidierte env-Keys = echte Shell-Injection (RCE) | done | S1 | workers | — (GitLab derzeit nicht erreichbar) |
| [BUG-0013](bug-0013-mcp-gateway-sessionid-route-confusion.md) | MCP-Gateway: `sessionId` bricht per `?`/`..` aus dem Pfad-Template aus | done | S2 | gateway-mcp | — (GitLab derzeit nicht erreichbar) |
| [BUG-0014](bug-0014-search-indexes-worktree-duplicates.md) | Sprachsuche zeigt Git-Worktree-Kopien als doppelte Treffer | done | S3 | server | — |
| [BUG-0015](bug-0015-offline-reload-token-gate.md) | Offline-Neuladen zeigt Token-Anmeldung statt gecachter Sessions (K10) | done | S2 | pwa | [#11](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/11) |
| [BUG-0016](bug-0016-reopen-ignores-input-id.md) | Wiederholte Eingabe startet eine gestoppte Session zweimal | done | S1 | core | — |
| [BUG-0017](bug-0017-concurrent-reopen-double-run.md) | Handy und PC öffnen eine gestoppte Session gleichzeitig: zwei Läufe | done | S1 | core, pwa | — |
| [BUG-0018](bug-0018-recovery-replays-stopped-sessions.md) | Hub-Start liest den Verlauf jeder gestoppten Session ein (K7) | done | S2 | core | — |
| [BUG-0019](bug-0019-tmux-reap-kills-foreign-workers.md) | Ein zweiter Hub oder `npm test` tötet die tmux-Worker des laufenden Hubs | done | S1 | workers | [#65](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/65) |
| [BUG-0020](bug-0020-diff-hides-new-files.md) | Diff und Bericht zeigen keine neu angelegten Dateien | done | S2 | server | — |
| [BUG-0021](bug-0021-skill-chain-misses-base-catalog.md) | Skill-Kette ist kürzer, wenn vorher niemand die Skill-Liste geöffnet hat | done | S2 | server | — |
| [BUG-0022](bug-0022-reply-box-missing-after-offline-open.md) | Antwortfeld fehlt dauerhaft, wenn der Hub beim Öffnen kurz weg war | done | S3 | pwa | [#126](https://github.com/securesight-ai/AncientVoid/issues/126) |
| [BUG-0023](bug-0023-chat-duplicates-overlapping-batches.md) | Chat zeigt Events doppelt nach Resync oder Replay | done | S2 | pwa | — |
| [BUG-0024](bug-0024-session-link-mixes-histories.md) | Ein Link auf eine andere Session mischt beide Verläufe | done | S2 | pwa | — |
| [BUG-0025](bug-0025-tmux-kill-never-reports-exit.md) | Ein per Kill beendeter tmux-Worker meldet nie sein Ende | done | S2 | workers | [#65](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/65) |
| [BUG-0026](bug-0026-tail-opens-with-oldest-100.md) | Eine geöffnete Session zeigt nur ihre ersten 100 Events | done | S1 | server, pwa | — |
| [BUG-0027](bug-0027-stop-deletes-agent-work.md) | Stop löscht die nicht committete Arbeit eines Agenten | done | S1 | core | — |
| [BUG-0028](bug-0028-tokens-in-request-log.md) | Geräte-Tokens stehen im Klartext im Request-Log | done | S1 | server | — |
| [BUG-0029](bug-0029-hub-log-default-permissions.md) | Hub-Log wird mit der Benutzer-umask für andere lesbar angelegt | done | S3 | hub.sh | — |
| [BUG-0030](bug-0030-data-directory-world-readable.md) | Hub-Datadir und SQLite-Credentials sind für andere Benutzer lesbar | done | S2 | core, hubctl | — |
| [BUG-0031](bug-0031-token-login-waits-for-fleet-hello.md) | Token-Login wartet auf Fleet-Handshake | done | S3 | pwa | [#126](https://github.com/securesight-ai/AncientVoid/issues/126) |
| [BUG-0032](bug-0032-acp-turn-haengt-ohne-timeout.md) | ACP-Zug kann endlos hängen: kein Turn-Timeout, Herzschlag blind | done | S1 | adapters | [!124](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/124) |
| [BUG-0033](bug-0033-acp-verlauf-erst-nach-zugende.md) | ACP-Verlauf kommt live nie an + Chat-Marker fehlen (ACP vs. CLI-Adapter) | done | S2 | adapters, pwa | [!125](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/125) |
| [BUG-0034](bug-0034-messlauf-laesst-acp-worker-zurueck.md) | Messlauf hinterlässt ACP-Worker und Zombie-tmux-Server | done | S2 | messlauf, workers | [!129](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/129) |
| [BUG-0035](bug-0035-entdecken-zeigt-aelteste-zuerst.md) | Entdecken paginiert unsortiert: älteste zuerst, aktuelle erst auf Seite 3 | done | S2 | core | [!131](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/131) |
| [BUG-0036](bug-0036-acp-recovery-replayed-historie.md) | ACP-Recovery replayed die geladene Historie als neue Events | done | S1 | adapters | — |
| [BUG-0037](bug-0037-hub-down-nach-sigterm-ohne-restart.md) | Hub blieb nach SIGTERM-Exit down: kein Restart bei status 0 | done | S1 | hub.sh | — |
| [BUG-0038](bug-0038-cursor-exit-1-ohne-modell.md) | Cursor-Sessions crashen ohne Modell: Exit 1 (out of usage) | done | S1 | adapters | — |
| [BUG-0039](bug-0039-acp-adoption-verliert-historie.md) | Übernommene ACP-Session zeigt keine Historie: ewiges „lädt…" | done | S1 | adapters | — |
| [BUG-0040](bug-0040-claude-cli-klartextfehler-und-neue-eventtypen.md) | Claude-CLI: Klartext-Fehler und neue Event-Typen erscheinen kryptisch | done | S2 | adapters | — |
| [BUG-0041](bug-0041-voice-aufnahme-laeuft-bei-gesperrtem-bildschirm.md) | Voice-Aufnahme läuft weiter, wenn der Bildschirm schon gesperrt ist | done | S3 | pwa | [#126](https://github.com/securesight-ai/AncientVoid/issues/126) |
| [BUG-0042](bug-0042-invite-qr-chunk-fehler-unbehandelt.md) | Einladungs-QR: fehlgeschlagener Chunk-Abruf bleibt unbehandelt und still | done | S3 | pwa | [#126](https://github.com/securesight-ai/AncientVoid/issues/126) |
| [BUG-0043](bug-0043-verlauf-springt-nach-unten-beim-lesen.md) | Verlauf springt nach unten, während man weiter oben liest | done | S2 | pwa | — |
| [BUG-0044](bug-0044-letzte-nachrichten-unter-dem-dock.md) | Die letzten Nachrichten liegen unter dem fixierten Dock | done | S2 | pwa | — |
| [BUG-0045](bug-0045-einzelner-abruffehler-laesst-ui-flackern.md) | Ein einzelner fehlgeschlagener Abruf lässt Meldungen aufflackern | done | S3 | pwa | [#126](https://github.com/securesight-ai/AncientVoid/issues/126) |
| [BUG-0046](bug-0046-thinking-block-leer-und-aufklappbar.md) | Aufgeklappte „thinking“-Blöcke sind immer leer | done | S3 | adapters, pwa | — |
| [BUG-0047](bug-0047-pc-tippen-leert-text-vor-dem-ergebnis.md) | „Am PC eintippen“ leert den Text, bevor der PC getippt hat | done | S3 | pwa | [#126](https://github.com/securesight-ai/AncientVoid/issues/126) |
| [BUG-0048](bug-0048-freigabe-noetig-haengt-nach-neustart.md) | „Freigabe nötig“ bleibt stehen, obwohl nichts zu entscheiden ist | done | S2 | core | — |
| [BUG-0049](bug-0049-meldung-flackert-beim-tippen.md) | Eine Meldung flackert auf (Entwurf-Zeile, Hub-Hinweise, „Am PC offen“) | done | S3 | pwa, core | — |
| [BUG-0050](bug-0050-recovery-nacheinander-statt-parallel.md) | Hub-Recovery braucht 12–14 s statt unter 3 s (K7) | done | S2 | core | — |
| [BUG-0051](bug-0051-gatekeeper-wertet-heredoc-inhalt-als-befehl.md) | Gatekeeper wertet den Inhalt eines Here-Documents als Befehl | done | S2 | core | — |
| [BUG-0052](bug-0052-e2e-zufallsport-kollidiert.md) | E2E: Zufallsport der Stand-in-Server kollidiert mit fremden Prozessen | done | S3 | e2e | — |
| [BUG-0053](bug-0053-dock-im-querformat-zu-hoch.md) | Im Querformat füllt das Dock fast den Bildschirm, der Verlauf ragt darunter | done | S2 | pwa | — |
| [BUG-0054](bug-0054-token-gate-bleibt-trotz-token.md) | Die Übersicht öffnet nicht, obwohl das Token schon im Feld steht | done | S3 | pwa | [#12](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/12) |
| [BUG-0055](bug-0055-handy-devtools-bricht-im-lauf-ab.md) | Die DevTools-Verbindung zum Handy-Chrome bricht mitten im Lauf ab | done | S3 | e2e | [#13](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/13) |
| [BUG-0056](bug-0056-code-suche-nicht-im-viewport.md) | „Code durchsuchen“ liegt nach einer Aktion nicht mehr im Bild | done | S3 | pwa | [#14](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/14) |
| [BUG-0057](bug-0057-claude-discovery-tiefe-projekte-bleiben-gemunged.md) | Claude-Discovery zeigt tiefer verschachtelte Projekte gemunged statt als Pfad | done | S3 | core | keine |
| [BUG-0058](bug-0058-acp-dsh-modellkatalog-leer.md) | dsh: Modellauswahl am Handy bleibt leer (Profil models entfällt) | done | S2 | adapters | — |
| [BUG-0059](bug-0059-dsh-deklariert-bilder-ohne-bildeingabe.md) | dsh: Adapter deklariert Bilder, der Agent nimmt keine Bildeingabe | done | S3 | adapters | — |
| [BUG-0060](bug-0060-recovery-weiter-ueber-k7-trotz-parallelisierung.md) | Recovery braucht weiter über 12 s trotz paralleler Wiederherstellung (K7) | done | S2 | core | — |
| [BUG-0061](bug-0061-dsh-prompt-verbessern-fehlt.md) | „Verbessern“ fehlt für DeepSeek-Harness-Sessions | done | S3 | server, pwa | [#16](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/16) |
| [BUG-0062](bug-0062-eta-waechst-bei-altem-plan.md) | Restzeit-Schätzung wächst, statt zu schrumpfen | done | S3 | pwa | [#17](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/17) |
| [BUG-0063](bug-0063-chat-aktivitaet-unsauber-sichtbar.md) | Im Chat ist nicht sichtbar genug, ob der Agent aktiv ist | done | S3 | pwa | [#18](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/18) |
| [BUG-0064](bug-0064-pi-model-ohne-reasoning-deklariert.md) | Agent-Modell als non-thinking deklariert — Denken nicht steuerbar | done | S3 | agent-tooling | [#19](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/19) |
| [BUG-0065](bug-0065-pi-verlauf-ohne-tools-und-thinking.md) | pi-Verlauf zeigt nur die Schlussantwort: kein Streaming, keine Tool-Calls, kein Thinking | done | S2 | adapters | [#20](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/20) |
| [BUG-0066](bug-0066-pi-bekommt-exec-als-prompt.md) | pi bekommt „exec" als eigene Nachricht und den Prompt in Anführungszeichen | done | S2 | adapters | [#21](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/21) |
| [BUG-0067](bug-0067-chat-zeigt-markdown-als-rohtext.md) | Chat zeigt Markdown der Agenten als Rohtext | done | S3 | pwa | [#22](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/22) |
| [BUG-0068](bug-0068-lange-antwort-im-chat-gekuerzt.md) | Antworten über 4 KB zeigt der Chat nur mit 200 Zeichen | done | S2 | pwa | [#23](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/23) |
| [BUG-0069](bug-0069-worktree-testet-pakete-von-main.md) | Gates im Session-Worktree testen die `@ancientvoid/*`-Pakete des Haupt-Checkouts | done | S2 | core, e2e | [#24](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/24) |
| [BUG-0070](bug-0070-claude-tool-progress-heartbeat-spam.md) | Claude-Heartbeats (`tool_progress`) füllen den Verlauf mit „unhandled stream-json type“ | done | S3 | adapters | [#25](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/25) |
| [BUG-0071](bug-0071-kachel-kuerzel-veralteter-zustand.md) | Zwei Kachel-Kürzel kurz hintereinander: das zweite arbeitet auf dem Zustand vor dem ersten | done | S3 | pwa | [#26](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/26) |
| [BUG-0072](bug-0072-hub-neustart-toetet-worker.md) | Neustart oder Absturz des Hub-Dienstes tötet die Worker und bricht laufende Züge ab | done | S2 | ops | [#27](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/27) |
| [BUG-0073](bug-0073-desktop-starter-zweiter-hub.md) | Der Desktop-Starter „AncientVoid“ startet einen zweiten Hub neben dem Dienst | done | S2 | ops | [#28](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/28) |
| [BUG-0074](bug-0074-hub-heap-oom-absturz.md) | Der Hub stürzt wiederholt mit „JavaScript heap out of memory“ ab | done | S1 | core | [#29](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/29) |
| [BUG-0075](bug-0075-hub-oom-resync-schleife.md) | Hub stürzt alle ~2 Min. mit Heap-OOM ab (Resync-Schleife, unsortierte Events) | done | S1 | core, server, pwa | — |
| [BUG-0076](bug-0076-pi-fehlerstatus-nach-erfolgreichem-turn.md) | pi: fehlerfreier Folgelauf bleibt `status:error` (stale `healthy=false`) | done | S1 | adapters | — |
| [BUG-0077](bug-0077-e2e-uebersicht-spec-einmalig-unter-last.md) | E2E-Übersichts-Spec fiel einmal unter voller Suite-Last (nicht reproduziert) | wont-fix | S3 | e2e | — |
| [BUG-0078](bug-0078-neue-session-stale-agent-auswahl.md) | Gemerkter Skill/Agent blockiert Session-Start bei Adaptern ohne Unterstützung („maki kennt keine Agenten.“) | done | S2 | pwa | [#32](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/32) |
| [BUG-0079](bug-0079-maki-slash-bridge-fuehrt-commands-nicht-aus.md) | maki-Slash-Brücke führte deklarierte Commands nicht aus („/new" kam nur als Chat an) | done | S2 | adapters | [#33](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/33) |
| [BUG-0080](bug-0080-slash-new-frische-session-ohne-modell.md) | Erste Nachricht nach /new stirbt an falschem Modell (403 → „Internal error") | done | S2 | adapters | [#34](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/34) |
| [BUG-0081](bug-0081-loop-start-wirkungslos.md) | Loop-Start im neuen Session-Dialog „tut nichts" (Blocker überlesbar, Pflicht-Selects galten nicht als gewählt) | done | S2 | pwa | — |
| [BUG-0082](bug-0082-notif-panel-ui-zoom.md) | Benachrichtigungs-Panel ragt bei UI-Zoom aus dem Bildschirm | done | S3 | pwa | [#126](https://github.com/securesight-ai/AncientVoid/issues/126) |
| [BUG-0083](bug-0083-pwa-freeze-securesight-anbindungsformular.md) | securesight-Anbindungsformular friert die PWA ein (endloser Render-Loop durch leere Modell-Vorgabe) | done | S1 | pwa | — |
| [BUG-0084](bug-0084-live-smoke-spezifische-locator-mehrdeutig.md) | Live-Smoke: Locator „Status"/„Einstellungen" mehrdeutig gegen den bevölkerten Live-Hub | done | S3 | e2e | — |
| [BUG-0085](bug-0085-factory-rollen-ohne-titel.md) | Factory-Beobachter erscheint ohne Auftrag | done | S2 | pwa | [#35](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/35) |
| [BUG-0086](bug-0086-factory-start-doppelte-laeufe.md) | Factory-Start bleibt im Formular und erzeugt doppelte Läufe | done | S2 | pwa | [#36](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/36) |
| [BUG-0087](bug-0087-factory-start-verwirft-maki.md) | Factory-Start verwirft maki und Modellwahl | done | S2 | server | [#37](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/37) |
| [BUG-0088](bug-0088-factory-treiber-falscher-workdir.md) | Factory-Treiber arbeitet außerhalb des beobachteten Projekts | done | S2 | core | [#38](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/38) |
| [BUG-0089](bug-0089-e2e-ci-host-label.md) | Konfigurierter eigener Host-Name wird in Fleet ignoriert | done | S3 | server | [#39](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/39) |
| [BUG-0090](bug-0090-desktop-e2e-wartet-auf-auftrag.md) | Desktop-E2E prüft Taste vor Ausführung | done | S3 | e2e | [#40](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/40) |
| [BUG-0091](bug-0091-steer-timeout-e2e-turn-race.md) | Timeout-E2E wartet vor Folgeauftrag nicht auf Turn-Ende | done | S3 | e2e | [#41](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/41) |
| [BUG-0092](bug-0092-k7-recovery-test-flaky-parallel-last.md) | K7-Recovery-Test flaky unter paralleler Last auf demselben Host | done | S3 | core | — |
| [BUG-0093](bug-0093-desktop-e2e-zweiter-auftrag-fertig-race.md) | Desktop-E2E prüft zweiten Auftrag gegen altes „fertig“ | done | S3 | e2e | — |
| [BUG-0094](bug-0094-resize-e2e-autogrow-misst-vor-render.md) | Resize-E2E misst Auto-Grow vor dem Re-Render | done | S3 | e2e | — |
| [BUG-0095](bug-0095-fehler-exit-durch-folgeprompt-zu-interrupted.md) | Fehler-Exit wird durch sofortigen Folgeprompt zu „interrupted“ | done | S2 | core | — |
| [BUG-0096](bug-0096-drafts-e2e-adapter-merkung-dummy.md) | Neue-Session-Formular zeigt gemerkten Adapter als „dummy“ | done | S3 | pwa | [#126](https://github.com/securesight-ai/AncientVoid/issues/126) |
| [BUG-0097](bug-0097-sessionseite-scrollt-bei-ui-zoom.md) | Session-Hauptseite scrollt; Chat ragt unter den Dock (UI-Zoom) | done | S2 | pwa | — |
| [BUG-0098](bug-0098-dock-buttons-abgeschnitten.md) | Fixierter Dock schneidet Buttons ab, wenn er höher als der Screen wird | done | S2 | pwa | — |
| [BUG-0099](bug-0099-uebersicht-scrollt-als-ganze-seite.md) | Übersicht scrollt als ganze Seite statt in der Session-Liste | done | S2 | pwa | — |
| [BUG-0100](bug-0100-prompt-an-fehler-session-lauft-ins-leere.md) | Prompt an eine fehlerklassifizierte Session läuft ins Leere | done | S2 | core | — |
| [BUG-0101](bug-0101-acp-weitermachen-tot.md) | „Weitermachen" auf unterbrochener maki-Session wirkt nicht | done | S2 | adapters | — |
| [BUG-0102](bug-0102-maki-internal-error-ohne-ursache.md) | maki „Internal error" ohne Ursache | done | S2 | adapters | — |
| [BUG-0103](bug-0103-popout-mobil-und-doppelte-scrollbalken.md) | Eigenes Fenster in Handy-Breite, doppelte Scrollbalken links | done | S3 | pwa | [#126](https://github.com/securesight-ai/AncientVoid/issues/126) |
| [BUG-0104](bug-0104-popout-lesespalte-rand.md) | Eigenes Fenster nutzt nicht die ganze Fläche: 1200-px-Lesespalte als Ränder | done | S3 | pwa | [#126](https://github.com/securesight-ai/AncientVoid/issues/126) |
| [BUG-0105](bug-0105-gewaehlter-harness-startet-nicht.md) | Gewählter Harness startet nicht: stiller Treiber-Reset, Wahl überlebt Remount nicht | done | S2 | pwa | — |
| [BUG-0106](bug-0106-tool-pane-esc-flake.md) | Esc schließt die Werkzeugfläche sporadisch nicht (CI-Flake) | done | S4 | pwa | — |
| [BUG-0107](bug-0107-selection-copy-ci-flake.md) | Clipboard-Test „fertige Auswahl im Clipboard" flakt in CI | done | S4 | pwa | — |
| [BUG-0108](bug-0108-policy-fail-open-leeres-label.md) | Token mit leerem Label umgeht die komplette Policy-Tabelle | done | S3 | server | [#42](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/42) |
| [BUG-0109](bug-0109-entpacken-ohne-groessenlimit.md) | Office-Expacken ohne Entpackgrößenlimit (Decompression-Bombe) | done | S3 | core | [#43](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/43) |
| [BUG-0110](bug-0110-agent-read-mapping-kosten.md) | Agent-Token löst Kosten-/Schreib-Endpunkte ohne Approval aus | done | S4 | server | [#44](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/44) |
| [BUG-0111](bug-0111-brave-crash-unter-voller-testlast.md) | Brave fällt unter voller lokaler Testlast aus (Renderer-SIGTRAP) | done | S3 | e2e | [#45](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/45) |
| [BUG-0112](bug-0112-popout-fenster-scrollt-bei-ui-zoom.md) | Eigenes Fenster (Chat) scrollt als ganze Seite bei UI-Zoom | done | S2 | pwa | — |
| [BUG-0113](bug-0113-dateien-schublade-browser-panel-ui-zoom.md) | Dateien-Schublade und Browser-Panel falsch vermessen bei UI-Zoom | done | S3 | pwa | [#126](https://github.com/securesight-ai/AncientVoid/issues/126) |
| [BUG-0114](bug-0114-vormerken-jetzt-sendens.md) | Vorgemerkte Nachricht lässt sich nicht sofort in den laufenden Zug senden | done | S3 | pwa | [#49](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/49) |
| [BUG-0115](bug-0115-sendqueuednow-bad-request.md) | „Jetzt senden" der Vormerkung schlägt in der PWA immer mit „Bad Request" fehl (leerer JSON-Body) | done | S3 | pwa | [#50](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/50) |
| [BUG-0116](bug-0116-automation-prompt-update-hash.md) | Automation-Update prüft Prompt-Hash nicht | done | S2 | core | [#47](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/47) |
| [BUG-0117](bug-0117-dock-acht-ziele-mobil.md) | Acht Dock-Ziele überlappen auf schmalen Displays | done | S2 | pwa | [#48](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/48) |
| [BUG-0118](bug-0118-session-menue-unter-steuerung.md) | Session-Menü liegt in niedriger Kachel unter der Steuerung | done | S3 | pwa | [#126](https://github.com/securesight-ai/AncientVoid/issues/126) |
| [BUG-0119](bug-0119-stdin-epipe-beendet-hub.md) | Ein gebrochenes stdin eines Workers beendet den ganzen Hub (EPIPE) | done | S2 | workers | [#65](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/65) |
| [BUG-0120](bug-0120-parallele-playwright-laeufe-teilen-test-results.md) | Parallele Playwright-Läufe löschen sich gegenseitig die Artefakte | done | S3 | e2e | — |
| [BUG-0121](bug-0121-handy-lauf-session-test-zeitueberschreitung.md) | Am echten Handy: „neue Session aus der UI“ läuft in der Gesamtfolge in die Zeitüberschreitung | done | S3 | e2e | [#3](https://github.com/securesight-ai/AncientVoid/issues/3) |
| [BUG-0122](bug-0122-overlay-hoehen-ohne-ui-zoom-teilung.md) | Overlay-Höhen/-Breiten (Datei-Blatt, Dialoge, Composer maximiert) ohne Division durch --ui-zoom | done | S3 | pwa | P50 |
| [BUG-0123](bug-0123-doppelte-scrollbalken-session-kachel.md) | Zwei Scrollbalken rechts in der Session-Ansicht | done | S3 | pwa | P43 |
| [BUG-0124](bug-0124-menue-datei-oeffnet-dateibaum-nicht.md) | „Mehr → Datei“ öffnet den Dateibaum nicht, Tab zeigt nur einen Knopf | done | S3 | pwa | P43 |
| [BUG-0125](bug-0125-worktree-vitest-nutzt-fremde-workspace-pakete.md) | Tests im Worktree laden `@ancientvoid/*` aus dem Haupt-Checkout | done | S2 | tooling | — |
| [BUG-0126](bug-0126-native-session-verloren-session-klemmt.md) | Verlorene Provider-Session klemmt die Hub-Session fest (kein Reparieren/Übergeben) | done | S2 | adapters | — |
| [BUG-0127](bug-0127-suche-indexierung-qmd-schlaegt-fehl.md) | Such-Indexierung: qmd-Abfrage endet 500 statt 200 (4 rot-Tests auf main) | done | S2 | server | — |
| [BUG-0128](bug-0128-dateibaum-detach-als-einzelfenster.md) | Herauslösen der Datei-Seitenleiste erzeugt Einzeldatei-Fenster statt einem gebündelten Fenster | done | S3 | pwa | [#126](https://github.com/securesight-ai/AncientVoid/issues/126) |
| [BUG-0129](bug-0129-vault-ordnerwahl-symlink-ordner-fehlen.md) | Vault-Ordnerwahl: Symlink-Ordner fehlten, keine Pfad-Eingabe/Vorschläge (Fix via P51 T51.1–T51.2 / ADR-0063) | done | S3 | core | EPIC-P51 |
| [BUG-0130](bug-0130-setup-token-falsches-datadir.md) | Setup stellt Tokens in der falschen Datenbank aus | done | S2 | ops | [#51](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/51) |
| [BUG-0131](bug-0131-openai-fehler-still-verworfen.md) | OpenAI-Beispieladapter verschweigt Stream- und Folgepromptfehler | done | S2 | adapters | [#52](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/52) |
| [BUG-0132](bug-0132-setup-verwendet-fremden-hub.md) | Wizard erklärt einen fremden Hub zum erfolgreichen eigenen Setup | done | S2 | ops | [#53](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/53) |
| [BUG-0133](bug-0133-setup-node-mindestversion.md) | Angegebene Node-Mindestversion passt nicht zum ausführbaren Setup | done | S2 | ops | [#54](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/54) |
| [BUG-0134](bug-0134-setup-openai-json-escaping.md) | OpenAI-Wizard serialisiert Benutzereingaben als ungültiges JSON | done | S3 | ops | [#55](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/55) |
| [BUG-0135](bug-0135-setup-voidwarden-zweittokens.md) | Wiederholtes VoidWarden-Setup stellt zusätzliche Tokens aus | done | S3 | ops | [#56](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/56) |
| [BUG-0136](bug-0136-vormerkung-streichen-kommt-zurueck.md) | Gestrichene vorgemerkte Nachricht ist nach dem Neuladen wieder da | done | S2 | pwa, server | — |
| [BUG-0137](bug-0137-nyx-fab-laesst-sich-nicht-ziehen.md) | Der Voice-FAB lässt sich mit der Maus kaum verschieben | done | S3 | pwa | [#126](https://github.com/securesight-ai/AncientVoid/issues/126) |
| [BUG-0138](bug-0138-nyx-fab-verdeckt-dock-tasten.md) | Voice-FAB liegt in der Standardposition auf den Dock-Tasten | done | S2 | pwa | — |
| [BUG-0139](bug-0139-e2e-specs-lesen-title-statt-data-tip.md) | E2E-Specs lesen `title`, das der Tooltip-Layer in `data-tip` verschoben hat | done | S3 | e2e | — |
| [BUG-0140](bug-0140-e2e-kartenmenue-ohne-uebergeben.md) | Kleinkram-Regel 3 kennt den Kartenmenüpunkt „Übergeben…“ nicht | done | S3 | e2e | — |
| [BUG-0141](bug-0141-e2e-repo-graph-erwartet-einzeldatei-fenster.md) | Repo-Graph-Spec erwartet beim Herauslösen noch ein Einzeldatei-Fenster | done | S3 | e2e | — |
| [BUG-0142](bug-0142-e2e-fenster-schliessen-rennen.md) | „In die App zurück“ wird unter Last als „Target closed“ rot | done | S3 | e2e | — |
| [BUG-0143](bug-0143-e2e-selection-copy-ohne-fokus.md) | Markieren-kopiert-Spec unter voller Suite ohne Kopier-Bestätigung | done | S3 | e2e | — |
| [BUG-0144](bug-0144-openai-beispiel-vertrag.md) | OpenAI-Beispieladapter besteht die Testkit-Vertragsprüfung nicht | done | S3 | adapters | — |
| [BUG-0145](bug-0145-fab-verdeckt-verlaufsende.md) | Voice-FAB verdeckt das Ende des Verlaufs auf Handy und Tablet | done | S2 | pwa | — |
| [BUG-0146](bug-0146-preset-speichern-nach-paint.md) | Verlauf-Preset wird erst nach dem Zeichnen gespeichert — sofortiges Neuladen verliert es | done | S3 | pwa | [#126](https://github.com/securesight-ai/AncientVoid/issues/126) |
| [BUG-0147](bug-0147-erststart-leerer-hub-gelesen.md) | Erststart mit leerem Hub: die ersten Sessions gelten als gelesen | done | S3 | pwa | [#126](https://github.com/securesight-ai/AncientVoid/issues/126) |
| [BUG-0148](bug-0148-automations-tick-waechst.md) | Automations-Tick wächst mit der Laufzeit und blockiert den Hub | done | S2 | core | — |
| [BUG-0149](bug-0149-cursor-kontingent-unsichtbar.md) | Cursor-Kontingent lässt die Session auf „arbeitet“ hängen, ohne Fehler und ohne Übergabe | done | S2 | adapter-cursor | — |
| [BUG-0150](bug-0150-horizontale-inhaltsscroller.md) | Lange Inhalte erzeugen horizontale Scrollflächen | done | S3 | pwa | [#58](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/58) |
| [BUG-0151](bug-0151-denkpfad-verliert-werkzeuge.md) | Denkpfad verliert Tool-Zuordnungen und Denktext | done | S2 | pwa | [#57](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/57) |
| [BUG-0152](bug-0152-galaxie-vollbild-querformat-reload.md) | Galaxie-E2E rot auf main: Erwartung nach Querformat-Reload zeitlich zu streng (Produkt korrekt) | done | S4 | e2e | [#59](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/59) |
| [BUG-0153](bug-0153-erstinstallation-ohne-projektwurzeln.md) | Erstinstallation ohne projectRoots: erste Session unmöglich, Tutorial schweigt den Schritt weg | done | S2 | pwa | [#60](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/60) |
| [BUG-0154](bug-0154-endlos-dummy-vormerken.md) | Endlos-Dummy: „Vormerken" statt Senden, erste Nachricht erreicht nie den Verlauf | done | S2 | setup | [#63](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/63) |
| [BUG-0155](bug-0155-idle-trotz-hintergrundarbeit.md) | Session wird idle, obwohl zugehörige Hintergrundarbeit läuft | done | S2 | core | [#62](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/62) |
| [BUG-0156](bug-0156-hub-stop-fremde-instanz.md) | hub.sh steuert aus einem anderen Checkout die Produktiv-Unit | done | S1 | ops | [#64](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/64) |
| [BUG-0157](bug-0157-tmux-alter-handle-killt-nachfolger.md) | Alter tmux-Handle beendet den Nachfolger derselben Session | done | S2 | workers | [#65](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/65) |
| [BUG-0158](bug-0158-codex-ablehnung-als-erfolg.md) | Codex bestätigt abgelehnte Folgeeingaben als angenommen | done | S2 | adapter-codex | [#61](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/61) |
| [BUG-0159](bug-0159-nyx-fab-feedback-blende-steht-dauerhaft.md) | Feedbackblende des Nyx-Voice-FAB steht nach der Aufnahme dauerhaft | done | S3 | pwa | [#457](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/457) |
| [BUG-0160](bug-0160-galaxy-route-verliert-tab-bei-kacheloffnung.md) | Graph-Deep-Link verliert den Reiter beim Öffnen der Kachel | done | S3 | pwa | [#126](https://github.com/securesight-ai/AncientVoid/issues/126) |
| [BUG-0161](bug-0161-tool-aktivitaet-beendet-hauptzug-vorzeitig.md) | Ein Tool-Aktivitätsende beendet den Hauptzug vorzeitig | done | S1 | core | — |
| [BUG-0162](bug-0162-exit-regex-matcht-fremde-event-typen.md) | Exit-Regex matcht fremde Event-Typen | done | S2 | core | — |
| [BUG-0163](bug-0163-ci-verify-rot-seit-11-11.md) | CI: `verify` seit dem 11.11. durchgehend rot (4 Umgebungstests), lokal grün | done | S2 | ci | [#4](https://github.com/securesight-ai/AncientVoid/issues/4) |
| [BUG-0164](bug-0164-offline-diff-verliert-stand.md) | Offline-Nachladen verwirft den sichtbaren Diff | done | S3 | pwa | [#67](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/67) |
| [BUG-0165](bug-0165-restart-session-working-ohne-worker.md) | Restart lässt Session dauerhaft `working` ohne Worker | done | S2 | core | [!481](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/481) |
| [BUG-0166](bug-0166-automation-neuanlage-aktiv.md) | Automation-Neuanlage übernimmt Aktivierung | done | S2 | core | [#46](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/46) |
| [BUG-0167](bug-0167-fastify-update-macht-zughistorie-flaky.md) | fastify ≥ 5.12.6 macht „ohne Plan, mit Zughistorie“ flaky (Pin auf 5.12.5) | open | S3 | server | [#5](https://github.com/securesight-ai/AncientVoid/issues/5) |
| [BUG-0168](bug-0168-fleet-steer-dedup-race-auf-langsamer-hardware.md) | Fleet-Steer-Dedup greift auf langsamer Hardware nicht (2 user-Events) | done | S3 | hub | [#12](https://github.com/securesight-ai/AncientVoid/issues/12) |
| [BUG-0176](bug-0176-starten-klick-von-arbeitsort-feld-ueberdeckt.md) | Starten-Klick im Neue-Session-Formular wird zeitweise vom Arbeitsort-Feld überdeckt (E2E-Flake) | open | S3 | e2e | [#28](https://github.com/securesight-ai/AncientVoid/issues/28) |
| [BUG-0177](bug-0177-spracheingabe-bricht-ab-und-ist-nicht-stoppbar.md) | Spracheingabe endet nach 10 s/60 s, kein Wort-für-Wort, erneut tippen kann nicht stoppen, Text doppelt nach Chrome-Neustart | done | S1 | pwa | — |
| [BUG-0178](bug-0178-agent-ausgabe-nur-vorgetaeuscht-gestreamt.md) | Agent-Ausgabe wird nur vorgetäuscht gestreamt: Adapter verwerfen Deltas, PWA tippt fertige Blöcke ab | done | S2 | pwa | — |
| [BUG-0179](bug-0179-e2e-stand-ins-lassen-sich-auf-windows-nicht-spawnen.md) | E2E-Stand-in-CLIs (Shebang ohne Extension) spawnen auf Windows nicht — Adapter-E2E sind lokal nicht prüfbar | done | S2 | e2e | — |
| [BUG-0180](bug-0180-z-fold-ausgeklappt-verschenkt-die-breite.md) | Ausgeklappter Z Fold (832 px, hoch): 680-px-Spalte mittig, Sitzungsliste quer scrollbar | done | S2 | pwa | [#40](https://github.com/securesight-ai/AncientVoid/pull/40) |
| [BUG-0181](bug-0181-app-dreht-nicht-mit-und-querformat-ohne-leshoehe.md) | App dreht nicht mit (Manifest `portrait-primary`); gedreht fraß der Dock 278 von 412 px, der Chat behielt 48 px | done | S2 | pwa | — |
| [BUG-0183](bug-0183-test-laeufe-ueberschreiben-das-live-buendel-des-hubs.md) | Playwright- und Guide-Läufe bauten in `apps/pwa/dist` — derselbe Ordner, den der laufende Hub am Handy servt: Fixes waren weg, ohne dass jemand deployt hätte | done | S1 | tests | [#50](https://github.com/securesight-ai/AncientVoid/pull/50) |
| [BUG-0184](bug-0184-token-summe-ist-kontext-quadrat-statt-verbrauch.md) | „Σ 244 Mio Tokens“ ist der aufaddierte Kontext (1.744 Aufrufe × Verlauf), nicht der Verbrauch — Erzeugtes ist nirgends sichtbar | done | S1 | pwa | [#48](https://github.com/securesight-ai/AncientVoid/pull/48) |
| [BUG-0185](bug-0185-token-bilanz-steht-auf-fruehem-abruf.md) | Token-Bilanz der Statuszeile bleibt auf dem Abruf vor dem Zug-Ende stehen — „erzeugt/verarbeitet“ fehlen dauerhaft; Inventarzeile S20 mit zwei Nachweisen rot | done | S2 | pwa | [#54](https://github.com/securesight-ai/AncientVoid/issues/54) |
| [BUG-0186](bug-0186-installierte-app-dreht-nicht-mit-trotz-freiem-manifest.md) | installierte App drehte nicht: Chromes Installations-Metadaten hielten die alte Manifest-Ausrichtung fest; nach Entfernen+Neuanlegen meldet die App 270° und 970x796 | done | S2 | pwa | — |
| [BUG-0187](bug-0187-geister-tokens-fremde-fallback-farben.md) | Geister-Tokens mit fremder Fallback-Palette im Diff-, Dateien- und Arbeitsort-Styling | done | S3 | pwa | [#84](https://github.com/securesight-ai/AncientVoid/issues/84) |
| [BUG-0188](bug-0188-hermes-stumm-native-binding-verloren.md) | Hermes-Session verstummt bei langen Turns; native Session (Resume-Griff) nach Stop verloren | done | S1 | core, adapter-hermes | [#133](https://github.com/securesight-ai/AncientVoid/pull/133) |
| [BUG-0188](bug-0188-projekt-anlegen-ignoriert-host.md) | „+ Anlegen“ in der Neuanlage legt Projekte immer auf dem heimischen Hub an — gewählter Fleet-Host wird ignoriert, Liste und Pfad springen auf lokal | done | S2 | pwa | [#62](https://github.com/securesight-ai/AncientVoid/issues/62) |
| [BUG-0189](bug-0189-bugs-ohne-statusfarben-im-dateibaum.md) | `bug-*.md` im Dateibaum ohne Statusfarben — Epics haben Punkte (grün/gelb/blau/grau) | done | S4 | pwa | [#72](https://github.com/securesight-ai/AncientVoid/issues/72) |
| [BUG-0190](bug-0190-git-historie-graph-unleserlich.md) | Git-Historie: Lane-Linien, Farben ohne Legende, Worktree-Refs nur als UUID | done | S3 | pwa | [#73](https://github.com/securesight-ai/AncientVoid/issues/73) |
| [BUG-0191](bug-0191-git-historie-datei-oeffnet-nur-workdir.md) | Datei aus Git-Historie öffnet nur Worktree-Stand — gelöschte/alte Pfade → 404 | done | S2 | pwa | [#74](https://github.com/securesight-ai/AncientVoid/issues/74) |
| [BUG-0192](bug-0192-slash-commands-nicht-bei-allen-anbietern.md) | Slash-Commands fehlen bei den meisten Anbietern — opencode/ACP-Dispatch live belegt, Deklaration fehlte | done | S3 | adapters | — |


| [BUG-0169](bug-0169-e2e-global-setup-npm-auf-windows.md) | E2E-Global-Setup spawnnt `npm` ohne Shell — auf Windows läuft kein einziger E2E-Test | done | S3 | e2e | — |
| [BUG-0170](bug-0170-testsuite-auf-windows-rot.md) | `npm test` ist auf Windows breit rot (CRLF, Symlinks, Spawn/Signale) — Gate und `^`-Commits blockiert | open | S2 | tests | — |
| [BUG-0171](bug-0171-session-start-fehlt-bei-neuem-ordner.md) | Session-Start in noch nicht existierendem Ordner scheitert mit falscher Begründung | done | S2 | core | — |
| [BUG-0172](bug-0172-ordner-ohne-git-nicht-waehlbar.md) | Ordner ohne `.git` erscheinen nie in der Projektauswahl | done | S3 | core | — |
| [BUG-0173](bug-0173-neue-session-vergisst-letzten-pfad.md) | Gemerkter Pfad, Anlegen-Block und Wurzelhinweis hängen an der Zahl gefundener Git-Ordner | done | S3 | pwa | [#126](https://github.com/securesight-ai/AncientVoid/issues/126) |
| [BUG-0174](bug-0174-zweite-session-im-gleichen-ordner.md) | Zweite Session im selben Ordner ist ohne Git eine Sackgasse | done | S2 | core | — |
| [BUG-0175](bug-0175-projektfilter-vergleicht-slash-pfade.md) | `outsideRoots()` vergleicht mit `/` und filtert Windows-Sessions komplett weg | done | S2 | core | — |


| [BUG-0182](bug-0182-web-push-4-esm-import.md) | web-push 4 verhindert den Hub-Import (ESM) | done | S1 | core | [#26](https://github.com/securesight-ai/AncientVoid/pull/26) |
| [BUG-0193](bug-0193-schneller-testloop-laeuft-auf-windows-nicht.md) | `test:fast`/`test:slow` setzen die Tier-Umgebung inline — auf Windows (cmd.exe) gibt es dafür kein Ergebnis, der schnelle Loop war dort unbenutzbar | done | S2 | repo | — |
| [BUG-0194](bug-0194-niedriges-querformat-dock-haengt-an-der-listenspalte.md) | niedriges Querformat: Dock an der Listenspalte eingerueckt (Tabs + Eingabe unter der Kante), Warteschlangen-Text auf 390 px unlesbar | done | S2 | pwa | — |
| [BUG-0195](bug-0195-live-thinking-groesser-als-die-denk-notiz.md) | das live uebertragene Denken war groesser, gerahmt und hinterlegt (15 px + Akzentkasten) statt wie eine Denk-Notiz (12 px, dimmt, kursiv) | done | S3 | pwa | [#126](https://github.com/securesight-ai/AncientVoid/issues/126) |
| [BUG-0196](bug-0196-windows-projektpfad-statt-projektname.md) | PWA zeigt unter Windows den vollen Projektpfad (inkl. Benutzername) statt des Projektnamens — `split("/")` an 20 Stellen | done | S2 | pwa | — |
| [BUG-0197](bug-0197-inventar-g19-s04-nach-ui-konsolidierung-rot.md) | nach PR #94 meldete das Inventar veraltete Leerzustands-Selektoren (`.empty`/`.empty-state` statt `ui-empty`) — Produkt war korrekt; 6 failed wurden 10 passed / 1 failed | done | S2 | pwa | — |
| [BUG-0198](bug-0198-check-context-token-tabelle-falschalarm-auf-windows.md) | `check:context` meldet auf Windows (CRLF-Checkout) „Token-Tabelle veraltet“, obwohl nichts veraltet ist — Generator schreibt LF in ein CRLF-Dokument | done | S3 | repo | — |
| [BUG-0199](bug-0199-sprach-fab-liegt-auf-einstellungen-ueber-einer-reihe.md) | der Sprach-FAB verdeckt auf langen Seiten (Einstellungen, y=3200) den Pinch-Zoom-Schalter — elementFromPoint trifft `nyx-fab`, der Schalter ist nicht erreichbar | done | S2 | pwa | — |
| [BUG-0200](bug-0200-mehr-menue-in-eigenen-fenstern-offnet-nicht.md) | Menüpunkte des „Mehr“-Menüs lagen im Kachelkopf hinter der Steuerung (Stapelkontext `--z-sticky` < `--z-dock`) — jetzt erbt der Kopf nur im geöffneten Zustand `--z-sheet`; Inventar 9 passed | done | S2 | pwa | — |
| [BUG-0201](bug-0201-nyx-fab-am-pc-liegt-ueber-dem-verlauf.md) | am PC lag der Nyx-FAB in der Viewport-Mitte und deckte eine Verlaufszeile ab — PC-Default sitzt jetzt unten links in der freien Liste | done | S3 | pwa | [#126](https://github.com/securesight-ai/AncientVoid/issues/126) |
| [BUG-0202](bug-0202-cursor-interaction-query-fehlt-im-chat.md) | Cursor `interaction_query`/`tool_call` nur als `cursor.unhandled` im Verlauf — Plan-/Auswahlfrage fehlt im Chat | done | S2 | adapters | [#116](https://github.com/securesight-ai/AncientVoid/issues/116) |
| [BUG-0203](bug-0203-wurzel-commit-im-bereich-laesst-den-ganzen-aenderungs-diff-fallen.md) | ein Eltern-loser Commit im Bereich liess den gesamten Aenderungsdiff ausfallen (`sha^` existiert nicht) — diffet jetzt gegen den leeren Baum | done | S2 | hub | — |
| [BUG-0204](bug-0204-ubergrosser-aenderungs-diff-faellt-wegen-maxbuffer-komplett-raus.md) | ein Commit-Diff ueber der Groessenkante loeschte den gesamten Aenderungs-View (live: `stdout maxBuffer length exceeded`) — jetzt Teilbefund pro Commit, uebrige Commits bleiben lesbar | done | S2 | hub | — |
| [BUG-0205](bug-0205-metrik-karten-ohne-region-role.md) | die Karten der Metrik-Seite haben nach der P63-Baustein-Migration keine region-Rolle mehr — `getByRole("region", { name: "Metrik-Quelle …" })` (ki-server-metriken.spec) findet sie nicht | done | S3 | pwa | [#117](https://github.com/securesight-ai/AncientVoid/issues/117) |
| [BUG-0206](bug-0206-terminal-css-bricht-token-ratchet.md) | Terminal-CSS aus PR #125 bricht den css-tokens-Ratchet (3 Farbliterale, 2 var-Fallbacks, Phantom-Token `--danger`) — main stand rot | done | S3 | pwa | [#126](https://github.com/securesight-ai/AncientVoid/issues/126) |
| [BUG-0207](bug-0207-live-strom-rollt-nicht-mit.md) | beim Live-Strom waechst der Text unter der Lesespitze weg, die Liste rollt nicht mit (Harness: Blase 911 px bzw. 891 px unter dem Rand) — Follow hing an Ereignissen, nicht an Frames | done | S3 | pwa | — |
| [BUG-0208](bug-0208-nach-strom-ende-auf-nachrichtenanfang-scrollen.md) | nach dem fertigen Strom steht die Spitze am ENDE der Nachricht, ihr Anfang bleibt oberhalb (Harness: −12 355 px, Liste klebt am Fuss) | done | S3 | pwa | — |
| [BUG-0209](bug-0209-session-bleibt-working-nach-abschluss.md) | Sessions bleiben nach fertigem Zug auf „arbeitet“ (pi: recover ohne adoptWorker; ACP: Werkzeugaufruf ohne terminales Update hält das Register offen) | done | S2 | core | — |
| [BUG-0210](bug-0210-sound-taste-schwebt-mittig-im-panel-kopf.md) | die Sound-Taste im Benachrichtigungs-Panel-Kopf schwebt fast mittig statt neben ✕ (`space-between` mit drei Kindern, Spalt 82 px gemessen) — Titel füllt jetzt den Rest, Tasten liegen benachbart | done | S4 | pwa | [#146](https://github.com/securesight-ai/AncientVoid/issues/146) |
| [BUG-0211](bug-0211-chat-spitze-nicht-erreichbar.md) | lange Gespraechte hoeren nach 500 Eintraegen auf: hochscrollen kommt nicht an den Anfang (Harness: aelteste Folge 45 von 544, nichts zum Holen) | done | S3 | pwa | — |
| [BUG-0212](bug-0212-terminal-stream-401-auth-hook.md) | Terminal-Verbinden scheitert fuer jedes Ziel mit „WebSocket-Fehler": der authHook weist den WS-Upgrade auf /api/terminals/:id/stream mit 401 ab (Browser-WS traegt keinen Bearer; Ticket-Freistellung wie bei STT fehlte) | done | S2 | server | — |
| [BUG-0213](bug-0213-statistik-500-tool-korrelation.md) | /api/statistics 500 „Tool-Ergebnis ohne zusammengehörigen Aufruf" — K5-ausgelagerte Ergebnisse und Resume-Replay-Bloecke im Journal legten die Statistik-Seite komplett lahm; Zaehlung statt Wurf | done | S2 | core | — |
| [BUG-0214](bug-0214-stt-verfuegbarkeit-geschwindelt-kein-browser-rueckfall.md) | eigene Spracherkennung abgeschaltet, `GET /api/stt` meldet weiter `available:true` (allein aus der Konfiguration), App haelt an den toten lokalen Weg fest statt auf die Browser-Erkennung umzuschalten | open | S2 | pwa | — |
| [BUG-0215](bug-0215-live-woerter-enden-nach-einer-minute.md) | 85-Sekunden-Diktat am Live-Hub: Teiltexte bis 57 s, dann „Sprachaufnahme dauerte länger als 60 Sekunden“ — Live-Vorschau endet mitten im Satz | done | S2 | hub | — |
| [BUG-0216](bug-0216-endtext-des-streamten-diktats-traegt-fremden-namen.md) | streamendes Diktat endet mit „engine=Nemotron 3.5 ASR Streaming“, obwohl `stt.streaming.engine` auf unsere Radeon-Erkennung steht — main.ts gibt den Schluessel nicht weiter |
| [BUG-0217](bug-0217-aktivitaetsregister-zeitkritisch-auf-hosted-runner.md) | Aktivitätsregister-Test auf Hosted-Runnern zeitkritisch — 1 von 2139 rot, Neustart grün (Issue #83, nachgezogen EPIC-P71) | open | S3 | tests | [#83](https://github.com/securesight-ai/AncientVoid/issues/83) |
| [BUG-0218](bug-0218-tier-a-parallel-zeitkritische-flakes.md) | drei Tests rotieren unter parallelem Tier A (8 Forks): handover, steer-wait-timeout, turn-state — je 1 von 3 Läufen rot (Issue #85, nachgezogen EPIC-P71) | open | S3 | tests | [#85](https://github.com/securesight-ai/AncientVoid/issues/85) |
| [BUG-0219](bug-0219-mainsync-stand-gehoert-zur-auswahl.md) | Hinweis „N hinter main“ gehört nicht zur Auswahl: Abfrage läuft nur beim Mount, Kachelfokus und Rückkehr zur offenen Ansicht zeigen den Stand eines früheren Zeitpunkts/anderen Projekts (zuerst als 0217 geführt, nach Kollision mit main umnummeriert) | done | S3 | pwa | [#180](https://github.com/securesight-ai/AncientVoid/issues/180) |
| [BUG-0220](bug-0220-activity-begin-herzschlag-flutet-eventstore.md) | wiederholte Running-Reports (Herzschlag/verklemmter Provider) emittieren jedes Mal `session.activity_begin` — 18 547 Events/6,8 MB in einer Session, 103 echte Aktivitäten; Fix: Dedupe im Register, `startedAt` wird aufgefrischt (PR #185) | done | S2 | core | [#184](https://github.com/securesight-ai/AncientVoid/issues/184) |
| [BUG-0221](bug-0221-hintergrundbild-upload-quetscht-beschriftung.md) | Hintergrundbild-Upload quetscht die Beschriftung auf 1 Buchstabe/Zeile — die Container-Stapel-Regel kannte file-Inputs nicht; Fix: mitstapeln + `max-width: 100%` fürs Input | done | S3 | pwa | [#188](https://github.com/securesight-ai/AncientVoid/issues/188) |
| [BUG-0222](bug-0222-benachrichtigungen-doppelt-und-veraltet.md) | Benachrichtigungen doppelt und veraltet: überlappende Polls (Peers ohne Timeout, 4-s-Intervall ohne In-Flight-Guard) spielen Antworten nach — Toast/Zeile kommt mehrfach; Fix: take() filtert id<=known, Merge dedupliziert nach Key, Poll-Guard (PR #194) | done | S2 | pwa | [#192](https://github.com/securesight-ai/AncientVoid/issues/192) |
| [BUG-0223](bug-0223-os-push-trotz-offener-app.md) | OS-Push und In-App-Toast melden dieselbe Nachricht doppelt, wenn die App sichtbar ist — der push-Handler im Service Worker prüft keine sichtbaren Fenster; Fix: Sichtbarkeitsprüfung, Test-Push ausgenommen (PR #195) | done | S3 | pwa | [#193](https://github.com/securesight-ai/AncientVoid/issues/193) |
| [BUG-0224](bug-0224-mainsync-scheduler-flutet-benachrichtigungen.md) | Main-Sync-Scheduler flutet die Glocke: Fetch-Fehler meldete je Session (41 Sessions = 41 Rows je Lage), dry-run/apply-Fehler und Konflikte ohne Dedup je Takt, behind je Session statt je Projekt — live 2070 Rows/2 Tage; Fix: Dedup je Projekt+Stand bzw. je Session+Ursache | done | S2 | core | [#197](https://github.com/securesight-ai/AncientVoid/issues/197) |
| [BUG-0226](bug-0226-glocke-zeigt-monatealte-notifications.md) | Glocke zeigt Notifications von vor zwei Monaten, auch zu gelöschten Sessions: keine Retention in der Tabelle (live 3176 Zeilen seit 2026-09-23, 22 verwaist), `notifications()` filtert weder Alter noch Session-Status, `delete()` räumt die Meldungen nicht mit, erster Poll füllt still mit `after=0`, offline serviert der SW die gecachte Seite als erfolgreichen Poll | open | S2 | server | [#204](https://github.com/securesight-ai/AncientVoid/issues/204) |
| [BUG-0227](bug-0227-stt-konvertierung-stirbt-am-tmp-quota.md) | Längere Diktate sterben mit 422 „Aufnahme nicht lesbar (UNKNOWN: unknown error)": 43 604 geleakte Test-Temp-Verzeichnisse füllten /tmp (tmpfs, usrquota, 91 % Inodes), bis toWav() am Quota scheitert — kurze Clips rutschen durch, längere nicht; Fix: /tmp einmalig leergeräumt (live bewiesen) + Sweeper im Vitest-Global-Setup | done | S2 | hub | [#205](https://github.com/securesight-ai/AncientVoid/issues/205) |
| [BUG-0228](bug-0228-archivieren-verlaesst-ansicht-nicht.md) | Archivieren verlässt die Ansicht nicht: Handy/Tablet bleibt in der Session geöffnet, am PC bleibt die Kachel mit der archivierten Session belegt (auch bei Fernarchivierung übers Handy); Fix: `leaveArchived()` in SessionTail — Kachelkontext räumt über `onArchived`/`onClose` ab, sonst `onNavigate("dashboard")`, der Übergang nicht-archiviert→archiviert im 3-s-`record`-Poll löst dasselbe aus | done | S3 | pwa | [#214](https://github.com/securesight-ai/AncientVoid/issues/214) |
| [BUG-0229](bug-0229-graph-pan-touch-blockiert.md) | Repo-Graph: Pan und Tap gehen nicht (Maus wie Touch) — das Hit-Overlay lag flächig über dem Canvas und schluckte jede Pointer-Eingabe; Handler liegen jetzt am Wrap, Overlay ist durchlässig, Klick nach Pan unterdrückt | done | S1 | pwa | [#217](https://github.com/securesight-ai/AncientVoid/issues/217) |
| [BUG-0230](bug-0230-graph-vollbild-ohne-schliessen.md) | Graph-Vollbild am PC ohne erkennbaren Schließen-Knopf (nur „←“), Fläche bei UI-Zoom über den Bildschirm — beschrifteter „✕ Vollbild verlassen“-Knopf oben rechts, Höhe durch --ui-zoom geteilt | done | S2 | pwa | [#218](https://github.com/securesight-ai/AncientVoid/issues/218) |
| [BUG-0231](bug-0231-graph-handy-unscharf-zoom-flach.md) | Repo-Graph am Handy unscharf und zu flacher Zoom — Backing-Store jetzt Gerätepixel × UI-Zoom (mit Scale-Listener), SCALE_MAX 32, Pinch-Zoom über Pointer-Map, Hit-Flächen gedeckelt | done | S2 | pwa | [#219](https://github.com/securesight-ai/AncientVoid/issues/219) |
| [BUG-0232](bug-0232-graph-kategorien-stattdessen-gruppen.md) | Graph-Filter kannte nur Doc/Code/Config — Kategorie-Bereiche (epics, bugs, …) kommen jetzt dynamisch aus dem Repo: category im Contract/Scan, Chips je Häufigkeit, Filter + Persistenz | done | S3 | core, pwa | [#220](https://github.com/securesight-ai/AncientVoid/issues/220) |
| [BUG-0233](bug-0233-graph-dateiklick-ohne-viewer.md) | Datei im Graph anklicken öffnete weder Viewer noch Dateibaum — Stern-Klick führt jetzt Auswahl + onOpenFile aus, ab 700 px geht der Dateibaum-Layer mit auf; Browsing über Suche/Nachbarn bleibt ohne Öffnen | done | S2 | pwa | [#221](https://github.com/securesight-ai/AncientVoid/issues/221) |
| [BUG-0234](bug-0234-session-zurueck-pfeil-am-breiten-layout.md) | Zurück-Pfeil neben dem Session-Titel auch am Tablet/PC, obwohl die Liste dort dauerhaft sichtbar ist — ab 700 px ausgeblendet (Media Query wie TABLET/WIDE), am Handy erhalten | done | S4 | pwa | [#222](https://github.com/securesight-ai/AncientVoid/issues/222) |
| [BUG-0235](bug-0235-claude-steering-hintergrundarbeit.md) | Claude-Steering und Queue warten auf Hintergrundarbeit | done | S2 | adapters, core | [#213](https://github.com/securesight-ai/AncientVoid/issues/213) |
| [BUG-0236](bug-0236-rueckfragen-fehlt-blau.md) | Rückfragen erscheinen mit Freigabefarbe | done | S3 | pwa | [#225](https://github.com/securesight-ai/AncientVoid/issues/225) |
| [BUG-0237](bug-0237-optionsfrage-eigene-antwort.md) | Optionsfragen wirken wie Pflicht zur Texteingabe | done | S2 | pwa | [#226](https://github.com/securesight-ai/AncientVoid/issues/226) |
| [BUG-0238](bug-0238-todos-bei-rueckfrage-unsichtbar.md) | Gemeldete To-dos verschwinden während einer Rückfrage | done | S3 | pwa | [#227](https://github.com/securesight-ai/AncientVoid/issues/227) |
| [BUG-0239](bug-0239-hintergrundaufgaben-ohne-details.md) | Hintergrundaufgaben werden nur gezählt | done | S3 | pwa | [#228](https://github.com/securesight-ai/AncientVoid/issues/228) |
| [BUG-0240](bug-0240-kontextfenster-nativ-fehlt.md) | Gemeldete Kontextfenster von Codex und Claude fehlen | done | S3 | adapters, pwa | [#229](https://github.com/securesight-ai/AncientVoid/issues/229) |
| [BUG-0241](bug-0241-omp-kontingent-reset-fehlt.md) | Das ausgeschöpfte OMP-Kontingent verliert seine Reset-Zeit | done | S3 | contracts, pwa | [#230](https://github.com/securesight-ai/AncientVoid/issues/230) |
| [BUG-0242](bug-0242-harness-metadaten-fehlen.md) | Native ACP-Kontextmeldung wird verworfen | done | S3 | adapters, pwa | [#231](https://github.com/securesight-ai/AncientVoid/issues/231) |
| [BUG-0243](bug-0243-archiv-loeschen.md) | Archiv-Sessions lassen sich nicht gesammelt oder zuverlässig löschen | done | S3 | pwa, hub, core | [#234](https://github.com/securesight-ai/AncientVoid/issues/234) |
| [BUG-0244](bug-0244-neue-session-kachel1-layout.md) | Neue Session öffnet nicht in Kachel 1; Formular zu lang | done | S3 | pwa | [#236](https://github.com/securesight-ai/AncientVoid/issues/236) |
| [BUG-0245](bug-0245-fenster-fokus-leer.md) | Eigenes Fenster: Duplikat statt Fokus; Schließen hinterlässt Leer-Kacheln | done | S2 | pwa | [#237](https://github.com/securesight-ai/AncientVoid/issues/237) |
| [BUG-0246](bug-0246-session-delete-orphan-projekt.md) | Session-Löschen scheitert an toten Projekten; Reste bleiben | done | S2 | core, hub | [#240](https://github.com/securesight-ai/AncientVoid/issues/240) |
| [BUG-0247](bug-0247-maki-normalizer-ohne-bash-command.md) | maki `bash`-tool_use ohne `command` (nur `title`) — Kuratierung blind | done | S3 | adapters | [#242](https://github.com/securesight-ai/AncientVoid/issues/242) |
| [BUG-0248](bug-0248-opencode-normalizer-ohne-shell-command.md) | opencode `shell`/`bash`-tool_use ohne `command` (nur `cwd`) — Kuratierung blind | done | S3 | adapters | [#243](https://github.com/securesight-ai/AncientVoid/issues/243) |
| [BUG-0249](bug-0249-continue-link-faellt-auf-root.md) | Continue-Link im Bericht fällt auf `#/` zurück (nur der Link, nicht das Kommando) | done | S3 | pwa | [#251](https://github.com/securesight-ai/AncientVoid/issues/251) |
| [BUG-0250](bug-0250-e2e-anker-chip-statusfilter-verwaist.md) | E2E-Anker `.chip.status-filter` verwaist nach Baustein-Migration (Chip rendert `ui-chip`) | done | S3 | pwa, e2e | [#252](https://github.com/securesight-ai/AncientVoid/issues/252) |
| [BUG-0251](bug-0251-gefunden-einstieg-doppelt.md) | „Gefunden“-Einstieg doppelt in der Übersicht (Tab + Chip) | done | S4 | pwa | [#253](https://github.com/securesight-ai/AncientVoid/issues/253) |
| [BUG-0252](bug-0252-sw-js-kommentarzeile-ohne-kommentarzeichen.md) | sw.js-Kommentarzeile ohne `//` — ServiceWorker-Eval schlägt fehl | fixed | S3 | pwa | — |
| [BUG-0253](bug-0253-toter-fleet-hub-heisst-inkompatibel.md) | Abgeschalteter Hub wird als „inkompatibel“ gemeldet | done | S2 | core | — |
| [BUG-0254](bug-0254-tts-upstream-json-statt-multipart.md) | TTS-Upstream-Aufruf spricht JSON, der echte Dienst (pocket-tts) will Multipart | done | S2 | hub | [#279](https://github.com/securesight-ai/AncientVoid/issues/279) · [PR #278](https://github.com/securesight-ai/AncientVoid/pull/278) |
| [BUG-0255](bug-0255-sidebar-tooltips-tablet.md) | Seitenleisten-Tooltips am Tablet ragen links aus dem Bildschirm (Anker-Klemmung statt Box-Klemmung) | done | S3 | pwa | [#284](https://github.com/securesight-ai/AncientVoid/issues/284) · [PR #285](https://github.com/securesight-ai/AncientVoid/pull/285) |
| [BUG-0256](bug-0256-notif-badge-escapes-glocke.md) | Badge-Zahl der flow-Glocke verankert am sticky Topbar statt an der Glocke — hängt above dem Viewport-Rand | done | S3 | pwa | [#291](https://github.com/securesight-ai/AncientVoid/issues/291) |
| [BUG-0257](bug-0257-analyse-ansichten-drei-icons-eine-seite.md) | Statistik, Metriken und Inferenz: drei Seiten, drei Navigations-Einträge, dasselbe Icon — eine Analyse-Seite mit Reitern, Altlinks leiten um | done | S3 | pwa | [#295](https://github.com/securesight-ai/AncientVoid/issues/295) · [PR #298](https://github.com/securesight-ai/AncientVoid/pull/298) |
| [BUG-0258](bug-0258-inferenz-modell-nicht-anbindbar.md) | Inferenz-Modell nicht manuell anbindbar — Engine-Quelle per Konfiguration, im Reiter befragbar (inkl. Tilde-Auflösung der Schlüsseldatei) | done | S2 | hub | [PR #298](https://github.com/securesight-ai/AncientVoid/pull/298) |
| [BUG-0259](bug-0259-ralph-loop-review-workflow-fehlt.md) | Ralph: Beobachter statt hub-Loop registriert (keine freie Adapterwahl), kein Agent-Review, kein Heartbeat | done | S2 | loops | [#289](https://github.com/securesight-ai/AncientVoid/issues/289) · [PR #290](https://github.com/securesight-ai/AncientVoid/pull/290) |
| [BUG-0260](bug-0260-main-sync-ohne-fern-fehlt-in-die-sessions-akte.md) | Projekt ohne `origin`-Fern: Check und Scheduler fetchen unbedingt — `workspace.main_sync_failed` in der Sessions-Akte, Route 502 | done | S2 | workspace | [#296](https://github.com/securesight-ai/AncientVoid/issues/296) · [PR #297](https://github.com/securesight-ai/AncientVoid/pull/297) |

| [BUG-0261](bug-0261-pi-zweite-laeufe-auf-derselben-sitzung.md) | Pi sicherte `midTurnInput: true` zu, `steer` startet aber einen zweiten `pi -p --session`-Prozess — drei Läufe auf einer Sitzung, `session.turn_end reason:"error"` + `adapter.down` | done | S1 | harness | [#300](https://github.com/securesight-ai/AncientVoid/issues/300) · [PR #301](https://github.com/securesight-ai/AncientVoid/pull/301) |
| [BUG-0262](bug-0262-seitenkachel-popout-ohne-ziel.md) | Seiten-Kachel (z. B. Notizen) als eigenes Fenster: Ziel wird immer als Session gebaut — Popup `#/sessions/` zeigt „Dieses Fenster hat kein Ziel." und löst die Kachel ab | fixed | S2 | pwa | [#312](https://github.com/securesight-ai/AncientVoid/issues/312) |
| [BUG-0263](bug-0263-tmux-log-fehlt-beim-start.md) | Der Worker-Logwatcher startet vor der tmux-Pipe | fixed | S2 | workers | [#104](https://github.com/securesight-ai/AncientVoid/issues/104) |
| [BUG-0264](bug-0264-verdeckte-kachel-wird-nicht-gezeigt.md) | Ein erneut geöffnetes Werkzeug bleibt hinter dem fixierten Raster unsichtbar | fixed | S2 | pwa | [#104](https://github.com/securesight-ai/AncientVoid/issues/104) |
| [BUG-0265](bug-0265-kontextueberlauf-meldet-anmeldeproblem.md) | Kontextüberlauf („prompt exceeds the context window") fällt in die auth-Regel — Banner verlangt Neuanmeldung, ADR-0115 | fixed | S2 | core | — |
| [BUG-0266](bug-0266-bild-auslese-ohne-ocr-werkzeug-schickt-zum-schluessel.md) | Bild ohne OCR-Werkzeug auf dem Hub meldet „Kein Text gefunden … Gemini-Schlüssel" — und die Eingabezeile bietet keine Vorschau | fixed | S2 | core | — |
| [BUG-0267](bug-0267-eingefuegtes-bild-ohne-ocr-hinweis-bleibt-liegend.md) | Eingefügtes Bild endet im Agenten-Prompt bei „(kein Text auslesbar)" — der Pfad war da, der Hinweis, das Bild zu oeffnen, nicht | fixed | S2 | core | — |
| [BUG-0269](bug-0269-statistik-schnitt-reload-race.md) | Statistik-Schnitt (Projekt) überlebt sofortiges Reload nicht — passive Persistenz + Remount-Rennen durch `setReport(null)` bei jedem Schnittwechsel (zuerst als 0263 angelegt, nach Kollision mit tmux-Log und offenem 0268 umnummeriert) | fixed | S3 | pwa | [#319](https://github.com/securesight-ai/AncientVoid/issues/319) |

| [BUG-0268](bug-0268-strg-klick-ersetzt-kachel.md) | Strg-/Cmd-Klick auf eine Session-Karte ersetzt im fixierten Raster die fokussierte Kachel statt eine zweite zu öffnen (`openFromList` verwirft `newTile` seit dabe85d5, E2E „Kachelfokus fragt neu" rot) | open | S3 | pwa | [#322](https://github.com/securesight-ai/AncientVoid/issues/322) |
| [BUG-0270](bug-0270-chat-status-lag-nach-turn-end.md) | Nach Zugende bleibt Status „aktiv/arbeitet“ statt „bereit“ — Tail setzt Status nur per 3s-Poll, nicht aus `session.turn_end` im WS | in-progress | S3 | pwa | [#334](https://github.com/securesight-ai/AncientVoid/issues/334) |
| [BUG-0271](bug-0271-toast-layout-shift.md) | Toast-Benachrichtigungen liegen im Flow und schieben Split/Topbar statt Overlay | in-progress | S3 | pwa | [#337](https://github.com/securesight-ai/AncientVoid/issues/337) |

Die nächste freie Nummer ist **0272** (0270 Status-Lag nach turn_end mit PR #335 gemerged; 0271 Toast-Layout-Shift; 0269 Statistik-Schnitt-Reload — zuerst als 0263, 0268 parallel in PR #327 für Strg-Klick; 0265 Kontextüberlauf als Anmeldepleite — ADR-0115, 0266 Bild-Auslese ohne OCR-Werkzeug, 0267 eingefügtes Bild ohne Oeffnen-Hinweis im Prompt; gemerged, 0260 mit PR #297 gemerged,
0178/0179 mit PR #37 gemerged, 0181 mit PR #41 und 0182 mit PR #26 gemerged,
0183 mit PR #50, 0184 mit PR #48 und 0185 mit dem Nightly-Fix aus den Issues #54–#57 gemerged,
0180 mit PR #40; 0186 ist das eingemauerte Manifest auf dem Handy; 0187 sind die Geister-Tokens
aus der P63-Planung; 0188 ist **doppelt belegt** (Hermes-Stumm/#133 done + host-ignorierendes Projekt-Anlegen in der Neuanlage);
0189–0191 sind Dateibaum-Bugfarben und Git-Historie-Lesbarkeit/Blob-Sprung;
0192 Slash-Commands; 0202 ist Cursor `interaction_query` unsichtbar im Chat; 0203 der Eltern-loser Commit im Aenderungsdiff; 0204 der uebergrosse Aenderungsdiff, der wegen maxBuffer komplett rausfaellt; 0207/0208 sind die Live-Strom-Scrolldefekte (Mitrollen an Frames statt Ereignissen, Sprung an den Nachrichtenanfang); 0209 Sessions bleiben auf working (PR #144); 0210 ist die Sound-Taste im Panel-Kopf (PR #147 — dort zunaechst als BUG-0207 gefuehrt, nach Kollision mit der aelteren Belegung durch PR #142 umnummeriert); 0211 ist die unerreichbare Chat-Spitze, weil der Client bei jedem Flush auf die letzten 500 stutzt (zuerst als 0209 gefuehrt); 0212 ist der 401-abgewiesene Terminal-Stream-Upgrade (authHook-Freistellung wie STT nachgereicht); 0213 ist der Statistik-500 aus nicht zuordenbaren Tool-Ergebnissen (K5/Replay); 0214 ist die geschwindelte STT-Verfuegbarkeit ohne Browser-Rueckfall; 0215 ist die 60-Sekunden-Grenze der Live-Woerter.
0216 ist der falsche Engine-Namen im Endtranskript des Diktats; 0222 sind die doppelt/veraltet nachgespielten Benachrichtigungen (Poll-Race); 0223 der OS-Push trotz offener App; 0225 ist das Gerät, das an der Browser-/Cloud-Erkennung festhält, weil die Quellenwahl beim App-Start eingefroren war (Behoben durch ADR-0095); 0226 sind die monatealten Notifications ohne Retention/Session-Filter (auch offline nachgespielt).
