# ADR-0127 — Cache-Schreib- und -Lese-Tokens getrennt erfassen und bepreisen

- Status: angenommen für P84
- Bezug: [EPIC-P84](../../epics/EPIC-P84-ai-arbeit-evaluation-benchmark.md) T84.14,
  [ADR-0126](0126-evaluation-in-turn-metriken.md), AC-P84-3

## Entscheidung

Cache-Tokens, die ein Anbieter nach **Lesen** (Treffer) und **Schreiben**
(Aufbau) trennt, werden ab der Erfassung getrennt weitergegeben und getrennt
bepreist:

- Ereignis-Payload: `cacheInputTokens` = Cache-**Lese**-Tokens,
  neu `cacheWriteInputTokens` = Cache-**Schreib**-Tokens (beide nur, wenn > 0).
- Ergebnisdatensatz (`EvalResult.phases[]`): `cacheInputTokens` (Lesen) und
  `cacheWriteInputTokens` (Schreiben, Default 0).
- Protokoll-Tarif (`EvalCloudPrice`): neu `cacheWriteUsdPerMillion`
  (optional, auch 0 erlaubt). Fehlt der Schreibpreis, werden
  Schreib-Tokens zum **Input-Preis** gerechnet — nicht mehr zum Lesepreis.

Kosten je Cloud-Phase (ADR-0126 bleibt):

```
frisch   = inputTokens − cacheInputTokens − cacheWriteInputTokens
kosten   = frisch · inputUsdPerMillion
         + cacheInputTokens  · (cacheInputUsdPerMillion  ?? inputUsdPerMillion)
         + cacheWriteInputTokens · (cacheWriteUsdPerMillion ?? inputUsdPerMillion)
         + outputTokens      · outputUsdPerMillion
```

Der Claude-Adapter (auch `claude-zai`) splittet
`cache_read_input_tokens`/`cache_creation_input_tokens` des result-Events.
Der Kontext-Zähler `claude.context` (contextInputTokens) bleibt Summe aller
drei Eingabearten — er misst Kontextfüllung, keine Kosten. Die
Zusammenfassungen (`evaluation-summary.ts`, `scripts/eval/report.mjs`)
weisen `davon Cache-Tokens` als **Lesen + Schreiben** aus und rechnen
`davon Cache [USD]` mit dem jeweiligen Preis.

## Begründung

- Vorher flossen Schreib-Tokens in den Lesepreis; Anthropic berechnet
  Schreiben aber mit 1,25× Input (5-min-TTL), z.ai stellt
  „Cached Input Storage“ befristet kostenlos. Die Kosten waren damit eine
  **untere** Schranke — auch für die Provider-Deckel (pilot-6-Planung,
  „Bekannte Unschärfe“).
- Der Default „fehlender Schreibpreis = Input-Preis“ überschätzt z. B. z.ai
  leicht, unterschätzt Anthropic leicht (1,25×) — beide Abweichungen sind
  kleiner als die bisherige Verrechnung zum Lesepreis (0,1× bei Anthropic)
  und im Report sichtbar (Zellenzeile nennt den Schreibpreis oder
  „Schreiben zum Inputpreis“).
- Ein eigener Metrik-Spaltenpaar (Schreib-/Lese-Spalten) unterbleibt: die
  Tabelle bleibt stabil, der Split steht im Datensatz (`ergebnisse.jsonl`)
  und im Ereignisjournal.

## Kompatibilität (K7)

- Alte Datensätze ohne `cacheWriteInputTokens` parsen weiter (Default 0);
  ihr Schreibanteil steckt in `cacheInputTokens` und bleibt mit den damals
  geltenden Kosten lesbar.
- Serien, die den alten Tarifen ohne `cacheWriteUsdPerMillion` liefen,
  bleiben vergleichbar untereinander; der Wechsel der Kostensemantik ist am
  Messwerkzeug-Commit (`lauf.yaml`) erkennbar. Wie beim Korpus-Wechsel
  werden Serien über den Wechsel hinweg nicht zusammengerechnet.
- Adapter mit `cacheIncluded: true` (Pi, OpenCode, Codex, ACP) melden
  weiterhin eine aggregierte Cache-Zahl ohne Schreibanteil — für sie ändert
  sich nichts (Kosten oben abgeschätzt, wie gehabt ausgewiesen). Cursor
  meldet Lesen/Schreiben im Rohformat, fusioniert sie aber noch; ein
  Follow-up kann das wie beim Claude-Adapter splitten.

## Prüfungen

- Adapter: `packages/adapters/claude/test/normalize.test.ts` — reale
  result-Zeile mit `cache_read_input_tokens` 16 683 und
  `cache_creation_input_tokens` 10 520 wird zu getrennten Feldern.
- Kern: Kostenrechnung mit Schreibpreis 0 (z.ai), 1,25× Input (Anthropic)
  und fehlendem Preis (Input-Preis) in `apps/hub/test/eval.integration.test.ts`.
- Zusammenfassung: `cacheTokens` = Lesen + Schreiben, Cache-Kosten je Preis
  in `packages/core/test/modules/runs/evaluation-summary.test.ts`.
