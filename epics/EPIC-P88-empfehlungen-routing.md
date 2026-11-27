# EPIC-P88 — Empfehlungen und Routing: welche Kombination wofür

**Status:** Planungsentwurf (Nutzerauftrag 27.11.2026) · **Phase:** P88 · **Dauer:** 2–3 Agenten-Wochen · **Tracker:** [#469](https://github.com/securesight-ai/AncientVoid/issues/469)
**Abhängigkeit:** Ergebnisvertrag aus [P84](EPIC-P84-ai-arbeit-evaluation-benchmark.md) (T84.1–T84.5); belegte Klassenwerte aus [P87](EPIC-P87-messserie-aufgabenklassen.md). Der Planungsauftrag erlaubt den Entwurf vor grünen Vorgängern, die Umsetzung braucht ein eigenes Go. Automatische Auswahl erst mit P87-Daten.

## 1. Ziel

In der Oberfläche steht, welche Kombination aus Harness, Modell und Anbieter für
welche Aufgabe empfohlen wird, und **eine** Entscheidungsfunktion versorgt neue
Sessions, Teams/Swarm, Loops und Dark Factories, Automationen und den
Orchestrator. Sie wählt je AncientVoid-Instanz und Nutzer nur aus dem, was dort
wirklich verfügbar ist.

„Beste Entscheidung“ heißt hier: die am besten **belegte** Wahl unter den
Vorgaben, mit sichtbarer Beleglage. Optimalität wird nie behauptet.

## 2. Scope (In / Out)

### In
- Aufgabenprofil, Beleglage je Kombination, deterministische Auswahlregeln.
- Hub-Route, Journal je Entscheidung, Rückmeldung (übernommen, überstimmt,
  Ergebnis).
- PWA: Empfehlungsansicht, Vorschlag beim Anlegen, Routing-Einstellungen.
- Anbindung von Swarm/Teams, Loops, Automationen.
- Opt-in-Eskalation: nach roten Prüfungen ein stärkerer Versuch, begrenzt.

### Out
- Kein lernendes Modell ([P89](EPIC-P89-eigenes-router-modell.md)), kein LLM als
  Entscheider.
- Kein Modellwechsel mitten in einer Session (Übergabe bleibt P21).
- Keine Änderung an Berechtigungsmodus, Sandbox oder Freigaben.
- Kein Datenaustausch zwischen Instanzen.

## 3. Design-Details

### 3.1 Aufgabenprofil
Art (Fehlerbehebung, Funktion, Review, Verständnisfrage, unbekannt), Schwere
(`klein`/`mittel`/`schwer`/unbekannt, Regel aus P87), Ziel (Erfolg, Tempo,
Kosten), Grenzen (nur lokal, erlaubte Anbieter, Budget). Der Nutzer wählt; ein
Vorschlag ist als solcher markiert. Unbekannt bleibt unbekannt.

### 3.2 Kandidaten
Registrierte Adapter, Modellkataloge und eigene Modelle (ADR-0060), erreichbare
Hosts, zuletzt gemeldete Kontingentausfälle, Budgetrest. Was nicht verfügbar
ist, wird mit Grund ausgeschlossen und angezeigt.

### 3.3 Beleglage
| Stufe | Bedeutung |
|---|---|
| gemessen | n ≥ 3 je Kombination × Klasse, ein Korpus- und Konfigurationsstand |
| dünn | weniger Läufe |
| Annahme | gepflegte Vorgabe, als Annahme beschriftet |
| keine Daten | keine Empfehlung, Standard des Nutzers gilt und wird so benannt |

Quelle ist die Serienzusammenfassung aus P84 (`EvalSeriesSummary`). Anzeige mit
Messdatum und Preisdatum. Ändert sich der Modell- oder Harness-Fingerprint,
verliert der Beleg die Stufe „gemessen“. Abbrüche zählen sichtbar gegen eine
Kombination (T84.13). Kosten, die nur als Schranke bekannt sind, werden so
gezeigt (T84.14).

### 3.4 Regel
Erst Grenzen filtern, dann Bestehensquote mit n, dann das gewählte Ziel
(Wandzeit oder Kosten). Ergebnis: bis zu drei Vorschläge mit Begründung und den
Ausschlussgründen. Gleiche Eingabe ergibt gleiche Ausgabe.

### 3.5 Contract und Route
`packages/contracts/src/routing/`, Core-Modul `routing`, Route
`POST /api/routing/recommend` in
`apps/hub/src/modules/routing/routing.routes.ts`. ADR vor dem ersten Code.
Jede Entscheidung wird journaliert (Profil, Kandidaten, Wahl, Beleglage,
Regelstand, Überstimmung): rekonstruierbar (K7), Großes als Blob (K5).

### 3.6 Oberfläche
- Reiter „Empfehlungen“ unter `#/statistik`: Matrix Klasse × Ziel; Antippen
  zeigt Begründung und Rohwerte. Auf dem Handy als Liste.
- Neue Session, Team-Plan, Loop-Start: Chip „Empfohlen“, mit einem Tipp
  übernommen.
- Einstellungen: Modus `aus`, `vorschlagen` (Standard), `automatisch`;
  erlaubte Anbieter, nur lokal, Budgets.

### 3.7 Verbraucher
Swarm wählt nur innerhalb der Modell-Allowlist des Rahmens. Externe Loops
bekommen die Wahl beim Start (Adapter, Modell); ihr Inneres bleibt unberührt.
Automationen nutzen Routing nur je Automation aktiviert.

### 3.8 Sicherheit
Routing wählt nur aus. Aufgabentext ist Datum; Agentenausgaben ändern nie
Regeln oder Einstellungen. Budgetdeckel und Freigaben gelten unverändert.

## 4. Aufgaben

- [ ] **T88.1** ADR und Contract (Profil, Kandidat, Beleg, Entscheidung).
  → AC-P88-1
- [ ] **T88.2** Beleglage aus Serienzusammenfassungen inklusive Verfall.
  → AC-P88-2
- [ ] **T88.3** Auswahlregeln mit Tabellen-Tests. → AC-P88-3
- [ ] **T88.4** Route, Policy, Journal und Wiederherstellung (K5, K7).
  → AC-P88-4
- [ ] **T88.5** Reiter „Empfehlungen“ mit Spec (K10). → AC-P88-5
- [ ] **T88.6** Vorschlag beim Anlegen und Routing-Einstellungen. → AC-P88-5
- [ ] **T88.7** Swarm/Teams anbinden. → AC-P88-6
- [ ] **T88.8** Loops und Automationen anbinden. → AC-P88-6
- [ ] **T88.9** Rückmeldung je Entscheidung (Ergebnis der Prüfungen,
  Überstimmung). → AC-P88-4
- [ ] **T88.10** Opt-in-Eskalation mit Versuchs- und Kostendeckel.
  → AC-P88-7

## 5. Acceptance Criteria

- **AC-P88-1:** ADR angenommen; alle Verbraucher nutzen denselben Contract.
- **AC-P88-2:** Keine Anzeige nennt „gemessen“ bei n < 3, gemischtem Stand oder
  geändertem Fingerprint (Test).
- **AC-P88-3:** Nicht verfügbare oder verbotene Kombinationen werden nie
  gewählt; ohne Daten gibt es keine Scheinempfehlung.
- **AC-P88-4:** Nach Hub-Neustart sind alle Entscheidungen samt Ergebnis
  rekonstruiert; eine ausgefallene Auswahl ist als Ereignis sichtbar.
- **AC-P88-5:** Empfehlung, Begründung und Rohwerte sind auf Handy und Desktop
  erreichbar; offline mit Zeitstempel.
- **AC-P88-6:** Modus `aus` ändert das Verhalten keines Verbrauchers.
- **AC-P88-7:** Eskalation überschreitet nie Versuchs- oder Kostendeckel.

## 6. Premortem

1. **Dünne Daten sehen wie Wahrheit aus.** Mitigation: Beleglage ist Teil des
   Contracts und jeder Anzeige.
2. **Unser Korpus passt nicht zum Projekt des Nutzers.** Mitigation: Quelle und
   Repo der Messung zeigen; eigene Korpora nutzbar halten.
3. **Werte veralten mit Modell- und Preiswechseln.** Mitigation: Fingerprint
   und Preisdatum, Verfall der Stufe.
4. **Automatik verbrennt Kontingent.** Mitigation: Standard `vorschlagen`,
   Deckel, Kontingentausfall schließt den Anbieter vorübergehend aus.
5. **Nur Gewähltes bekommt Daten.** Die Empfehlung bestätigt sich selbst.
   Mitigation: Benchmark-Serien bleiben die Vergleichsquelle; Alltagsergebnisse
   getrennt ausweisen.

## 7. Definition of Done

AC-P88-1 bis -7 durch benannte Tests belegt; `lint`, `typecheck`,
`check:context` grün; `npm run gate` lokal grün und GitHub-Actions-Lauf auf dem
Abschluss-PR grün; jede neue Ansicht und jeder Ablauf mit Spec in `e2e/specs/`;
Feature über Navigation und Einstellungen erreichbar und im Guide beschrieben;
Geräteabnahme nach P000 verschoben; Tracker-Issue gesichtet.
