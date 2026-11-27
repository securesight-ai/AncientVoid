# EPIC-P84 — AI-Arbeit-Evaluation: Harness × Modell × Skills messbar vergleichen

**Status:** In Umsetzung, echte Kern- und Reproduktionsserie offen · **Phase:** P84 · **Dauer:** 2–3 Agenten-Wochen · **Abhängigkeit:** keine blockierende (Quer-Epic wie P80/P82); P81/P82-Ausläufe bleiben unberührt, P30/P31 On hold ebenfalls. Grundlagen: [Recherche-Snapshot 2026-11-24](../docs/2026-11-24_ai-arbeit-evaluation-recherche.md); Messlauf-Muster (`scripts/messlauf-*.mjs`), Skill-Run-Extraktor `scripts/skill-runs.mjs` (P72), `turn_metrics`/ADR-0003/ADR-0006, P81 (Energie).

Tracker: [#427](https://github.com/securesight-ai/AncientVoid/issues/427) ·
[Messlauf-Anleitung](../docs/evaluation-messlauf.md) ·
[Pilotserie-Planung](../docs/p84-pilotserie-planung.md) ·
[Serien-Vorlage](../docs/p84-serien-vorlage.md) ·
[Pilotbericht](../docs/2026-11-27_p84-pilotserie.md) ·
[ADR-0126](../docs/adr/0126-evaluation-in-turn-metriken.md)

## 1. Ziel

Messbar und reproduzierbar belegen, welche Kombination aus Harness, Modell
und Skill-Ausstattung die wenigsten Fehler einbaut, am schnellsten, am
token-effizientesten und am kostengünstigsten arbeitet — und zwar an
*Aufgaben dieses Repos*. Zwei offene Kernfragen, die die öffentliche
Datenlage nicht beantwortet (Recherche §4):

1. Bringt die **Aufteilung von Planung und Implementierung** auf verschiedene
   Modelle (z. B. ausführliche Planung mit lokalem Qwen über pi — schnell und
   „kostenlos" — und Implementierung durch ein starkes Cloud-Modell) bessere
   oder billivere Ergebnisse als die umgekehrte Richtung oder ein
   Einzelmodell?
2. Was bringen die **eigenen Skills** (`.claude/skills/`) messbar — gemessen
   als A/B mit/ohne Skills auf identischen Aufgaben im selben Harness?

Aus den Daten wird nach und nach die Empfehlung „optimalste Kombination"
abgeleitet; jede Antwort nennt Mittelwerte über mindestens n = 5 Läufe, nie
Einzelläufe.

## 2. Scope (In / Out)

### In
- **Aufgabenkorpus** aus diesem Repo: 12–20 nachspielbare Aufgaben
  (nachgespielte Bugs, kleine Features), jede mit deterministischer
  Abnahme-Prüfung (Test rot→grün); Korpus wird eingefroren und gehasht.
- **Protokoll + Ergebnisspeicherung** für Evaluationsläufe (Vertrag in
  `contracts`, Ablage in `core`, K7-Recovery-Pfad; Erweiterung der
  bestehenden `turn_metrics`-Infrastruktur, kein zweiter Datenpfad).
- **Runner** `npm run messlauf:eval` im bestehenden Messlauf-Muster: fährt
  definierte Arme über die vorhandenen Adapter (`pi`, `claude`, `codex`,
  `opencode`, …) durch den Hub.
- **Kosten-/Energierechnung**: Cloud-API-Kosten mit Preis-Snapshot je Lauf;
  lokale Modelle über P81-Energie — ein lokaler Lauf kostet nie 0.
- **Reduzierte Kernmatrix + Split-Szenarien** (§3) als erste Messserie mit
  Report im Messlauf-Format (`docs/messlauf/JJJJ-MM-DD-p83-*.md`).

### Out
- Kein Nachbau externer Benchmarks (SWE-bench, Terminal-Bench & Co. bleiben
  zitierte Kalibrierung — Recherche §2); kein eigener Leaderboard-Webview
  (`#/statistik` darf später anzeigen, was die Ergebnisspeicherung liefert,
  aber kein neuer Dashboard-Aufbau in diesem Epic).
- Keine dauerhafte Nightly-Benchmark-CI — erste Serie + Generator;
  Dauerbetrieb kann anknüpfen, ist aber nicht Ziel dieses Epics.
- Keine neue Modell-/Adapter-Anbindung; vorhandene Adapter reichen
  (Fehlt ein Kandidat, wird er benannt, nicht hier gebaut).
- Kein LLM-as-Judge als einzige Qualitätsinstanz (deterministische Tests
  zuerst; subjektive Qualität geht an P000).

## 3. Design-Details

### Arm-Design (Verconfoundung vermeiden — Recherche §2.2)
Arme sind immer gespleißt, damit mindestens eine Variable pro Vergleich fix
bleibt:

- **Modellvariation bei konstantem Harness** (z. B. pi mit lokalem
  Planungsmodell vs. starkem Cloud-Modell; opencode analog).
- **Harness-Variation bei konstantem Modell**, wo die Adapter dasselbe
  Modell hergeben.
- **Skills A/B nur innerhalb eines Harness** (die Harness-Installationen laden Skills
  unterschiedlich nativ; über Harness hinweg gemessen wäre das der Harness-
  Effekt, nicht der Skill-Effekt). Immer-geladene Regel-Last und
  on-demand-geladene Skills werden getrennt ausgewiesen (Recherche §3.5).
- **Split-Szenarien:** (a) billig/lokal plant → stark implementiert,
  (b) stark plant → billig/lokal implementiert, (c) Kontrollarm: dasselbe
  Einzelmodell für beides. Beide Split-Richtungen auf identischem Korpus;
  Phasentrennung im Protokoll dokumentieren (Plan-Lauf und
  Bau-Lauf sind zwei aufeinanderfolgende Sessions desselben Arms).

### Reduzierte Kernmatrix (vorgezeichnet, nicht hochskaliert)
Kernkorpus (12–20 Aufgaben) × Arme: {pi, claude-code, opencode} ×
{lokales Modell, Cloud-Modell} × {Skills an, Skills aus}, plus die drei
Split-Szenarien auf einem Teilkorpus. n ≥ 5 Läufe je Arm; berichtet werden
Median und Streuung/KI je Metrik und je Aufgabe (Recherche §2.5 — Einzelläufe
sind Rauschen). Evaluationsfragen werden **vor** der ersten Serie
festgeschrieben (dieses Epic), Ergebnisse danach nicht mehr umdefiniert.

### Metriken je Lauf (Mindestmenge)
1. **Fehlerquote:** Abnahme-Test/Lint/Typecheck rot am Laufende; zusätzlich
   gezählte Nachbesserungen im Lauf.
2. **Wandzeit** pro Task (Runner-Stoppuhr) und Token-Verbrauch getrennt
   (Input/Output, aus `usage`-Events/`turn_metrics`, ADR-0003/0006).
3. **Kosten:** Cloud = Preis-Snapshot (Preisdatum im Datensatz); lokal =
   Energie über P81-Werte; „kostenlos" ist kein Messwert.
4. **Ergebnisqualität:** deterministische Prüfung pro Aufgabe (Test
   rot→grün); subjektive Qualitätsurteile des Nutzers wandern nach P000.

### Ergebnisspeicherung und Report
Ergebnisdatensatz (Arm, Aufgabe, Harness+Version, Modell, Modellpreis-Datum,
Skills an/aus, Wiederholung, alle Metriken) in die bestehende
Turn-Metrik-/Statistik-Infrastruktur; Rekonstruierbarkeit aus JSONL +
Snapshot nach K7. Report-Generator schreibt datierte Messlauf-Reports;
der Run-Extraktor (`scripts/skill-runs.mjs`, P72) liefert die
Skill-Zuordnung pro Lauf nachträglich.

## 4. Aufgaben

- [x] **T84.1** Aufgabenkorpus einfrieren: 12–20 nachspielbare Aufgaben aus
  diesem Repo mit deterministischer Abnahme-Prüfung; Korpus-Hash ins Repo;
  Erzeugungsdatum je Aufgabe notieren (Kontaminationsschutz, Recherche
  §2.4). [Korpus-Abnahme](../docs/messlauf/2026-11-25-p84-korpus.md) → AC-P84-1
- [x] **T84.2** Evaluations-Protokoll + Ergebnisspeicherung als Contract in
  `@ancientvoid/contracts` und Core-Modul (Erweiterung `turn_metrics`-Welt,
  K7-Recovery-Pfad dokumentiert). → AC-P84-2, AC-P84-3
- [x] **T84.3** Runner `npm run messlauf:eval` (`scripts/messlauf-eval.mjs`,
  Messlauf-Muster): Arm-Definition als Datei, fährt Arme über bestehende
  Adapter durch den Hub; K8-Klasse (parallele Sessions ohne Verlust): der
  Runner bricht laut, statt Läufe still zu droppen. → AC-P84-2
- [x] **T84.4** Kosten-/Energiebuchung: Preis-Snapshot je Lauf im
  Datensatz; lokale Arme mit P81-Energie; Report weist beides getrennt aus.
  → AC-P84-3
- [x] **T84.5** Skills-A/B innerhalb je eines Harness (an/aus auf
  identischen Aufgaben; immer geladene Regel-Last konstant halten und
  ausweisen). → AC-P84-4
- [x] **T84.1b** Sieben aus dem Text nicht lösbare Aufgaben
  ([Befund](../docs/p84-pilotserie-planung.md)) nennen ihren
  Schnittstellenvertrag; `scripts/eval/corpus.test.mjs` prüft „Namen im Test
  stehen am Start oder im Text“. → AC-P84-2
- [ ] **T84.6** Erste Kernserie auf der reduzierten Matrix (n ≥ 5 je Arm,
  Median + Streuung je Metrik und Aufgabe). → AC-P84-2, AC-P84-6
- [ ] **T84.7** Split-Szenarien (a)/(b)/(c) auf demselben Korpus,
  Phasentrennung Plan/Bau im Protokoll. → AC-P84-5
- [ ] **T84.8** Report-Generator (Code fertig, `scripts/eval/report.mjs`) + erster datierter Report
  `docs/messlauf/JJJJ-MM-DD-p83-eval-kernserie.md`; datenbasierte
  Kombinations-Empfehlung (Anhang im Report) als Entscheidungsvorlage. → AC-P84-2…6

Nachtrag 2026-11-27 (Nutzerauftrag: vollständige Daten, mehr Aufgabenarten,
nach und nach erfassen, was wie gut funktioniert und warum):

- [x] **T84.9** Laufdiagnose je Lauf (Werkzeuge, Fehler, abgelehnte Aufrufe,
  eigene Prüfungen, geänderte Dateien, Abnahmefehler) und Ablage je Serie im
  Benchmark-Repo (erstmals für
  [`pilot-6`](../docs/2026-11-27_p84-pilotserie.md)). → AC-P84-2
- [ ] **T84.10** Claude Code gegen z.ai: In `pilot-5`/`pilot-6` hatte jeder Lauf
  abgelehnte Aufrufe („Auto mode is unavailable“). Berechtigungsmodus für
  `claude` und `claude-zai` auf `manual` (Hub-Config `defaultPermissionMode`,
  Rückfragen über das Hub-Gate), Smoke ohne Ablehnung, dann beide Zellen neu messen. → AC-P84-6
- [x] **T84.11** Drei schwerere Aufgaben
  ([Abnahme](../docs/messlauf/2026-11-25-p84-korpus.md)). → AC-P84-1
- [ ] **T84.12** Weitere Aufgabenarten: Fehlersuche nur aus dem Symptom,
  Adapter-Aufgabe, UI-Abnahme, Verständnisfrage mit deterministischer Prüfung;
  je Art zuerst „Start rot, Referenz grün“ belegen. → AC-P84-1
- [ ] **T84.13** Zeitlimit und offene Rückfrage als Ergebnis im Vertrag (ADR),
  damit Mediane nicht nur überlebende Läufe zeigen. → AC-P84-2
- [x] **T84.14** Cache-Schreib- und -Lese-Token beim Claude-Adapter getrennt
  bepreisen ([ADR-0127](../docs/adr/0127-cache-token-getrennt-bepreisen.md):
  Ereignis, Datensatz und Tarif führen `cacheWriteInputTokens` bzw.
  `cacheWriteUsdPerMillion`; Zusammenfassung bepreist getrennt). → AC-P84-3
- [ ] **T84.15** Serienübersicht im Benchmark-Repo (Serie × Zelle × Aufgabe);
  Serien mit anderem Korpus- oder Konfigurationsstand nie zusammenrechnen.
  → AC-P84-6

Die nächste Messserie mit Aufgabenklassen ist in
[EPIC-P87](EPIC-P87-messserie-aufgabenklassen.md) geplant.

## 5. Acceptance Criteria

- **AC-P84-1 (Korpus):** Korpus eingefroren + gehasht; jede Aufgabe hat eine
  deterministische Abnahme-Prüfung, die an einer Referenzlösung grün und am
  unbedienten Start rot ist; Erzeugungsdatum je Aufgabe dokumentiert.
- **AC-P84-2 (Reproduzierbarkeit):** Jeder gemeldete Arm-Wert beruht auf
  n ≥ 5 Läufen und wird mit Median und Streuung berichtet; ein zweiter
  voller Lauf derselben Kernserie reproduziert die Rangfolge der Arme auf
  den aggregierten Metriken (K7: Datensatz aus JSONL + Snapshot
  rekonstruierbar).
- **AC-P84-3 (Kosten):** Jeder Ergebnisdatensatz trägt Token (Input/Output
  getrennt) und eine Kostenbasis (Preis-Snapshot mit Datum oder
  P81-Energie); kein Lauf mit Kosten 0.
- **AC-P84-4 (Skills):** Der Skill-Effekt wird binnen eines Harness
  gemessen; ein Effekt wird nur dann berichtet, wenn er die Arm-Streuung
  überschreitet — sonst explizit „nicht messbar getrennt vom Rauschen".
- **AC-P84-5 (Split):** Beide Split-Richtungen + Kontrollarm liegen auf
  identischem Korpus vor; die Auswertung nennt eine datenbasierte
  Empfehlung (oder erklärt, warum die Datenlage dafür noch nicht reicht).
- **AC-P84-6 (Variablen-Trennung):** Mindestens je ein Vergleich variiert
  nur das Modell (Harness fix) bzw. nur den Harness (Modell fix);
  verconfoundete Zeilen des Reports sind als solche gekennzeichnet.
- **AC-P84-7 (Qualität):** Mechanische Korrektheit kommt aus
  deterministischen Tests; subjektive Qualitätsurteile sind nach
  **[P000 T000.39](EPIC-000-testsuite-fuer-menschen.md) verschoben** und werden hier nicht
  vorweggenommen.

## 6. Premortem

**Ende P84, gescheitert. Warum?**

1. **Kontamination oder Ausreißer-Aufgabe verzerren:** Eine Aufgabe dominiert
   ein Ergebnis (oder war doch in Trainingsdaten). Mitigation: n ≥ 5,
   Per-Aufgabe-Ausweisung bleibt sichtbar, Median statt Mittel, Korpus-Hash;
   Aufgaben mit Trainingszeitraum-Verdacht werden gekennzeichnet und in einer
   Zweitbetrachtung ohne sie gerechnet.
2. **Kosten-Drift macht die Serie ungleich:** Modelle werden umbenannt,
   Preise bewegen sich während der Serie. Mitigation: Preis-Snapshot mit
   Datum je Lauf (AC-P84-3); Vergleiche über Preisdatum hinweg werden im
   Report als solche markiert, nicht verschleiert.
3. **Stichprobe zu klein / nichtreproduzierbar:** Zwei Läufe, drei Meinungen.
   Mitigation: AC-P84-2 erzwingt n ≥ 5 + Reproduktionslauf; Einzelläufe
   erscheinen im Report nie als Ergebniszeile.
4. **Skill-Wirkung nicht kausal trennbar:** die Harness-Installationen laden Skills
   unterschiedlich nativ, oder die immer-geladene Kontext-Last vermischt sich
   mit dem A/B. Mitigation: A/B nur binnen Harness (AC-P84-4),
   immer/on-demand getrennt ausgewiesen (Recherche §3.5); kein
   Harness-übergreifender Skill-Vergleich als „Ergebnis".
5. **Runner wird zum Wissenschaftsprojekt:** Volle Kreuzmatrix, Live-
   Dashboard, LLM-Judge-Kette. Mitigation: reduzierte Kernmatrix (§3),
   Report bleibt Markdown im Messlauf-Muster, Judge ist deterministisch;
   was darüber hinaus will, braucht ein Folge-Epic.
6. **Harness-/Modell-Version drifftet während der Serie:** Mitigation:
   Version/Fingerprint je Lauf im Datensatz; ein Kandidatenwechsel startet
   den Arm neu, alte Läufe bleiben mit ihrem Stand lesbar.

## 7. Definition of Done

Alle ACs grün; `npm run gate` lokal und die GitHub-Actions-Läufe (`verify`,
`k8`, `e2e`) auf dem Abschluss-PR grün (Rot allein wegen Umgebung benannt,
nie als Pass gezählt — `docs/testing-e2e.md`); Runner + Report-Generator
haben Tests auf Verhaltenshöhe (rot-dann-grün, Skill `write-tests`); erster
datierter Report mit vollständiger Kernserie liegt in `docs/messlauf/`;
Empfehlungs-Anhang aus Daten geschrieben; `check:context`/`check:epics` grün;
`epics/README.md` nachgezogen; der Runner ist registriert und aufrufbar
(`npm run messlauf:eval`), nicht nur gebaut. Menschen-Abnahmen
(Qualitätsurteile): nach P000 verschoben. Tracker-Issue nach `docs/issues.md`
(Anlage: Epics-Auftrag); Defekt-PRs im Epic tragen `Fixes #`.
