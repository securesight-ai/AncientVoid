# EPIC-P59 — Metrik-Seite: Auslastung des lokalen KI-Servers

**Status:** abgeschlossen 2026-11-15 — Live-Abnahme an gpubox nach P000 verschoben (T000.23) · **Phase:** P59 · **Dauer:** 1–2 Agenten-Wochen (grobe Schätzung)
**Abhängigkeit:** keine fachliche offene (Quer-Epic, Präzedenz P50–P53, P47–P52; Vorgänger-Phase P57 abgeschlossen 13.11.2026). Datenbasis auf bestehendem Betrieb (docs/local-llm.md, ADR-0010, ADR-0023); P56 bleibt der Aggregationsort — Abgrenzung §3.4.

Quelle: Nutzerauftrag vom 14.11.2026; Recherche mit Bestand:
[2026-11-14](../docs/2026-11-14_recherche_verfeinerungen_typewriter_metriken.md).

## 1. Ziel

Eine neue Metrik-Seite für den Server, auf dem die lokalen Modelle laufen:
CPU-Auslastung, GPU-Auslastung, Tokens/s, Prefill, Decode und weitere
Kennwerte des lokalen KI-Servers — live beprobt, ehrlich nach ADR-0023
(Quelle steht daneben; „nicht gemeldet“ ist kein Quadrat mit 0). Messlatten
K5 (Kennzahlen laufen über REST-Endpunkte, nicht über den EventBus),
K7 (jede neue State-Quelle hat einen dokumentierten Recovery-Pfad —
Entscheid im ADR), K9/Fail-loud (Probe-Ausfall sichtbar < 60 s), K10
(Offline: letzte Daten + Zeitstempel, kein White-Screen).

## 2. Scope (In / Out)

**In:** Serverseitiger Sampler für die lokalen Modell-Server (llama.cpp mit
`--metrics`, bereits im Betrieb), CPU-/GPU-/Speicher-Proben auf dem
Hub-Host, neue Les-API mit normaler API-Auth, Metrik-Seite in der PWA
(nav-registriert, mobil erreichbar), E2E-Spec `ki-server-metriken.spec.ts`,
Funktionsinventar-Eintrag.
**Out:** Session-Kennzahlen und Rollups (bleiben bei P56 — keine zweite
Aggregationswahrheit); Prometheus/OTel-Import (bleibt verneint nach
ADR-0010); Cloud-Telemetrie; Geschichte — Langzeit-Histogramme über die eigene
Retention hinaus; GPU-Auslastung auf Hosts ohne belegte Lesbarkeit ( dann
„nicht gemeldet“, nicht erfunden).

## 3. Design-Details

### 3.1 Datenquellen (Bestand, nicht Behauptung)

- **llama.cpp:** `ancientvoid-llama` (und `ancientvoid-vision`) laufen auf
  gpubox mit `--metrics` (docs/local-llm.md) — der Prometheus-Textendpoint
  liefert tokens/s (decode), prefill/TTFT-Zeiten, KV-Cache-Belegung,
  Queue/Slots. Der Hub beprobt ihn serverseitig per HTTP; API-Key nur im
  Header (Redaction-Liste ADR-0010 Nr. 5 gilt auch hier), nie in der URL.
- **CPU:** OS-Proben auf dem Hub-Host (load/CPU/RAM — der Memory-Check aus
  `/api/health` existiert schon). Für einen Modell-Server auf einem
  Fremd-Host (§3.2) braucht die CPU-/GPU-Probe einen Weg zum Peer —
  Contract-Erweiterung nötig, also **ADR vor Implementierung** (Regel 1).
- **GPU:** gpubox ist AMD Strix Halo (RDNA 3.5, Unified Memory) ohne
  ROCm-Userland. Spike: Auslastung/RAM/Leistung per amdgpu-sysfs lesen;
  Spike-Befund entscheidet, was als Zahl, was als „nicht gemeldet“ gilt.

### 3.2 Anbindung

Erste Ausbaustufe: Beprobung von Endpunkten, die der Hub schon kennt
(konfigurierte Modell-Server aus ADR-0060/hub.config). Ein Modell-Server auf
einem Peer-Host benötigt einen Sammelweg über den Fleet-Peer — neue
vertragsfläche, ADR-Pflicht, vor dem ersten Verhaltens-Merge.

### 3.3 Seite und Verhalten

Neue Seite (PWA-Feature `apps/pwa/src/features/<feature>/` —
Vorschlag `features/ai-metrics`): Karten je Instanz (Modell-Alias), Live-
Felder mit Zeitstempel der letzten Probe: CPU-Auslastung, GPU busy,
VRAM/Unified Memory, Temperatur/Leistung, Tokens/s gesamt und decode,
Prefill/TTFT p50/p95 (kurzes Fenster), KV-Cache, Queue. Kurze Retention für
Verlaufsdiagramme (Ring buffer, rebuildbar aus Proben — was persistiert
wird, entscheidet das ADR mit Recovery-Pfad, K7). Quelle und Alter jeder
Zahl sichtbar; Probe-Fehler als Zustand, nicht als Null (ADR-0023).

### 3.4 Abgrenzung

P56 bleibt die einzige Aggregationsseite (Rollups aus dem EventStore);
P21 bleibt Lauf-/Session-Metriken. P59 zeigt ausschließlich direkte
Proben von System- und Server-Proben. P56-Status (Planungsentwurf, Review)
bleibt unberührt.

## 4. Aufgaben (Checkliste T59.m)

- [x] **T59.1** ADR: Sampler-Architektur, Datenquellen, Retention/Recovery-Pfad (K7), Contract-Frage Fleet-Peer — vor dem ersten Code-Merge. — ADR-0078, MR !471.
- [x] **T59.2** Spike GPU-/CPU-Lesbarkeit auf gpubox (amdgpu sysfs), Beleg im ADR; Unlesbares bleibt „nicht gemeldet“. — Spike 2026-11-15, Beleg in ADR-0078 (Hub-Host RX 580 via sysfs lesbar; gpubox Strix Halo CPU lesbar, GPU ohne ROCm-Userland → „nicht gemeldet“).
- [x] **T59.3** Serverseitiger Sampler (llama.cpp `/metrics` per Header-Auth; OS-Proben; Poll-Intervall konfigurierbar, Default ~10 s; Fail loud). — `packages/core/src/modules/aimetrics/`, 14 Tests.
- [x] **T59.4** Les-API mit normaler API-Auth (K5: REST, keine EventBus-Payloads); Contract-Stellen in `@ancientvoid/contracts` nur nach ADR. — `GET /api/aimetrics`, 3 Tests (inkl. 401), Contract 3 Tests.
- [x] **T59.5** PWA-Metrik-Seite: Karten, Live-Felder mit Quelle/Zeitstempel, Offline-Zustand (K10), Register in Navigation und Funktionsinventar. — Dock „Mehr“ → „Metrik“, Inventar G72.
- [x] **T59.6** `e2e/specs/ki-server-metriken.spec.ts` (mit mockten Proben: volle Daten, fehlende Quelle, Probe-Ausfall) + Gate. — 8 Specs grün; `npm run gate` komplett grün (Lokal, 2026-11-15).

## 5. Acceptance Criteria (AC-P59-k)

- **AC-P59-1 ✅:** Die Seite zeigt für die konfigurierten lokalen Modell-Server
  CPU, GPU busy, Speicher/VRAM, Tokens/s, Prefill (TTFT), Decode, KV-Cache
  und Queue — je Zahl mit Quelle und Zeitstempel; unlesbare Quellen stehen
  als „nicht gemeldet“ da, nie als 0.
- **AC-P59-2 ✅:** Beprobung läuft mit Header-Auth ohne Secret in URL oder
  Logs; ein ausfallender Probe ist als Zustand sichtbar (< 60 s, K9-Geist).
- **AC-P59-3 ✅:** Der Retention-/Recovery-Pfad steht im ADR und ein Test zeigt
  ihn (K7).
- **AC-P59-4 ✅:** K5 unverändert verletzt-frei: keine neuen EventBus-Payloads;
  die Seite lädt über REST.
- **AC-P59-5 ✅:** Offline zeigt die Seite letzte Daten mit Zeitstempel (K10);
  neue Specs grün; Funktionsinventar und Doku aktuell.

## 6. Premortem (Failure-Modi + Mitigation)

1. GPU-Werte schweigen still, weil gpubox kein ROCm-Userland hat → Spike
   (T59.2) vor Implementierung; Fallback „nicht gemeldet“, nie erfundene
   Werte (ADR-0023).
2. Secret der Modell-Server sickert in URLs, Logs oder die API-Antwort →
   Header-only, Redaction-Liste, Test auf Rot bei Leak.
3. Neue State-Quelle ohne Recovery-Pfad verletzt K7 → ADR entscheidet
   volatil-vs-persistiert vor dem ersten Merge; Test belegt den Pfad.
4. Zweite Wahrheits neben P56 (doppelte Aggregation, widersprüchliche
   Zahlen) → P59 nur Live-Proben, Aggregation bleibt P56; Schnitt in §3.4.
5. Poller wird zum Selbstzweck und frisst genau die Ressourcen, deren
   Auslastung er zeigt → Poll-Intervall konfigurierbar, Kosten der eigenen
   Proben auf der Seite sichtbar (Selbstauskunft).

## 7. Definition of Done

Alle T59.* und AC-P59-* mit Evidenz; ADR merged. `npm run gate` grün,
PWA-Build grün; Pipeline-Job `e2e` grün bzw. nach `docs/ci-runbook.md`
nachgezogen (nie als Pass zählen). Neue Seite registriert, erreichbar
(mobil + Desktop) und dokumentiert; K5/K7/K10 nachgewiesen; kein TODO ohne
Epic-Bezug. Echte Live-Abnahme an der `ancientvoid-llama`-Instanz mit dem
Nutzer (Zahlen gegen `curl /metrics` gegengeprüft).

**Abschlussnachweis 2026-11-15 (MR !471):** `npm run gate` lokal komplett
grün (Typecheck, Lint, alle Checks, 2180 Unit/Integration, 694 E2E);
PWA-Build grün; ADR-0078 merged. Die gitlab.com-Pipelines (3069277607,
3069443568) waren auf dem Runner rot — ausschließlich belastungs-
zeitkritische Tests ohne P59-Berührung (runbook-§6-Bild), lokal bei jedem
Lauf grün; nach Runbook §4 (gitlab.com) zählt das lokale Gate. Offen:
echte Live-Abnahme, sobald `ancientvoid-llama` auf gpubox wieder läuft.

**Live-Abnahme-Teilstand 2026-11-17 (evox2, live belegt):** Sampler ist
konfiguriert (runtime `hub.config.json`, git-ignored; Secrets nur als
Datei-Referenz nach ADR-0011) und beprobt Hub-Host (sysfs/os — Werte live
sichtbar). Halogen ist peonist flash-server (kein llama.cpp): `/metrics`
404, `/health` ok — ADR-0078-Nachtrag: Fallback auf `/health` + optional
`halogenLog` (Kais livelog-Format). Peer-Merge für Systemmetriken des
KI-Hosts über Fleet (`mergePeers`). Bewusst manuell: auf dem Peer-Hub
(`securesight`) `aiMetrics.hostProbe` + Halogen-Server inkl. Log-Pfad
setzen und Hub neu starten; Leserecht auf `halogen.log` (docs/local-llm.md).
Vision (:8095) / `ancientvoid-llama` (:8081) bleiben Fehlerquellen, bis die
Dienste laufen.
