# EPIC-P79 — Token-Tempo lokaler Inferenz in der PWA (eigener Menüpunkt)

**Status:** offen · **Messlatten:** K5 (Antwortgrößen), K7 (Rekonstruktion aus JSONL),
K9 (Ausfall sichtbar), ADR-0023 (`null` ≠ 0), ADR-0011 (Secrets nur als Dateireferenz),
ADR-0020 (Vertical Slices) · **Vertrag:** `@ancientvoid/contracts` → `inference/`
(ADR-0102)

## Warum

Der Rechner betreibt lokale Inferenz-Engines (Strata, Halogen, llama.cpp). Bisher
zeigt `GET /api/aimetrics` (P59, ADR-0078) **skalarisierte Felder im 10-s-Takt** — gut
für „wie heiß, wie voll", aber nicht für die Frage, die Kai am Handy stellt: *Wie
schnell laufen Vorbehandlung und Generierung wirklich, und woran liegt es?* Diese
Frage braucht **Request-bezogene Verteilungen** (Perzentile über abgeschlossene
Requests, KV-Reuse-Schichten, Zeit-bis-erstes-Token), und die existieren in keiner
Engine als Fertigwert.

Ein externes Einzeltool (`~/repos/tokdeck`, Port 7474) hat das vorgemacht: Adapter für
Strata/Halogen/llama.cpp, eigene Request-Historie, Perzentile mit Ausreißer-Behandlung.
Es läuft als zweiter Dienst mit eigenem Port, ohne Login und ohne Sessions-Bezug. Das
gehört in den Hub: ein Login, ein Port, die Zahlen am Ort, und später der Bezug zur
Session, die den Request ausgelöst hat.

## Premortem (Was wäre schiefgegangen?)

1. **Zwei Sampler, doppelte Polling-Last** gegen dieselbe Engine → bewusst: eigene
   Spur mit 2-s-Takt, weil Verteilungen eine feigängige Request-Historie brauchen;
   der Preis ist ein zusätzlicher `GET /metrics` je Engine und Takt (größenordnung
   Kilobyte). Kein Feld-Duplikat in `aimetrics`, keine Vermischung der Messreihen.
2. **Perzentile aus Gegenwerten erfunden** →Adapter, die keine Einzel-Requests melden
   (llama.cpp, Halogen), liefern `features.perRequest=false` und **keine** Verteilung;
   die Seite sagt, warum. (Im Vorbild real entdeckt und korrigiert.)
3. **KV-Reuse als Prefill-Tempo verfälscht** → Prefill-Rate rechnet mit **gelesenen**
   Token (`prompt − reused`), nicht mit Prompt-Token; sonst erscheinen Mini-Raten aus
   Nachlade-Arbeit als Tempoeinbruch.
4. **Antwort sprengt K5** → Response istvertraglich gekappt: max. 12 Request-Zeilen,
   max. 120 Verlaufs-Punkte, max. 8 Hinweise; keine Prompts, keine Rohwerte.
5. **Request-Historie wächst unbegrenzt / überlebt Neustart nicht** → JSONL mit
   Größendach und Zeitfenster; Rekonstruktion beim Start (K7).
6. **Hart kodierte Strings in der PWA** (P61-Gate) → Seite von Anfang an mit `t()`
   und Katalog-Schlüsseln; `check:i18n` muss grün bleiben.
7. **Secret im Klartext** → Key nur als Dateireferenz in der Hub-Konfiguration
   (ADR-0011), wie bei `aiMetrics.servers[].apiKeyFile`.

## Scopes

- **T79.1 Vertrag** `packages/contracts/src/inference/tempo.ts`:
  `InferenceSnapshot`, `InferenceSourceList`, `InferenceFeatures`, Perzentil-/
  Bucket-/Request-Zeilen. K5-Grenzen im Schema (`max`).
- **T79.2 Kern** `packages/core/src/modules/inference/`: Engine-Adapter
  (Strata JSON, Halogen Prometheus+JSON, llama.cpp Prometheus), Request-Speicher
  (JSONL, dedupliziert, Zeitfenster), Perzentil-Statistik (Tukey-Ausreißer,
  Größen-Schichten, Asymptote), Tracker (Poll-Takt, Pro-Quellen-Zustand).
- **T79.3 Hub-Routen** `apps/hub/src/modules/inference/inference.routes.ts`:
  `GET /api/inference/sources`, `GET /api/inference/snapshot?id=&fenster=`.
  Konfiguration: `inference.engines[]` in `platform/config.ts` (URL, Schlüssel-Datei,
  Takt, Fenster, Prefill-Schwelle).
- **T79.4 PWA**: `features/inference/InferencePage.tsx` + **eigener Menüpunkt**
  (Sidebar-Werkzeugleiste, Dock, Route `/inferenz`), i18n de/en, Kachel-/Ring-
  Darstellung, Quellen-Umschalter, Zeitfenster-Pills.
- **T79.5 Tests**: Kern-Unit (Adapter an Fixture-Rohdaten, Statistiken, Store),
  Routen-Integration (leere Konfiguration → leere Liste, nicht `null`), E2E-Spec
  für Menüpunkt + Seite gegen einen Modell-Server-Attrappen-Endpunkt.
- **T79.6 Doku**: `docs/inference-token-tempo.md` (was welche Engine liefert, was
  nicht), ADR-0102 (Warum eigene Spur neben P59), Vermerk in `docs/guide/`.

## Ausstiegskriterien

1. `GET /api/inference/sources` und `…/snapshot` liefern die konfigurierten Engines;
   fehlende Engines erscheinen mit Fehlerzustand statt zu verschwinden (K9).
2. Die Seite hat einen **eigenen Menüpunkt** und ist unter `/inferenz` erreichbar;
   sie zeigt Decode-, Prefill-, Zeit-bis-erstes-Token-Werte und die Schichten, und
   jede Zahl trägt ihre Quelle.
3. Perzentile erscheinen nur bei Engines mit Einzel-Requests; für Zähler-Engines steht
   der Grund auf der Seite (kein erfundener Verlauf).
4. Nach Hub-Neustart sind die Perzentile aus der JSONL-Historie rekonstruiert (K7) —
   nachgewiesen durch einen Test.
5. Antworten sind gekappt (12 Requests, 120 Verlaufs-Punkte, 8 Hinweise) und ihre
   Größe ist gemessen, nicht behauptet: ein voller Snapshot bleibt unter 12 KB
   (live mit Strata gemessen: 7,4 KB). Die 4-KB-Grenze aus K5 gilt für Event-Payloads,
   nicht für diese REST-Antwort — sie bleibt hier ausdrücklich unberührt.
6. `lint`, `typecheck`, `check:arch`, `check:i18n`, `check:context` und die gezielten
   Tests grün; E2E-Spec vorhanden (Skip-Muster wie üblich).
7. Menschen-Abnahme am Handy (Lesbarkeit auf Cover- und Falt-Display) wandert nach
   EPIC-000.

## Nicht in diesem Epic

Kosten/Preis-Rechnung (P55), Session-Zuordnung einzelner Engine-Requests (die Engine
weiß nicht, welche Session sie gesendet hat — eigene Entscheidung nötig), vLLM-Adapter
(nur wenn ein vLLM-Endpunkt existiert, gemessen statt geraten), Grafana-Export.
