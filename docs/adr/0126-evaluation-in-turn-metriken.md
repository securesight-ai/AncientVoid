# ADR-0126 — Evaluation im Session-Journal

- Status: angenommen für P84
- Bezug: [EPIC-P84](../../epics/EPIC-P84-ai-arbeit-evaluation-benchmark.md), K5/K7/K8

## Entscheidung

`POST /api/sessions/:id/evaluation` bindet die Abnahme und den Prüfstand
eines Laufs an seine abgeschlossene Bausitzung. Der Hub liest die
abgeschlossenen Züge und die getrennt gemeldeten Ein-/Ausgabe-Tokens aus
denselben Ereignissen wie die Turn-Metriken. Ein Split referenziert genau
eine frühere Plansitzung desselben Laufs.

Der Hub schreibt `evaluation.completed` in das vorhandene Session-JSONL
und sichert den Append vor der HTTP-Antwort. Der EventStore lagert
überlange Inhalte in seinen bestehenden Blob-Speicher aus. Der
HTTP-Schreibzugriff ist menschlichen lokalen Operator-Tokens vorbehalten.
Wiederholung einer identischen Anfrage liefert denselben Datensatz.
`GET /api/sessions/:id/evaluation` liest aus dem Journal, auch bei leerem
Turn-Metrik-Cache. Bei Backup und Restore gehören JSONL, Snapshots und
referenzierte Blobs zusammen. Es gibt keine Evaluationsdatenbank.

Cloud-Kosten sind USD-Listenpreisäquivalente mit eingefrorenem Preisdatum
und Quelle. Das gilt auch für Cache-Tokens, deren Rabatte und individuelle
Tarife nicht abgebildet werden. Lokale Kosten sind gemessene positive
kWh der ausgewiesenen P81-Komponenten und der angesetzte USD/kWh-Tarif.
Fehlende Richtungstelemetrie oder Energie blockiert die Ergebniserfassung.

OpenCode reicht vorhandene per-step Richtungstokens im bestehenden
`payload.usage` weiter. Claude ergänzt die Eingabe um ausgewiesene
Cache-Tokens. Vorhandene Gesamtzähler bleiben kompatibel. Pi meldet
bereits die aggregierte Eingabe einschließlich der Cache-Tokens.

## Nachtrag 2026-11-26: Protokoll Version 2

Das Protokoll beschreibt Zellen (Harness × Modell) statt eines festen
lokal/Cloud-Paares je Harness. Neu im Ergebnisdatensatz: `attempt`
(Versuchsnummer nach Infrastrukturausfall), `cacheInputTokens` (nur die
ausdrücklich gemeldeten Cache-Tokens; Adapter mit aggregierter Eingabe wie Pi
werden zum Eingabepreis gerechnet und überschätzen daher die Kosten), optional
`cacheInputUsdPerMillion` im Preis-Snapshot sowie `eurPerKwh`, `usdPerEur` und
`fxDate` im Energie-Snapshot. Alle Felder sind additiv; bestehende
Aufzeichnungen bleiben lesbar (`attempt` hat den Vorgabewert 1).
`cacheInputTokens` ist für neue Aufzeichnungen Pflicht.
