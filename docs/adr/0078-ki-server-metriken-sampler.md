# ADR-0078 — KI-Server-Metriken: Sampler im Hub, Retention volatil, Contract für Les-API

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/aimetrics/` (neu),
`packages/contracts/src/fleet/fleet.ts` (`FLEET_ROUTABLE`),
`packages/core/src/modules/aimetrics/` (neu), `packages/core/src/platform/config.ts`
(`aiMetrics`), `apps/hub/src/modules/aimetrics/` (neu),
`apps/pwa/src/features/aimetrics/` (neu), EPIC-P59.
Eränzt ADR-0010 (Redaction-Liste gilt auch hier), ADR-0023 (Quelle pro Zahl),
ADR-0011 (Secrets nur als Datei-Referenz), ADR-0017 (Fleet-GET-Proxy).

## Kontext

EPIC-P59 will eine Metrik-Seite für den lokalen KI-Server (CPU, GPU, Tokens/s,
Prefill, Decode, KV-Cache, Queue). Prometheus/OTel-Import bleibt verneint
(ADR-0010); `GET /api/metrics` behält die Prozesszähler und wird nicht
angezapft. P56 bleibt der einzige Aggregationsort — P59 zeigt ausschließlich
direkte Proben. Der Hub kennt die Modell-Server bereits aus der
Konfiguration; die llama.cpp-Instanzen laufen im Betrieb mit `--metrics`
(`docs/local-llm.md`).

## Spike-Befund (T59.2, gemessen 2026-11-14)

**amdgpu-sysfs** (ohne ROCm-Userland, lesbar per `cat`):

| Datei | gpubox (Strix Halo) | Hub-Host (RX 580) |
|---|---|---|
| `gpu_busy_percent` | lesbar (87 %) | lesbar (0–7 %) |
| `mem_busy_percent` | **nicht lesbar** | lesbar (1 %) |
| `mem_info_vram_used` / `_total` | lesbar (≈2,0 GB / 2,1 GiB) | lesbar (≈2,3 GB / 8,6 GiB) |
| `mem_info_gtt_used` | lesbar (≈21,9 GB) | lesbar (≈163 MB) |
| `power1_average` | **nicht lesbar** | **nicht lesbar** (`<n/a`) |
| hwmon `temp1_input` | lesbar (amdgpu 59 °C) | lesbar (amdgpu 51 °C) |

Was fehlt, steht als „nicht gemeldet“ da — nie als 0 (ADR-0023). CPU lastet
der Hub-Host über `os.loadavg()`/`os.cpus()`-Delta, RAM über `os`.

**llama.cpp `/metrics`** (Familiendokumentation Master-README, Stand
2026-11-14): `llamacpp:prompt_tokens_total`, `llamacpp:prompt_seconds_total`,
`llamacpp:prompt_tokens_seconds`, `llamacpp:tokens_predicted_total`,
`llamacpp:tokens_predicted_seconds_total`, `llamacpp:predicted_tokens_seconds`,
`llamacpp:requests_processing`, `llamacpp:requests_deferred`,
`llamacpp:n_tokens_max`, `llamacpp:n_decode_total`,
`llamacpp:n_busy_slots_per_decode`, `llamacpp:spec_decode_*`. Historische
Histogramme gibt es im aktuellen Master nicht mehr: p50/p95 kommen aus dem
eigenen Sample-Fenster, nicht aus Histogram-Buckets.

## Entscheidung

1. **Sampler im Hub** (neues Core-Modul `modules/aimetrics/`). Poll-Intervall
   konfigurierbar (`aiMetrics.intervalSec`), Default 10 s. Pro Tick werden alle
   Quellen einmal beprobt; Fehler erscheinen als Zustand auf der Quelle
   (K9: sichtbar binnen eines Intervalls < 60 s), letzte Werte bleiben mit
   Zeitstempel stehen (K10).
2. **Quellen:** (a) die Modell-Server, die der Hub schon kennt
   (`assistant.model`, `gatekeeper.models[]`, `media.vision`) plus explizite
   `aiMetrics.servers`; API-Key nur aus `apiKeyFile` (ADR-0011), nur im
   `Authorization`-Header, nie in URL, Antwort oder Log
   (Redaction-Liste ADR-0010 Nr. 5 — Test auf Rot bei Leak). (b) Der
   Hub-Host selbst (sysfs/os, Spike-Tabelle).
3. **Retention/Recovery (K7):** Pro Quelle ein In-Memory-Ring-Buffer
   (Default-Fenster 15 min für p50/p95, Retention konfigurierbar).
   **Nicht persistiert.** Begründung: Proben sind Augenblicks-Beobachtungen,
   keine Zustandswahrheit; eine Persistenz wäre eine zweite
   Aggregationswahrheit neben P56. Recovery-Pfad: Nach Hub-Neustart leert sich
   der Buffer und baut sich aus den Live-Proben spätestens nach zwei
   Intervallen wieder auf (Test AC-P59-3).
4. **Les-API:** `GET /api/aimetrics` mit normaler API-Auth (K5: REST, keine
   EventBus-Payloads). Das Report-Format ist Contracts-Fläche
   (`packages/contracts/src/aimetrics/`) und unterliegt öffentlicher
   API-Stabilität.
5. **Fleet-Peer (§3.2):** `aimetrics` wird in `FLEET_ROUTABLE`
   (`packages/contracts/src/fleet/fleet.ts`) aufgenommen — der Home-Hub darf
   den `/api/aimetrics`-Report eines Peers über den bestehenden GET-Proxy
   (ADR-0017) abrufen. Nur GET; an der Verbotsliste (Token, WebAuthn) ändert
   sich nichts.
6. **Felder je Modell-Server** (nur belegte Familien; unverdächtig direkte
   Werte direct, alles andere derived): tokens/s total (abgeleitet aus
   Counter-Deltas), decode tokens/s (`predicted_tokens_seconds` direct),
   prefill tokens/s (`prompt_tokens_seconds` direct), Prefill-Zeit je Token
   abgeleitet, Queue (`requests_processing`/`requests_deferred` direct),
   Kontext-High-Water (`n_tokens_max`), Busy-Slots (`n_busy_slots_per_decode`),
   Spec-Decode-Counter. p50/p95 über das Sample-Fenster (kein Histogram).
   Die Seite zeigt pro Zahl Quelle (`direct`/`derived`) und Alter.

## Konsequenzen

- Neue Contracts-Typen + `FLEET_ROUTABLE`-Erweiterung: rote Tests zuerst
  (`isFleetRoutable("/api/aimetrics")`).
- Unit-Tests: Prometheus-Parser (Realformat), Recovery-Pfad (AC-P59-3),
  Redaction (Key nie in Antwort/Log), „nicht gemeldet“ ≠ 0.
- E2E `ki-server-metriken.spec.ts`: volle Daten, fehlende Quelle,
  Probe-Ausfall, Offline-Zustand; Funktionsinventar-Eintrag G67.
- Der Sampler pollt nur konfigurierte Quellen; ein Hub ohne Modell-Server
  zeigt nur die Host-Karte.

## Nachtrag 2026-11-17 — Halogen und Peer-Merge

Halogen (peonist flash-server auf evox2) ist **kein** llama.cpp: `/metrics`
antwortet mit 404, obwohl `/health` den Pfad nennt. Entscheidung:

1. **Fallback `/health`:** schlägt Prometheus fehl und liefert `/health` ein
   erkanntes Halogen-JSON, werden Queue/`busy`/Slots/Kontext als
   `halogen:*`-Felder gemeldet (ADR-0023: fehlende bleiben „nicht gemeldet“).
2. **Optional `aiMetrics.servers[].halogenLog`:** Dateipfad zum Serverlog
   (Format wie Kais `halogen-livelog.py` / `serve_api`-Zeilen). Daraus Prefill-
   und Decode-tokens/s — nur Zahlen, keine Prompt-Inhalte. Leserecht muss der
   Hub-Prozess haben; sonst bleiben die Raten „nicht gemeldet“.
3. **Peer-Merge:** `aiMetrics.mergePeers` (Default true). `GET /api/aimetrics`
   hängt Quellen der Fleet-Peers an (Timeout fail-loud als Fehlerquelle).
   Jeder Hub misst weiterhin nur lokal (`hostProbe` + eigene Server); kein
   SSH-Scraping vom Home-Hub.
4. **`probeKnown`:** Cloud-URLs (nicht Tailnet/RFC1918/localhost) werden nicht
   mehr als Modell-Server angezapft — vermeidet z.ai-404-Rauschen.

## Nachtrag 2026-11-23 — Leistung liegt in hwmon (BUG-0274)

Der Spike-Befund „`power1_average` nicht lesbar“ prüfte `device/power1_average`. Der
Kernel meldet PPT unter `device/hwmon/hwmonN/power1_{average,input}` in µW. Auf einer APU
(`in1_label` = `vddnb`) ist das die Leistung des CPU-Pakets
(`sysfs:package_power_watts`), auf einer Karte (`power1_cap` vorhanden) die der GPU
(`sysfs:power_watts`). Trifft keins oder beides zu, bleibt beides „nicht gemeldet“.
Der neue Feldschlüssel ist additiv (`key` ist ein freier String).

## Nachtrag 2026-11-23 — Zähler statt Momentaufnahme (BUG-0278)

Halogen ab 0.18 hat `/metrics` (llama.cpp-Namen plus `halogen:*`); ein Gateway davor reicht
den Pfad nicht zwingend durch. `/health` allein zeigt nur den Augenblick: Anfragen von
wenigen Sekunden fallen zwischen zwei Abfragen. Deshalb:

1. Optional `aiMetrics.servers[].metricsUrl`: Zähler-Endpunkt neben `url`, ohne Schlüssel abgefragt.
   Fällt er aus, bleiben die `/health`-Werte, und die Quelle steht auf Fehler (K9).
2. Meldet eine Quelle `halogen:*`-Zähler, wird `/health` zusätzlich gelesen (Slots, Warteschlange, busy).
3. Neue abgeleitete Felder: Decode-/Prefill-Tempo je gerechneter Sekunde und Anfragen je Minute. Ohne
   neue Arbeit entsteht kein Wert; der letzte bleibt mit Alter stehen. Springt ein Zähler zurück, gibt es keine Rate.
