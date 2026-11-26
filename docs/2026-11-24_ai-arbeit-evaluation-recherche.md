# Recherche: Evaluation und Kalkulation von AI-Arbeit (Harness × Modell × Skills)

Datum der Recherche: **2026-11-24** (alle Webquellen an diesem Tag abgerufen).
Grundlage für [EPIC-P84](../epics/EPIC-P84-ai-arbeit-evaluation-benchmark.md).
Dies ist ein datierter Snapshot und altern bewusst.

## 1. Forschungsfrage

Welche Kombination aus **Harness** (pi, Claude Code, Codex, opencode, …),
**Modell** und **Skill-Ausstattung** arbeitet an *unseren* Aufgaben am
fehlerärmsten, schnellsten, token-effizientesten und günstigsten? Bringt die
**Aufteilung von Planung und Implementierung** auf verschiedene Modelle
(billig/lokal planen → stark implementieren, und umgekehrt) messbar mehr als
ein Einzelmodell? Publish-bare Benchmarks beantworten das nur zum Teil — dieses
Dokument sammelt was die öffentliche Lage hergibt, und wo sie endet.

## 2. Öffentliche Benchmarks und was sie wirklich messen

### 2.1 SWE-bench Verified (OpenAI, 2024-08, Stand 2025-02)

Quelle: <https://openai.com/index/introducing-swe-bench-verified/>

Menschlich validierte Teilmenge des SWE-bench-Kerns (12 Python-Repos), weil die
Autoren selbst nachwiesen, dass Aufgaben-Label-Rauschen den Benchmark **systematisch
unterschätzt**. Kritisch: Python-only, GitHub-Sourcing → Kontaminationsvektor
Trainingsdaten; Vendor-eigene Zahlen auf einem Benchmark, den der eigene
Forschungszweig mitdefiniert hat (Interesse an guten Zahlen).

### 2.2 Terminal-Bench 4.1 — die beste öffentliche Harness×Modell-Pareto-Quelle

Quelle: <https://www.tbench.ai/leaderboard> (Snapshot 24.11.2026). Auszug der
echten Tabelle (Auflösung ± 95%-KI, Tokens, Kosten):

| Harness | Modell | Resolution | Tokens | Kosten |
|---|---|---|---|---|
| GitHub Copilot | Copilot Fusion (max) | 71,2 % ± 2,9 % | 3,3 Mrd | $2,0k |
| Claude Code | Opus 5.5 (max) | 65,8 % ± 3,1 % | 8,0 Mrd | $4,7k |
| Claude Code | Fable 5.2 (max) | 65,8 % ± 2,8 % | 15,7 Mrd | $16,5k |
| Claude Code | Sonnet 5.5 (max) | 63,9 % ± 3,0 % | 19,4 Mrd | $7,3k |
| Codex | GPT-6.2 Astra (max) | 62,1 % ± 2,3 % | 1,1 Mrd | $1,4k |
| Codex | GPT-6.2 Sol (max) | 61,5 % ± 2,8 % | 1,1 Mrd | **$0,3k** |

Das ist genau die Dreiecks-Messung (Qualität × Token × Kosten), die wir selbst
bauen wollen — und sie zeigt publiziert, wovor die Literatur warnt: **zwei
Zeilen lösen gleich auf (65,8 %), kosten aber 3,5× verschiedene Tokenmengen und
drei verschiedene Preise.** Harness und Modell sind in dieser Tabelle
**verconfoundet** (Zeile = Paar), eine saubere Aufteilung der Beiträge leistet
kein öffentliches Leaderboard. Außerdem: Einsende-Läufe, selbstberichtet, Preise zum
Publikationszeitpunkt — als Kalibrierung gut, als Urteil über *unsere* Aufgaben
nicht genug.

### 2.3 Aider-Polyglot-Leaderboard

Quelle: <https://aider.chat/docs/leaderboards/> — 225 Exercism-Übungen über
sechs Sprachen, mit Kosten-Spalte pro Modell. Reine Modell-Leaderboard-Sicht
unter fixem Harness (aider); bestätigt das Muster: Qualität korreliert positiv
mit Kosten, aber nicht linear.

### 2.4 LiveCodeBench — Kontaminations-Evidenz

Quelle: <https://arxiv.org/abs/2403.07974> (Zhu et al.). Kontaminationsfrei
durch zeitlich fortlaufend nachgelieferte Aufgaben; zeigt empirisch
**Kontamination und Overfitting bestehender Benchmarks** (u. a. HumanEval).
Konsequenz für uns: eigene Aufgabenkorpora müssen nach Trainings-Cutoff
entstanden sein — ein privates Repo ist naturgemäß der sauberste Arena-Typ.

### 2.5 METR-Zeithorizonte

Quelle: <https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/>
(Stand 2025-03; der Beitrag weist selbst darauf hin, dass die statischen
Zahlen/Trendwerte nicht mehr aktuell sind und die Zeitreihen-Methode
inzwischen als TH1.1 weitergeführt wird). Kernaussage für uns:
Aufgabengelingen wird sinnvoller nach **Zeit-Horizont** gemessen: Aufgaben, die
ein Mensch in N Minuten löst, schafft ein Agentensystem mit 50 %
Erfolgswahrscheinlichkeit, wenn ihm ebenfalls N Minuten zur Verfügung stehen —
einzelne Tasks sind Rauschen, erst n Wiederholungen
mit Konfidenz geben ein Signal.

## 3. Planung↔Implementierung-Split und Kosten-Literatur

### 3.1 RouteLLM (arXiv 2406.18665)

Router, die pro Anfrage zwischen stark und schwach wählen, senken Kosten um
> 2× ohne Qualitätsverlust, und die Router-Entscheidung **transferiert** auf
neue Modellpaare. Das ist die seriöse Evidenz für die Richtung „kleines Modell
vor/großes Modell nach" — aber für **Einzel-Turn-Klassifikation**, nicht für
mehrstufige Agentenläufe mit Feedback-Schleifen.

### 3.2 FrugalGPT (arXiv 2305.05176)

LLM-Kaskade: bis zu 98 % Kostenersparnis bei gleicher Performance wie das
beste Einzelmodell (oder +4 % Genauigkeit bei gleichen Kosten). Kontext:
GPT-4-Ära 2023, Preise haben sich seitdem mehrfach bewegt — Richtung
robust, Zahlen historisch.

### 3.3 Anthropic: Multi-Agent Research System (2025-06)

Quelle: <https://www.anthropic.com/engineering/built-multi-agent-research-system>.
Die interessanteste publizierte Varianzanalyse: **Token-Verbrauch allein
erklärt 80 % der Leistungsstreuung** bei ihren Forschungs-Tasks; Agenten
verbrauchen ~4×, Multi-Agent-Systeme ~15× die Tokens eines Chats. Multi-Agent
(Opus-lead + Sonnet-sub) schlägt den Single-Opus-Agenten um +90,2 % — aber nur
bei breadth-first-artigen Aufgaben; der Beitrag sagt ausdrücklich, dass
Domänen, die geteilten Kontext brauchen (explizit: **die meisten Coding-Tasks**),
nicht gut für Multi-Agent passen. Direkte Konsequenz für unsere Fragestellung:
der Split Plan↔Implementierung ist bei Coding **nicht** per Publikation
vor entschieden — genau das muss unser eigener Messlauf klären.

### 3.4 Anthropic: Agent Skills (2025-10)

Quelle: <https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills>.
Skills als komposable, dateibasierte Expertise — konzeptionell genau das,
was `.claude/skills/` hier nutzt. **Publizierte quantitative Wirkung: keine.**
Anbieter lobt eigene Funktion; eine belastbare Antwort auf „was bringen unsere
20+ Skills messbar" liefert nur ein eigener A/B-Messlauf (mit/ohne auf
identischen Aufgaben, gleicher Harness — sonst misst man den Harness).

### 3.5 Kontext-Hygiene (hauseigen, 2026-11-12)

`docs/check-context.md` fasst bereits zusammen: Kontextdateien kosten im
Schnitt > 20 % Inferenz ohne Erfolgsgewinn (Gloaguen et al.), und
Anthropic-Empfehlung ist < 200 Zeilen pro immer geladener Datei. Eine
Skill-Wirkungs-Messung muss deshalb **immer geladene** Regel-Last und
**on-demand geladene** Skills trennen.

## 4. Was die öffentliche Lage hergibt — und wo sie endet

1. **Verfügbar:** große, ernsthafte Datenlagen Modell→Auflösung→Kosten unter
   *jeweiligem* Referenz-Harness (Terminal-Bench, Aider) und für Routing als
   Prinzip (RouteLLM, FrugalGPT).
2. **Nicht verfügbar:** eine öffentlich quantifizierte Aufteilung, wie viel
   Leistung auf den **Harness** und wie viel aufs **Modell** entfällt; eine
   publizierte Messung des **Skills-/Regel-Datei-Nutzens**; eine Messung des
   Plan↔Implementierungs-Splits auf **Coding**-Aufgaben (die Multi-Agent-
   Evidenz ist research-artig und warnt sogar vor Coding).
3. **Methodische Mindeststandards aus der Kritik:** Aufgabengelingen über
   wiederholte Läufe mit Konfidenz (METR), Kontaminations-Kontrolle
   (LiveCodeBench), Preise als Zeitstempel eher als Behauptung, eigene
   Aufgaben unveröffentlicht zu halten (Kontaminationsverdacht vermeiden).

## 5. Was wir schon haben (interne Ausgangslage)

- **Orchestrator:** der Hub selbst — Adapter für `pi`, `claude`, `codex`,
  `opencode`, `aider`, `copilot`, `acp`, `jsonrpc` (`packages/adapters/`),
  Adapter-Contract mit `usage`/Kosten (ADR-0003, ADR-0006).
- **Messlauf-Muster:** `npm run messlauf:*` (`scripts/messlauf-*.mjs`,
  Ergebnisse als datierte `docs/messlauf/*.md`) — genau das Format, in das ein
  Evaluations-Messlauf hineingehört.
- **Rohdaten:** `turn_metrics` (`packages/core/src/modules/runs/
  turn-metric-store.ts`, Statistics-Rollup) und der Run-Extraktor
  `scripts/skill-runs.mjs` (P72: Skill-Kette pro Run bereits rekonstruiert).
- **Energie-Kosten lokaler Modelle:** P81 (Host-Monitoring, Watt/kWh) liefert
  die Basis — lokale Läufe zählen nicht als „kosten 0".

## 6. Konsequenzen für EPIC-P83

1. Eigener, reproduzierbarer Messlauf **im Repo** (der Hub ist der
   Orchestrator), Aufgabenkorpus **aus diesem Repo** (Kontamination
   praktisch ausgeschlossen) plus zitierte externe Kalibrierung statt
   Nachbau externer Benchmarks.
2. Arme immer paarweise/gespleißt: **gleicher Harness, Modell variiert** und
   **gleiches Modell, Harness variiert**; Skills A/B nur innerhalb eines
   Harness.
3. Split-Szenarien (plan-billig→bau-stark, plan-stark→bau-billig,
   Einzel-Modell-Kontrolle) als erste Klasse — die öffentliche Datenlage
   entscheidet diese Frage nicht.
4. Metriken mindestens: Fehlerquote (Gate/Tests rot), Wandzeit, Tokens
   (Input/Output getrennt), Kosten (Preis-Snapshot je Lauf; lokal: Energie
   über P81), Ergebnisqualität (deterministische Check + delegierte
   Menschen-Abnahme an P000).
5. Konfidenz erst ab Wiederholung (n ≥ 5 je Arm); einzelne Läufe werden nie
   als Ergebnis verbucht.
