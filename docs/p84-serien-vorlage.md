# P84-Serien-Vorlage: planen, fahren, ablegen, anzeigen

**Art:** how-to

Jede Serie (Pilot, Kern, Split, Skills) läuft nach demselben Muster. Planung:
[Pilotserie](p84-pilotserie-planung.md). Protokollformat und Hub-Einrichtung:
[Messlauf-Anleitung](evaluation-messlauf.md).

## 1. Beschreibung (je Serie ausfüllen, vor dem Lauf committen)

| Feld | Inhalt |
|---|---|
| Serienname | `[a-z0-9][a-z0-9._-]*`, eindeutig, nie wiederverwendet |
| Fragestellung | Welche Variable variiert, welche bleibt fix? |
| Parameter | Zellen, Aufgabenumfang, n, `timeoutMs`, `providerBudgetUsd` (alles im Protokoll) |
| Umgebung | Hub-Commit, Node, Host, Engine-Parameter, Quantisierung (Feld `setup`) |
| Preise/Tarif | Quelle + Datum je Zelle, Strompreis + Kurs + Datum |
| Messlatten | PRD-§9-Nummern der Messgrößen |
| Abbruch/Gültigkeit | wie in der Planung; serienspezifische Zusätze |
| Abweichungen | nach dem Lauf: was anders lief, mit Versuchsschlüssel |

## 2. Ablauf

```sh
npm run messlauf:eval -- plan  --protocol protocol.json            # Hash, Arme, Anzahl Läufe
npm run messlauf:eval -- check --protocol protocol.json            # Vorprüfung gegen den Benchmark-Hub
npm run messlauf:eval -- run   --protocol protocol.json --scratch /pfad/eval --series <name>
npm run messlauf:eval -- export --protocol protocol.json --first /pfad/eval/<name>/sessions.jsonl \
  --invalid /pfad/eval/<name>/invalid.jsonl --out <benchmark-repo>/evaluation/laeufe/JJJJ-MM-DD-<name>
npm run messlauf:eval -- pilot-report --protocol protocol.json --series <name> \
  --report docs/JJJJ-MM-TT_p84-<name>.md [--invalid-reason "<Grund>"]
```

`ANCIENTVOID_URL` und `ANCIENTVOID_TOKEN` zeigen auf den Benchmark-Hub.
Rohdaten verlassen den Hub nur über `export`; vor jedem Commit
`npm run check:secrets`. `data/` bleibt git-ignoriert.

## 3. Eine Datenquelle, zwei Sichten

Die Quelle sind die Journale des Hubs (`evaluation.completed`, K7). Daraus
fasst `summariseSeries` (core) zusammen; `GET /api/evaluation/series` und
`GET /api/evaluation/series/:series` liefern das. Die PWA zeigt es unter
`#/statistik/evaluation`, `pilot-report` schreibt dieselbe Zusammenfassung als
Markdown. Beide formatieren über `evaluationTable` (contracts), die Zellen sind
identisch. Der Report enthält die Rohwerttabelle (Einheiten im Kopf) und einen
CSV-Block zum Weiterrechnen. Beleg: `scripts/eval/evaluation.test.mjs`
(Report gegen Tabelle) und `e2e/specs/evaluation.spec.ts` (DOM gegen Tabelle).

## 4. Abschluss

- Report mit Datum im Namen unter `docs/`, nur aus echten Daten; er wird mit
  `wx` angelegt und nie überschrieben.
- Serie im Epic ([EPIC-P84](../epics/EPIC-P84-ai-arbeit-evaluation-benchmark.md))
  abhaken, Abweichungen im Report eintragen, Ordner im Benchmark-Repo prüfen
  (`manifest.sha256`, `messung_gueltig`) und die
  [Serienübersicht](evaluation-messlauf.md#serienübersicht-im-benchmark-repo)
  neu generieren.
