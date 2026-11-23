# ADR-0117 — Host-Metriken: offener Messpunkt-Vertrag, eigener Verlauf, NAS per SSH

**Status:** angenommen (2026-11-23) · **Bezug:** [EPIC-P81](../../epics/EPIC-P81-host-monitoring-strom.md),
ADR-0078 (Sampler), ADR-0023 (ehrliche Zahlen), ADR-0017 (Fleet), ADR-0011 (Secrets)

## Kontext

P81 zeigt alle auslesbaren Werte aller Hosts. `AiMetricsReport` taugt dafür nicht: `kind`
und `source` sind geschlossene Enums, und ein älterer Home-Hub verwirft bei einem
unbekannten Wert den ganzen Peer-Report.

## Entscheidung

1. **Vertrag** `contracts/src/hostmetrics/`: eine Liste von `HostMetricPoint`.
   `group`, `unit`, `source` sind freie Strings; unbekannte Gruppen zeigt die PWA unter
   „Weitere“. `value: null` trägt `reason`. Obergrenze 2.000 Punkte (REST, kein Event).
2. **Schlüssel** aus Treiber und Gerät (`hwmon:amdgpu:0000:2d:00.0:power1`), nie aus
   `hwmonN`. Bekannte Grenze: I²C-Busnummern können nach einem Boot wechseln.
3. **Leistung:** `powerDomain` benennt das gemessene Bauteil. Punkte derselben Domäne
   werden nie addiert, RAPL geht vor PPT. PPT gehört auf einer APU (`vddnb`, kein
   `power1_cap`) zu `cpu-package:0`, auf einer Karte zu `gpu:<pci>`; sonst zu nichts.
   Die Anzeige nennt jede Summe „gemessene Komponenten“ und führt fehlende Domänen auf.
4. **Quellen fallen einzeln aus:** Der Fehler steht in `errors`, der Rest läuft weiter (K9).
   `nvidia-smi` läuft nur bei vorhandener NVIDIA-Karte. `statfs` fragt nur lokale
   Blockgeräte, weil Netz- und FUSE-Laufwerke hängen können.
5. **Verlauf (T81.6):** `data/hostmetrics.db` je Hub; Minuten 7 Tage, Viertelstunden
   90 Tage, Tages-kWh dauerhaft. **Abweichung von K7:** Messwerte sind nicht aus JSONL
   ableitbar, die Datei ist selbst die Quelle. Als Events würden sie den Session-Strom
   mit Daten fluten, die keine Session betreffen. Recovery: letzter abgeschlossener
   Minutensatz (Verlust ≤ 60 s); eine defekte Datei wird beiseitegelegt und gemeldet.
6. **Fleet (T81.7):** `hostmetrics` kommt mit der Route in `FLEET_ROUTABLE`; ein 404 des
   Peers heißt „Version zu alt“.
7. **NAS (T81.8):** Der Home-Hub fragt Hosts ohne Hub per SSH ab. Ausnahme zum Nachtrag
   in ADR-0078 („kein SSH-Scraping“): eigener Schlüssel mit `command=` und `restrict`,
   festes lesendes Kommando, keine Eingaben aus der PWA, Timeout.
8. **RAPL (T81.5):** Leserecht nur über eine eigene Gruppe, vom Nutzer gesetzt.
   Restrisiko: Prozesse mit dieser Gruppe, also auch Agenten unter demselben Nutzer,
   können den PLATYPUS-Seitenkanal nutzen. Ohne Regel steht „keine Berechtigung“ da.

## Messung (23.11.2026, 2-s-Takt, Sammler aus T81.4)

| Host | Punkte | ohne Wert | JSON | CPU je Takt | Komponenten-Watt |
|---|---|---|---|---|---|
| omarchy | 107 | 1 (RAPL) | 17 KB | 12,6 ms | 63,5 (nur GPU) |
| evox2 | 120 | 2 | 18 KB | 13,0 ms | 6,7 (Paket) |
| Server | 82 | 2 | 13 KB | 10,2 ms | 107,4 (Paket 53,1 + RTX 54,3) |

Die CPU-Zeit enthält nicht die Kindprozesse (`nvidia-smi` rund 13 ms).

## Konsequenzen

`aimetrics` bleibt unverändert und behält die Modell-Server. Die PWA liest Host-Werte
künftig aus `hostmetrics`; die alten `hub-host`-Felder bleiben für ältere Hubs.
