# EPIC-P81 — Host-Monitoring und Strom: alle Werte aller Hosts, schick und ehrlich

**Status:** in Umsetzung seit 23.11.2026 (T81.1–T81.8 liegen), Rest offen · **Phase:** P81 · **Dauer:** 3–4 Agenten-Wochen (grobe Schätzung) · **Abhängigkeit:** keine blockierende (Quer-Epic wie P59/P66); P59 und P66 abgeschlossen, P79 offen nur mit T79.6. P30/P31 On hold bleiben unberührt. Tracker-Issue: #361.

## 1. Ziel & Entscheidung

Unter `#/statistik` ein neuer Reiter **Hosts**: alle auslesbaren Werte von omarchy, evox2,
dem Server und dem NAS (Last, Temperatur, Lüfter, Takt, Speicher, Platten,
Netz, GPU, Watt, kWh) mit Verlauf. Die Reiter Statistik, Metriken und Inferenz bekommen
dieselbe Bildsprache. Vorlage für den Stil: [powermeter](https://github.com/KaiFelixBennett/powermeter)
(MIT, Stand `8b024d5`).

**Entscheidung: nicht 1:1 übernehmen, sondern Stil und Messregeln übertragen.**

| Befund (geprüft 23.11.2026) | Folge |
|---|---|
| Das Linux-Widget ist GTK4/Libadwaita, das andere Tk (`gtkwidget.py`, `gui.py`); es gibt keine Web-Oberfläche | Nicht in die PWA einbettbar, muss in Preact neu entstehen |
| `python3 -m powermeter scan` auf omarchy findet nur die feste Schätzung `rest` (30 W) | Als Messquelle ist es hier heute wertlos, obwohl die RX 580 rund 66 W meldet |
| `_AmdSpec` sucht ab `card*/device`; die Muster in `HwmonPower` treffen `hwmon/hwmonN/` darunter nicht, und es wird nur der erste Glob-Treffer genutzt (`sources/linux.py`) | AMD-GPU bleibt auf omarchy und evox2 unsichtbar |
| Sammeln per SSH + CSV (`sync.py`), eigener Dienst und eigene Geräteliste | Zweiter Sammelweg neben dem Fleet (ADR-0017) und zweite Wahrheit |
| Misst ausschließlich Watt | Deckt „alle möglichen Werte“ nicht ab |

**Übernommen werden** (mit MIT-Nennung in `docs/host-monitoring.md`): große Live-Zahl
mit Trend-Chip, Verlaufskurve mit Spitze/Ø/Tief, Anteilsbalken, Gerätezeile mit
Mini-Kurve und Detailseite, Tagesbalken; Zählerüberlauf-Behandlung (`_Delta`); „keine
erfundenen Nullen“; Wirkungsgrad wird beim Lesen gerechnet, nie in die Historie geschrieben.

**Nutzerentscheide 23.11.2026:** (D1) drei Hub-Hosts plus NAS, Windows später;
(D2) RAPL-Leserecht über eine eigene Gruppe; (D3) Verlauf 90 Tage gestuft;
(D4) nur Watt und kWh, **keine Euro-Beträge**.

## 2. Scope (In / Out)

**In:** Host-Sampler je Hub, NAS-Abfrage, persistenter Verlauf, Fleet-Zusammenführung,
Reiter „Hosts“ mit Detailseite je Host, gemeinsame Chart-Bausteine, optische
Überarbeitung von Statistik/Metriken/Inferenz, Behebung der Messfehler aus §3.1.

**Out:** Euro-Kosten (D4, P31); Windows (bmax) und Telefone; fremde Geräte im Tailnet;
Smart-Plugs; Alarme/Push bei Grenzwerten; Prometheus/OTel-Import (ADR-0010); Chart-
Bibliothek von Dritten; Steuern von Hosts (Lüfter, Takt, Neustart). Der P66-Satz „Tabellen
bleiben die Wahrheit“ wird nur insoweit geändert, als Diagramme dazukommen; jede
Kurve behält eine Tabellenansicht.

## 3. Design-Details

### 3.1 Bestand: was heute falsch oder unvollständig ist

- **Watt fehlt zu Unrecht.** `sampler.ts` (`sysfs:power_watts`) liest
  `device/power1_average`. Diese Datei existiert auf omarchy und evox2 nicht; der Wert
  liegt in `device/hwmon/hwmonN/power1_input`. ADR-0078 nennt ihn „nicht lesbar“,
  geprüft wurde der falsche Pfad. Ein reiner Pfad-Fix wäre aber falsch, siehe §3.2.
- **Nur eine GPU.** Der Sampler nimmt die erste Karte mit `gpu_busy_percent`; die RTX 5050
  im Server (54 W, per `nvidia-smi` lesbar) sieht er nie.
- **Nur die eigene Host-Quelle** erscheint in der Statistik-Sektion „System“:
  `sources.find(kind === "hub-host")`, obwohl der Report Peers enthält.
- **Metriken-Reiter** ist eine Tabelle je Quelle ohne Verlauf, obwohl `history` mitkommt.

### 3.2 Was die Hosts hergeben (gemessen 23.11.2026, lesend)

| Host | CPU | Sensoren/Leistung | Hub |
|---|---|---|---|
| omarchy | Ryzen 7 5800X | k10temp, nvme, amdgpu (Watt, Lüfter, Takt, Spannung, Limit 175 W), jc42 (RAM), iwlwifi | Home |
| evox2 | Ryzen AI Max+ 395 | acpitz, nvme, amdgpu (PPT), k10temp, r8169, mt7925, `gpu_metrics` | Peer |
| Server | Ryzen 5 7600 | nvme, k10temp, asus, amdgpu, RTX 5050 per `nvidia-smi` | Peer |
| NAS | Synology | CPU- und Plattentemperatur, `/proc` inkl. PSI, `md`, Plattenzustand aus `/run/synostorage/disks/*` (ohne root lesbar); hwmon leer, kein Watt | keiner |

RAPL (`energy_uj`) existiert auf allen drei Hub-Hosts, ist aber nur für root lesbar.
Keine Lüfterdrehzahl auf dem Server; `smartctl` fehlt auf omarchy und dem Server.
Solche Lücken stehen als „nicht gemeldet“ auf der Seite, mit Grund.

**PPT ist nicht überall GPU-Leistung (gemessen, offener Punkt beantwortet):** Auf dem
Server meldet die integrierte GPU 50–64 W bei 0 % GPU-Last, auf evox2 6,5–17 W bei
0 %. Dort ist PPT die Leistung des **CPU-Pakets**; auf omarchy (gesteckte RX 580) die
der Grafikkarte. Unterscheidbar ohne root: Beide APUs führen das Label `vddnb` und kein
`power1_cap`, die Karte umgekehrt. Folge: APU-Watt kommen ohne RAPL; nötig ist RAPL nur
für die CPU von omarchy. Ist beides lesbar, zählt genau eine Quelle je Paket.
`nvidia-smi` kostet auf dem Server 13 ms je Aufruf.

**Stand der Peers (`version.json`, 23.11.2026):** evox2 `a4135a6c` (13.11., noch ohne
`/api/aimetrics`), Server `3bbe465c` (19.11., mit). Das beschreibt den PWA-Build; die
Sampler-Konfiguration beider Hubs war nicht einsehbar.

### 3.3 Vertrag und Messung (ADR-0117 vor der ersten Zeile Code)

- **Neuer Vertrag** `contracts/src/hostmetrics/`, Route `GET /api/hostmetrics`
  (+ `/history`), neu in `FLEET_ROUTABLE`. `AiMetricsReport` wird **nicht** erweitert:
  `kind` und `source` sind geschlossene Enums, und ein älterer Home-Hub verwirft bei einem
  unbekannten Wert den ganzen Peer-Report (`AiMetricsReportSchema.parse`).
- **Offener Messpunkt** statt Feldliste: `{ key, group, device, label, unit, value|null,
  reason?, source, ts }`. Neue Sensoren erscheinen ohne Vertragsänderung; Unbekanntes
  landet sichtbar unter „Weitere“ (Fail loud).
- **Gruppen:** CPU (gesamt/je Kern, Takt, Last, PSI), Speicher (RAM, Swap, zram), GPU
  (je Karte, AMD sysfs + `nvidia-smi`), Temperaturen, Lüfter, Leistung, Platten (Belegung,
  Durchsatz, Zustand), Netz (je physischer Schnittstelle; veth/Bridge zusammengefasst),
  System (Uptime, Prozesse, Kernel).
- **Host-Hardware gehört danach hostmetrics.** `aimetrics` behält Modell-Server;
  seine `hub-host`-Felder bleiben für Alt-Hubs, die PWA liest sie nicht mehr.
- **Doppelzählung verhindern:** PPT einer APU und RAPL desselben Pakets sind Alternativen
  (§3.2), nie Summanden. Ein PPT ohne eindeutige Zuordnung zählt nicht. Summen tragen ihre Bestandteile und das Wort „gemessene Komponenten“;
  sie sind keine Steckdosenwerte. Ein Netzteil-Wirkungsgrad ist nur optional und als
  „geschätzt“ markiert; feste „Rest“-Watt gibt es nicht.
- **RAPL (D2):** udev-Regel für die Gruppe `hostmetrics`, Modus 0440, nur
  `energy_uj`. Der Nutzer führt sie je Host mit sudo aus; der Hub erhöht keine Rechte.
  Das Restrisiko (PLATYPUS-Seitenkanal für Prozesse dieser Gruppe, also auch für Agenten
  unter demselben Nutzer) steht im ADR.
- **NAS:** Der Home-Hub startet ein festes, rein lesendes Kommando per `ssh` (eigener
  Schlüssel mit `command=`-Zwang und `restrict`, Timeout, 60-s-Takt, keine Nutzereingaben
  im Kommando). Das ist eine bewusste Ausnahme zu „kein SSH-Scraping“ im
  ADR-0078-Nachtrag, beschränkt auf Hosts ohne Hub.

### 3.4 Verlauf (D3)

Eigene SQLite-Datei `data/hostmetrics.db` je Hub: Minutenmittel (mit Min/Max) 7 Tage,
Viertelstunden 90 Tage, Tages-kWh dauerhaft. Live-Takt 5 s nur im Speicher. Lücken bleiben
Lücken: Energie wird nur über gemessene Zeit integriert, die Abdeckung steht daneben
(„18,2 von 24 h“). **K7:** Die Messreihe ist selbst Quelle und nicht aus JSONL ableitbar;
Recovery ist der letzte abgeschlossene Minutensatz (Verlust ≤ 60 s), eine defekte
Datei wird beiseitegelegt und gemeldet. Das ADR begründet diese Abweichung.
Jeder Hub speichert nur sich selbst, der Home-Hub zusätzlich das NAS.

### 3.5 Oberfläche

- **Reiter:** Statistik · **Hosts** · Metriken · Inferenz (`#/statistik/hosts[/<hostId>]`).
- **Übersicht:** Hero mit Gesamt-Watt der messbaren Komponenten und Trend gegen 5 min,
  Segment Stunde/24 h/7 Tage/90 Tage, Anteilsbalken, dann je Host eine Karte (Status, CPU,
  RAM, GPU, wärmster Sensor, vollste Platte, Watt, Mini-Kurve).
- **Detail:** alle Gruppen klappbar, Suche über Messpunkte, Tagesbalken kWh.
- **Bausteine** in `shared/ui/charts/`: `StatHero`, `TrendChip`, `AreaChart`, `Sparkline`,
  `ShareBar`, `DayBars`, `Meter`. Eigenes SVG, Farben ausschließlich als neue
  Daten-Tokens in `00-tokens.css` (powermeter-Palette als Ausgangspunkt, Kontrast geprüft).
- **Bestandsreiter:** Metriken = Karten mit Kurve, Tabelle auf Klick. Inferenz = gleiche
  Hero-/Segment-Bausteine, Datenlogik unverändert. Statistik = Kennzahl-Kacheln und
  p50/p90/p95-Balken über den Tabellen, n und Klein-n-Hinweis bleiben; die Sektionen
  „System“ und „KI-Server“ werden zu Kurzkarten mit Link (keine doppelte Anzeige).
- Texte mit `t()` in de/en; Zustand in der URL; Offline mit letztem Stand und Uhrzeit (K10).

## 4. Aufgaben (Checkliste T81.m)

- [x] **T81.1** Messfehler aus §3.1 im bestehenden Sampler beheben (BUG-0274):
  hwmon-Pfad mit Trennung Karte/Paket, alle Hub-Hosts in „System“; Nachtrag zu ADR-0078. Eigener PR, sofort nützlich. **K9**
- [x] **T81.2** Spike (23.11.2026, Ergebnisse in §3.2): Bedeutung von PPT je Host,
  `nvidia-smi`-Kosten, NAS-Felder, Hub-Stand der Peers. `gpu_metrics` wird nicht gebraucht.
- [x] **T81.3** ADR-0117 (Vertrag, Verlauf/K7, NAS-SSH, RAPL) und Contracts mit Tests. **K5/K7**
- [x] **T81.4** Core-Modul `hostmetrics`: `/proc`, hwmon, AMD, NVIDIA, Platten, Netz gegen
  Fixture-Bäume (anonymisiert: keine Seriennummern, MACs, IPs). **K9**
- [x] **T81.5** RAPL-Regel mit Installations- und Rückbauanleitung; Zählerüberlauf-Test.
- [x] **T81.6** Verlaufsspeicher mit Verdichtung, Aufräumen, Recovery. **K7**
- [x] **T81.7** Routen, `FLEET_ROUTABLE`, Peer-Zusammenführung; Alt-Hub meldet sich als
  „Version zu alt“ statt leer. **K5/K9**
- [x] **T81.8** NAS-Sammler per SSH. **K9**
- [x] **T81.9** Chart-Bausteine und Tokens, Design-System-Doku.
- [x] **T81.10** Reiter „Hosts“ mit Detailseite, E2E `host-monitoring.spec.ts`. **K10**
- [ ] **T81.11** Reiter Metriken und Inferenz auf die Bausteine; bestehende Specs grün.
- [ ] **T81.12** Reiter Statistik überarbeiten; Filter-/Klapp-Zustand (P66) bleibt. **K10**
- [ ] **T81.13** Roll-out auf drei Hubs (evox2 läuft unter anderem Benutzer: Nutzer nötig), `docs/host-monitoring.md`, Guide-Inventar,
  Host-Liste in `~/AGENTS.md`.

Reihenfolge: T81.1 sofort; T81.3 → T81.4/6/7 → T81.10; T81.9 parallel.

## 5. Acceptance Criteria (AC-P81-k)

- **AC-P81-1:** Alle vier Hosts erscheinen; jeder Sensor aus §3.2 ist als Wert oder als
  „nicht gemeldet“ mit Grund zu finden. Abgleich gegen `sensors`/`nvidia-smi` je Host.
- **AC-P81-2:** GPU-Watt auf omarchy weicht höchstens 5 % von `sensors` ab (gleicher
  Zeitpunkt, 10 Messungen); der Test zu T81.1 ist ohne Fix rot.
- **AC-P81-3:** Fällt ein Host aus, ist das binnen 60 s sichtbar, der letzte Wert bleibt
  mit Uhrzeit stehen, und die Summe zählt ihn nicht weiter mit (K9/K10).
- **AC-P81-4:** Nach Hub-Neustart ist der Verlauf da, Verlust ≤ 60 s; eine defekte
  Datei verhindert den Start nicht (K7).
- **AC-P81-5:** Ein Test speist PPT und RAPL desselben Pakets ein; die Summe zählt einmal.
- **AC-P81-6:** Kein Euro-Betrag, keine feste „Rest“-Schätzung in der Oberfläche.
- **AC-P81-7:** Messlast des Samplers je Host < 1 % CPU im 10-min-Mittel, gemessen;
  Plattenbedarf nach simulierten 90 Tagen dokumentiert, Obergrenze 200 MB je Hub.
- **AC-P81-8:** Übersicht < 64 KB, Verlauf ≤ 720 Punkte je Reihe; am Handy (412 px) kein
  horizontales Scrollen.
- **AC-P81-9:** Kein Geheimnis, keine Seriennummer, MAC oder öffentliche IP in Antwort,
  Log oder Fixture (Test).
- **AC-P81-10:** Design-System-Ratchets, `check:i18n`, `check:arch` grün; jede Kurve hat
  eine per Tastatur erreichbare Tabelle.

## 6. Premortem (Failure-Modi + Mitigation)

1. **Schöne, aber falsche Summe:** PPT + RAPL doppelt oder Komponenten als Steckdose
   gelesen → Regel aus §3.2, AC-P81-5, Beschriftung „gemessene Komponenten“.
2. **Gemischte Hub-Versionen:** Ein Peer ist älter und die Seite bleibt leer → eigener
   Endpunkt, 404 wird „Version zu alt“, Test mit Alt-Antwort.
3. **Sampler bremst, was er misst:** `nvidia-smi` je 5 s, NAS-Platten wachen auf →
   Kosten im Spike messen, eigener Takt je Quelle, NAS nur `/proc` und `/run`, nie SMART.
4. **Verlauf füllt die Platte:** → Verdichtung mit harter Obergrenze, AC-P81-7. Die
   Seite zeigt ihren eigenen Platzbedarf.
5. **SSH-Ausnahme wird zum Fernsteuerkanal:** → erzwungenes Kommando, kein
   Parameter aus der PWA, Schlüssel nur als Dateireferenz (ADR-0011).
6. **RAPL-Regel fehlt nach Neustart oder Kernel-Update:** → Zustand „keine Berechtigung“
   mit Link zur Anleitung, nie 0 W.
7. **Umbau der Bestandsreiter verliert Ehrlichkeit oder Zustände:** → Specs
   `statistik`, `ki-server-metriken`, `inference-tempo` laufen unverändert mit; nur
   Selektoren dürfen sich ändern, keine Aussagen.
8. **Host fällt durchs Raster, weil Sensornamen wechseln** (`hwmonN` ist nicht stabil) →
   Schlüssel aus Treibername und Gerätepfad, nie aus der Nummer.

## 7. Definition of Done

Alle T81.* und AC-P81-* mit Evidenz; `npm run gate` lokal grün; GitHub-Actions-Lauf
(`verify`, `k8`, `e2e`) auf dem Abschluss-PR grün; jede neue UI-Funktion mit Spec in
`e2e/specs/`; alle vier Hosts live erreichbar, Reiter im Guide-Inventar; Geräteabnahme
auf Handy und Tablet als P000-Eintrag; Defekt-PRs mit `Fixes #<nr>`, Tracker-Issue in der
Statuszeile, Issues des Epics gesichtet (`docs/issues.md`).
