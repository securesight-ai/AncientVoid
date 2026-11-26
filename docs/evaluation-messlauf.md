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

Das Protokoll ist eine JSON-Datei. Diese Form zeigt einen Harness-Block.
Die drei Schlüssel `pi`, `claude` und `opencode` erhalten je einen Block
mit ihren tatsächlichen Modellkennungen und Versionen.

```json
{
  "version": 1,
  "fixturePolicy": "isolated-hub",
  "repetitions": 5,
  "timeoutMs": 900000,
  "parallelCloudRuns": 1,
  "setup": "Prüfstand, Hardware, Messdomänen und Inferenz-Parameter",
  "splitHarness": "pi",
  "harnesses": {
    "pi": {
      "adapter": "pi",
      "version": "CLI-Version",
      "configurationFingerprint": "Hash der bereinigten Konfiguration",
      "local": {
        "model": "provider/model-id",
        "fingerprint": "Modellrevision, Quantisierung und Sampling",
        "billing": { "kind": "local", "date": "2026-11-25", "host": "P81-Host-ID", "usdPerKwh": 0.25 }
      },
      "cloud": {
        "model": "provider/anderes-model-id",
        "fingerprint": "API-Modellrevision und Sampling",
        "budgetUsd": 1,
        "billing": {
          "kind": "cloud",
          "date": "2026-11-25",
          "source": "https://example.com/prices",
          "inputUsdPerMillion": 1,
          "outputUsdPerMillion": 2
        }
      }
    }
  }
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

Die Matrix umfasst pro Serie 720 Kernläufe und 60 Split-Läufe. Bei
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

## Nachweise

- [ADR-0126](adr/0126-evaluation-in-turn-metriken.md)
- [Korpus-Abnahme vom 25.11.2026](messlauf/2026-11-25-p84-korpus.md)
- [Epic 84 und Tracker #427](../epics/EPIC-P84-ai-arbeit-evaluation-benchmark.md)
