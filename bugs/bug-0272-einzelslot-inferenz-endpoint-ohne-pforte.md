---
id: BUG-0272
slug: einzelslot-inferenz-endpoint-ohne-pforte
status: offen
severity: S1
area: core
instance: prod
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/340"
epic: "EPIC-P79 (Inferenz-Token-Tempo) — Pforte fehlt; ADR nötig"
created: 2026-11-23
numbering: "zuerst als 0268 angelegt; auf main war 0268 schon von PR #327 (Strg-Klick) belegt — deshalb 0272"
reporter: kai
---

# BUG-0272 — Alle Modellanfragen drängeln ungeordnet auf einen Einzelslot (Strata)

## Gesehen

Zwei Sitzungen (und mehrere hub-interne Anfragen) benutzen **denselben**
Inferenz-Endpoint `http://127.0.0.1:8080/v1` (Strata, ein Slot). Nichts im Hub
regelt den Zugriff: es gibt keine Pforte, kein Kontextbudget, keine Warteschlange.
Spürbar wird das als „wer bekommt Strata" — und als Fehlermeldung.

Beleg aus der Notifications-Tabelle von heute (`data/hub.db`):

    13:52:55  error  provider.error  garmin · pi: Kontext des Modells reicht nicht
    12:54:32  error  provider.error  qwen 4 · pi: Kontext des Modells reicht nicht
    11:08:58  error  provider.error  AncientVoid · pi: Anmeldung beim Provider fehlgeschlagen
    10:18:34  error  provider.error  garmin · pi: Anmeldung beim Provider fehlgeschlagen

Die letzten beiden Zeilen sind mit hoher Wahrscheinlichkeit **dieselbe** Ursache,
nur falsch beschriftet (BUG-0265: Kontextüberlauf fiel in die Auth-Regel).

## Gemessen (2026-11-23, live)

`GET /metrics` mit dem Strata-Schlüssel:

    engine.max_context = 262144          kv = int8      pool_workers = 13
    live.state = idle   live.queued = 0
    live.parallel = null  live.waiting = null  live.admitting = null  live.slots = null
    totals.requests = 17   prompt_tokens = 1.387.996   reused = 1.176.390   (85 % KV-Treffer)
    letzte Requests: prompt ~112.000 Token, reused ~112.000, first_token 0,2–1,0 s

Drei gleichzeitige Mini-Requests (`/v1/chat/completions`, `max_tokens 8`):

    reqA http=200 t=0.59 s
    reqC http=200 t=1.11 s
    reqB http=200 t=1.57 s

→ Strata **serialisiert selbst** und lehnt kleine Requests nicht ab. Der Schaden
entsteht nicht am Slot, sondern am **gemeinsamen Kontext**: eine Sitzung hält
~112 k Token im KV. Zwei lange Sitzungen (je ~130 k) passen nicht gleichzeitig in
`max_context 262144` — die zweite bekommt einen Kontextüberlauf, oder der Verdrang
kostet erneutes Vorbehandeln von ~112 k Token (gemessenes Vorbehandeln: der Hub
meldet `prefill_tok_s`; ein Wechsel kostet damit Größenordnungen Minuten).
Genau dieses Verdrangen ist der Eindruck „die streiten sich, wer Strata bekommt".

## Was der Hub schon weiß, aber nicht nutzt

`packages/core/src/modules/inference/strata.ts` liest bereits `live.queued`,
`live.parallel`, `live.waiting`, `live.admitting`, `heldTokens(slots)` und
`cache.evictions`. Diese Werte gehen in die Inferenz-Seite (EPIC-P79) — eine
**Entscheidung** leitet der Hub daraus nicht ab. grep nach `semaphore`,
`maxConcurrent`, `slot` in `packages/core/src`, `apps/hub/src` ergibt nichts, das
Modellanfragen begrenzen würde (nur Schreib-Queue im Team-Modul, Fanout in der Suche).

Zugleich nutzen den Endpoint mehrere Stellen ungeordnet:

* Adapter-Züge mehrerer Sitzungen (`hub.config.json`: `"model":
  "strata/qwen3.8-flash-next-iq3_s"`),
* `packages/core/src/modules/gatekeeper/model.ts`
* `packages/core/src/modules/sessions/session-title.ts`
* `packages/core/src/modules/media/models.ts`
* `packages/core/src/modules/prompts/enhance.ts`
* `packages/core/src/modules/commands/model.ts`

## Erwartung

1. **Pforte pro Modell-Endpoint.** Alle Modellanfragen des Hubs holen sich einen
   Slot (Semaphore, Default 1 bei Einzelslot-Providern) und stehen in einer
   sichtbaren FIFO-Warteschlange. Wartezeit wird am Session-Ereignis sichtbar,
   nicht als Provider-Fehler.
2. **Kontextbudget als Aufnahmeregel.** Aufnahme nur, wenn
   `prompt + erwartete Ausgabe + bereits gehaltene Token ≤ max_context`
   (`/metrics` liefert beides). Passt es nicht, sagt der Hub „Sitzung kompaktieren
   oder warten" — statt einen 400er des Providers als Pannenfahne zu zeigen.
3. **Lease statt Sprung-bewegung.** Eine Sitzung darf den Slot für eine Serie von
   Zügen halten (bis sie z. B. 20 s leer ist). Warum: die gemessene
   KV-Wiederverwendung von 85 % (1,18 M von 1,39 M Token) bricht sofort weg, wenn
   zwei Sitzungen sich abwechseln — der Preis ist jedes Mal erneutes
   Vorbehandeln des ganzen Verlaufs.
4. **Hub-interne Hintergrundanfragen sind niedrig priorisiert** (Titel, Übersetzen,
   Enhance, Gatekeeper): sie warten, bis der interaktive Zug fertig ist, und stören
   den laufenden Zug nie.

## Nicht die Lösung

`--parallel 2` (oder mehr) bei Strata: die KV-Größe ist das Problem, nicht die
Slot-Zahl. Bei `int8`-KV und 262 k Gesamtkontext verdrängen sich zwei lange
Sitzungen auch mit zwei Slots. Mehr Slots verschlechtern den Durchsatz pro Sitzung,
sobald die Verläufe lang sind.

## Fußnote (Nebenbefund, nicht Teil dieses Bugs)

Zwei ADRs tragen dieselbe Nummer:
`docs/adr/0115-kontextueberlauf-eigene-fehlerkategorie.md` und
`docs/adr/0115-nativer-compact-und-direktadapter.md`. `check:context` moniert das
nicht.

## Reziprozität der Prüfung (für den Fix)

* Roter Test zuerst: zwei Sessions, die gleichzeitig eine Modellanfrage stellen,
  bekommen nacheinander den Slot; die zweite erzeugt ein Ereignis
  `inference.slot_wait`, keinen Provider-Fehler.
* Aufnahmeregel: Test mit `max_context` klein konfiguriert → die zweite Anfrage
  wird abgewiesen mit Grund `context_budget`, bevor der Provider gefragt wird.
* Pforte gilt für hub-interne Nutzer (Gatekeeper/Titel) und Adapter-Züge gleichermaßen.
* `npm run check:arch`, `typecheck`, `lint` + die betroffene Spec; ADR für den
  neuen Contract-Anteil (Pforte ist geteilter Zustand → Contracts-Regel 1).
