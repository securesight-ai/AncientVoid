# EPIC-P90 — Session-Namen mit Ursprung und Fokus; Chat bis oben scrollbar; Prompt-Verbesserer mit Beleg, Einstellungen und deterministischem Scan

**Status:** offen (Planungsentwurf) · **Phase:** P90 · **Dauer:** ~2 Agenten-Wochen (Messlauf ohne Laufzeit) · **Abhängigkeit:** keine blockierende — Quer-Epic wie P87–P89; baut auf P68 (Engine-Kette, ADR-0089) und P72 (Skill-Pflege, beide abgeschlossen) auf; P74 nur als optionale Quelle (Angebotsmodus); P84-Werkzeuge für den Messlauf vorhanden. P30/P31 bleiben On hold und unberührt. Tracker-Issue wird bei Start nach `docs/issues.md` angelegt.

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
eigener pi-One-Shot-Stufe), pinnen auf ein规定的其他 Modell (Katalog
`assistant.model`/Connections/custom models) übersteuert die Kette sichtbar.
(2) Ein **deterministischer Repo-Scan** ergänzt den festen Projektkontext um die
tatsächlich vorhandenen, zum Auftrag passenden Code-Stellen (Pfade, Symbole,
Kommandos, Skills); angebundene Wissensquellen (P74) werden nur gefragt, wenn
angebunden **und** gefragt. (3) Der **Nutzen ist belegt**: ein Messlauf nach
`messlauf`-Muster mit und ohne Scan entscheidet ehrlich per Go-Regel — ein
nicht belegter Scan bleibt aus.

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
- Messlauf (korpusbasiert, Arme mit/ohne Scan) mit Protokoll in `docs/messlauf/`
  und Go-Regel; Auswertung des bestehenden Feedback-JSONL.
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

Messlauf nach `messlauf`-Muster (Werkzeuge wie P84, Start ohne zusätzlichen
Freigabe-Hang weil Teil dieses Epics):

- Korpus: 10 eingefrorene, realistische Initial-Aufträge aus diesem Repo
  (gemischt: bugfix-artig, refactor-artig, quer-zu-modulen).
- Arme: `Scan aus` (P68-stand) vs. `Scan an` (Spur C), Engine in beiden Armen
  dasselbe konfigurierbare Modell; n ≥ 5 je Arm.
- Metriken (deterministisch aus dem Event-Strom der Folgesession):
  (a) Explorer-Tool-Calls (ls/grep/read-artig) bis zum ersten
  Inhaltsschreibens — je weniger, desto besser vorbereitet war der Prompt;
  (b) Akzeptanzrate der Vorschläge aus `prompt-optimizer-feedback.jsonl`;
  (c) Wandzeit bis zum ersten grünen gezielten Test.
- **Go-Regel:** Der Scan wird nur Default, wenn (a) oder (c) sich messbar
  verbessert und (b) nicht einbricht. Bleibt der Nutzen aus, bleibt der Scan
  als Option aus, und der Messlauf ist das ehrliche Ergebnis des Epics.

## 4. Aufgaben (Checkliste T90.m)

- [ ] **T90.1** ADR-0127 (Vertragsfelder `originIntent`/`focus`,
  Settings-Schlüssel, pi-One-Shot-Stufe), ADR-Index. Messlatte: Contracts-first.
- [ ] **T90.2** Contracts + Core: Felder, Migration/Recovery-Pfad (K7),
  Benennungspolitik inkl. Wort-Overlap-Heuristik; Unit-Tests rot-dann-grün.
- [ ] **T90.3** PWA: Ursprung/Fokus-Anzeige (Liste + Detail), Übergabe-Badge,
  Umbenennungsfluss; e2e-Spec `e2e/specs/session-naming.spec.ts`.
- [ ] **T90.4** Scroll-Defekt: Repro-Spec (rot), Bug-Datei nach `bug-report`,
  Fix (grün), mobiles Projekt, ohne Sprung; `Fixes #` im PR. K2 (Nachladelast).
- [ ] **T90.5** Settings-Store + Einstellungs-Abschnitt; Engine-Kette respektiert
  Pin mit sichtbarem Fallback; `enhanceFlavorFor` + pi-One-Shot; Unit-Tests mit
  Fake-Provider/Fake-Runner. K10 (sichtbarer Grund).
- [ ] **T90.6** `repoFacts`-Scan (nur reale Pfade, Budgets, Rahmung,
  Angebotsmodus für P74-Quellen); Tests: gefundene Pfade existieren, Budget hält,
  Injection-Rahmen steht, Quelle nicht angebunden ⇒ still. K5/K7.
- [ ] **T90.7** Messlauf: Korpus einfrieren, Arme, Metriken, Protokoll
  `docs/messlauf/`, Go-Regel anwenden; Feedback-JSONL-Auswertung als Skript.
- [ ] **T90.8** `docs/funktionsinventar.md`, `docs/einstellungen-empfehlungen.md`,
  Epic-Abschluss-Notiz; Menschen-Abnahmen (echtes lokales Modell, Scrollen auf dem
  Handy, Badges mit echten Augen) nach **P000** verschoben.

Reihenfolge: T90.1 → T90.2/T90.3 und T90.4 (unabhängig) → T90.5 → T90.6 →
T90.7 → T90.8.

## 5. Acceptance Criteria (AC-P90-k)

- **AC-P90-1:** `originIntent` ist nach dem Setzen unveränderlich (nur
  Menschen-Umbenennung ändert `focus`); ein Test belegt die Immutability und den
  Recovery-Pfad aus JSONL/Platte (K7).
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
- **AC-P90-6:** Der Messlauf läuft mit n ≥ 5 je Arm und dokumentiert die
  Go-Regel-Entscheidung (Protokoll in `docs/messlauf/`); „hilft“ oder „hilft
  nicht“ ist entschieden, nicht offengelassen.
- **AC-P90-7:** Die Einstellungs-Änderung ist persistent (Settings-Store) und in
  der Vorschau-Engine-Anzeige sichtbar; die Vorschau bleibt eine Vorschau —
  senden tut nur der Mensch.

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

## 7. Definition of Done

Alle T90.* und AC-P90-* mit Evidenz. Gezielte Tests (rot-dann-grün, beim Namen
genannt), Lint und Typecheck grün; lokale Gates und GitHub-Actions (`verify`) auf
dem Abschluss-PR grün; Vollsuite/Nightly gemäß `AGENTS.md` (kein Breitlauf ohne
ausdrücklichen Auftrag); rote CI allein wegen Umgebung wird benannt, nie als Pass
gezählt. Jede neue UI-Funktion mit Spec in `e2e/specs/`; Eintrag in
`docs/funktionsinventar.md`; ADR-0127 geschrieben und indexiert; Tracker-Issue mit
`Fixes #`-Bezug (`docs/issues.md`); K5/K7/K10 nachweislich erfüllt; kein TODO ohne
Epic-Bezug. Menschen-Abnahmen (echtes Modell beim Messlauf, Scrollen auf dem Handy,
Badges mit echten Augen) sind nach **P000** verschoben und werden nicht
vorweggenommen.
