# EPIC-P90 — Session-Namen mit Ursprung und Fokus; Chat bis oben scrollbar; Prompt-Verbesserer mit Beleg, Einstellungen und deterministischem Scan

**Status:** In Umsetzung, vollständige Messserie und repoübergreifende Abnahme offen · **Phase:** P90 · **Dauer:** 3–4 Agenten-Wochen plus Messlaufzeit (Schätzung) · **Abhängigkeit:** Quer-Epic wie P87–P89; baut auf P68 (Engine-Kette, ADR-0089) und P72 (Skill-Pflege, beide abgeschlossen) auf; P74 liefert optionale Wissensquellen; die Repo-Eval baut auf den vorhandenen P84-Werkzeugen und ADR-0126 auf. P30/P31 bleiben On hold. Tracker [#479](https://github.com/securesight-ai/AncientVoid/issues/479).

Quelle: Nutzerauftrag vom 27.11.2026, drei Punkte: (1) Session-Namen sind oft
nichtssagend — der **initiale Gedanke darf nicht verloren gehen**, und ein
**Fokuswechsel muss sichtbar** werden; für **Übergaben** gilt: kurz und prägnant,
ohne den ganzen Titel in Anspruch zu nehmen. (2) Aktuell kann man in der
Chat-Historie **nicht weiter als die eigene letzte Nachricht scrollen**. (3) Der
**Prompt-Verbesserer soll deutlich besser werden — und es muss belegt sein, dass
er hilft**: wenn möglich immer das lokale Modell (aktuell qwen3.8 über Pi), in den
Einstellungen konfigurierbar; der Verbesserungsmechanismus soll **so deterministisch
wie möglich das Projekt scannen** (plus angebundene Quellen wie Brain/RAG, falls
angebunden und gefragt) und die für den Initial-Prompt nützlichen Code-Stellen,
Regeln und Vorgehensweisen finden — **sodass der nächste Agent in der nächsten
Session nichts mehr suchen muss**.

## 0. Bestand (Stand 27.11.2026)

- **Namen.** Ein Feld `title` (≤ 120 Zeichen, `@ancientvoid/contracts`
  `sessions/session.ts`), `titleSource` `auto|ai|manual` (T15.5);
  `askTitleModel` vergibt den Modell-Titel einmalig aus den ersten Worten des
  Auftrags. Discovery-/Übergabe-Titel nach ADR-0040 (Provider-Titel, sonst erster
  Prompt; Vorschau ≤ 160 Zeichen). Was fehlt: eine bleibende Ursprungszeile,
  Fokus-Revidierung und eine knappe Übergabe-Kennzeichnung.
- **Scroll.** BUG-0211 hat Nachladen gebaut (`loadOlder`, `tailWindow` mit
  `floorSeq`, `SessionTail.tsx`) und ist done. Die neue Meldung (Scrollen endet an
  der eigenen letzten Nachricht) ist **unreproduziert**; erste Hypothesen:
  Touch-Scroll löst den oberen Rand-Trigger nicht aus; die Zug-Projektion
  (`ChatTurns`) und das Ereignis-Lager teilen sich das Fenster; der Hub-`tail()`-
  Aufruf aus `loadOlder` mit `afterSeq = 0`. Reihenfolge wie immer: Repro →
  Bug-Datei (`bug-report`) → Fix.
- **Verbesserer.** EPIC-P68/ADR-0089: Engine-Kette `lokal → Adapter → OpenCode`,
  fester Projektkontext (feste Quellen, 6 000 Zeichen), Duplikat-Schutz bei
  Skills, Feedback-JSONL (T3.9, `prompt-optimizer-feedback.jsonl`) wird
  geschrieben, aber noch nie ausgewertet. `enhanceFlavorFor()` kennt kein `pi` —
  bei gewähltem pi-Adapter und belegtem lokalem Modell fällt die Kette auf
  OpenCode zurück, obwohl pi-one-shot-fähig ist (pi läuft one-shot je Zug).
- **Evaluation.** Die [P84-Eval-Seite](../apps/pwa/src/features/evaluation/EvaluationPage.tsx)
  zeigt aggregierte Rohwerte je Serie, Arm und Aufgabe. Der
  [P84-Vertrag](../packages/contracts/src/runs/evaluation.ts) erfasst bereits
  Abnahme, Lint und Typecheck und schreibt die Ergebnisse über
  [ADR-0126](../docs/adr/0126-evaluation-in-turn-metriken.md) ins Session-Journal.
  Es fehlen Repo-Zuordnung, ein Vergleich der wirksamen Konfigurationen und
  Befunde zu einzelnen Prüfungen.

## 1. Ziel

**Spur A — Namen (Spurlänge 1–2 Tage).** Jede Session trägt (a) einen
**unveränderlichen Ursprung** (der initiale Gedanke, beim Anlegen gesetzt, für
immer sichtbar), (b) einen **aktuellen Fokus**, der sich an definierten,
deterministischen Anlässen ändern lässt (Umbenennung durch Menschen, angenommene
Übergabe, ausdrückliche Modell-Bitte — nie pro Zug), und (c) eine **knappe
Übergabe-Kennzeichnung** als Badge (Symbolebene, ≤ ~12 Zeichen), die den Titel
nicht beschlagnahmt.

**Spur B — Scroll (1 Tag).** Wer in einer langen Session nach oben scrollt,
erreicht den Anfang des Chats — auch über Touch auf dem Handy, auch in der
Zug-Projektion, ohne Sprünge (erwartetes Verhalten wie bei BUG-0211).

**Spur C — Prompt-Verbesserer (Priorität; 3–5 Tage + Messlauf).**
(1) Die bevorzugte Engine ist **in den Einstellungen konfigurierbar**; Default
`auto` erhält P68s Kette (lokales Modell zuerst — aktuell qwen3.8; über Pi via
eigener pi-One-Shot-Stufe), pinnen auf ein bestimmtes Modell (Katalog
`assistant.model`/Connections/custom models) übersteuert die Kette sichtbar.
(2) Ein **deterministischer Repo-Scan** ergänzt den festen Projektkontext um die
tatsächlich vorhandenen, zum Auftrag passenden Code-Stellen (Pfade, Symbole,
Kommandos, Skills); angebundene Wissensquellen (P74) werden nur gefragt, wenn
angebunden **und** gefragt. (3) Der **Nutzen ist belegt**: ein Messlauf nach
`messlauf`-Muster mit und ohne Scan entscheidet ehrlich per Go-Regel — ein
nicht belegter Scan bleibt standardmäßig aus.

**Spur D — Repo-Evaluation.** In der bestehenden Eval-Suite kann jedes
angebundene Repo den aktuellen Stand von Kontext, Skills, Hooks, Guardrails
und Regeln gegen eine Änderung prüfen. Die Seite zeigt je Repo, Aufgabe und
Änderung, was sich an Codequalität, Regeltreue und Aufwand ändert.
Bei Rückschritten, fehlendem Mehrwert oder zu wenig Evidenz zeigt sie den
konkreten Verbesserungs- oder Messbedarf samt Begründung. Der Prompt-Scan ist
der erste reale Vergleich mit dieser Funktion.

## 2. Scope (In / Out)

**In**

- Contracts + Core: neue Felder `originIntent` (immutable) und `focus` am
  Session-Vertrag (ADR-0127, Migrationspfad, K7); Benennungspolitik
  (Ursprung immutable; Fokus nur an definierten Anlässen).
- PWA: Anzeige von Ursprung/Fokus in Liste und Detail; Übergabe-Badge statt
  Titel-Präfix; Umbenennungsfluss respektiert `titleSource`.
- Verbesserer-Einstellung: Settings-Store-Schlüssel + Einstellungen-Abschnitt
  (PWA); Engine-Kette respektiert die Einstellung; pi bekommt eine eigene
  One-Shot-Stufe in `enhanceFlavorFor`.
- Deterministischer `repoFacts`-Scan (feste Extractoren, nur reale Pfade),
  optionale Wissens-Abfrage nur wenn angebunden und gefragt.
- Repo-Auswahl, konfigurierbarer Aufgabenkorpus und Vergleich von Referenz-
  und Kandidatenstand in der bestehenden Eval-Suite. Ergebnisse und Befunde
  bleiben je Repo abrufbar. Der Prompt-Scan nutzt denselben Ergebnisweg,
  mit Go-Regel und Protokoll in `docs/messlauf/`.
- Scroll-Defekt: Repro (E2E-Harness wie BUG-0211), Bug-Datei, Fix, Spec.

**Out**

- Embedding-/Vektor-RAG als neuer Pflichtpfad — nur die vorhandene
  P74-Anbindung im Angebotsmodus; ein eigener Index entsteht nicht.
- Automatische Benennung pro Zug (Kosten, Flickern, Premortem 3).
- Umbau der Sessions-Liste oder der Icon-Leiste jenseits von Badge/Fokuszeile.
- Auto-Accept des Verbesserer-Vorschlags (P68 bleibt: der Mensch sieht die
  Vorschau und entscheidet).
- `assistant.model`-Infrastruktur (Modell-Download, Server-Start) — es zählt,
  was konfiguriert ist.

## 3. Design-Details

### 3.1 Namen (Spur A)

Vertragsänderung in `@ancientvoid/contracts` (`sessions/session.ts`,
sessions-Zweig), **ADR-0127** nötig:

- `originIntent: string | null` — der initiale Gedanke, **immutable** once gesetzt
  (Ausnahme: ausdrückliche Nutzerumbenennung überschreibt Fokus, nie Ursprung).
  Quelle: beim Anlegen der erste Auftrag (gekürzt), sonst das bisherige
  Titelmaterial.
- `focus: { text, source, setAt } | null` mit `source ∈ manual | handoff | model`
  — `model` nur auf ausdrückliche Bitte (Composer/Aktion), nie automatisch pro Zug.
- Anzeige: Liste zeigt `focus ?? title`; der Ursprung steht unverkürzt in der
  Detailansicht und im Tooltip. Eine **Übergabe** wird als Badge dargestellt
  (`↪`, Kurzform ≤ ~12 Zeichen, z. B. „↪ Handy“) — Titel unverändert.
- Revidierungs-Anlässe (deterministisch): Menschen-Rename; angenommene Übergabe
  mit erstem Auftrag, der thematisch vom aktuellen Fokus abweicht (Wort-Overlap-
  Heuristik wie P68s Duplikat-Schutz, kein Modelllauf im Regelfall); sonst nur
  explizite Modell-Bitte.

### 3.2 Scroll (Spur B)

1. **Reproduzieren** im E2E-Harness (Muster BUG-0211: Fixture-Hub unterhalb der
   Resync-Grenze, > 600 Ereignisse, mobiles Projekt, Touch-Scroll statt Maus).
2. Bug-Datei `bugs/bug-NNNN-*.md` anlegen (Nummer nach `bug-report`-Konvention bei
   Anlage), `Fixes #` im PR.
3. Fix am ausgelösten Übeltäter (Hypothesen in §0); Acme: vom unteren Rand durch
   die eigene letzte Nachricht hindurch bis zur Spitze scrollen, ohne Sprung,
   Nachladelast bleibt seitengroß wie bei BUG-0211.

### 3.3 Einstellungen und Engine-Kette (Spur C)

- Settings-Store-Schlüssel `promptEnhancer`: `{ engine: "auto" }` (Default,
  unverändert P68) oder gepinnt `{ kind: "model", ref }` (Referenz auf
  `assistant.model`/Connection/custom model) oder gepinnt `{ kind: "adapter",
  id }` (nur Adapter mit eigener One-Shot-Stufe).
- `enhanceFlavorFor` bekommt `pi` (pi läuft one-shot je Zug — dieselbe
  One-Shot-Bauart wie claude/codex/opencode/dsh, stdin schließen, Flags vor `--`,
  Lessons aus enhance.ts beachten). Die Engine-Anzeige der Vorschau (P68) nennt
  die tatsächlich geantwortet habende Stufe samt Gründen — unverändert fail loud.
- Eine gepinnte Engine, die nicht erreichbar ist, fällt **sichtbar** auf `auto`
  zurück (`skipped[]`-Grund), nie still.

### 3.4 Deterministischer Scan (`repoFacts`)

An `projectContext` (P68) angebunden, Zusatzblock, klar als Daten gerahmt
(PRD §8.5). Stufen, alle deterministisch außer dem optional Richter:

1. **Bestehende feste Quellen** (unverändert: Leitfaden, README-Kopf, Manifeste,
   oberste Verzeichnisebene, Skills/Agents).
2. **Deterministische Extraktion aus dem Rohtext:** vorkommende Pfade,
   Paket-/Modulnamen, Kommando-Namen (`package.json`-Scripts, `Makefile`-Ziele,
   Top-Level-Skripte), Dateiendungs-Muster. Nur **real existierende** Ziele
   werden übernommen (Auflösung über Dateisystem sowie vorhandene Module
   `search`/`scan`/`graph` — kein neuer persistenter Zustand, K7).
3. **Angebotsmodus:** ist eine Wissensquelle (P74, `KnowledgeSource`) angebunden
   **und** der Auftrag oder die Einstellung fragt sie, liefert sie max. N Treffer
   zu den extrahierten Begriffen; sonst bleibt sie still.
4. Optional derselbe Modell-Richter wie P68 (§3.3) zur Reihenfolge — erfundene
   Pfade werden verworfen, nur der Katalog des Scans zählt.

Budgets: existing 6 000 Zeichen (P68), `repoFacts` ≤ 4 000 Zeichen, Getrennte
Budgets, der Prompt ist keine Event-Payload (K5 bleibt unangetastet).

### 3.5 Beleg (das „hilft es?“)

Erster Vergleich nach §3.6 mit zehn eingefrorenen Initial-Aufträgen aus
AncientVoid (Bugfix, Refactoring und modulübergreifende Änderungen). Beide
Arme nutzen dieselbe Enhancer-Engine und dasselbe Modell für die Folge-Session.
Der Referenzarm verwendet den P68-Kontext, der Kandidat ergänzt den Scan.
Die Suite erfasst Abnahme und Qualitätsprüfungen des resultierenden Diffs,
Suchaufrufe bis zur ersten Änderung, Zeit bis zur ersten grünen gezielten
Prüfung sowie Tokens und Kosten beider Phasen. Läufe ohne grüne Prüfung zählen
zur Fehlerquote und bleiben im Befund sichtbar. Die Akzeptanzrate aus
`prompt-optimizer-feedback.jsonl` ergänzt die Messung als Nutzungssignal.

**Go-Regel:** Der Scan wird Standard, wenn die Codequalität nachweislich
steigt oder der Aufwand bei gleichwertiger Qualität nachweislich sinkt.
Pflichtprüfungen, Guardrails und Regeltreue müssen die vorab festgelegten
Grenzen erfüllen. Bei einer Regression, fehlendem Mehrwert oder unklarer
Evidenz bleibt der Scan standardmäßig aus. Serie, Entscheidungsgrund und
konkrete Befunde stehen in der Eval-Suite und im Messlaufprotokoll.

### 3.6 Vergleich pro Repo in der Eval-Suite (Spur D)

1. **Vergleich konfigurieren und starten.** Repo, versionierten Aufgabenkorpus,
   Referenzstand und Kandidat in der bestehenden Eval-Seite auswählen. Ein
   angebundenes Repo ohne Korpus zeigt, wie es Aufgaben mit einer
   ausführbaren Abnahme hinzufügen kann. P84-Runner und Prüfpfad
   wiederverwenden. Je Aufgabe sind Start-Commit,
   Eingabe, zulässiger Änderungsumfang und ausführbare Abnahme eingefroren.
   Regelfälle prüfen zusätzlich das gewünschte Verhalten und erlaubtes
   Verhalten als Negativkontrolle, etwa erlaubte Schreibvorgänge, die ein
   Guardrail weiterhin durchlassen soll. Referenz und Kandidat laufen in
   frischen isolierten Arbeitskopien mit gleicher erzwungener Plattform-Policy,
   gleichen Limits, gleichem Harness und gleicher Modellrevision. Korpus und
   Prüfungen liegen außerhalb des vom Agenten veränderbaren Arbeitsbereichs.
2. **Wirksame Änderung belegen.** Pro Vergleich genau eine fachliche Änderung
   an Kontextauswahl, Skill, Hook, Guardrail oder Regel variieren. Versions- und
   Konfigurations-Fingerprints erfassen auch globale bzw. geerbte Vorgaben,
   externe Quellen und die Reihenfolge wirksamer Regeln. Pro Lauf belegen, ob
   der jeweilige Kontext ausgeliefert, ein Hook ausgelöst oder die Regel bzw.
   der Guardrail geprüft wurde. Unklare Wirkung, Drift und
   Infrastrukturfehler sind sichtbar. Timeouts und fehlgeschlagene Abnahmen
   zählen als Laufresultate. Befunde über mehrere gleichzeitig geänderte
   Komponenten bleiben auf das Änderungspaket beschränkt.
3. **Auswertung vorab festlegen.** Abnahmetests und Regressionstests, repo-eigene
   Lint-/Typprüfungen, Diff-Umfang sowie Kategorien wie falsche Blockierung
   und Regelverstoß einzeln erfassen. Nicht anwendbare Checks ausweisen.
   Sekundär Zeit, Tokens, Kosten und Suchaufwand messen. Die primäre Metrik,
   Mindestverbesserung und Toleranz für gleichwertige Ergebnisse vor dem
   Lauf festlegen. Mindestens fünf gepaarte Wiederholungen je Aufgabe und
   Arm. Die Reihenfolge der Arme wechselt zwischen den Paaren. Die Seite
   zeigt Stichprobe, Streuung und Differenz pro Prüfung und Aufgabe. Der Befund
   unterscheidet „verbessert“, „kein messbarer Mehrwert“, „verschlechtert“
   und „Evidenz fehlt“. Unvollständige oder nicht vergleichbare Paare liefern
   keinen Wirkungsnachweis. Fehlende Messwerte bleiben offen.
4. **Warum und wo anzeigen.** Jeder negative oder offene Befund nennt die
   betroffene Quelle, Aufgabe und Prüfung mit Soll-/Ist-Verhalten, die
   Messwerte beider Arme, einen Link zum Laufbeleg und den nächsten konkreten
   Prüfschritt. Beispiel: Ein Hook blockiert in vier von fünf Kandidatenläufen
   erlaubte Änderungen an einer Fixture-Datei. Die Seite zeigt Hook und Pfad,
   verlinkt die Blockierungsereignisse und nennt die Ausnahmeregel als
   Prüfpunkt. Wo die Ursache ungeklärt ist, kennzeichnet die Seite die
   Vermutung und empfiehlt den fehlenden Kontrollvergleich.
5. **Nachweis erhalten.** Repo-Zuordnung über die vorhandene Projektidentität,
   Serienmetadaten, Belege und Ergebnisse über den Eval-Vertrag und
   Session-Journale nach ADR-0126. Größere, bereinigte Nachweise über den
   Blob-Pfad (K5). Ableitungen bleiben nach Neustart rekonstruierbar (K7).
   Legacy-Serien bleiben lesbar, ohne ihnen nachträglich Repo-Zugehörigkeit
   oder Wirkung zuzuschreiben. Nur bereinigte Belege und Fingerprints
   speichern. Secrets und Rohkontext verbleiben außerhalb der Eval-Daten.

## 4. Aufgaben (Checkliste T90.m)

- [x] **T90.1** [ADR-0127](../docs/adr/0127-sitzungsursprung-fokus-und-prompt-verbesserer.md) (Vertragsfelder `originIntent`/`focus`,
  Settings-Schlüssel, pi-One-Shot-Stufe), ADR-Index. Messlatte: Contracts-first.
- [ ] **T90.2** Contracts + Core: Felder, Migration/Recovery-Pfad (K7),
  Benennungspolitik inkl. Wort-Overlap-Heuristik; Unit-Tests rot-dann-grün.
- [x] **T90.3** PWA: Ursprung/Fokus-Anzeige (Liste + Detail), Übergabe-Badge,
  Umbenennungsfluss; e2e-Spec `e2e/specs/session-naming.spec.ts`.
- [ ] **T90.4** Scroll-Defekt: Repro-Spec (rot), [BUG-0293](../bugs/bug-0293-chat-historie-touch-und-seitenluecke.md),
  Fix (grün), mobiles Projekt, ohne Sprung; `Fixes #` im PR. K2 (Nachladelast).
- [ ] **T90.5** Settings-Store + Einstellungs-Abschnitt; Engine-Kette respektiert
  Pin mit sichtbarem Fallback; `enhanceFlavorFor` + pi-One-Shot; Unit-Tests mit
  Fake-Provider/Fake-Runner. K10 (sichtbarer Grund).
- [ ] **T90.6** `repoFacts`-Scan (nur reale Pfade, Budgets, Rahmung,
  Angebotsmodus für P74-Quellen); Tests: gefundene Pfade existieren, Budget hält,
  Injection-Rahmen steht, Quelle nicht angebunden ⇒ still. K5/K7.
- [ ] **T90.7** Messlauf: Korpus einfrieren, Arme, Metriken, Protokoll
  `docs/messlauf/`, Go-Regel anwenden, Ergebnis in der Eval-Suite belegen;
  Feedback-JSONL auswerten.
- [ ] **T90.8** `docs/funktionsinventar.md`, `docs/einstellungen-empfehlungen.md`,
  Epic-Abschluss-Notiz. Geräte- und Alltagsabnahme in [T000.41](EPIC-000-testsuite-fuer-menschen.md).
- [ ] **T90.9** Repo-Auswahl bis gespeicherter A/B-Befund: Eval-Vertrag und
  ADR-0126 ergänzen, Repo-Korpus und Vorprüfung an P84 anbinden, gestartete
  Serie pro Repo in der Suite wiederfinden. Contract-/Route-Tests in
  `packages/contracts/test/runs-evaluation-summary.test.ts` und
  `apps/hub/test/eval.integration.test.ts` für Altbestand, Wiederholung,
  fehlende Prüfdaten, Repo-Trennung und Journal-Recovery (K5/K7).
- [ ] **T90.10** Diagnose vom Prüfergebnis bis zur Eval-Seite: Vergleich und
  Beleglinks je Aufgabe und Änderung. `packages/core/test/modules/runs/evaluation-summary.test.ts`
  prüft Rückschritt, Gleichstand, Drift und unvollständige Paare.
  `e2e/specs/evaluation.spec.ts` prüft Repo-Wechsel, fehlenden Korpus,
  Laufstart, Vergleich und konkreten Befund samt Beleg.
- [ ] **T90.11** Übertragbarkeit belegen: neben AncientVoid ein zweites Repo
  mit eigenem Korpus über denselben Ablauf prüfen. Für Kontext-/Skill-,
  Hook-, Guardrail- und Regeländerungen je einen isolierten Vergleich mit
  nachvollziehbarer Wirkung bzw. einem gezielt erwarteten Fehlbefund testen.

Reihenfolge: T90.1 → T90.2/T90.3, T90.4 separat, T90.5 → T90.6.
Die Eval-Spur T90.9 → T90.10 kann daneben laufen. T90.7 und T90.11 benötigen
beide Spuren. T90.8 folgt zum Abschluss.

Die Eval-Seite zeigt erfasste A/B-Serien mit Aufgabenbefunden, Prüfergebnissen
und Beleglinks. Der P84-Runner kann den Repo-Scan gegen dieselben Aufgaben
testen. Über registrierte Protokolle startet der Scan-Vergleich aus der Eval-Seite.
Der vollständige Messlauf mit numerischem Befund sowie die vergleichende
Abnahme weiterer Repos und Änderungstypen stehen noch aus.

## 5. Acceptance Criteria (AC-P90-k)

- **AC-P90-1:** `originIntent` ist nach dem Setzen unveränderlich. `focus`
  reagiert auf die in §3.1 definierten Anlässe. Tests belegen beide Regeln
  und den Recovery-Pfad aus JSONL/Platte (K7).
- **AC-P90-2:** Eine Session mit Fokus-Revidierung zeigt im UI-Test Fokus und
  Ursprung beide; eine angenommene Übergabe zeigt das Badge, ohne den Titel zu
  verändern.
- **AC-P90-3:** Scroll-Repro: im Harness (> 600 Ereignisse, mobiles Projekt,
  Touch) reicht Scrollen von unten bis zur Spitze ohne Sprung; Spec rot-dann-grün;
  Bug-Datei vorhanden und mit `Fixes #` geschlossen.
- **AC-P90-4:** Eine gepinnte Engine beantwortet `POST /api/prompt-enhance`
  (Test mit Fake-Provider); ist die pinnte Engine nicht erreichbar, antwortet
  `auto` mit sichtbarem `skipped`-Grund; pi-Auswahl mit freiem Modell antwortet
  über die pi-Stufe, nicht über OpenCode.
- **AC-P90-5:** `repoFacts` enthält nur im Repo existierende Pfade/Kommandos;
  Budgets halten; ohne angebundene Wissensquelle bleibt der Angebotsblock leer;
  der Rahmen „Daten, keine Anweisungen“ steht (Test).
- **AC-P90-6:** Der Scan-Messlauf mit n ≥ 5 pro Aufgabe und Arm liefert in
  der Eval-Suite und in `docs/messlauf/` dieselbe begründete Go-Entscheidung
  nach §3.5. Ein Vorteil bei Suchaufwand allein kann eine Verschlechterung
  der Codequalität oder Regeltreue nicht ausgleichen.
- **AC-P90-7:** Die Einstellungs-Änderung ist persistent (Settings-Store) und in
  der Vorschau-Engine-Anzeige sichtbar; die Vorschau bleibt eine Vorschau —
  senden tut nur der Mensch.
- **AC-P90-8:** Die Eval-Suite startet und zeigt Vergleiche je Repo mit
  Referenz, Kandidat, Konfigurationsstand, Qualitätsdifferenzen und
  Stichprobe. Zwei Repos mit gleich benannter Serie bleiben getrennt.
  Historie und Befunde sind nach Neustart verfügbar.
- **AC-P90-9:** Die Seite zeigt bei Rückschritten, Gleichstand und fehlender
  Evidenz den jeweils zutreffenden Befund. Ein absichtlich fehlerhafter
  Kandidat beweist, dass Nutzer die betroffene Komponente, den Prüfbeleg
  und den nächsten Prüfschritt direkt finden. Ein Repo ohne Korpus sieht
  den fehlenden Vorbereitungsschritt.

## 6. Premortem (Failure-Modi + Mitigation)

1. **Modell-Umbenennung macht Namen schlechter als heute** (genau das Gegenteil
   des Auftrags): `originIntent` immutable; Modell-Titel bleibt wie bisher
   opt-in; Menschen-Rename gewinnt immer; `titleSource` bleibt auditierbar.
2. **Scan flutet den Prompt mit irrelevantem Kram:** nur deterministisch
   aufgelöste, reale Pfade; strikte Budgets; und die Go-Regel (§3.5) kann den
   Scan wieder ausschalten — „bringt nichts“ ist ein erlaubtes Epic-Ergebnis.
3. **Fokus-Revidierung bei jeder Nuance ⇒ Titel-Churn:** Revidierung nur an den
   drei definierten Anlässen; kein Modelllauf pro Zug.
4. **Settings versprechen Pin, P68-Kette ignoriert ihn:** Pin ist explizit
   implementiert, Fallback bleibt sichtbar (`skipped`-Grund in der Vorschau).
5. **Scroll-Fix wirkt nur am Maus-Rad:** AC und Spec fahren das mobile Projekt
   mit Touch-Scroll; Gerätetermin zusätzlich in P000.
6. **Messlauf wird ohne echten Lauf abgehakt:** Arme laufen gegen das reale,
   konfigurierte Modell; Live-Lauf am echten llama.cpp/qwen bleibt
   Nutzerabnahme (P000) — der Messlauf selbst braucht ein echtes laufendes
   Modell, kein Fake.
7. **Falscher Nutzen durch Drift oder fehlgeschlagene Läufe:** Festes
   Protokoll, gepaarte Läufe, wirksame Konfiguration und vollständige
   Abnahmestände sind nachprüfbar. Unvereinbare Stände bleiben sichtbar.
8. **Effizienz verbessert sich, der Diff wird schlechter:** Qualitäts-
   und Regelprüfungen behalten eigene Grenzwerte und Belege. Der Go-Entscheid
   greift erst nach bestandener Qualitätsprüfung.

## 7. Definition of Done

Alle T90.* und AC-P90-* mit Evidenz. Gezielte Tests (rot-dann-grün, beim Namen
genannt), Lint und Typecheck grün; lokale Gates und GitHub-Actions (`verify`) auf
dem Abschluss-PR grün; Vollsuite/Nightly gemäß `AGENTS.md` (kein Breitlauf ohne
ausdrücklichen Auftrag); rote CI allein wegen Umgebung wird benannt, nie als Pass
gezählt. Jede neue UI-Funktion mit Spec in `e2e/specs/`; Eintrag in
`docs/funktionsinventar.md`; ADR-0127 geschrieben und indexiert; Tracker-Issue mit
`Fixes #`-Bezug (`docs/issues.md`); K5/K7/K10 nachweislich erfüllt; kein TODO ohne
Epic-Bezug. Die Geräte- und Alltagsabnahme ist nach [P000 T000.41](EPIC-000-testsuite-fuer-menschen.md)
verschoben. Der reproduzierbare Modell-Messlauf bleibt Teil von P90.
