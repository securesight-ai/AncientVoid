# EPIC-P89 — Eigenes Router-Modell: Daten sammeln, finetunen, prüfen, nutzen

**Status:** Planungsentwurf (Nutzerauftrag 27.11.2026) · **Phase:** P89 · **Dauer:** 3–4 Agenten-Wochen nach dem Daten-Spike · **Tracker:** [#470](https://github.com/securesight-ai/AncientVoid/issues/470)
**Abhängigkeit:** [P88](EPIC-P88-empfehlungen-routing.md) grün (Entscheidungsjournal und Regel-Auswahl als Vergleich). Umsetzung gesperrt; vor dem Bau entscheidet T89.1 mit Go oder No-go.

## 1. Ziel

Jeder Nutzer kann aus **seinen eigenen** Daten herausfinden, welche
Einstellungen für ihn am besten funktionieren, dafür ein kleines lokales Modell
finetunen, es gegen einfachere Verfahren prüfen und nur dann nutzen, wenn es
nachweislich besser ist.

## 2. Scope (In / Out)

### In
- Datensatz aus eigenen Entscheidungen, Ergebnissen und Benchmark-Läufen,
  Export nach Zustimmung, bereinigt und secret-gescannt.
- Vergleichsverfahren, lokale Finetuning-Strecke, Prüfbericht, Aktivierung mit
  Rückfall, Versionen.
- Gewählt werden Harness, Modell, Anbieter, Skills an/aus und Denkaufwand, soweit
  der Adapter das kennt.

### Out
- Keine zentrale Sammlung von Nutzerdaten, kein automatischer Upload, kein
  Training in der Cloud als Standard.
- Keine Wahl von Sicherheitseinstellungen (Berechtigungen, Sandbox, Freigaben,
  Budgetdeckel).
- Kein Finetuning von Modellen, die Code schreiben.

## 3. Design-Details

### 3.1 Daten
Ein Datensatz je Entscheidung: Aufgabenprofil, Merkmale des Projekts,
Kandidaten, Wahl, Ergebnis (Prüfungen, Wandzeit, Kosten, Abbruch,
Überstimmung). Prompttext nur mit eigener Zustimmung. Alltagsdaten zeigen nur
das Ergebnis der gewählten Kombination; die unverzerrte Quelle sind
Benchmark-Serien, in denen jede Kombination dieselbe Aufgabe bekommt. Ein
Erkundungsanteil ist möglich, standardmäßig aus und gedeckelt.

### 3.2 Daten-Spike (Go/No-go)
Heute liegen rund hundert Benchmark-Ergebnisse aus wenigen Aufgaben vor. Das
trägt kein Finetuning. T89.1 misst, wie schnell Daten anfallen, und legt vor dem
Bau die Mindestmenge fest (Vorschlag zur Prüfung: 500 Ergebnisse und 30 je
häufiger Kombination × Klasse).

### 3.3 Vergleichsverfahren
(a) Regel-Auswahl aus P88, (b) Tabelle oder kleiner Klassifikator auf den
Merkmalen. Ein Sprachmodell wird nur weiterverfolgt, wenn Text gegenüber (b)
messbar hilft.

### 3.4 Training
Läuft auf einem Host des Nutzers (LoRA auf kleinem Basismodell), als sichtbarer
Job. Reproduzierbar festgehalten: Datensatz-Hash, Basismodell, Parameter,
Ergebnis. Daten und Gewichte bleiben im Datadir und aus Git.

### 3.5 Prüfung
Zurückgehaltene Aufgaben und spätere Zeiträume. Maße: Abstand zur besten
gemessenen Kombination, Bestehensquote, Kosten, Zeit, Treffsicherheit der
Zuversicht. Aktivierbar ist ein Modell nur, wenn es (a) und (b) schlägt.

### 3.6 Nutzung
Muster des Gatekeepers (ADR-0024): Erst filtern die Regeln, das Modell wählt nur
unter erlaubten Kandidaten mit erzwungenem Ausgabeformat. Zu geringe
Zuversicht, Zeitüberschreitung oder Fehler führen sichtbar zur Regel-Auswahl.
Jede Entscheidung nennt Quelle und Modellversion.

### 3.7 Oberfläche
Datenstand und fehlende Menge, Training starten, Vergleichsbericht, aktivieren,
zurückrollen, Daten und Modell löschen.

## 4. Aufgaben

- [ ] **T89.1** Daten-Spike mit Mindestmenge und Go/No-go. → AC-P89-1
- [ ] **T89.2** Datensatz-Contract und Export mit Zustimmung, Bereinigung,
  Secret-Scan (ADR; K5, K7). → AC-P89-2
- [ ] **T89.3** Vergleichsverfahren und Prüfstrecke. → AC-P89-3
- [ ] **T89.4** Trainingsjob mit Fortschritt, Abbruch und Protokoll (K9).
  → AC-P89-4
- [ ] **T89.5** Inferenz hinter P88 mit Rückfall. → AC-P89-5
- [ ] **T89.6** Oberfläche mit Spec. → AC-P89-6
- [ ] **T89.7** Anleitung für Nutzer: eigene Daten, Training, Aktivierung.
  → AC-P89-6

## 5. Acceptance Criteria

- **AC-P89-1:** Go oder No-go ist mit Zahlen dokumentiert; No-go schließt das
  Epic ohne Bau.
- **AC-P89-2:** Ohne Zustimmung entsteht kein Export; der Secret-Scan blockiert
  Funde.
- **AC-P89-3:** Prüfbericht vergleicht Modell, Regeln und Klassifikator auf
  zurückgehaltenen Daten mit Streuung.
- **AC-P89-4:** Ein Training ist aus Protokoll und Datensatz-Hash
  nachvollziehbar.
- **AC-P89-5:** Ein ausgefallenes oder unsicheres Modell ändert nie die
  erlaubten Kandidaten und fällt sichtbar zurück.
- **AC-P89-6:** Ein Nutzer kommt allein mit Oberfläche und Anleitung von den
  Daten zum aktiven Modell oder zur begründeten Ablehnung.

## 6. Premortem

1. **Zu wenig Daten.** Das Modell lernt Zufall. Mitigation: Daten-Spike mit
   Mindestmenge.
2. **Eine Tabelle ist genauso gut.** Mitigation: Vergleich ist Aktivierungs-
   bedingung; dann gewinnt das einfache Verfahren.
3. **Verzerrte Alltagsdaten** bestätigen alte Gewohnheiten. Mitigation:
   Benchmark-Daten als Anker, Erkundung nur gedeckelt und gewollt.
4. **Private Inhalte im Datensatz.** Mitigation: Merkmale statt Text als
   Standard, lokal, löschbar.
5. **Modell veraltet** mit neuen Modellen und Preisen. Mitigation: unbekannte
   Kandidaten gehen an die Regeln; Prüfung wiederholen.

## 7. Definition of Done

AC-P89-1 bis -6 belegt (oder dokumentiertes No-go); `lint`, `typecheck`,
`check:context` grün; `npm run gate` lokal grün und GitHub-Actions-Lauf auf dem
Abschluss-PR grün; neue Oberfläche mit Spec in `e2e/specs/` und im Guide
erreichbar beschrieben; Abnahme am eigenen Datenbestand nach P000 verschoben;
Tracker-Issue gesichtet.
