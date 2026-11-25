# ADR-0116 — Pforte pro Modell-Endpoint: ein Platz, ein Kontextbudget, ein Lease

**Status:** angenommen (2026-11-23) · **Bezug:** BUG-0272 (#340), EPIC-P79 (ADR-0125), ADR-0115 (Kontextüberlauf als eigene Fehlerkategorie)

## Kontext

Der Hub hat auf diesem Rechner **ein** lokales Inferenz-Backend: Strata auf
`127.0.0.1:8080`, gemeldet `max_context 262144`, KV `int8`, ein Verarbeitungs-
platz. Davon zehren gleichzeitig:

* die Züge aller Sessions (`hub.config.json`: `"model": "strata/…"`),
* hub-interne Anfragen (Gatekeeper pro Tool-Aufruf, Sitzungs­titel, Übersetzen,
  Enhance, Analyse-Antworten).

Nichts regelte den Zugriff. Messwerte vom 2026.11.23 (`GET /metrics`):

    engine.max_context = 262144   live.queued = 0   live.parallel = null
    totals.requests = 17   prompt_tokens = 1.387.996   reused = 1.176.390   (85 % KV-Treffer)
    letzte Requests: prompt ~112.000 Token, reused ~112.000, first_token 0,2–1,0 s

Drei gleichzeitige Kleinstanfragen liefert Strata selbst serialisiert
(0,59 s / 1,11 s / 1,57 s, alle 200). Der Schaden liegt also **nicht** am Slot,
sondern am gemeinsamen Kontext: eine Sitzung hält ~112 k Token im KV. Zwei lange
Sitzungen passen nicht gleichzeitig hinein — die zweite bekommt
`Kontext des Modells reicht nicht` (zweimal am 23.11. in den Notifications), und
die verdrängte muss ihren ganzen Verlauf neu vorbehandeln. Der Eindruck beim
Nutzer: „die streiten sich, wer Strata bekommt“.

## Entscheidung

1. **Pforte pro Endpoint (`packages/core/src/modules/inference/pforte.ts`).**
   Konfiguration in `hub.config.json → inference.gate.engines[]`
   (`provider` oder `url`, `slots` Default 1, `maxContext`, `leaseMs` Default
   20 000, `maxWaitMs` Default 120 000). **Nur gelistete Endpoints sind
   gedeckelt** — Cloud-Provider bleiben ungedeckelt, der Hub bremst nichts, was
   das Problem nicht hat.
2. **Ein Zug hält den Platz, nicht nur den `steer`-Aufruf.** Die Session reserviert
   den Endpoint beim Zustellstart und gibt ihn zurück, sobald sie `working`/
   `starting` verlässt (`setStatus` ist der einzige Aufhänger). Hub-interne
   Kurz Anfragen nutzen `durchlassen()` (Warteschlange + Priorität).
3. **Warten ist eine Lage, kein Fehler.** Ist der Platz belegt, bleibt die Meldung
   in der Session-Warteschlange (`session.queued`) und die Akte bekommt
   `inference.slot_wait` mit Grund `modell_besetzt`. Beim Freiwerden weckt der
   `Weckruf` der Pforte genau die Sessions dieses Endpoints (`scheduleDrain`).
4. **Kontextbudget als Aufnahmeregel.** Passt `prompt + max_tokens` nie in
   `maxContext`, lehnt die Pforte **vor** der Provider-Anfrage mit
   `context_budget` ab (Hinweis: kompaktieren oder kleineres Modell). Passt sie
   gerade nicht, weil eine andere Sitzung den KV hält, wartet sie und meldet nach
   `maxWaitMs` denselben Grund — nie eine Pannenfahne des Providers.
5. **Lease statt Sprungwechsel.** Nach einem Zug bleibt der Platz 20 s für
   **dieselbe** Sitzung reserviert. Grund: die gemessene KV-Wiederverwendung von
   85 % bricht sofort weg, wenn sich zwei Sitzungen abwechseln — jedes Mal
   erneutes Vorbehandeln des ganzen Verlaufs. Der Lease ist Vorrang, keine Sperre:
   hat die Lease-Inhaberin nichts an, verfällt er; wartet jemand länger als die
   Hälfte von `maxWaitMs`, wird er gebrochen (`inference.lease_broken`).
6. **Interaktiv vor Hintergrund.** Titel, Übersetzen, Enhance, Gatekeeper ordnen
   sich ein; sie können einen laufenden Zug nie verdrängen.
7. **Sichtbarkeit.** `GET /api/inference/gate` liefert je Endpoint: Plätze,
   Inhaber, gehaltene Token, Wartende mit Wartezeit, Lease. Ohne konfigurierte
   Pforte: 501 mit Ansage.

## Contrato

Pforten-Zustand ist zwischen Hub, Sessions und PWA geteilt → `@ancientvoid/contracts`
(`packages/contracts/src/inference/pforte.ts`): `InferenceGateConfig`,
`InferenceGateZustand`, `InferenceGateSnapshot`, `InferenceGrund`,
`InferencePforteEvent`. Die Session-Akte bekommt die Ereignisarten
`inference.slot_wait`, `inference.slot_granted`, `inference.slot_denied`,
`inference.lease_broken` (K7: alles aus JSONL rekonstruierbar).

## Grenzen (bewusst)

* **Kein `--parallel 2`.** Die KV-Größe ist das Problem, nicht die Slot-Zahl;
  mehr Slots verschlechtern den Durchsatz pro Sitzung, sobald Verläufe lang sind.
* Die Pforte kennt die Prompt-Größe einer Sitzung erst, wenn ein Adapter sie
  meldet. Ohne Zahl gilt das Budget nur gegen die gehaltene Summe, nicht gegen
  die einzelne Anfrage — deshalb bleibt der Provider-Kontextüberlauf als
  Fehlerkategorie (ADR-0115) zusätzlich erhalten.
* Prozesse **außerhalb** des Hubs (Pi in VS Code, zweite Instanz) sieht die
  Pforte nicht. Für die ist ein vorgelagertes Gateway (Port + FIFO) der nächste
  Schritt; die Pforte ist das, was der Hub selbst verantwortlich entscheidet.

## Prüfung

`packages/core/test/modules/inference/pforte.test.ts` (8 Fälle: Serialisierung,
Sichtbarkeit, Budget-Absage vor Provider-Frage, Lease-Vorrang, Hintergrund-
einordnung, `maxWaitMs`-Entscheidung, Belegung/Freigabe, ungedeckelte Cloud) und
`packages/core/test/modules/sessions/inferenz-pforte.test.ts` (3 Fälle: zwei
Sessions an einem Endpoint, zweite wird vorgemerkt und nach Freiwerden geliefert;
ohne Pforte altes Verhalten; Lease bringt die Fortsetzung derselben Sitzung vor).
