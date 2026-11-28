# ADR-0128 — Zeitlimit und offene Rückfrage sind Ergebnisse

- Status: angenommen für P84
- Bezug: [EPIC-P84](../../epics/EPIC-P84-ai-arbeit-evaluation-benchmark.md) T84.13,
  [ADR-0126](0126-evaluation-in-turn-metriken.md), AC-P84-2, K8/K9

## Entscheidung

Ein Lauf, der das Zeitlimit erreicht oder auf eine unbeantwortete Rückfrage
(Approval) stößt, wird als **Ergebnis** erfasst — nicht nur in `aborted.jsonl`
sichtbar und aus der Ergebnistabelle weggelassen.

- `EvalRunInput.outcome`: `"completed" | "timeout" | "approval"`
  (Default `completed`, alte Datensätze parsen weiter).
- Abgebrochene Läufe dürfen `turns = 0`, `costUsd = 0` haben und auf der
  **Plan**-Phase enden (Abbruch schon im Planungszug). Für `completed` bleiben
  die alten Invarianten verpflichtend (positive Züge und Kosten je Phase,
  Bau-Phase zuletzt).
- Messung (`measureEvaluationPhase`): bei `outcome ≠ completed` zählt die
  Telemetrie bis zum Abbruch (partielle Token, begrenzt durch die Ereignisse);
  ohne vollendeten Zug begrenzen die Ereignisse Start und Ende. Die
  Fehlerquote solcher Läufe ist 1 — sie sind geplante Läufe, die nicht
  bestanden, keine Lücken.
- Runner (`runPhase`): Zeitlimit und Rückfrage werden als `aborted` am
  Phasen-Ergebnis zurückgegeben (die Sitzung wird vorher gestoppt);
  `run-series` schreibt dieselbe Abnahme wie für vollendete Läufe
  (`acceptance/lint/typecheck` false, `baseline` 0, kein Prüferlauf) und
  zusätzlich `aborted.jsonl` für die Laufdiagnose. Ein Timeout an **toter**
  Engine bleibt Infrastrukturausfall (Wiederholung, `invalid.jsonl`) — nie
  ein Aufgabenfehler, nie ein Ergebnis.
- `BudgetGuard` verträgt das Fehlen der Bau-Phase (0 USD statt Absturz).
- Eine Serie gilt jetzt als vollständig, wenn jeder geplante Lauf ein
  Ergebnis hat — auch abgebrochene. `--resume` wiederholt abgebrochene Läufe
  nicht erneut: ihre Schlüssel stehen in `sessions.jsonl`. Serien, die vor
  diesem ADR liefen, behalten die alte Semantik (Abbruch = offener Lauf);
  das Messwerkzeug-Commit in `lauf.yaml` unterscheidet die Stände.

## Begründung

- Bisher fehlten Abbrüche in der Ergebnistabelle: Mediane zeigten nur
  überlebende Läufe (Überlebenden-Verzerrung). Ein Arm, der regelmäßig das
  Zeitlimit reißt, sah aus wie ein schneller, erfolgreicher Arm.
- Die offene Rückfrage ist Teil des Verhaltens einer Zelle
  (Berechtigungsmodus, T84.10), nicht Umgebung: Sie als Ergebnis zu zählen
  hält die Serie ehrlich, ohne die Rückfrage selbst abzuschalten.
- Infrastrukturausfälle bleiben getrennt (ADR-0126 Nachtrag): nur
  Engine-tote Timeouts und Anbieterausfälle zählen als `invalid` und
  Wiederholung.

## Grenzen

- Cloud-Läufe ohne einzigen Zug kosten ehrig 0 USD — die Ausnahme von
  „kein Lauf mit Kosten 0“ (AC-P84-3) ist hier dokumentiert; lokale Läufe
  verbrennen weiterhin gemessene Energie (P81), auch beim Abbruch.
- `baseline: 0` bei Abbrüchen ist „nicht gemessen“, nicht „keine roten
  Tests“; die Fehlerquote trägt die Aussage, nicht das Feld.
- Der Prüfer läuft für Abbrüche nicht: ob der halbfertige Stand zufällig
  grün gewesen wäre, ist nicht Teil des Ergebnisses.

## Prüfungen

- `scripts/eval/evaluation.test.mjs`: runPhase meldet Zeitlimit und
  Rückfrage strukturiert, andere Vor-Zug-Status bleiben Fehler.
- `apps/hub/test/eval.integration.test.ts`: Timeout-Lauf wird mit
  partieller Token-Telemetrie, `turns = 0` und Fehlerquote 1 erfasst.
- `packages/contracts/test/runs-evaluation-summary.test.ts`: Default-Parse
  alter Datensätze, abgebrochene Form zulässig, `completed`-Invarianten
  bleiben erzwungen.
- `packages/core/test/modules/runs/evaluation-summary.test.ts`:
  `outcome ≠ completed` zählt als Fehler.
