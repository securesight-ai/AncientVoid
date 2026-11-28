# EPIC-P87 — Zweite Messserie: wo kleine Modelle kippen (pi, maki, omp, aider, opencode)

**Status:** Planungsentwurf (Nutzerauftrag 27.11.2026: festhalten, nicht starten) · **Phase:** P87 · **Dauer:** 2 Agenten-Wochen zuzüglich Messzeit · **Tracker:** [#468](https://github.com/securesight-ai/AncientVoid/issues/468)
**Abhängigkeit:** [P84](EPIC-P84-ai-arbeit-evaluation-benchmark.md) ist offen; Korpus, Runner und Diagnose daraus liegen vor (T84.1–T84.5, T84.9, T84.11). Jede Serie startet **nur auf ausdrücklichen Auftrag**.

## 1. Ziel

Für die Harnesses pi, maki, omp, aider und opencode mit lokalen Modellen und GLM
sowie für kleine Cloud-Modelle messen, **ab welcher Aufgabe und mit welchem
Kontext sie in echter Arbeit scheitern, und woran**. Die Daten speisen die
Empfehlungen ([P88](EPIC-P88-empfehlungen-routing.md)) und das Finetuning
([P89](EPIC-P89-eigene-kleine-modelle.md)).

Ausgangslage ([Pilotbericht](../docs/2026-11-27_p84-pilotserie.md)): 104 von 105
erfassten Läufen bestanden; alle vier Aufgaben änderten je eine Datei mit 3 bis
8 neuen Zeilen.

### Stand der Fokus-Harnesses (geprüft 27.11.2026)

| Harness | Lokales Modell | GLM Coding Plan | Im Hub messbar |
|---|---|---|---|
| pi 1.6.1 | in `pilot-6` gemessen | erlaubt; CLI-Durchstich mit Dateiänderung | ja |
| opencode 2.4.2 | in `pilot-6` gemessen | erlaubt; gemessen | ja |
| omp 19.2.1 | in `pilot-6` gemessen | **nicht auf der Liste** | ja |
| maki 0.6.5 | CLI-Antwort ohne Werkzeuge | **nicht auf der Liste** | nein: Rückfragen unbeantwortet |
| aider 0.86.2 | CLI-Durchstich mit Dateiänderung und Token | **nicht auf der Liste** | nein: Adapter erfasst keine Token |

- **maki** fragt vor Shell-Befehlen per `control_request`. Es erwartet `behavior`
  direkt in `response`; die bei Claude übliche Verschachtelung wertet es als
  Ablehnung. Mit dem passenden Format lief ein freigegebener Aufruf durch.
  Dateiänderungen im Arbeitsordner kamen ohne Rückfrage. Der frühere Fehler
  „kein Guthaben“ bei GLM trat mit ausdrücklich übergebenem Schlüssel nicht
  mehr auf; die Ursache ist nicht belegt (die Mess-Registrierung übergibt
  keinen). Aktuell ist maki 0.7.4, gemessen und geprüft wurde 0.6.5.
- **aider** war nie Teil der Matrix. `--analytics-log` liefert Eingabe- und
  Ausgabe-Token (ohne Cache), `--llm-history-file` die vollständigen Anfragen.
  aider ändert Dateien ohne Werkzeugschleife und ist nur eingeschränkt
  vergleichbar.

### Zugang und Nutzungsbedingungen

Der GLM Coding Plan darf laut z.ai nur in den
[unterstützten Werkzeugen](https://docs.z.ai/devpack/tool/others) genutzt
werden (darunter Claude Code, Codex, OpenCode, Pi, Cursor); Verstöße können
den Zugang einschränken
([Abo-Bedingungen](https://docs.z.ai/legal-agreement/subscription-terms)).
maki, omp und aider fehlen dort. Die omp-GLM-Zelle aus `pilot-5` und `pilot-6`
sowie kurze maki- und aider-Durchstiche am 27.11. liefen dennoch darüber; das
wird nicht wiederholt. GLM in diesen drei Harnesses braucht einen
nutzungsabhängigen API-Zugang oder eine schriftliche Zusage.

## 2. Scope (In / Out)

### In
- Zugang je Zelle klären, maki und aider messbar machen.
- Aufgabenklassen, Kontextstufen, Größenleiter lokaler Modelle.
- Serie in drei Stufen mit Bericht, Export, Diagnose und Mitschnitt.

### Out
- Keine Rangfolge ohne Vollkorpus, n ≥ 3 und Streuung. Kern- und Split-Serie
  bleiben T84.6–T84.8 in P84.
- Kein Training (P89). Keine Berechtigungsprüfung abschalten.

## 3. Design-Details

### 3.1 Aufgabenklassen
Maß ist die Referenzänderung in den freigegebenen Dateien, nie ein Messergebnis.
`schwer`: mindestens 90 neue Zeilen. `klein`: höchstens zwei Dateien und unter
50 neue Zeilen. `mittel`: alles andere. Die Negativkontrolle hat keine Klasse.
Die Zuordnung liegt neben dem Korpus, damit dessen Hash stabil bleibt.

| Klasse | Aufgaben (Korpus 27.11.2026, 20 Aufgaben) |
|---|---|
| klein | `notizen-route`, `halogen-endpoints`, `halogen-throughput`, `millions-format`, `continue-link`, `host-power`, `steer-lag-symptom`, `pi-env-files` |
| mittel | `session-median`, `notification-retention`, `local-image`, `inference-share`, `queue-steering`, `halogen-rates` |
| schwer | `transcript-typo`, `queue-order`, `sync-notices`, `neu-modal` |

Neue Aufgabenarten (T84.12, [Abnahme 27.11.2026](../docs/messlauf/2026-11-27-p84-korpus-arten.md)):
Fehlersuche nur aus dem Symptom, Adapter-Aufgabe, UI-Abnahme,
Verständnisfrage. Die Verständnisfrage hat wie die Negativkontrolle keine
Klasse. Korpus-Stände vor dem 27.11. (15 Aufgaben) mischen nie mit dem
aktuellen (20 Aufgaben, Hash dort).

### 3.2 Kontextstufen
| Stufe | Inhalt |
|---|---|
| K0 | Aufgabentext wie bisher |
| K1 | zusätzlich die betroffenen Dateien genannt |
| K2 | zusätzlich ein vorab eingefrorener Plan eines großen Modells und ein benachbarter Beispieltest |

Die Zusätze werden vor der Serie committet. Verglichen wird nur innerhalb einer
Stufe. aider bekommt in K0 keine Dateiliste, sondern nur seine Repo-Karte.

### 3.3 Stufen
**Stufe 1 (Fokus, K0):** die drei schweren Aufgaben und die Negativkontrolle,
n = 2.

| Zellen | Anzahl |
|---|---:|
| pi, maki, omp, aider, opencode mit Halogen (lokal) | 5 |
| pi und opencode mit `glm-5.3-flash` und `glm-4.5-air` | 4 |
| opencode mit `glm-5.3` als starke Gegenprobe | 1 |
| Claude Code mit Haiku, Codex mit einem kleinen Modell | 2 |

12 Zellen, 96 Läufe, davon 40 lokal (bei 30 Minuten Zeitlimit bis zu 20
Stunden). `glm-4.5-air` listet der Coding-Zugang, in pi und opencode muss es
erst eingerichtet werden.

**Stufe 2 (Kontext):** K1 und K2 für die Zellen, die in Stufe 1 gescheitert sind.

**Stufe 3 (Kipppunkt):** Größenleiter lokaler Modelle, mindestens fünf Aufgaben
je Klasse samt neuen Aufgabenarten (T84.12), n ≥ 5. Eine Kombination „kippt“ in
der ersten Klasse, deren Bestehensquote unter der Schwelle liegt (Vorschlag 80 %,
vor der Serie festzulegen), mit Konfidenzintervall. Fehlerarten: Zeitlimit,
keine Änderung, falsches Verhalten, Lint oder Typecheck, Werkzeugformat,
Kontextüberlauf.

Lokal bedient evox2 derzeit nur Halogen; weitere Modelldateien dort gehören zu
anderen Projekten. Auf omarchy wurde keines gefunden, der GPU-Treiber antwortete
nicht. Kleinere Modelle werden nach Lizenz (Training erlaubt, siehe P89),
Werkzeugfähigkeit und Platz ausgewählt und erst nach Zustimmung geladen
(Kandidaten mit Belegen und Tunbarkeit:
[Snapshot 27.11.2026](../docs/2026-11-27_lokale-modellkandidaten.md)).

### 3.4 Kostenrahmen Stufe 1 (Nutzerrahmen 10–20 USD je Anbieter)
Listenpreise; „bisher“ zählt erfasste Läufe aller Serien. Schätzungen grob.

| Anbieter | bisher USD | Schätzung USD | Deckel USD |
|---|---:|---:|---:|
| z.ai | 4,35 | 4–10 | 10 |
| Anthropic | 3,23 | 0,5–2 | 3 |
| OpenAI | 1,52 | Preis vor dem Start festhalten | 3 |

### 3.5 Offene Entscheidungen (Nutzer, vor dem Start)
- Startfreigabe, Deckel, Zeitlimit 30 oder 60 Minuten.
- Welche kleineren lokalen Modelle geladen werden (Kandidatenvorschlag:
  [Snapshot 27.11.2026](../docs/2026-11-27_lokale-modellkandidaten.md);
  Auswahl bleibt Handentscheid des Nutzers).

Entschieden 27.11.2026 (Nutzer): GLM in maki, omp und aider **nur lokal**
(nutzungsabhängiger Zugang kommt nicht dazu). Messläufe erst später —
Anbieterkontingente sind derzeit erschöpft; die Serie startet nur auf
ausdrücklichen Auftrag.

## 4. Aufgaben

- [ ] **T87.1** Klassenzuordnung als Datei mit Test. → AC-P87-1
- [ ] **T87.2** Zugang je Zelle: Benchmark-Konfiguration nur mit erlaubten
  Kombinationen; Hinweis zur Werkzeugliste in `docs/adapters.md`. → AC-P87-3
- [ ] **T87.3** maki messbar: `control_request` über das Hub-Gate beantworten
  (Test rot→grün, K9). → AC-P87-2
- [ ] **T87.4** aider messbar: Token aus dem Analytics-Log, Mitschnitt,
  Diagnose ohne Werkzeugschleife. → AC-P87-2
- [ ] **T87.5** Durchstich je Zelle mit Shell- und Schreibaufruf, Token je
  Richtung, `manual`-Modus (T84.10). → AC-P87-2
- [ ] **T87.6** Mitschnitt vollständiger Anfragen lokaler Läufe vor der ersten
  Serie, damit nichts verloren geht (Contract in T89.2). → AC-P87-6
- [ ] **T87.7** Serienbeschreibung, Protokoll, Kontextzusätze committen.
  → AC-P87-1
- [ ] **T87.8** Stufe 1 nach Freigabe fahren (K8, K9). → AC-P87-4
- [ ] **T87.9** Bericht, Export, Diagnose mit Fehlerarten (K7).
  → AC-P87-5, AC-P87-6
- [ ] **T87.10** Stufe 2 (Kontext). → AC-P87-6
- [ ] **T87.11** Größenleiter, neue Aufgaben und Stufe 3. → AC-P87-7

## 5. Acceptance Criteria

- **AC-P87-1:** Klassen, Protokoll, Kontextzusätze und Schwelle sind vor dem
  ersten erfassten Lauf committet.
- **AC-P87-2:** Jede Zelle hat vor der Serie einen Durchstich ohne ungewollte
  Ablehnung und mit Token je Richtung.
- **AC-P87-3:** Keine Zelle nutzt einen Zugang außerhalb seiner Bedingungen.
- **AC-P87-4:** Jeder geplante Lauf ist erfasst, abgebrochen oder ungültig mit
  Grund.
- **AC-P87-5:** Der Gesamtverbrauch je Anbieter liegt im vereinbarten Rahmen.
- **AC-P87-6:** Je Modell × Harness × Kontextstufe stehen Bestehensquote,
  Fehlerarten und Mitschnitt bereit.
- **AC-P87-7:** Ein Kipppunkt wird nur bei n ≥ 5 und fünf Aufgaben je Klasse
  genannt, sonst „nicht bestimmbar“.

## 6. Premortem

1. **Wieder besteht fast alles.** Mitigation: Stufe 1 klein halten, vor Stufe 3
   schwerere Aufgabenarten bauen.
2. **Lokale Warteschlange dauert Tage** (ein Lauf zur Zeit). Mitigation: Stufen,
   nur gescheiterte Zellen vertiefen.
3. **Harness-Unterschied wirkt wie Modellunterschied.** Mitigation: Vergleiche je
   Variable, aider gesondert ausweisen.
4. **Kontext verrät die Lösung.** Mitigation: Stufen beschriften, nie mischen.
5. **Anbieterbedingungen oder Kontingente ändern sich.** Mitigation: vor jeder
   Serie prüfen; Ausfall zählt nie als Aufgabenfehler.
6. **Lösung steckt in Trainingsdaten** (öffentliche Historie). Mitigation:
   `contaminationRisk` im Bericht nennen.

## 7. Definition of Done

AC-P87-1 bis -7 belegt; gezielte Tests, `lint`, `typecheck`, `check:context`
grün; `npm run gate` lokal grün und GitHub-Actions-Lauf auf dem Abschluss-PR
grün; neue Anzeige in der PWA hat eine Spec in `e2e/specs/`; Rohdaten nur
secret-gescannt im Benchmark-Repo; Sichtprüfung am Gerät nach P000 verschoben;
Tracker-Issue gesichtet.
