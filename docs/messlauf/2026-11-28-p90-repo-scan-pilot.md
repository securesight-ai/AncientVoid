# P90-Messlauf: Repo-Scan (repoFacts) mit und ohne — Pilot und Vollserie

**Art:** messlauf · **Epic:** [P90](../../epics/EPIC-P90-namen-scroll-prompt-enhancer.md) · **Frage:** Hilft der deterministische Repo-Scan dem Prompt-Verbesserer — besserer Code, weniger Aufwand — oder nicht?

## Prüfstand

Isolierter Hub (Loopback, eigenes Datadir, `projectRoots` nur auf den Mess-Scratch),
Qwen per Pi über den vorhandenen SSH-Loopback-Tunnel (evox2, halogen-qwen3.8,
IQ4_XS, P81-Abrechnung am Benchmark-Hub), P81 liest am Benchmark-Hub. Vor
jedem Lauf geprüft: Health, Modell-Fingerprint, engine-Pin, Scan-Modus. Arme:
`reference` (repoFacts aus, P68-Kontext wie gehabt) und `candidate` (repoFacts
an, Zusatzblock ≤ 4 000 Zeichen, nur reale Pfade). Der Runner bricht ab, wenn
Engine, Modell oder Scan-Modus vom eingefrorenen Protokoll abweichen.

## Pilotserie 1 — `p90-qwen-pilot` (ungültig, ehrlich)

3 Minuten Zeitlimit je Bau-Zug: der erste Kandidatenlauf
(`candidate/millions-format/1`, Session d3911d9f) lief in das Zeitlimit
(`aborted.jsonl`, Ursache `timeout`), der Folgelauf brach mit `AbortError` ab,
die Serie gilt als fehlgeschlagen. 0 erfasste Läufe. **Befund:** 3 Minuten sind
für diesen Prüfstand zu knapp — kein Aufgabenfehler, kein Anbieterausfall.

## Pilotserie 2 — `p90-qwen-pilot-b` (gültig)

8 Minuten je Bau-Zug, eine Aufgabe (`millions-format` aus dem P84-Korpus),
5 gepaarte Wiederholungen, Arme rotiert je Paar. 10 von 10 Läufen erfasst,
keine Abbrüche, keine ungültigen Versuche.

- [Pilotbericht](../2026-11-28_p84-p90-repo-scan-pilot.md) (Rohwerte, Zellen, Maschinenlesbar)
- [Export ins Benchmark-Repo](../../../ancientvoid-benchmarks/evaluation/laeufe/2026-11-28-p90-repo-scan-pilot-b/) (`messung_gueltig=true`)

**Vergleich:** `millions-format` — **verbessert** (gemessen). Abnahme:
Referenz 4/5, Kandidat 5/5 (der eine Referenzfehler: Inferenz-Format P79).
Wandzeit (Median): Referenz 245,8 s, Kandidat 215,9 s (−12 %). Tokens, Kosten
und Energie entsprechend niedriger. Die Vorschau selbst lief in beiden Armen
über dieselbe gepinnte pi-Engine.

## Go-Regel (§3.5)

**Entscheidung: Scan bleibt standardmäßig aus.** Der Pilot zeigt eine
Verbesserung auf einer einzigen Aufgabe — zu schmal für die Standardisierung.
Die Vollserie (zehn Aufgaben, §3.5) ist vorbereitet und über den Laufstart der
Eval-Suite gestartet (siehe unten); sie wiederholt beide Arme mit demselben
Protokoll und liefert die begründete Go-Entscheidung für den Standard. Bis
dahin gilt: `repoFacts` ist Opt-in (Einstellung „Repo-Scan für die Vorschau“).

## Vollserie (registriert, läuft)

- Protokoll: 10 Aufgaben aus dem P84-Korpus (bugfix-artig, feature-artig,
  quer-zu-modulen), 5 Wiederholungen, 12 Minuten je Bau-Zug, 100 Läufe.
- Start über die Eval-Suite (Laufstart, registriertes Preset `p90-scan-full`
  am isolierten Hub) — nicht über ein Ad-hoc-Kommando. Start und Ende stehen
  im Launcher-Journal (`<dataDir>/evaluation/run-<serie>.jsonl`), Abbrüche
  in `aborted.jsonl`/`invalid.jsonl`, Prüfstandfehler im gleichnamigen `.log`.
- Auswertung: `pilot-report` schreibt den datierten Bericht aus derselben
  Quelle, die auch die Eval-Seite zeigt; `export` sichert die Belege ins
  Benchmark-Repo. Die Go-Entscheidung wird erst nach vollständiger Serie
  gefällt und hier nachgetragen.

## Übertragbarkeit: zweites Repo (rea)

Dieselbe Bauart mit eigenem Korpus: [rea-tasks.json](../../../ancientvoid-benchmarks/evaluation/rea-tasks.json)
(3 Aufgaben aus der realen Git-Historie, jeweils rot am Startstand und grün
am Referenzstand nachgestellt — `electron-preference-keys`,
`response-endpoint`, `directive-fingerprints`; SHA-256-geprüft). Das Preset
`p90-rea-scan` läuft über denselben Laufstart. Für Skill-, Hook-, Guardrail-
und Regeländerungen steht der `repoVariant`-Vergleich bereit (zwei Git-Revisionen
derselben Datei als Referenz/Kandidat, Beobachtungsereignis je Arm); die
isolierten Vergleiche je Änderungsart folgen derselben Bauart.

## Feedback-JSONL (Metrik b, Nutzungssignal)

[Auswertung](../../scripts/eval/optimizer-feedback.mjs) über die vorhandene
`prompt-optimizer-feedback.jsonl` des produktiven Hubs (Stand 2026-11-28):
79/79 angenommen (100 %), Zeitraum 2026-09-21 bis 2026-11-27, mittlere Latenz
je Vorschau 23,7 s (überwiegend die vor-P90-Kette inkl. Adapter-Fallback).
Hinweis zur Lesart: 100 % Akzeptanz heißt, dass angezeigte Vorschläge
übernommen wurden — sie belegt Nutzung, nicht Qualität; verworfene Vorschläge
wurden ebenso erfasst (0 Fälle). Die Zahl ist die Baseline für die Serie: sinkt
die Akzeptanzrate unter dem Scan, ist das ein Verschlechterungssignal (Go-Regel).

## Was das nicht sagt

- Ein Pilot mit einer Aufgabe trägt keine Aussage über „besser“ — die
  Vollserie entscheidet.
- Lokale Energie umfasst die P81-Komponenten des Messhosts inklusive
  Grundlast; parallele Fremdlast (Blinker-Serie) wurde vor Seriestart
  abgewartet.
- Die Akzeptanzrate der Feedback-JSONL misst die Vorschau-Annahme durch den
  Menschen, nicht die Codequalität der Folgesitzung; dafür stehen Abnahme,
  Lint und Typprüfung je Lauf.
