# P84-Evaluationsmesslauf

**Art:** how-to

Der [eingefrorene Korpus](../scripts/eval/corpus.json) enthält zwölf
Regressionen mit Start-Commit, Referenz-Commit, Aufgabentext,
Dateiumfang, Abnahme-Selektor und dem Datum der ursprünglichen
Referenz. Der [SHA-256](../scripts/eval/corpus.sha256) bindet das Manifest
einschließlich der über die Git-Objekte adressierten Referenztests. Ein
vollständiger lokaler Git-Verlauf ist erforderlich.

```sh
node scripts/eval/verify-corpus.mjs
```

Der Prüfer installiert am jeweiligen Stand die Abhängigkeiten aus dem
Lockfile. Er führt denselben ausgewählten Test am Start- und
Referenzstand aus. `--offline` verwendet den vorhandenen npm-Cache.
Weitere Argumente sind Korpus-IDs und beschränken die Prüfung.

## Prüfstand und Protokoll

Einen eigenen Hub mit eigenem Datadir und einem gemeinsamen Scratch-Pfad
als `projectRoots` verwenden. Der Runner sieht denselben Pfad wie der Hub.
Die Harnesses auf dem Benchmark-Hub verwenden separate Profile ohne
globale Skills und Regeln. Ihre Arbeitsverzeichnisse dürfen ausschließlich
auf Benchmark-Arbeitskopien zugreifen. Anbieterzugänge werden im Prüfstand
konfiguriert. `ANCIENTVOID_TOKEN` ist der menschliche Token dieses Hubs,
`ANCIENTVOID_URL` sein Origin. Hintergrund-Inferenz, Projekt-Automationen
und andere Last auf den Messhosts während der Serie pausieren. Die
Arbeitskopien stammen aus Git-Archiven ohne erreichbaren Projektverlauf.

Das Protokoll (Version 2) ist eine JSON-Datei mit einer Liste von **Zellen**
(Harness × Modell). Jede Zelle nennt Harness, Adapter-Registrierung, CLI-Version,
Konfigurations-Fingerprint, Modellkennung, Modell-Fingerprint, Provider und
Abrechnung. `providerBudgetUsd` setzt je Provider einen harten Serien-Deckel:
ist er erreicht, bricht der Runner laut ab (die bereits erfassten Läufe bleiben).
`splits` benennt Plan-/Bau-Zellen innerhalb desselben Harness. `skillsAb: false`
nimmt eine Zelle aus dem Skills-A/B heraus. `healthUrl` (lokale Engines) wird vor
jedem Lauf geprüft. `maxInfraRetries` begrenzt Wiederholungen nach
Infrastrukturausfall.

```json
{
  "version": 2,
  "fixturePolicy": "isolated-hub",
  "repetitions": 3,
  "timeoutMs": 900000,
  "parallelCloudRuns": 1,
  "maxInfraRetries": 2,
  "setup": "Prüfstand, Hardware, Messdomänen und Inferenz-Parameter",
  "providerBudgetUsd": { "anthropic": 35, "zai": 20 },
  "cells": [
    {
      "id": "pi-local", "harness": "pi", "adapter": "pi", "version": "CLI-Version",
      "configurationFingerprint": "Hash der bereinigten Konfiguration",
      "model": "provider/model-id", "fingerprint": "Modellrevision, Quantisierung, Sampling",
      "provider": "local", "healthUrl": "http://127.0.0.1:18099/health",
      "billing": { "kind": "local", "date": "2026-11-26", "host": "P81-Host-ID",
        "usdPerKwh": 0.3609, "eurPerKwh": 0.33, "usdPerEur": 1.0935, "fxDate": "2026-11-25" }
    },
    {
      "id": "claude-sonnet", "harness": "claude", "adapter": "claude", "version": "CLI-Version",
      "configurationFingerprint": "…", "model": "sonnet", "fingerprint": "…", "provider": "anthropic",
      "budgetUsd": 1,
      "billing": { "kind": "cloud", "date": "2026-11-26", "source": "https://platform.claude.com/docs/en/about-claude/pricing",
        "inputUsdPerMillion": 2, "cacheInputUsdPerMillion": 0.2, "outputUsdPerMillion": 10 }
    }
  ],
  "splits": [{ "id": "split-local-cloud", "plan": "pi-local", "build": "pi-cloud" }]
}
```

Dies sind Platzhalter. Für den Harness-Vergleich muss mindestens ein
Modell in zwei Harnesses in derselben Revision und Konfiguration
verfügbar sein. Eine Claude-Code-Registrierung mit lokalem Modell
benötigt einen bereits funktionsfähigen Anthropic-kompatiblen Endpoint.
Eine Registrierung ohne ein gefordertes Modell oder ohne messbare
P81-Komponenten fällt bereits in der Vorprüfung auf. Cloud-Preise
sind dokumentierte Listenpreisäquivalente. Budgetwerte gehen an die
vorhandene Hub-Budgetlogik. Das umfasst Anbieter mit nativer
Kostenmeldung. Die berechneten Listenpreise entstehen nach dem
Zug. Die Zeit der lokalen Phasen wird gegen die UTC-Minutenwerte
in P81 integriert und erfasst deren Komponenten und Grundlast.

```sh
npm run messlauf:eval -- plan --protocol protocol.json
npm run messlauf:eval -- check --protocol protocol.json
npm run messlauf:eval -- run --protocol protocol.json --scratch /pfad/eval --series kern-a
npm run messlauf:eval -- run --protocol protocol.json --scratch /pfad/eval --series kern-b
npm run messlauf:eval -- report --protocol protocol.json \
  --first /pfad/eval/kern-a/sessions.jsonl --repeat /pfad/eval/kern-b/sessions.jsonl \
  --data /pfad/hub-datadir --report docs/messlauf/JJJJ-MM-DD-p83-eval-kernserie.md
```

Die Matrix ergibt sich aus den Zellen: je Zelle ein Arm ohne und (außer `skillsAb: false`) ein Arm mit Skills, dazu die Split-Arme auf dem Split-Teilkorpus. Bei
jedem Split arbeiten getrennte Plan- und Bau-Sessions auf demselben
Startstand. Der Übergabeplan bleibt ein Datenartefakt. Der Kontrollarm
nutzt denselben Cloud-Kandidaten in beiden Phasen. Skills-A/B bietet
den eingefrorenen Projekt-Skillbestand über die nativen
`.claude/skills`- und `.agents/skills`-Verzeichnisse an. Beide Zellen
behalten dieselben immer geladenen Projektregeln. Der P72-Extraktor
meldet explizite Skill-Aufrufe und gelesene Skill-Dateien.

Die Abnahme führt den eingefrorenen Test sowie Lint und Typecheck in
einem nach Sitzungsende erstellten Prüfverzeichnis aus. Nur die
freigegebenen Quelldateien fließen in die Abnahme ein. Das Journal
enthält die verbindliche Abnahme, Telemetrie und Kostenbasis.
`sessions.jsonl` im Scratch-Bereich enthält nur Referenzen darauf.
Ein ausgefallener Lauf beendet die Serie mit dem betroffenen Schlüssel
und Arbeitsverzeichnis. Die bereits erfassten Läufe bleiben lesbar.
Ein neuer Serienname startet einen unabhängigen Lauf. Der Report
erfordert lückenlose, disjunkte Serien mit festem Protokollstand
und weist Rangänderungen und Preisdatumswechsel aus.

## Negativkontrolle

Der Korpus enthält neben den zwölf Regressionen eine Negativkontrolle
(`negative: true`, Start = Referenz, nicht im Split-Teilkorpus): Das Kriterium gilt schon,
der Prompt erlaubt „nichts zu tun“, und **jede Änderung** der freigegebenen Dateien ist ein
Fehler. Ein Lauf ohne Token-Lebenszeichen wird nicht erfasst und kann daher nie als
fälschlich grüne Negativkontrolle zählen (eine tote Engine „ändert nichts“ auch).
Der Report weist sie in einem eigenen Abschnitt aus.

## Export in ein Benchmark-Repo

```sh
npm run messlauf:eval -- export --protocol protocol.json --first /pfad/eval/kern-a/sessions.jsonl \
  --invalid /pfad/eval/kern-a/invalid.jsonl --out /pfad/benchmarks/evaluation/laeufe/JJJJ-MM-DD-kern-a
```

Der Ordner wird neu angelegt und nie überschrieben: `lauf.yaml` (Pflichtangaben, Zellen mit
Preis-/Tarif-Snapshot, Kosten je Provider, verworfene Versuche, `messung_gueltig`),
`ergebnisse.jsonl` (ein Datensatz je Lauf mit allen Metriken), `sessions.jsonl`,
`invalid.jsonl` und `manifest.sha256`. Eine unvollständige Serie lässt sich nur mit `--partial`
exportieren und ist dann nie `messung_gueltig`. Der Hub-Datadir bleibt die Quelle (K7).

## Mess-Registrierungen im Benchmark-Hub

Die ACP-Anbindung von maki 0.6.5 meldet nur die Kontextfüllung, keine Richtungs-Tokens
(`capabilities.usage=false`); die Session-Datei von maki bleibt bei null. Der Hub lehnt solche
Läufe laut ab. Für die Messung läuft maki deshalb über den Claude-Adapter im
stream-json-Modus (`maki -p --output-format stream-json` ist Claude-kompatibel):

```json
{ "id": "maki-sdk", "module": "@ancientvoid/adapter-claude",
  "config": { "command": "maki", "permissionPrompts": "off", "modelsCommand": ["maki", "models"] } }
```

Damit liefert maki native Richtungs-Tokens und den Cache getrennt. Die interaktive
ACP-Registrierung bleibt unverändert. Claude Code gegen z.ai GLM läuft als weitere
Claude-Registrierung mit `command` auf einen Wrapper, der `ANTHROPIC_BASE_URL`
(`https://api.z.ai/api/anthropic`), den Key aus einer Datei und ein eigenes Profil setzt.
Das von Claude Code gemeldete `costUsd` ist dort ein Anthropic-Preis und wird nicht verwendet.

Cache-Tokens: Claude meldet sie getrennt von der frischen Eingabe. Pi, OpenCode und Codex
melden die Eingabe einschließlich Cache und markieren das mit `cacheIncluded`; der Cache
bleibt über `cacheInputTokens` sichtbar und wird zum Cache-Preis gerechnet. Bei Adaptern
ohne Cache-Angabe (z. B. Cursor) weist der Report die Kosten als obere Schranke aus.

## Nachweise

- [ADR-0126](adr/0126-evaluation-in-turn-metriken.md)
- [Korpus-Abnahme vom 25.11.2026](messlauf/2026-11-25-p84-korpus.md)
- [Epic 84 und Tracker #427](../epics/EPIC-P84-ai-arbeit-evaluation-benchmark.md)

## Gültigkeit der Messung

Ausfälle der Infrastruktur (HTTP 5xx, Turn ohne Telemetrie, Engine ohne
Gesundheitsantwort, Timeout bei toter Engine) zählen **nie** als Aufgabenfehler.
Der Runner protokolliert den Versuch in `invalid.jsonl` neben `sessions.jsonl`,
wiederholt höchstens `maxInfraRetries`-mal (Versuchsnummer im Datensatz als
`attempt`) und bricht nach drei Ausfällen in Folge laut ab. Ein Timeout bei
lebender Engine ist ein Abbruch des Agenten und beendet die Serie ebenfalls laut;
ein Aufzeichnungspfad für Abbrüche ist offen (EPIC-P84).
