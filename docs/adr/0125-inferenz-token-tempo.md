# ADR-0125 — Eigene Messreihe für lokales Inferenztempo

**Status:** angenommen (nachgetragen für die mit PR #264 eingeführte Implementierung von EPIC-P79)

## Kontext

P59 fasst Server- und Hardware-Metriken in einer groben Zeitreihe zusammen.
Das reicht für Auslastung und Temperaturen. Für Prefill, Decode und die Zeit
bis zum ersten Token braucht der Hub enger getaktete Werte und, wo verfügbar,
Einzel-Requests. Diese Felder und Zeitfenster unterscheiden sich je Engine.

## Entscheidung

- Der Hub liest konfigurierte Engines mit einem eigenen Tracker, standardmäßig
  alle zwei Sekunden. `aiMetrics` und `inference.engines` bleiben unabhängig.
  Die Bedienoberfläche bündelt sie in getrennten Reitern unter Statistik.
- Der Vertrag in `packages/contracts/src/inference/tempo.ts` normalisiert
  Einheiten und kennzeichnet fehlende Felder mit `null`. Perzentile entstehen
  nur aus Einzel-Requests. Für Prefill zählt die frisch gelesene Tokenmenge.
- Strata liefert Einzel-Requests, die in `inference-requests.jsonl` im
  Hub-Datenverzeichnis erhalten bleiben. Beim Start rekonstruiert der Tracker
  daraus das aktive Fenster. Halogen und llama.cpp liefern Raten aus Zählern.
- Snapshots begrenzen den sichtbaren Ausschnitt auf 12 Requests, 120
  Verlaufspunkte und 8 Hinweise. Die API enthält keine Prompttexte. Optionale
  Bearer-Schlüssel kommen aus einer Datei gemäß ADR-0011.

## Konsequenzen

Pro Engine kommt mindestens eine Abfrage pro Poll hinzu. Quellen können
ausfallen, ohne dass die übrigen verschwinden. Die Grenzen der Anzeige und
die Einrichtung stehen in [Token-Tempo der Inferenz](../inference-token-tempo.md).
