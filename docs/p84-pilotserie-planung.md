# P84-Pilotserie: Planung vor dem ersten Lauf

**Art:** erklaerung

Festgeschrieben **vor** der Serie (Stand 2026-11-26). Nachträglich wird nichts
umdefiniert; Abweichungen stehen im Report unter „Abweichungen“. Die Pilotserie
ist Stufe 1 des Plans im Benchmark-Repo (`evaluation/plan-v3-zur-pruefung.md`):
Sie liefert echte Token- und Kostenwerte, bevor Deckel und Matrix hochgerechnet
werden. Durchführung und Ablage: [Serien-Vorlage](p84-serien-vorlage.md).

## Fragestellung

1. Sind die Zellen (Harness × Modell) mit der Messkette vollständig und gültig
   messbar (Token je Richtung, Cache getrennt, Kosten, Energie, Abnahme)?
2. Wie streuen Wandzeit, Token und Kosten je Zelle bei n = 2 auf vier Aufgaben?
   Die Werte kalibrieren Kostenrahmen und Provider-Deckel der Kernserie.
3. Zeigt die Negativkontrolle Lebenszeichen und bleibt ohne Änderung grün?

Die Pilotserie beantwortet **keine** Rangfrage zwischen Zellen (R9.8: ohne
Vollkorpus, n ≥ 3 und Streuung keine Rangfolge).

## Messgrößen und Messlatten

| Größe | Einheit | Quelle | Messlatte |
|---|---|---|---|
| Fehlerquote (Abnahme/Lint/Typecheck rot) | Anteil 0–1 | Abnahme im Prüfverzeichnis | PRD §9 K1 (Aufgabe gelöst), AC-P84-2 |
| Wandzeit | ms | Runner-Stoppuhr | K1 (Dauer je Aufgabe) |
| Eingabe-, Cache-, Ausgabe-Token | Token | `usage`-Events, ADR-0126 | K5 (Payload ≤ 4 KB), ADR-0003/0006 |
| Kosten Cloud / Cache / Energie | USD | Preis-Snapshot, P81-Watt | AC-P84-3 (Preisdatum im Datensatz) |
| Energie | kWh | P81-Minutenwerte × Zeit | AC-P84-3 |
| Tool-Fehler, Turns | Anzahl | `turn_metrics` | AC-P84-2 |
| Wiederherstellung der Ergebnisse | ja/nein | Journal (`evaluation.completed`) | K7 |

Die Metrikliste steht einmal in `EVAL_METRICS`
(`packages/contracts/src/runs/evaluation-summary.ts`); PWA und Report lesen sie
von dort.

## Versuchsaufbau

- Isolierter Benchmark-Hub (eigenes Datadir, Loopback, `hostId omarchy-bench`),
  Harnesses mit eigenem Profil ohne globale Skills/Regeln.
- Korpus: vier Aufgaben aus dem eingefrorenen Korpus (`scripts/eval/corpus.json`,
  Hash im Datensatz) plus die Negativkontrolle `notizen-route-negativ`.
- n = 2 je Zelle, `timeoutMs` und Deckel je Provider im Protokoll
  (`providerBudgetUsd`); Anthropic-Pilot-Rahmen ≈ 9 USD, OpenAI ≈ 3 USD
  (Annahme, die die Pilotserie ersetzt).
- Preise: Listenpreise mit Datum und Quelle je Zelle; Strom 0,33 EUR/kWh,
  Kurs mit Datum im Snapshot. Abo-Provider (z.ai, Cursor) als
  Listenäquivalent, nicht als Barausgabe.
- Last auf den Messhosts pausiert; Hardware, Engine-Parameter und
  Quantisierung stehen im Protokollfeld `setup` und im Zell-Fingerprint.

## Gültigkeit und Abbruch

Ungültig (`messung_gueltig: false`, Grund im Report) wird die Serie bei:

- gemischtem Korpus- oder Protokoll-Hash innerhalb der Serie (Report und App
  verweigern bzw. markieren das);
- fehlender Pflichtangabe (Prüfstand, Modell/Version, Datum, Werkzeug);
- Negativkontrolle ohne Token-Lebenszeichen oder mit Dateiänderung.

Ausfälle der Infrastruktur zählen nie als Aufgabenfehler (`invalid.jsonl`,
höchstens `maxInfraRetries` Wiederholungen). Der Runner bricht laut ab bei drei
Ausfällen in Folge, erreichtem Provider-Deckel oder Timeout bei lebender Engine.
Erfasste Läufe bleiben lesbar; die Serie bleibt dann `--partial`.

## Auswertung

Je Arm und Aufgabe: Median, Mittel, Min–Max, n. Ein Mittelwert steht nie
ohne Streuung. Nicht gelesene Werte stehen als `n/a`, nie als 0.
Der Report „Was das nicht sagt“ benennt die Grenzen (n = 2, vier Aufgaben,
Listenäquivalent bei Abos).

## Ausdrücklich offen

Der Lauf selbst braucht die Freigabe des Nutzers (GPU-Fenster, Kosten bis zum
Deckel). Bis dahin existiert **kein** datierter Pilotbericht; er entsteht erst
aus echten Daten per `pilot-report` und wird nicht von Hand geschrieben.
