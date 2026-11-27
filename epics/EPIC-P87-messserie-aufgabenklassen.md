# EPIC-P87 — Zweite Messserie: schwerere Aufgaben und Aufgabenklassen

**Status:** Planungsentwurf (Nutzerauftrag 27.11.2026: festhalten, nicht starten) · **Phase:** P87 · **Dauer:** 1 Agenten-Woche zuzüglich Messzeit · **Tracker:** [#468](https://github.com/securesight-ai/AncientVoid/issues/468)
**Abhängigkeit:** [P84](EPIC-P84-ai-arbeit-evaluation-benchmark.md) ist offen; Korpus, Runner und Diagnose daraus liegen vor (T84.1–T84.5, T84.9, T84.11). Der Lauf verbraucht Abo-Kontingente und startet **nur auf ausdrücklichen Auftrag**.

## 1. Ziel

Messdaten, die Zellen (Harness × Modell) tatsächlich unterscheiden und je
**Aufgabenklasse** vorliegen, damit [P88](EPIC-P88-empfehlungen-routing.md)
Empfehlungen belegen kann. Ausgangslage
([Pilotbericht](../docs/2026-11-27_p84-pilotserie.md)): 104 von 105 erfassten
Läufen bestanden; alle vier Aufgaben änderten je eine Datei mit 3 bis 8 neuen
Zeilen.

## 2. Scope (In / Out)

### In
- Aufgabenklassen `klein`, `mittel`, `schwer` für den ganzen Korpus,
  festgeschrieben vor dem ersten Lauf.
- Serie `pilot-7`, Stufe 1: `transcript-typo`, `queue-order`, `sync-notices`
  und die Negativkontrolle, 11 Zellen, n = 2, also 88 Läufe.
- Bericht, Export mit Diagnose, Anzeige in der PWA über den vorhandenen Weg
  ([Serien-Vorlage](../docs/p84-serien-vorlage.md)).
- Entscheidungsvorlage für Stufe 2 (die sechs mittleren Aufgaben, weitere
  Aufgabenarten aus T84.12).

### Out
- Keine Rangfolge: ohne Vollkorpus, n ≥ 3 und Streuung bleibt es bei
  Beobachtungen. Kern- und Split-Serie bleiben T84.6–T84.8 in P84.
- Keine neuen Adapter, keine Änderung am Ergebnisvertrag (dafür T84.13/T84.14).

## 3. Design-Details

### 3.1 Klassenregel
Maß ist die Referenzänderung der Aufgabe in ihren freigegebenen Dateien, nie
ein Messergebnis. `schwer`: mindestens 90 neue Zeilen. `klein`: höchstens zwei
Dateien und unter 50 neue Zeilen. `mittel`: alles andere. Die Negativkontrolle
hat keine Klasse.

| Klasse | Aufgaben (Stand Korpus 27.11.2026) |
|---|---|
| klein | `notizen-route`, `halogen-endpoints`, `halogen-throughput`, `millions-format`, `continue-link`, `host-power` |
| mittel | `session-median`, `notification-retention`, `local-image`, `inference-share`, `queue-steering`, `halogen-rates` |
| schwer | `transcript-typo`, `queue-order`, `sync-notices` |

Die Zuordnung liegt neben dem Korpus (eigene Datei), damit der Korpus-Hash
stabil bleibt. Zeilenzahl ist ein Ersatzmaß für Schwere; die gemessene
Bestehensquote wird getrennt ausgewiesen.

### 3.2 Voraussetzungen vor dem Start
1. T84.10: `defaultPermissionMode: "manual"` im Benchmark-Hub; je Zelle ein
   Durchstich mit Shell- und Schreibaufruf ohne Ablehnung, auch für Claude Code
   gegen Anthropic.
2. Benchmark-Hub und Runner auf aktuellem `main`.
3. Neues Protokoll, Serienbeschreibung nach Vorlage, vor dem Lauf committet.

### 3.3 Kostenrahmen (Nutzerrahmen 10–20 USD je Anbieter)
Listenpreise; „bisher“ zählt erfasste Läufe aller Serien ohne ungültige und
abgebrochene Versuche. Schätzung und Deckel sind Vorschläge.

| Anbieter | bisher USD | Schätzung USD | Deckel `pilot-7` USD |
|---|---:|---:|---:|
| Anthropic | 3,23 | 2–4 | 6 |
| z.ai | 4,35 | 3–6 | 8 |
| OpenAI | 1,52 | 1–2 | 4 |
| Cursor | 5,39 | 4–8 | 10 |

Lokal: 24 Läufe, bei 30 Minuten Zeitlimit im ungünstigsten Fall 12 Stunden.

### 3.4 Offene Entscheidungen (Nutzer, vor dem Start)
- Startfreigabe und Deckel.
- Zeitlimit 30 oder 60 Minuten (gilt für alle Zellen gleich).
- Alle 11 Zellen oder zuerst die Cloud-Zellen.

## 4. Aufgaben

- [ ] **T87.1** Klassenzuordnung als Datei mit Test „jede Korpus-Aufgabe hat
  genau eine Klasse, passend zur Regel“. → AC-P87-1
- [ ] **T87.2** Voraussetzungen §3.2 erfüllen und je Zelle belegen (K9).
  → AC-P87-2
- [ ] **T87.3** Serienbeschreibung und Protokoll committen. → AC-P87-1
- [ ] **T87.4** Stufe 1 nach Freigabe fahren; Ausfälle sichtbar, Nachlauf für
  Kontingentfälle (K8, K9). → AC-P87-3
- [ ] **T87.5** Bericht, Export, Diagnose; Werte je Zelle × Klasse (K7).
  → AC-P87-3, AC-P87-4
- [ ] **T87.6** Entscheidungsvorlage für Stufe 2. → AC-P87-5

## 5. Acceptance Criteria

- **AC-P87-1:** Klassen, Protokoll und Serienbeschreibung sind vor dem ersten
  erfassten Lauf committet.
- **AC-P87-2:** Jede Zelle hat vor der Serie einen Durchstich mit null
  abgelehnten Aufrufen.
- **AC-P87-3:** Jeder geplante Lauf ist erfasst, abgebrochen oder ungültig mit
  Grund; keiner fehlt still.
- **AC-P87-4:** Der Gesamtverbrauch je Anbieter liegt im vereinbarten Rahmen
  und steht im Bericht.
- **AC-P87-5:** Der Bericht sagt ausdrücklich, ob die schweren Aufgaben die
  Zellen beim Ergebnis unterscheiden, auch wenn die Antwort Nein ist.

## 6. Premortem

1. **Wieder besteht fast alles.** Dann trennen nur Zeit und Kosten. Mitigation:
   Stufe 1 klein halten und vor Stufe 2 andere Aufgabenarten wählen.
2. **Abo-Kontingent bricht mitten in der Serie.** Zellen laufen zeitversetzt.
   Mitigation: Anbieterausfall zählt nie als Aufgabenfehler, Nachlauf, Versatz
   im Bericht.
3. **Lokale Zellen laufen ins Zeitlimit.** Mediane zeigen nur Überlebende.
   Mitigation: Abbrüche je Zelle ausweisen; T84.13 vor einer Rangaussage.
4. **Zeilenzahl ≠ Schwere.** Mitigation: Regel nicht nachträglich ändern,
   Bestehensquote je Aufgabe zeigen.
5. **Lösung steckt in Trainingsdaten** (öffentliche Historie). Mitigation:
   `contaminationRisk` des Korpus im Bericht nennen.

## 7. Definition of Done

AC-P87-1 bis -5 belegt; gezielte Tests, `lint`, `typecheck`, `check:context`
grün; `npm run gate` lokal grün und GitHub-Actions-Lauf auf dem Abschluss-PR
grün; neue Anzeige in der PWA hat eine Spec in `e2e/specs/`; Rohdaten nur
secret-gescannt im Benchmark-Repo; Sichtprüfung am Gerät nach P000 verschoben;
Tracker-Issue gesichtet.
