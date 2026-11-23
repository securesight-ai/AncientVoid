# EPIC-P56 — Statistiken-Page: Modell-, Provider- und Session-Kennzahlen

**Status:** Code steht (Statistik-Grundumfang), Exit offen (Orchestrator-Vergleich und Anbindungen) · **Phase:** P56
**Dauer:** 2 Agenten-Wochen (grobe Schätzung)
**Abhängigkeit:** Die Grundlage nutzt bestehende Session-/Zug-/Team-Fakten (P21/P40/P60). T56.5, Katalognormalisierung und EUR-Kosten warten auf P31; Compression und AC-P56-6 auf P55. P30/P31 bleiben ausdrücklich On hold.

**Startauftrag 15.11.2026:** Nutzer wünscht den sinnvollsten Start aus P44/P55/P56. P56 beginnt mit dem unabhängig umsetzbaren Metrik-Grundlagenteil; daraus folgt keine Freigabe für pausierte Voraussetzungen. P56-Abschluss und Geräteabnahme bleiben offen.

## 1. Ziel

Eine **Statistiken-Seite** in der PWA, die aus den vorhandenen Event-Daten (keine neue Instrumentierungswahrheit) konsolidierte Kennzahlen zeigt: Wie lang läuft eine Session im Schnitt **je Modell und Provider**, wie viele **Tokens** braucht sie, wie oft **scheitert** sie, wie oft verursachen **Tool-Aufrufe Fehler** — jeweils mit sinnvoller Verteilung (nicht nur Mittelwert), filterbar nach Zeitraum/Projekt/Harness/Orchestrator. Ziel ist Transparenz für Modell-/Provider-Entscheidungen (P31-Routing) und Plugin-Entscheidungen (P55), **nicht** eine automatische Qualitätsbewertung.

## 2. Scope (In / Out)

**In:** Abgeleitete Metrik-Aggregation (Rollup) aus EventStore; Statistiken-Page mit Filtern; Metrik-Definitionen mit Berechnungsregel (dieses Dokument ist der Maßstab); CSV-Export; Compression-Kennzahlen (P55) je Modell/Plugin.
**Out:** Automatisches Modell-Ranking/„Bestes Modell"-Siegel; Telemetrie-Export in die Cloud; neue Events nur für Metriken, die nicht aus Bestandsdaten ableitbar sind (jede neue Event-Art braucht Begründung); User-Tracking über Projekte hinaus.

## 3. Metriken (Definitionen mit Berechnungsregel)

Alle Metriken werden je **Modell**, **Provider**, **Harness** und **Orchestrator** (self/hermes, P54) geschnitten; Zeitreihen mit wählbarem Zeitraum. Verteilungen immer als **p50 / p90 / p95 + n**, nie nur Mittelwert (Ausreißer-Sessionen sind das Interessanteste).

### 3.1 Session-Metriken

- **Session-Dauer (wall):** erster bis letzter Event-Zeitstempel einer Session; p50/p95.
- **Aktive Dauer:** Summe der Zeiträume mit Agent-Aktivität (min. ein LLM-Call/Tool-Call), ohne Wartezeiten auf Gates/Mensch.
- **Gate-Wartezeit:** Zeit in Zustand `waiting_for_human` — trennt „Agent langsam" von „Mensch langsam".
- **Turns pro Session:** Anzahl Agent-Antworten; **Ø-Dauer pro Turn**.
- **Session-Ende-Grund (Verteilung):** `done | failed | cancelled | stalled | context_exhausted` — Misserfolgsquote nur daraus, nicht aus Bauchgefühl.

### 3.2 Token- & Kosten-Metriken

- **Input-/Output-Tokens pro Session** (Summe und p50/p95); **Cache-Read/Cache-Write** getrennt (Cache-Hit-Rate).
- **Tokens pro Turn** und **Context-Auslastung Peak** (max. belegte Fenstergröße / Limit) — Frühindikator für context_exhausted.
- **Kosten (EUR):** nur wenn Preisdaten im P31-Katalog gepflegt; sonst Tokens ohne Euro („unbekannte Kosten bleiben unbekannt, nicht Null" — P40-Regel).
- **Compression-Kennzahlen (P55):** gesparte Tokens, Ratio, betroffene Requests, Skip-/Fehlerquote je Plugin; **Netto-Effekt** = Ersparnis vs. Mehraufwand (Latenz, Cache-Miss-Kosten).

### 3.3 Erfolgs-/Misserfolgs-Metriken

- **Task-Erfolgsquote:** Tasks mit bestandenem Gate / alle abgeschlossenen Tasks (Run/Task-Modell P40; „worker_done allein belegt keinen Gate-Erfolg" — P40-Regel übernehmen).
- **Retry-Rate:** Dispatches pro Task (>1 = Retries); **Abbruchquote** je Modell/Provider.
- **Recovery-Zeit:** Zeit von Fehler zu erfolgreichem Weiterlauf.
- **Klein-n-Warnung:** Slices mit n < 10 werden ausgegraut/gekennzeichnet — keine Rückschlüsse aus Einzel-Sessionen.

### 3.4 Tool-Metriken

- **Tool-Calls pro Session** (p50/p95) und je Tool.
- **Tool-Fehlerquote:** `is_error=true`-Ergebnisse / Aufrufe, je Tool und je Modell (schwach: Modell nutzt Tool falsch; hoch: Tool/Umgebung kaputt — nur zusammen interpretierbar, deshalb beide Schnitte).
- **Timeouts/Hangs** je Tool.

### 3.5 Vergleichsansichten (Ideen über die Anforderung hinaus)

- **Orchestrator-Vergleich:** dieselben Kennzahlen self vs. hermes (Ralph-Runs, P54) — Kosten des Koordinators sichtbar machen.
- **A/B-Ansicht:** zwei Zeitrahmen oder Modelle direkt nebeneinander (für P55-Plugin-An/aus-Bewertung).
- **Anomalie-Flag:** Session mit Dauer/Tokens/Fehlern > p95 des jeweiligen Modells wird markiert (Kandidat für „Runaway"-Analyse).
- **Kosten-Budget-Alarm (optional):** konfigurierbares Tages-/Wochenbudget, Warnung bei 80%.
- **CSV-Export** aller Ansichten für eigene Auswertung; lokale Daten bleiben lokal.

## 4. Architektur

- **Ableitung, nicht zweite Wahrheit:** Rollup-Job (inkrementell, nachführbar bei Event-Nachträgen) schreibt aggregierte Tabellen aus dem EventStore; Statistiken-Page liest nur Rollups. Kein Schreiben von Metriken zur Laufzeit in die UI.
- Schnittstellen-Contract mit P55 (Plugin-Events) und P31 (Modell-/Provider-Namen normalisiert aus dem Katalog, nicht aus freien Strings).
- Zeitraum-Filter: Woche/Monat/Alles + Projekt/Host/Harness/Orchestrator-Filter.

## 5. Aufgaben (Checkliste T56.m)

- **T56.1** Metrik-Contract (Feldliste, Berechnungsregeln exakt nach §3) als testbare Spezifikation.
  - [x] **T56.1a** Datenquellen/Feldliste und ehrliche Verteilungen für vorhandene Zugmetriken; p50/p90/p95, n/missing, Klein-n, Token-Herkunft und Replay-Gegenprobe. **K5/K7**.
  - [x] **T56.1b** Übrige Session-/Gate-/Team-/Tool-Metriken nach den belegten Quellen präzisieren und testen; fehlende terminale/korrelierte Fakten ausdrücklich kennzeichnen. **K5/K7**. (abgeschlossen 17.11.2026: Verträge `SessionStatistics`/`GateWaitStatistics`/`ToolStatistics`/`TeamTaskStatistics`, Ableitungen `deriveSessionFacts`/`deriveRecoveryIntervals`/`deriveGateWaitIntervals`/`deriveToolCallFacts`, 28 neue Tests)
- [x] **T56.2** Rollup-Job inkl. Nachführbarkeit und Klein-n-Kennzeichnung. (abgeschlossen 17.11.2026: `StatisticsRollup` — Migration 36 mit Fakten-Caches, Nachführung über basis_last_seq/basis_updated_at, prune + deterministisches rebuild; Leseseite liefert nur Aggregate, Klein-n über `smallSample`. Zeitraum-/Projekt-/Host-Schnitte brauchen zusätzliche Cache-Dimensionen und folgen mit T56.3.)
- **T56.3** Statistiken-Page: Sessions/Tokens/Erfolg/Tool-Sektionen, Filter, p50/p90/p95-Darstellung. *(17.11.2026 erledigt — `#/statistik`, `GET /api/statistics`, Migration 37; Details §8.)*
- **T56.4** Vergleichsansichten (Orchestrator, A/B) + Anomalie-Flag + CSV-Export. *(17.11.2026 erledigt — A/B-Zeitraumvergleich, Anomalien über Gruppen-p95, CSV-Download; Orchestrator-Vergleich mangels belegter Fakten offen.)*
- **T56.5** P55-Anbindung (Compression-Kennzahlen je Plugin/Modell) und P31-Namen.
- [x] **T56.6** Abnahme mit Nutzer an echten Daten (nach P000 verschoben).

## 6. Acceptance Criteria (AC-P56-k)

- **AC-P56-1:** Statistiken-Page zeigt Dauer-, Token-, Erfolgs- und Tool-Kennzahlen je Modell/Provider/Harness/Orchestrator mit p50/p90/p95 und n; Filter und Zeitraum funktionieren.
- **AC-P56-2:** Jede Zahl ist aus dem EventStore reproduzierbar (Rollup deterministisch nachführbar; Test vergleicht Rollup gegen Stichproben-Rechnung).
- **AC-P56-3:** Klein-n-Slices sind gekennzeichnet; keine Mittelwerte ohne Verteilung.
- **AC-P56-4:** Session-Ende-Gründe und Task-Erfolgsquote folgen P40-Faktenlage (Gate bestanden ≠ worker_done).
- **AC-P56-5:** CSV-Export liefert exakt die angezeigten Daten; keine Cloud-Exporte.
- **AC-P56-6:** Compression-Kennzahlen aus P55 erscheinen je Plugin/Modell inkl. Skip-/Fehlerquote.

## 7. Premortem (Failure-Modi + Mitigation)

- **Zahlen lügen ohne Kontext** (Survivorship-Bias: abgebrochene Sessionen fehlen in „fertigen" Auswertungen) → Ende-Grund-Verteilung Pflichtmetrik; Auswertungen über **alle** Sessionen.
- **Korrelation als Kausalität verkauft** (Modell X scheitert öfter, weil es die schweren Tasks bekam) → Seite bleibt beschreibend; Hinweistext; Schnitte nach Projekt/Task-Typ, wo vorhanden.
- **Rollup driftet vom EventStore** → deterministische Nachführung + Reconciliation-Test im CI.
- **Metrik-Wildwuchs** → §3 ist die feste Metrik-Liste; neue Metriken nur per Epic-Änderung.
- **Qualitäts-Schlussvergleiche** („Modell A besser als B" aus Erfolgsquote) → bewusst out of scope; Gates bleiben menschlich.

## 8. Umsetzungsstand

T56.1a: [Metrik-Referenz](../docs/statistik-metriken.md) und
[ADR-0079](../docs/adr/0079-statistik-verteilungen-und-datenluecken.md).
T56.1a abgeschlossen: 24 neue Contract-/Core-Tests grün; Feldliste und
Datenquellengrenzen dokumentiert. Vollständiges lokales Gate grün: 2204 Unit-/Integrationstests bestanden (4 sichtbar übersprungen), 694 E2Es bestanden (5 sichtbar übersprungen; 27.4m). Typecheck, Lint, Architektur, Kontext und PWA-Build grün. Skips sind keine Passes.
Der Gate-Stand enthält den separat über [MR !476](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/476)
behobenen Offline-Diff-Defekt BUG-0164. Nach der getrennten Übernahme sind
alle neun Source-/Testdateien bytegleich mit dem geprüften Stand.

Neue additive Statistik-Lesemodelle und reine Aggregation; keine neue
Persistenz, HTTP-Route oder PWA-Seite. Die vorhandene Rekonstruktion
`deriveTurnMetrics` bleibt Quelle. T56.1b–T56.6 und alle vollständigen AC
bleiben offen; P31/P55-Anbindungen bleiben gesperrt.

T56.1b (17.11.2026): Session-/Gate-/Team-/Tool-Metriken nach belegten
Quellen präzisiert und getestet — Verträge `SessionStatistics`,
`GateWaitStatistics`, `ToolStatistics`, `TeamTaskStatistics` in
`@ancientvoid/contracts` (additiv, keine Events, K5), Ableitungen
`deriveSessionFacts`, `deriveRecoveryIntervals`, `deriveGateWaitIntervals`,
`deriveToolCallFacts` und Aggregationen in `packages/core/src/modules/
statistics/` (K7: Journal bzw. Team-Record bleiben Quelle). Belegte
Session-Endgründe: `completed`/`error`/`interrupted`/`stopped` aus dem
letzten terminalen Marker; `stalled`/`context_exhausted` bewusst unbekannt.
`workerEndRate` ist keine Gate-Erfolgsquote (P40-Regel). Recovery nur bis
zum nächsten erfolgreich beendeten Zug, sonst unbekannt. 28 neue Tests in
`packages/core/test/modules/statistics/` (rot-dann-grün; Statistik-Suite
insgesamt 38 grün). Offen bleiben T56.3 Page, T56.4 Vergleiche/CSV, T56.6
Abnahme; T56.5 (P55/P31) bleibt gesperrt.

T56.2 (17.11.2026): `StatisticsRollup` (core/modules/statistics/rollup.ts)
mit Migration 36 (session_stat_facts, gate_wait_facts, tool_stat_facts,
recovery_facts, team_stat_facts — reine Caches, K7: Journal und Team-Record
bleiben Quelle, alles per rebuild() rekonstruierbar). Nachführung über
basis_last_seq (Session) bzw. basis_updated_at (Team); prune entfernt
weggefallene Quellen; deterministischer Neuaufbau belegt (Test vergleicht
Cache-Leseseite gegen direkte Ableitung, AC-P56-2). Leseseite:
sessionStatistics/gateWaitStatistics/toolStatistics/recoveryDistribution/
teamTaskStatistics — HTTP/PWA (T56.3) lesen nur diese Aggregate.

T56.3 (17.11.2026): Statistik-Seite `#/statistik` mit Les-API
`GET /api/statistics` (Contract `StatisticsReport`, additive Verträge in
`@ancientvoid/contracts`). Migration 37 ergänzt die Schnitt-Dimensionen
project/host_id/harness/created_at an session_stat_facts (project/created_at
an team_stat_facts); Zeilen ohne Dimensionen werden beim nächsten Lauf neu
abgeleitet — kein SQL-Backfill, die Team-Quelle liegt außerhalb der DB.
Rollup-Leseseite trägt den Filter (Zeitraum/Projekt/Host/Harness; Teams nur
Projekt/Zeitraum — Host/Harness sind keine Team-Dimension) und
turnStatistics als Join über den turn_metrics-Cache. Hub:
`StatisticsService` (single-flight, inkrementell beim Abruf, REFRESH_MS 5 s)
in main.ts verdrahtet; Route ohne Dienst ehrlich 501. PWA:
features/statistics/StatisticsPage.tsx (Sessions/Züge+Tokens/Gates/Tools/
Teams, Filterkarte, Klein-n-Kennzeichnung, beschreibender Hinweis — kein
Ranking). Seite im Dock „Mehr", Guide-Inventar gepflegt. Belegt: Rollup-
Schnitt-Tests (Filter je Dimension, turn-Join, Dimensions-Auffrischung,
updatedAt), Contract-Test StatisticsReport, Hub-Routen-Tests (401/501/200/
400, echte Dummy-Session), E2E statistik.spec.ts (Dock-Weg, Zahlen mit n
und Klein-n, Zeitraum-/Projektschnitt, API-Contract/Leer/400). Der
Orchestrator-Schnitt ist nicht belegt (P54: Orchestrator lebt auf Team/Loop,
nicht auf der Session) und bleibt offen. BUG-0205 (vorbestehend, P63-Folge):
Card-Baustein ohne region-Rolle — Statistik-Seite setzt role="region"
explizit, Bug separat angelegt (#117). Offen: T56.4, T56.6 (Abnahme);
T56.5 (P55/P31) bleibt gesperrt.

T56.4 (17.11.2026): Anomalie-Flag (Contract `SessionAnomaly`, Rollup-
Leseseite `sessionAnomalies`: Session über dem p95 ihrer Adapter-/Modell-
Gruppe in Wallzeit oder Zugzahl; Klein-n-Gruppen melden keine, Gruppen-p95
schließt die Session selbst ein — deterministisch; Tokens/Fehler je Session
als Kriterien nicht belegt, bleibt offen) im Report sichtbar und CSV-
exportierbar. A/B-Zeitraumvergleich clientseitig über die bestehende API
(gleicher Projekt-/Host-/Harness-Schnitt, zweiter Bericht als B).
CSV-Export clientseitig aus dem geladenen Report als Download — exakt die
angezeigten Daten, kein Netz (AC-P56-5). Orchestrator-Vergleich (§3.5)
bleibt offen: kein belegter Faktenbestand (Orchestrator lebt auf Team/Loop),
nicht erfunden. Belegt: Rollup-Anomalie-Tests (p95-Gruppenlage, Klein-n,
Zeitraum-Schnitt), Contract-Tests SessionAnomaly, E2E statistik.spec.ts
(Klein-n-Karte ehrlich weg, Vergleich lädt B, CSV-Download mit Inhalt).
Offen bleibt T56.6 (Abnahme mit Nutzer an echten Daten); T56.5 (P55/P31)
bleibt gesperrt.
`HubDatabase.exec` ergänzt (mehranweisungs-SQL). 4 neue Tests (Statistik-
Suite inkl. db.test 45 grün), Tier A 2286 grün (ein Steer-Wait-Timing-Flake
der BUG-0163-Familie im Parallellauf: isoliert 2× grün, Neustart sauber —
benannt, nicht als Pass gezählt). Offen: T56.3 Page + Schnitte (brauchen
zusätzlich Cache-Dimensionen Zeitraum/Projekt/Host), T56.4 Vergleiche/CSV,
T56.6 Abnahme; T56.5 bleibt gesperrt.

## 9. Definition of Done

Alle T56.* und AC-P56-* mit Evidenz; Reconciliation-Test grün; Abnahme mit Nutzer an echten Sessions.
