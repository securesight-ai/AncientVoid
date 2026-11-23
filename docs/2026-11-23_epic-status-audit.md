# Epic-Status-Audit vom 23.11.2026

Ausgangspunkt waren 18 offene Epic-Dateien von 86 laut `npm run epics:status`.
Hinzu kamen abweichend markierte Einträge im [Epic-Index](../epics/README.md)
und im Explorer. Geprüft wurden Aufgaben, AC und Definition of Done gegen
vorhandene Testdateien, Messberichte, ADRs und den Git-Verlauf. Live-Befunde
stammen aus [PROGRESS.md](../PROGRESS.md) und den verlinkten Berichten.

Die Konsole meldet nach dem Abgleich 22 offen und 64 abgeschlossen. P23, P70, P71 und P72
erscheinen mit ihren dokumentierten Resten jetzt auch im Konsolenzähler. P73s alter Indexeintrag
ist mit dem dokumentierten Live-Beleg und Retro-Fazit abgeglichen. Historische
Marker und delegierte Abnahmen sind aus den betroffenen Statuszeilen
herausgelöst. P77 und P78 haben wieder eigene Tabellenzeilen. Die
[Status-Konvention](epic-status.md) beschreibt die beiden Anzeigen.

## Nachtrag 23.11.2026 (Fortsetzung nach PR-Merges)

Der Audit-Zwischenstand aus der Session `94ca0510` war uncommittet liegen
geblieben, während #306/#310/#311 gemergt wurden. Dieser Nachtrag bringt die
Statuszeilen und den Index wieder auf den belegten Stand:

- `check:epics` war bereits driftfrei (K1/K2).
- Konsolenzähler vor dieser Fortsetzung: **18 offen / 68 abgeschlossen**.
- P30/P31 bleiben On hold.
- P23 und P79 werden hier **nicht** allein aufgrund des Audit-Textes geschlossen:
  P23-K10-E2E und P79-Betriebsdoku (ADR-0102) lagen nur im alten Worktree und
  müssen mit ihren Nachweisen separat nachgezogen werden.
- README-Widersprüche zu P61/P72/P73/P52/P41/P42/P74/P79 bereinigt.
- Historische Status-Altfragmente hinter dem ersten ` · ` in abgeschlossenen
  Epics entfernt.


## 1. Abschlussbelege mit überschaubarem Aufwand

| Epic | Vorhandene Evidenz | Rest zum Abschluss |
|---|---|---|
| [P23](../epics/EPIC-P23-desktop-navigation-reste.md#4-akzeptanzkriterien) | Navigation und Desktop-Statusleiste haben Unit- und E2E-Belege. | AC-P23-4: Hub-Ausfall im Desktop-Spec simulieren und K10-Status mit Zeitstempel nachweisen. Roll-out in T000.18. |
| [P79](../epics/EPIC-P79-inferenz-token-tempo.md#nachweisstand-23112026) | PR #264, Kern-/Routentests, E2E, Live-Restore und gemessene Snapshot-Größe | T79.6 mit Architekturentscheidung und Betriebsdoku vervollständigen. Danach Exit 7 als Geräteprüfung für Cover- und Falt-Display in P000 aufnehmen. |
| [P52](../epics/EPIC-P52-repo-galaxie.md#retro) | T52.1–T52.7, E2E, Layout-Median bei 4.000 Dateien im [K2-Messlauf](messlauf/2026-11-13-p52-galaxie-k2.md) | T52.8: Bildzeit-p95 im Leerlauf und bei Zoom/Pan messen (AC-P52-6). PC-Kachel nach Reload prüfen und bei Bedarf die Route korrigieren (AC-P52-8). Handy in P000 T000.21. |
| [P70](../epics/EPIC-P70-release-notes-pr-nachvollziehbar.md#gates-t706-ehrlich) | PR #172, `verify` und die Release-Notes-spezifischen Specs grün. T70.6 dokumentiert 22 Fehlschläge im Voll-E2E. | Für den Abschluss den nach §7 geforderten grünen Gesamt-Gate-Nachweis zuordnen. |
| [P71](../epics/EPIC-P71-issue-lebenszyklus.md) | PR #179, Auto-Close-Unit-Tests und Workflow-Wiring. | Für AC-P71-2/AI-P71-2 den ersten Nightly-Auto-Close mit Kommentar-Link oder dokumentierter Negativprobe belegen. |
| [P72](../epics/EPIC-P72-skill-pflege-nach-runs-deterministisch.md#abgleich-der-abschlussbelege-23112026) | PR #244, T72.1–T72.12 und benannte AC-Tests, [Erstlauf-Bericht](2026-11-21_skill-curation-erstlauf.md). Der dokumentierte volle E2E-Lauf enthält 84–87 Fehlschläge. | Zuerst vorhandenen grünen Gate-/CI-Nachweis für den Abschlussstand suchen. Den `succeeded`-Beleg der Live-Automation aus P000 T000.28 dem DoD zuordnen. |
| [P61](../epics/EPIC-P61-mehrsprachigkeit-englisch.md#8-stand-der-exit-nachweise-23112026) | PR #274 schaltet Englisch frei, i18n-Ratchet und Sprach-Spec sind vorhanden. Der Abschlussvermerk aus #273 wurde in #274 überschrieben. | AC-P61-2 bis -7 gezielt nachweisen bzw. fehlende Belege nachtragen: Negativprobe, Offline-Kaltstart und -Wechsel, Notification-Replay, zweisprachige Push-Zustellung, K2-Vergleich und sprachneutrales CLI-JSON. K6 in T000.29. |
| [P41](../epics/EPIC-P41-automationen.md#8-stand-und-exit-lücken-abgleich-11112026) | Crash/Recovery, `unknown`-Auflösung, Lease/Auth und K8 mit 128 Plänen sind belegt. | T41.4/T41.6: echter Konto-/Kontingent-Fehlerpfad, PWA-Build und Abschluss-CI belegen. [P42](../epics/EPIC-P42-android-testgeraete.md) hat eine ausdrückliche Umsetzungsfreigabe und eigene AVD-Belege. Der Startauftrag hält das Gating fest. P41-Exit zum Startzeitpunkt belegen oder die Gating-Entscheidung dokumentieren. |

## 2. Fachliche Restarbeit und externe Nachweise

| Epic | Vorhandene Evidenz | Rest zum Abschluss |
|---|---|---|
| [P46](../epics/EPIC-P46-projekt-explorer-dateiansicht.md#4-aufgaben-checkliste-t46m) | Baum, Viewer, Diagnosen und persistierte Tabs sind dokumentiert. P48 T48.7 belegt Popout für Session-Roots. | Projekt-Root-Popout, datierten Offline-Bereichsstatus und Remote-Projektliste mit getrennter Host-/Root-Identität belegen (AC-P46-1/8). Polling und geforderten Resync aus AC-P46-2 abgleichen. Pixel- und Gerätemessungen liegen in T000.20. |
| [P74](../epics/EPIC-P74-knowledge-mcp-brick.md#10-schnitt-t746t747-skill-concept-phase-20112026--ac-belegstand) | AV-Verträge, Hub/PWA/Gateway und zwei Testfassaden sind belegt. `fusion` und `minScore` sind in Contract und Client vorhanden. | T74.1 ADR-Nutzerreview, T74.4 echte Fassade und Live-Interop inkl. Tenant-Trennung, T74.5 SDK-Piloten mit Checkpoint, T74.8 Retrieval-Benchmark (AC-P74-2/3/6–8). |
| [P56](../epics/EPIC-P56-statistiken-page-metrik-suite.md#8-umsetzungsstand) | Rollup, API/PWA, A/B, Anomalie und CSV sind mit Tests dokumentiert. P66 nutzt den Grundumfang. | T56.4/AC-P56-1 braucht eine belastbare Zuordnung von Orchestrator und Session oder eine Scope-Entscheidung. T56.5/AC-P56-6 bleibt an P31/P55 gebunden. Nutzerabnahme in T000.22. |
| [P000](../epics/EPIC-000-testsuite-fuer-menschen.md#4-aufgaben-inventar) | Permanentes Inventar mit 31 Einträgen, Herkunft und Ablauf. Aktuelle Lizenzentscheidung in ADR-0086. | Abnahmerunden belegen, beginnend mit gebündelten Handy-/Sprachprüfungen T000.1/2/7/20/21/29/30. Für die Release-Zelle T000.5 Tag, Changelog und Fixture-Abnahme separat belegen. |

## 3. Planung und Entscheidungstore

| Epic | Geprüfter Stand und nächste Voraussetzung |
|---|---|
| [P78](../epics/EPIC-P78-token-effiziente-mcp-anbindung.md) | Planungsentwurf. T78.1 braucht einen neuen Strategie-ADR mit Nutzerreview, da 0098 bereits vergeben ist. T78.5 hat die Indexzeile, der P74-Verweis fehlt. Die Beschreibungsmessung (T78.2/T78.4) folgt auf die echte Fassade. Der Prototyp T78.3 bleibt an den dokumentierten Trigger gebunden. |
| [P76](../epics/EPIC-P76-adapterspezifische-modellkataloge.md) | Planungsentwurf mit Bestandssichtung. P75 ist als abgeschlossen dokumentiert, Geräteprüfung separat. Bei erteiltem Umsetzungsauftrag zuerst T76.1 (Exit-Belege, Quelleninventar und „Kolex“-Identität); T76.2–T76.6 sind offen. |
| [P77](../epics/EPIC-P77-mobile-session-instanzen.md) | Planungsentwurf hinter P76. T77.1 braucht einen Plattform-Spike auf Android und iOS, T77.2 einen belegten Web-Pfad oder dokumentierten Tab-Fallback. Davon hängt die spätere Umsetzung ab. |
| [P80](../epics/EPIC-P80-pentest-scanseite.md) | Planungsentwurf. §7 dokumentiert die bisherigen Entscheidungen und externe Abhängigkeiten. Die Aufgaben T80.1–T80.7 und die Epic-eigenen AC-Nachweise stehen aus. |
| [P32](../epics/EPIC-P32-mobile-client-entscheidung.md#8-evaluations-exit-2026-11-08) | Der [Entscheidungsbericht](2026-11-08_p32-evaluations-exit.md) trägt den Evaluations-Exit „vertagt“. Eine Neubewertung braucht den M1–M6-Gerätebefund und ein ausdrückliches Go. T32.3–T32.6 bleiben gesperrt. |
| [P33](../epics/EPIC-P33-englische-einstiegsdokumentation.md#8-evaluations-exit-2026-11-08) | Evaluations-Exit „vertagt“, englischer Guide über P62 geliefert. Für T33.2–T33.4 braucht es ein Go und einen Abgleich des Quickstarts im frischen Datadir, des Adapter-/Sink-Einstiegs und der Pflegegrenzen mit dem bereits publizierten Guide. |
| [P44](../epics/EPIC-P44-plugin-panels-themes.md) | P43.5 liefert die UI-Grundlage. T44.1–T44.6 und ihre Panel-/Theme-Nachweise hängen am Plugin-Lifecycle aus P30 und bleiben gesperrt. |
| [P55](../epics/EPIC-P55-plugin-toggles-token-ersparnis.md) | Planungsauftrag und Messkonzept vorhanden. Nutzerreview, P30-Lifecycle und P31-Modell-/Tokenizer-Metadaten fehlen. T55.1–T55.6 und ihre Retrieval-/Sparnachweise bleiben gesperrt. |
| [P30](../epics/EPIC-P30-adapter-sink-plugins.md) und [P31](../epics/EPIC-P31-acp-provider-katalog.md) | **On hold seit 15.11.2026.** P30 T30.1–T30.5 samt Lifecycle-/Testkit-Nachweisen und P31 T31.1–T31.6 samt zwei realen ACP-Provider-Nachweisen sind offen. Wiederaufnahme ausschließlich auf ausdrücklichen Nutzerauftrag. |

[P73 §7](../epics/EPIC-P73-issue-session-bridge.md#7-definition-of-done)
nennt neben dem dokumentierten Test-Issue #190 und den Einzeltests einen
lokalen Gesamt-Gate- und einen Abschluss-`verify`-Nachweis. Die Laufbelege
sind bei der nächsten Sichtung der CI für PRs #186/#187 nachzutragen.

## Empfohlene Reihenfolge

1. P79, P23 und P52 mit den konkret benannten Abschlussbelegen nachziehen. Parallel vorhandene Gate-/Nightly-Läufe für P70–P73 zuordnen.
2. P61-Evidenz schließen. P41/P42-Gating klären und Live-Provider-Nachweis einplanen. Die P000-Gerätetermine bündeln.
3. P46-Restumfang abarbeiten. P74-Review und externe Evidenz einholen. Für P56 zuerst die Orchestrator-Datenfrage entscheiden.
4. Bei erteilten Startaufträgen P76 vor P77 bearbeiten. P78 am festgelegten Trigger ausrichten. P32/P33, P44/P55 und weitere Planung an den dokumentierten Entscheidungen und Abhängigkeiten ausrichten.

## Nachtrag zum Abschlussabgleich

P23 und P79 sind mit nachgezogenen Nachweisen abgeschlossen. Bei P23
prüft Playwright Zeitstempel und Wiederverbindung. P79 hat 32 bestandene
gezielte Kern-, Routen- und Format-Tests und die nachgezogene
[Betriebsdoku](inference-token-tempo.md) mit ADR-0102. Die manuellen
Prüfungen für P79, P41 und P74 stehen in P000 T000.32–T000.34.
Der CLI-Stand nach diesem Nachtrag ist 20 offen und 66 abgeschlossen.

| Angefangenes Epic | Noch erforderlicher technischer Nachweis oder Rest |
|---|---|
| [P41](../epics/EPIC-P41-automationen.md) | T41.6: vollständigen Abschluss-Gate-Lauf und P42-Gating-Zuordnung belegen. Crash, Lease und Auth im gezielten Playwright-Lauf bestätigt. |
| [P46](../epics/EPIC-P46-projekt-explorer-dateiansicht.md) | Remote-Projektliste und Resync (T46.3), Projekt-Root-Popout und Offline-Bereichsstatus (T46.8). |
| [P52](../epics/EPIC-P52-repo-galaxie.md) | T52.8: Bildzeit-p95 und Wiederherstellung in der PC-Kachel. |
| [P56](../epics/EPIC-P56-statistiken-page-metrik-suite.md) | Orchestrator-/Session-Zuordnung (T56.4); T56.5 hängt weiterhin an P31 und P55. |
| [P61](../epics/EPIC-P61-mehrsprachigkeit-englisch.md#8-stand-der-exit-nachweise-23112026) | Offline-Kaltstart und -Wechsel, Alt-/Neu-Notification nach Restart, K2-Vergleich und konkretisierter CLI-Vertrag. Katalog-Negativprobe und Push-Lokalisierung sind belegt. |
| [P70](../epics/EPIC-P70-release-notes-pr-nachvollziehbar.md) | Grüner Gesamt-Gate-Nachweis. |
| [P71](../epics/EPIC-P71-issue-lebenszyklus.md) | Auto-Close durch den Evidenz-Kommentar in [Issue #203](https://github.com/securesight-ai/AncientVoid/issues/203#issuecomment-7038760787) belegt. Gesamt-Gate aus §7 steht aus. |
| [P72](../epics/EPIC-P72-skill-pflege-nach-runs-deterministisch.md) | PR-`verify` ist grün. Das Gesamt-Gate fehlt bei rotem Nightly-E2E. |
| [P74](../epics/EPIC-P74-knowledge-mcp-brick.md) | HiveMind-Fassade, Konnektoren, Benchmark und Interop oder ausdrückliche Entscheidung zum Repo-Schnitt F8. |


## Nachtrag zum deterministischen Abgleich

- P52 T52.8 ist erledigt. Der Desktop-Reload wird dauerhaft geprüft.
  Der [wiederholbare Chromium-Messlauf](messlauf/2026-11-23-p52-galaxie-bildzeit.md)
  nutzt 4.000 Dateien aus einer Fixture. Alle Zeichenzeit-p95 lagen im Budget.
  Ein Zoom/Pan-Lauf hat einen erhöhten Frameabstand. Frameabstand und
  vollständiger Gate-Beleg bleiben offen.
- P61 AC-P61-3 und AC-P61-4 sind mit echtem Offline-Reload und einer
  dateibasierten Neustartprobe belegt. AC-P61-7 hat einen lokalen
  HTTP-Vertragstest für übersetzten Status und sprachneutrale JSON-Bytes.
  Offen sind der vor/nach vergleichbare K2-Session-Tail-Messlauf und
  das Abschluss-Gate.
- P72s Automationsrezept verwendet jetzt die registrierte argv-Aktion und
  den tatsächlichen CLI-Vertrag. Das Beispiel ist im CLI-Builder und
  gegen den Hub-Contract validiert. Der Produktionsnachweis in P000 und
  der vollständige Gate-Beleg bleiben in ihren jeweiligen Aufgaben.
- Die [Compaction-Prüfung](2026-11-23_adapter-compaction-audit.md) trennt
  native Harness-Fähigkeiten, belegte Adapter-Integration und
  providerseitige Messwerte. Für die gezielten Proben wurden keine
  Modellaufrufe gestartet.

Der Zähler bleibt bei 20 offen und 66 abgeschlossen. Die Produktreste für
P46, P56 und P74 sowie die vollständigen Gate-Nachweise sind weiterhin offen.
