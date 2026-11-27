# EPIC-P89 — Eigene kleine Modelle: Arbeitsmodelle und Router finetunen

**Status:** Planungsentwurf (Nutzerauftrag 27.11.2026) · **Phase:** P89 · **Dauer:** 4–6 Agenten-Wochen nach dem Daten-Spike · **Tracker:** [#470](https://github.com/securesight-ai/AncientVoid/issues/470)
**Abhängigkeit:** Spur A (Arbeitsmodelle) braucht Messwerte und Mitschnitt aus [P87](EPIC-P87-messserie-aufgabenklassen.md); Spur B (Router) braucht [P88](EPIC-P88-empfehlungen-routing.md) grün. Umsetzung gesperrt; vor jedem Bau entscheidet T89.1 mit Go oder No-go.

## 1. Ziel

- **Spur A:** Wissen, ab wann kleine Modelle bei produktiver Arbeit scheitern
  (P87), und prüfen, ob Finetuning diese Grenze verschiebt.
- **Spur B:** Jeder Nutzer findet aus eigenen Daten seine besten Einstellungen
  und kann dafür ein kleines Router-Modell trainieren.

Ein Modell wird nur genutzt, wenn es auf zurückgehaltenen Aufgaben nachweislich
besser ist.

## 2. Scope (In / Out)

### In
- Mitschnitt, Datensatz, Rechteprüfung je Quelle, Secret-Scan.
- Spur A: Finetuning kleiner Code-Modelle, Vorher-Nachher-Messung.
- Spur B: Vergleichsverfahren, Router-Training, Aktivierung mit Rückfall.
- Training auf eigenen Hosts, Oberfläche, Anleitung.

### Out
- Kein Training auf Ausgaben, deren Nutzungsrecht dafür nicht geklärt ist.
- Die Benchmark-Aufgaben kommen nie in Trainingsdaten.
- Keine zentrale Sammlung, kein automatischer Upload.
- Keine Wahl von Berechtigungen, Sandbox, Freigaben oder Budgetdeckeln.

## 3. Design-Details

### 3.1 Datenquellen und Rechte
Keine Rechtsberatung; Stand der Prüfung 27.11.2026, vor dem Bau zu bestätigen.

| Quelle | Training | Grund |
|---|---|---|
| Änderungen aus eigener Git-Historie mit grüner Abnahme | ja | eigener Code, Beiträge Dritter prüfen |
| Läufe offener lokaler Modelle | nach Lizenzprüfung je Modell | Lizenzen unterscheiden sich |
| Prüfergebnisse (bestanden, Fehlerart, Zeit) | ja, Analyse und Router | Messwerte |
| Ausgaben von Anthropic, OpenAI, z.ai | nein, bis geklärt | Bedingungen beschränken das Training konkurrierender Modelle ([Anthropic](https://www.anthropic.com/legal/commercial-terms), [OpenAI](https://openai.com/policies/business-terms/), [z.ai](https://docs.z.ai/legal-agreement/terms-of-use)) |

### 3.2 Mitschnitt
Das Hub-Journal enthält weder Systemprompt noch Werkzeugschemata und reicht
nicht zum Training. Nötig sind Anfrage und Antwort, wie das Modell sie sah.
Kandidaten: `--llm-history-file` von aider, Sitzungsdateien der übrigen
Harnesses (zu prüfen) oder ein Aufzeichnungs-Proxy vor dem lokalen Endpunkt, der
nie Schlüssel speichert. Bei Cloud-Zugängen nur, wenn deren Bedingungen es
erlauben. Rohdaten bleiben im Datadir und aus Git (K5, K7).

### 3.3 Zurückgehaltene Aufgaben
Korpus aus P84 und P87 samt Referenz-Commits ist gesperrt; ein Test weist
Überschneidungen ab. Zusätzlich Trennung nach Zeit.

### 3.4 Spur A: Arbeitsmodelle
1. Ausgangswert je Modell aus P87 (Kipppunkt, Fehlerarten).
2. Daten-Spike: Wie viele geprüfte Beispiele liefern eigene Historie und
   erlaubte Läufe? Welche Fehlerart lässt sich damit überhaupt angehen?
3. LoRA auf dem kleinen Modell; Datensatz-Hash, Basismodell und Parameter
   festgehalten.
4. Dieselben Zellen neu messen. Erfolg: höhere Bestehensquote mit
   Konfidenzintervall ohne Verschlechterung der Negativkontrolle.

### 3.5 Spur B: Router
Ein Datensatz je Entscheidung (Aufgabenprofil, Kandidaten, Wahl, Ergebnis).
Alltagsdaten zeigen nur die gewählte Kombination; unverzerrt sind Benchmarks.
Vergleich gegen (a) die Regeln aus P88 und (b) eine Tabelle oder einen kleinen
Klassifikator; ein Sprachmodell nur, wenn Text gegenüber (b) messbar hilft.
Nutzung wie beim Gatekeeper (ADR-0024): Regeln filtern zuerst, das Modell wählt
nur unter erlaubten Kandidaten, bei Unsicherheit oder Fehler sichtbar zurück zu
den Regeln.

### 3.6 Trainingshost
Offen. Am 27.11. antwortete der GPU-Treiber auf omarchy nicht; evox2 bedient
gleichzeitig Halogen. Der Spike klärt Speicher, Laufzeit und Zeitfenster.

## 4. Aufgaben

- [ ] **T89.1** Daten- und Host-Spike mit Mindestmenge und Go/No-go je Spur.
  Rund hundert Ergebnisse aus wenigen Aufgaben reichen nicht. → AC-P89-1
- [ ] **T89.2** Mitschnitt- und Datensatz-Contract mit Zustimmung, Bereinigung,
  Secret-Scan (ADR; K5, K7). → AC-P89-2
- [ ] **T89.3** Rechte und Lizenz je Quelle; Export weist ungeklärte ab.
  → AC-P89-2
- [ ] **T89.4** Sperre der Benchmark-Aufgaben mit Test. → AC-P89-3
- [ ] **T89.5** Trainingsjob mit Fortschritt, Abbruch und Protokoll (K9).
  → AC-P89-4
- [ ] **T89.6** Spur A: Vorher-Nachher-Messung. → AC-P89-3
- [ ] **T89.7** Spur B: Vergleichsverfahren und Prüfstrecke. → AC-P89-3
- [ ] **T89.8** Spur B: Inferenz hinter P88 mit Rückfall. → AC-P89-5
- [ ] **T89.9** Oberfläche mit Spec und Anleitung für Nutzer. → AC-P89-6

## 5. Acceptance Criteria

- **AC-P89-1:** Go oder No-go je Spur ist mit Zahlen dokumentiert; No-go
  schließt die Spur ohne Bau.
- **AC-P89-2:** Ohne Zustimmung oder geklärtes Recht entsteht kein Export; der
  Secret-Scan blockiert Funde.
- **AC-P89-3:** Jeder Gütewert stammt aus zurückgehaltenen Aufgaben, mit
  Streuung und Vergleich zum Ausgangswert.
- **AC-P89-4:** Ein Training ist aus Protokoll und Datensatz-Hash
  nachvollziehbar.
- **AC-P89-5:** Ein ausgefallenes oder unsicheres Router-Modell ändert nie die
  erlaubten Kandidaten und fällt sichtbar zurück.
- **AC-P89-6:** Ein Nutzer kommt mit Oberfläche und Anleitung von den Daten zum
  aktiven Modell oder zur begründeten Ablehnung.

## 6. Premortem

1. **Zu wenige erlaubte Daten.** Die starken Cloud-Läufe fallen weg.
   Mitigation: Spike zählt nur erlaubte Quellen; Mitschnitt ab der ersten Serie.
2. **Das Modell lernt den Benchmark.** Mitigation: Sperrliste mit Test.
3. **Finetuning verschiebt die Grenze nicht**; mehr Kontext (K1, K2) wirkt
   stärker. Mitigation: Kontextstufen aus P87 als Vergleich.
4. **Eine Tabelle ist so gut wie der Router.** Mitigation: Vergleich ist
   Aktivierungsbedingung.
5. **Private Inhalte im Datensatz.** Mitigation: lokal, bereinigt, löschbar.
6. **Kein tragfähiger Trainingshost.** Mitigation: im Spike klären, bevor Code
   entsteht.

## 7. Definition of Done

AC-P89-1 bis -6 belegt (oder dokumentiertes No-go je Spur); `lint`, `typecheck`,
`check:context` grün; `npm run gate` lokal grün und GitHub-Actions-Lauf auf dem
Abschluss-PR grün; neue Oberfläche mit Spec in `e2e/specs/` und im Guide
beschrieben; Abnahme am eigenen Datenbestand nach P000 verschoben; Tracker-Issue
gesichtet.
