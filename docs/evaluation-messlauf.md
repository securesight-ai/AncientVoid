# P84-Evaluationsmesslauf

**Art:** how-to

Der [eingefrorene Korpus](../scripts/eval/corpus.json) enthält 15
historische Änderungen mit Start-Commit, Referenz-Commit, Aufgabentext,
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

„Rot am Start, grün an der Referenz“ belegt noch nicht, dass eine Aufgabe aus
ihrem Text lösbar ist: Der Abnahmetest bleibt verborgen. Deshalb muss der Text
jeden Namen nennen, den erst die Lösung einführt und den der ausgewählte Test
benutzt (Funktionen mit ihrer Datei, Felder, Metrik-Schlüssel), dazu Signatur
und Verhalten, aber nicht den Lösungsweg.
`npx vitest run scripts/eval/corpus.test.mjs` prüft die Namen
([solvability.mjs](../scripts/eval/solvability.mjs)); ob Signatur und Verhalten
ausreichen, bleibt Prüfung durch Lesen.

## Prüfstand und Protokoll

Einen eigenen Hub mit eigenem Datadir und einem gemeinsamen Scratch-Pfad
als `projectRoots` verwenden. Der Runner sieht denselben Pfad wie der Hub.
Die Harnesses auf dem Benchmark-Hub verwenden separate Profile ohne
globale Skills und Regeln. Ihre Arbeitsverzeichnisse dürfen ausschließlich
auf Benchmark-Arbeitskopien zugreifen. Anbieterzugänge werden im Prüfstand
konfiguriert. `ANCIENTVOID_TOKEN` ist der menschliche Token dieses Hubs,
`ANCIENTVOID_URL` sein Origin. Hintergrund-Inferenz, Projekt-Automationen
und andere Last auf den Messhosts während der Serie pausieren. Die
Arbeitskopien stammen aus Git-Archiven ohne erreichbaren Projektverlauf und
werden jeweils als eigenes Git-Repo mit einem Startcommit angelegt.

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

Der Korpus enthält neben den 15 historischen Änderungen eine Negativkontrolle
(`negative: true`, Start = Referenz, nicht im Split-Teilkorpus): Das Kriterium gilt schon,
der Prompt erlaubt „nichts zu tun“, und **jede Änderung** der freigegebenen Dateien ist ein
Fehler. Ein Lauf ohne Token-Lebenszeichen wird nicht erfasst und kann daher nie als
fälschlich grüne Negativkontrolle zählen (eine tote Engine „ändert nichts“ auch).
Der Report weist sie in einem eigenen Abschnitt aus.

## Export in ein Benchmark-Repo

```sh
npm run messlauf:eval -- export --protocol protocol.json --first /pfad/eval/kern-a/sessions.jsonl \
  --invalid /pfad/eval/kern-a/invalid.jsonl --data /pfad/hub-datadir \
  --out /pfad/benchmarks/evaluation/laeufe/JJJJ-MM-DD-kern-a
```

Der Ordner wird neu angelegt und nie überschrieben: `lauf.yaml` (Pflichtangaben, Zellen mit
Preis-/Tarif-Snapshot, Kosten je Provider, verworfene Versuche, `messung_gueltig`),
`ergebnisse.jsonl` (ein Datensatz je Lauf mit allen Metriken), `sessions.jsonl`,
`invalid.jsonl` und `manifest.sha256`. Liegen neben den Belegen `aborted.jsonl` (Abbrüche) und
`verdicts.jsonl` (Fehlermeldungen der Abnahme), gehen sie mit; `--data` ergänzt die Laufdiagnose. Eine unvollständige Serie lässt sich nur mit `--partial`
exportieren und ist dann nie `messung_gueltig`. Der Hub-Datadir bleibt die Quelle (K7).

## Laufdiagnose: warum ein Lauf so ausging

```sh
npm run messlauf:eval -- diagnose --first /pfad/eval/kern-a/sessions.jsonl \
  --data /pfad/hub-datadir --out /pfad/kern-a-diagnose.jsonl
```

Je erfasstem und abgebrochenem Lauf liest [diagnose.mjs](../scripts/eval/diagnose.mjs) das
Sitzungsjournal und die Arbeitskopie: Werkzeugaufrufe nach Art, Fehler und vom Harness
abgelehnte Aufrufe, selbst gestartete Tests/Lint/Typecheck, Zeit bis zur ersten Änderung,
geänderte Dateien (eigene Tests getrennt von Quellen außerhalb des erlaubten Umfangs),
Fehlerproben und Schlussantwort. Pfade werden durch `<workspace>` und `~` ersetzt; vor dem
Commit ins Benchmark-Repo trotzdem auf Zugangsdaten prüfen. Kein LLM, kein Urteil: Die Werte
beschreiben Verhalten und belegen keine Ursache. Ein Zug, den der Anbieter abbricht (Kontingent,
Rate-Limit, Anmeldung, Netz, Server), ist im Runner ein ungültiger Versuch (`invalid.jsonl`) und
kein Aufgabenfehler; ältere Datensätze dieser Art zeigt die Diagnose als `provider:<Art>`. Läufe mit abgelehnten Aufrufen messen die
Harness-Konfiguration mit und gehören in die Abweichungen der Serie.

Beim Fahren schreibt der Runner je Lauf zusätzlich `verdicts.jsonl` mit den fehlgeschlagenen
Abnahmefällen und dem Ende der Lint-/Typecheck-Ausgabe.

## Mess-Registrierungen im Benchmark-Hub

Die ACP-Anbindung von maki 0.6.5 meldet nur die Kontextfüllung, keine Richtungs-Tokens
(`capabilities.usage=false`); die Session-Datei von maki bleibt bei null. Der Hub lehnt solche
Läufe laut ab. Für die Messung läuft maki deshalb über den Claude-Adapter im
stream-json-Modus (`maki -p --output-format stream-json` ist Claude-kompatibel). Offen:
maki fragt Werkzeug-Erlaubnisse als `control_request`, den der Claude-Adapter nicht
beantwortet; mit Werkzeugen hängt der Zug in beiden `permissionPrompts`-Modi.
Befund 2026-11-27: maki erwartet `behavior` direkt in `response`
(`{"type":"control_response","response":{"request_id":"…","behavior":"allow"}}`);
die Claude-Verschachtelung wertet es als Ablehnung. Umsetzung:
[EPIC-P87](../epics/EPIC-P87-messserie-aufgabenklassen.md) T87.3.

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
ohne Cache-Angabe weist der Report die Kosten als obere Schranke aus. ACP-Adapter
(opencode, omp) und cursor melden den Cache seit dem 26.11.2026 getrennt.

- Serien: [Planung der Pilotserie](p84-pilotserie-planung.md), [Serien-Vorlage](p84-serien-vorlage.md); `pilot-report` schreibt den datierten Bericht aus der Hub-Zusammenfassung.

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
lebender Engine oder eine offene Rückfrage ist ein Abbruch des Agenten: Er steht
in `aborted.jsonl`, die Serie läuft weiter und ist partiell. Abbrüche fehlen in
der Ergebnistabelle (Überlebenden-Verzerrung); der Report muss sie nennen.
Vor jeder Serie muss jede Zelle einen Zug mit Werkzeugnutzung bestehen.

Ein erschöpftes Anbieter-Kontingent (Abo-Limit) erscheint als Ausfall ohne Token
und hält die Serie an. `run … --series <name> --resume` setzt dieselbe Serie unter
demselben Protokoll fort: erfasste und abgebrochene Läufe entfallen, der verbrauchte
Provider-Deckel zählt weiter. `--skip-provider anthropic` stellt einen Anbieter
zurück; ein späteres `--resume` ohne die Angabe holt ihn nach.

## Repo-Scan vergleichen (P90)

Für den Vergleich von `repoFacts` im Protokoll genau eine Modellzelle,
`parallelCloudRuns: 1`, mindestens fünf Wiederholungen und keine Splits
angeben. Der Abschnitt `repoScan` nennt das ursprüngliche Projekt und
die erwartete Engine der Vorschau.

```json
{
  "repo": "/pfad/zum/angebundenen/repo",
  "engineKind": "local",
  "engineId": "local",
  "model": "qwen",
  "minimumEffect": 0.2
}
```

`repoScan` ist ein Feld des Protokolls. `plan` zeigt die Laufzahl.
`run` erstellt frische Arbeitskopien und schickt denselben Auftrag mit
Scan aus und an durch die Vorschau und das festgelegte Ausführungsmodell.
Abweichungen bei Engine, Modell oder Scan-Modus brechen den Lauf ab.
Das Referenzmodell und die P81-Energiequelle müssen im isolierten Hub
messbar sein. Die Wissensquellen bleiben bei diesem Vergleich außen vor.
`Statistik → Evaluation` zeigt Ergebnisse unter dem gewählten Repo.
Der Reportpfad `pilot-report` liest dieselbe Repo-Serie. Die dort verfügbare
Codequalitätsentscheidung beruht auf Abnahme, Lint, Typprüfung und Laufstatus.
Aufwand der Ausführung und Laufzeit der Vorschau werden getrennt berichtet.
Die Akzeptanzrate der Vorschläge steht als Nutzungssignal daneben:
`node scripts/eval/optimizer-feedback.mjs --data <hub-datadir>` wertet die
bestehende `prompt-optimizer-feedback.jsonl` aus (Rate je Engine und Projekt,
unlesbare Zeilen gezählt, nie gedeutet).

### Regel-, Hook-, Guardrail-, Skill- und Kontextänderungen als Revisionen vergleichen (P90)

`repoVariant` vergleicht zwei Git-Revisionen **derselben Datei** im Quell-Repo
— Referenz gegen Kandidat — statt des Scans. Die Variante wird je Arm in die
Bau-Arbeitskopie gebracht (gleiche Dateirechte, danach frischer Snapshot);
`kind` nennt die Art der Änderung (`context|skill|hook|guardrail|rule`), und
`observation` benennt je Arm das erwartete Ereignis (`payload.kind`), das den
Nachweis liefert, dass die Änderung im Lauf wirkte. Für Hook-, Guardrail- und
Regelvergleiche wird zusätzlich `policyPassed` aus der Abnahme geführt. Beide
Vergleichsarten schließen sich aus (`repoScan` oder `repoVariant`).

```json
{
  "repo": "/pfad/zum/repo",
  "path": ".claude/settings.json",
  "kind": "hook",
  "reference": "<40-Zeichen-SHA>",
  "candidate": "<40-Zeichen-SHA>",
  "minimumEffect": 0.2,
  "observation": { "reference": "hook.alt", "candidate": "hook.neu" }
}
```

Für den Laufstart im UI legt der Betreiber am isolierten Hub
`evaluation/presets.json` im Datadir an. Es enthält eine Liste von
Protokollen, die jeweils an ein Repo gebunden sind.

```json
[{
  "id": "scan-qwen",
  "label": "Repo-Scan mit Qwen",
  "repo": "/pfad/zum/repo",
  "protocol": "/pfad/zum/protokoll.json",
  "scratch": "/pfad/zur/separaten/arbeitsflaeche",
  "origin": "http://127.0.0.1:7373",
  "tokenFile": "/pfad/zum/operator-token"
}]
```

`origin` ist der isolierte Loopback-Mess-Hub. Der Repo-Pfad muss mit dem
eingefrorenen Protokoll übereinstimmen. Ein separater P81-Hub lässt sich
als `energy: { origin, tokenFile }` eintragen. Der Laufstart akzeptiert
eine Preset-ID. Der Bediener wählt in der Eval-Suite das Repo und das
Messprotokoll. Start und Ende liegen je Serie in einer JSONL-Datei unter
`<dataDir>/evaluation/`. Das gleichnamige Protokoll mit der Endung `.log`
enthält den Grund für Prüfstandsfehler.

Für ein anderes npm-/Vitest-Repo unterstützt `--corpus /pfad/tasks.json`
das gleiche versionierte Aufgabenformat mit einer SHA-256-Datei
`tasks.json.sha256`. Die Start- und Referenz-Commits werden aus dem in
`repoScan.repo` angegebenen Repo gelesen. Im UI-Preset kann derselbe
Manifestpfad unter `corpus` stehen.
