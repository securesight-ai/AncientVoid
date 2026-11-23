# EPIC-P26 — Factory-Integration: Projekt anlegen, Lauf auslösen, beobachten, steuern

**Status:** abgeschlossen 2026-11-18 (Code + automatisierte Tests grün) — Menschen-Abnahme nach P000 verschoben · **Phase:** P26 · **Dauer:** 2–3 Agenten-Wochen · **Abhängigkeit:** fachlich keine offene — baut auf P19 (Loop-Contract und Connector, gebaut; manuelle Abnahme offen), P7 (Rückfragen/Freigaben) und P25 (Slash-Befund) auf; Präzedenz P13/P14/P17/P19 (läuft neben offenen Abnahmen). Factory-seitig: `securesight-factory` `main` ab `bd8228d` (CLI `factory` installiert); Gegenstück-Planentwurf factory-seitig: `docs/plaene/0057-aussen-schnittstelle-entwurf` (im separaten, nicht öffentlichen Factory-Repo) (E57, Branch `plan/0057-aussen-schnittstelle` — deren Gate derzeit rot auf unverändertem HEAD, Commit wartet).

## Befunde 2026-10-30 abends (Nachtrag zur Bestandsaufnahme)

- **Loop-Start verwirft den Auftrag:** Session `eb0f764a` (Loop securesight,
  Projekt AncientVoid) zeigte „0 von 0 Aufgaben", „Intake: intake", danach
  Stillstand — `spec.goal` geht in den beobachtenden Connector (Nutzerauftrag
  „AncientVoid-Rename" nie angekommen). Genau die Lücke, die T26.5 schließt:
  der Start-Flow legt den Treiber an, der `/factory` **mit Auftrag** ausführt.
- **Audit der 13 uncommitted Dateien auf `main`** (Nutzerauftrag 2026-10-30):
  `.claude/settings.json` + `.claude/skills/factory/SKILL.md` committet
  (Treiber-Grundlage); die 11 `.factory/`-Dateien eines abgebrochenen
  Onboarding-Tests verworfen (Intake nie ausführungsbereit, „PRD" war nur ein
  CONTRIBUTING-Import; über `factory init` jederzeit neu erzeugbar). Der
  offene Testauftrag (Projekt umbenennen) bleibt für T26.11 dokumentiert.

Auslöser: Wunsch von Jan vom 2026-10-30: „ … über ancientvoid (AncientVoid) manuell die
factory antriggern und das epic abarbeiten lassen … Anschließend erstelle ich ein
Testprojekt mit der factory über ancientvoid. … schreiben, dass wir dort alles sauber
integriert haben für die factory.“ Bezug: [EPIC-P19](EPIC-P19-loop-dark-factory.md),
[ADR-0038](../docs/adr/0038-loop-dark-factory.md), [docs/loops.md](../docs/loops.md).

## 1. Ziel

Am Handy und am PC lässt sich ein **Factory-Projekt von Anfang bis Ende** führen:
(1) ein Projekt aus einer PRD/Markdown-Quelle anlegen oder ein bestehendes
anbinden, (2) Betriebsmodus (a/b) und Provider wählen, (3) den Lauf **auslösen**,
(4) Fortschritt, Fehlerbelege und Rückfragen **beobachten und beantworten**,
(5) nach Hub-Neustart oder Verbindungsverlust nahtlos weitermachen — ohne Hermes;
Hermes bleibt ein optionaler Orchestrator.

Befund aus der Bestandsaufnahme (2026-10-30, belegt): Der Connector
`securesight-factory` **beobachtet nur** (`control()` lehnt jeden Befehl ab) und
verlangt `scripts/betrieb.py` im Projekt. Ein mit `factory init` angelegtes
**Zielprojekt hat dieses Skript nicht** (es enthält `.factory/`,
`.claude/settings.json`, `.claude/skills/factory/SKILL.md`). Heute würde der Hub
ein solches Projekt mit „kein securesight-harnez-Projekt (scripts/betrieb.py fehlt)“
ablehnen. P26 schließt diese Lücke.

## 2. Scope (In / Out)

**In:**
- **Schnittstellenvertrag** Factory → Hub (`docs/factory-schnittstelle.md`, versioniert,
  mit Fixtures aus echten Läufen): welche Dateien/Kommandos der Hub liest, mit
  `schema_version`-Prüfung (Unbekanntes ⇒ `loop.broken`, nie still).
- **Connector-Modus `project`** neben dem bestehenden Modus `repo` (Factory-Repo
  mit `betrieb.py`): Erkennung über `.factory/config.json`; Quellen
  `factory progress show` (JSON, `schema_version "1"`), `.factory/lauf-status.json`,
  `.factory/evidence/*fehler*.json` (Bootstrap- und Lauf-Ende-Fehlerbelege),
  `.factory/intake/state.json`. Modus `repo` bleibt unverändert (Regression).
- **Onboarding** (`LoopOnboarding`/`onboard()` für `securesight-factory`): Projektpfad
  (neu/bestehend), optional PRD-Pfad (`--from-prd`), Modus a|b, Provider
  anthropic|zai ⇒ `factory init …`; die Init-Checkliste (git, provider, trust,
  intake, next) wird als Ergebnis angezeigt, Fehler sichtbar.
- **Start-Flow**: aus einem Formular eine **Treiber-Session** (Claude-Adapter im
  Projektverzeichnis, erster Prompt `/factory`) und die verknüpfte **Beobachter-
  Session** (Loop) starten; Verknüpfung, Stop-Semantik, Recovery (K7).
- **Steuerung** mit fester Allowlist, nur Mensch, mit Audit-Event und
  Bestätigungsdialog bei Außenwirkung (Modus a merged automatisch).
- **Provider-/Harness-Wahl**: Provider (anthropic|zai) sofort; Harness
  (`claude`|`maki`) **fähigkeitsgesteuert** — sichtbar erst, wenn die installierte
  `factory`-CLI die Auswahl meldet, sonst ausgeblendet mit Grund.
- **PWA-Ansicht** für den Projektmodus (Fortschritt, Fehlerbelege, Intake-/Init-
  Checkliste, Rückfragen über die bestehende Freigaben-Ansicht).
- **Namensbereinigung** „securesight-harnez“ → „securesight-factory“ in Connector-
  Meldungen, `docs/loops.md`, Registry-Beschreibung, EPIC-P19; der Lesepfad für
  `.harnez/` bleibt als dokumentierter Fallback für Altprojekte.
- **Stand-in-Factory** (kleine `factory`-Attrappe) für E2E, **Messlauf** und
  **manuelle Abnahme** mit einem echten Testprojekt.

**Out:** Änderungen am Repo `securesight-factory` (Wünsche stehen unter 3.6 als
Schnittstellenwünsche, nicht hier umgesetzt); Hermes-Start oder -Steuerung (nur
Lesen wie in P19); aSPARK-Factory; maki als Hub-Adapter (P24, bereits vorhanden);
mehrere parallele Factory-Läufe je Projekt; ein Hub-eigener Loop-Treiber
(„Ralph im Hub“, bleibt Out wie in P19); Änderungen an Provider-Keys der Factory
(der Hub reicht nie Keys weiter).

## 3. Design-Details

### 3.1 Zwei Rollen, eine Fachsprache

- **Treiber** = eine normale Claude- oder maki-Session im Projektverzeichnis.
  Claude führt `/factory` aus; maki erhält den projektlokalen Skill über die
  bestehende Hub-Skill-Kette als Prompt (`args.skill`). Die frühere Festlegung
  auf Claude ist durch [ADR-0048](../docs/adr/0048-factory-treiberwahl-und-projektpfad.md)
  präzisiert (BUG-0087/0088, 2026-11-02). Die Wahl des Treibers und seines Modells
  ist unabhängig vom Factory-Worker-Routing. Freigaben und Rückfragen des Treibers
  laufen über die bestehende Freigaben-Ansicht (P7).
- **Beobachter** = Loop-Session `securesight-factory` im Modus `project`. Sie liest
  Dateien und `factory progress show`, **schreibt nichts ins Projekt** (der P19-Test
  „Verzeichnis vorher/nachher“ gilt weiter).
- Begriff: „Betriebsart“ (Hub-Feld) zeigt den Factory-Modus **gelesen**, nie angenommen.

### 3.2 Connector-Modi

| Modus | Erkennung | Quellen | Bestand |
|---|---|---|---|
| `repo` | `scripts/betrieb.py` vorhanden | `betrieb.py supervisor-status --json`, `.harness/notify`, `.harness/transcript`, `.factory/progress.json` | unverändert (9 Tests bleiben grün) |
| `project` | `.factory/config.json` vorhanden, kein `betrieb.py` | `factory progress show`, `.factory/lauf-status.json`, Fehlerbelege, Intake-Zustand | neu |

Ein Verzeichnis mit beidem ist `repo` (Factory-Repo selbst). Jede Quelle fällt
einzeln aus (⇒ `loop.broken` mit Grund), die übrigen laufen weiter (P19-Muster).

### 3.3 Start-Flow und Verknüpfung (ADR-0043 zu entscheiden)

Empfehlung **A** — Core-Orchestrierung: ein `POST /api/factory/start` (Policy
„Mensch ja, Agent nein“) legt zwei verknüpfte Sessions an (Treiber + Beobachter),
speichert die Verknüpfung im JSONL (K7) und startet den Treiber mit `/factory`.
*Alternative B:* der Connector startet den Treiber selbst über `ctx.spawnWorker`
(bricht die Kapselung „`packages/loops/*` importiert nur `@ancientvoid/contracts`“).
*Alternative C:* der Nutzer startet beide Sessions von Hand (kein neuer Code,
aber kein „sauber integriert“). Der ADR entscheidet; A ist vorgemerkt, weil die
Kapselung (AC-P19-6) erhalten bleibt.
Stop-Semantik: „Lauf beenden“ beendet **beide** Sessions; endet nur der Treiber,
zeigt der Beobachter „Treiber beendet“ (nicht „fertig“).

### 3.4 Steuerung — feste Allowlist (nur Mensch)

Erlaubt (Entwurf, im ADR zu bestätigen): Betriebsart wechseln (a/b, mit
Bestätigung; im Modus `repo` über `betrieb.py mode`, im Modus `project` über
`factory init --reconfigure --modus …`), Fortsetzen (neue Eingabe an den Treiber
`/factory`), `notify-ack` (nur Modus `repo`), Lauf beenden. Alles andere wird mit
Grund abgelehnt. Jeder Befehl erzeugt ein Audit-Event; ein Agent-Token kann keinen
davon auslösen (AC-P26-5). Die Befehle rufen nur die dokumentierten Factory-
Kommandos auf (kein Schreiben in Projektdateien durch den Hub).

### 3.5 Onboarding

Eingaben: Projektpfad, optional PRD-Pfad (Datei oder Ordner), Modus, Provider.
Aufruf: `factory init --root <pfad> [--from-prd <pfad>] --modus a|b --provider anthropic|zai`.
Das Ergebnis (JSON) enthält die Checkliste `git/provider/trust/intake/next`;
„bereit“ erscheint **nur**, wenn die Factory es meldet (kein `trust ✘`). Bei
`ready`-Fehlen zeigt die Oberfläche die konkrete Zeile und den Hinweis der
Factory. Der Hub setzt kein Trust und keine Berechtigungen selbst.

### 3.6 Schnittstellenwünsche an `securesight-factory` (nicht in P26 umgesetzt)

1. **Fähigkeitsabfrage** `factory capabilities --json` (Harnesses, Provider,
   Version) — bis dahin bleibt die Harness-Wahl ausgeblendet.
2. **`schema_version` in `.factory/lauf-status.json`** und den Fehlerbelegen
   (`progress show` hat sie bereits).
3. Ein stabiles, dokumentiertes **Exit-Code-/JSON-Vertrag** für `factory init`
   und `factory progress show` (liegt faktisch vor, ist aber nirgends als Vertrag
   festgehalten).
Diese Punkte werden als Folgeanforderungen an die Factory gemeldet; P26 läuft ohne
sie (Fähigkeiten werden ausgeblendet, fehlende Felder als „unbekannt“ gezeigt).

### 3.7 Sicherheit, Secrets, Injection

- Provider-Keys liegen bei der Factory; der Hub liest, speichert oder loggt sie nie
  (Leak-Test über Events, API-Antworten, Logs).
- Fortschrittstexte, Berichte und Fehlerbelege sind **Daten**: kein Markdown-
  Rendering mit Aktion, keine Interpretation als Befehl (PRD §8.5).
- `factory`-Aufrufe über `execFile` mit fester Argumentliste, Zeitlimit,
  Ausgabegrenze; Pfade werden gegen die Projektauswahl geprüft (kein `..`).

## 4. Aufgaben

- [x] **T26.1 — Schnittstellenvertrag und Fixtures.** `docs/factory-schnittstelle.md`;
  Fixtures aus einem echten `factory init` und einem echten Lauf mit Fortschritt
  (anonymisiert, secret-gescannt, nie Roh-Logs). K7, K9.
- [x] **T26.2 — ADR-0043.** Treiber/Beobachter, Start-Flow (A/B/C), Allowlist,
  Modi `repo|project`. Contract-Änderungen nur additiv.
- [x] **T26.3 — Connector-Modus `project`.** Erkennung, Quellen, `schema_version`-
  Prüfung, Ausfall je Quelle ⇒ `loop.broken`; Regression Modus `repo`. K2, K9.
- [x] **T26.4 — Onboarding.** `onboard()` für `securesight-factory`, Route und
  Formular „Factory-Projekt anlegen“, Checkliste als Ergebnis, Fehler sichtbar.
- [x] **T26.5 — Start-Flow.** `POST /api/factory/start` (Policy), verknüpfte Sessions,
  Stop-Semantik, Recovery aus dem JSONL (K7).
  *Teilumsetzung 2026-10-30 abends:* Route, Policy `factory.start` (nur Menschen),
  Treiber mit `/factory <Auftrag>`-Prompt, Beobachter mit `options.driver`
  (Loop-Snapshot, K7), `factory.linkage`-Ereignis auf beiden Sessions, Rollback
  des Treibers bei scheiterndem Beobachter; PWA-Dialog startet darüber für
  securesight „bestehend“. Integrationstests + E2E `factory.spec.ts` grün.
  *Nachgezogen 2026-11-09:* `end_run` und Treiber-Ende-Anzeige (T26.6/T26.8), K7-Neustart mitten im Lauf (E2E `factory-lauf.spec.ts`, Messlauf T26.10).
- [x] **T26.6 — Steuerung.** Allowlist, Bestätigungsdialog, Audit-Event,
  Agent-Token-Ablehnung (Policy-Test).
- [x] **T26.7 — Provider-/Harness-Wahl.** Provider sofort; Harness nur bei gemeldeter
  Fähigkeit, sonst ausgeblendet mit Grund.
- [x] **T26.8 — PWA-Ansicht Projektmodus.** Fortschritt, Fehlerbelege, Init-/Intake-
  Checkliste, Verknüpfungsstatus; Zustand nur aus `loop.*`-Events gefaltet.
- [x] **T26.9 — Namensbereinigung und Docs.** Meldungen, `docs/loops.md`,
  Registry-Text, EPIC-P19, README-Matrix; Prüfskript mit Allowlist für den
  dokumentierten `.harnez/`-Fallback.
- [x] **T26.10 — Stand-in-Factory, E2E, Messlauf.** `factory`-Attrappe, Specs in
  `e2e/specs/`, Messlauf (K2, K7, K9), `docs/messlauf/…`.
- [ ] **T26.11 — Manuelle Abnahme mit Testprojekt.** Ablauf am Handy/PC (siehe → nach P000 verschoben
  AC-P26-10); bleibt `not_run`, bis Jan bestätigt.

## 5. Acceptance Criteria

- **AC-P26-1 (Onboarding):** Über das Formular entsteht aus einer PRD ein Projekt mit
  `.factory/` und `.claude/skills/factory/SKILL.md`; die Init-Checkliste ist sichtbar;
  „bereit“ erscheint nur bei gemeldetem `ready`. Ein fehlschlagendes `factory init`
  zeigt Grund und Zeile, nie ein stilles Scheitern. Beleg: E2E mit Stand-in + Integrationstest.
- **AC-P26-2 (Start):** „Lauf starten“ legt eine Treiber-Session im Projektverzeichnis
  mit erstem Prompt `/factory` und die verknüpfte Beobachter-Session an; eine Änderung
  an `.factory/progress.json` erscheint im Panel in ≤ 15 s (Poll-Grenze P19). Beleg: E2E.
- **AC-P26-3 (Projekte ohne `betrieb.py`):** Ein Projekt ohne `scripts/betrieb.py`, aber
  mit `.factory/config.json`, wird akzeptiert; der Modus `repo` verhält sich exakt wie
  vorher (bestehende Connector-Tests und `layout.spec.ts` grün).
- **AC-P26-4 (K9, fail loud):** Unbekannte `schema_version`, kaputtes JSON oder fehlendes
  `factory`-Binary ergibt `loop.broken` mit Grund in < 60 s; andere Sessions laufen
  ungestört.
- **AC-P26-5 (Außenwirkung):** Ein Agent-Token kann weder onboarden noch starten noch
  steuern noch beenden (Policy-Test); jeder Befehl erzeugt ein Audit-Event; Betriebsart
  `a` verlangt Bestätigung.
- **AC-P26-6 (K7):** Hub-Neustart mitten im Lauf: beide Sessions und die Verknüpfung sind
  identisch wiederhergestellt (< 3 s), keine doppelten und keine fehlenden Ereignisse.
- **AC-P26-7 (Secrets):** Kein Provider-Key und kein Trust-/Token-Wert in Events,
  API-Antworten oder Logs (Leak-Test); der Hub schreibt nichts ins Projekt (Verzeichnis
  vorher/nachher gleich, außer durch den Treiber und `factory init`).
- **AC-P26-8 (Namen):** Kein „harnez“ in Code, Meldungen und aktueller Doku außer im
  dokumentierten `.harnez/`-Lesefallback und in historischen Retros (Prüfskript mit
  Allowlist, im Gate).
- **AC-P26-9 (Fähigkeiten):** Die Harness-Auswahl ist nur sichtbar, wenn die installierte
  `factory` sie meldet; sonst ausgeblendet mit Begründung. Kein Rateversuch aus der Version.
- **AC-P26-10 (manuelle Abnahme, Jan):** Am Handy/PC: Projekt aus PRD anlegen → Lauf
  starten → Fortschritt sehen → eine Rückfrage beantworten → Ergebnis ansehen →
  Hub neu starten und weitermachen. Status `not_run`, bis Jan bestätigt; nie als `pass`
  gezählt.

## 6. Premortem

1. **Die Factory ändert ihre Dateien/CLI** (sie ist in Bewegung, u. a. Iteration 0056).
   *Mitigation:* `schema_version` wird geprüft, Unbekanntes wird `loop.broken`, Fixtures
   stammen aus echten Läufen, Schnittstellenvertrag versioniert (T26.1, AC-P26-4).
2. **Der Treiber hängt in Berechtigungen oder Workspace-Trust** (reale Historie der
   Factory: Iterationen 0029/0030). *Mitigation:* der Hub setzt weder Trust noch
   Rechte; er zeigt die Init-Checkliste der Factory und startet erst bei `ready`;
   der Messlauf (T26.10/T26.11) deckt es auf, ein hängender Treiber wird als
   „wartet ohne Fortschritt“ sichtbar, nicht als „läuft“.
3. **Zwei Sessions laufen auseinander** (Treiber beendet, Beobachter zeigt „läuft“).
   *Mitigation:* Verknüpfung im JSONL, Statusabzeichen „Treiber beendet“, Stop beendet
   beide, Recovery-Test AC-P26-6.
4. **Außenwirkung im Modus a** (automatischer Merge). *Mitigation:* Policy „Mensch ja,
   Agent nein“, Bestätigungsdialog, Audit-Event, keine „Immer erlauben“-Regel.
5. **Prompt-Injection über Fortschritt, Berichte, Fehlerbelege.** *Mitigation:* alles
   Daten, nie Befehl; Tool-Input roh anzeigen (PRD §8.5).
6. **Begriffsverwirrung „Modus“** (Adapter-Modus, Factory a/b, Loop-Betriebsart).
   *Mitigation:* Feld „Betriebsart“, Wert providereigen und gelesen, nie angenommen.
7. **„Fertig“ ohne belegten Lauf** (Selbsttäuschung wie bei P19, 3 🟢 / 5 🟡).
   *Mitigation:* AC-P26-10 bleibt `not_run` bis zur echten Abnahme; der Messlauf
   unterscheidet Stand-in und echte Factory.

## 7. Definition of Done

Alle Aufgaben abgehakt, AC-P26-1…9 belegt (AC-P26-10 als manuelle Abnahme von Jan
bestätigt oder ausdrücklich `not_run`), `npm run gate` grün, Pipeline-Job `e2e` grün,
jede neue UI-Funktion und jeder Ablauf mit Spec in `e2e/specs/`, ADR-0043 gemergt,
`docs/factory-schnittstelle.md` und `docs/loops.md` aktuell, `epics/README.md` und die
Adapter-/Loop-Matrix aktualisiert. Erreichbarkeit: der Loop `securesight-factory` im
Modus `project` ist in `hub.config.json` registriert und im Start-Formular wählbar.
Offene Reste (z. B. Fähigkeitsabfrage der Factory, Live-Abnahme am Handy) bleiben
sichtbar dokumentiert, kein „done“ über ungesehene Läufe.

## 8. Retro (2026-11-09)

| AC | Status | Beleg |
|---|---|---|
| AC-P26-1 Onboarding | 🟢 | E2E `factory-lauf.spec.ts` (Fehlergrund, „nicht bereit“ ohne Lauf, bereit); `onboard()`-Tests; additives `ready` im Contract (ADR-0043 Nachtrag) |
| AC-P26-2 Start | 🟢 | `factory.integration.test.ts`, E2E; Panel-Latenz Median 788 ms bei Takt 500 ms (`docs/messlauf/2026-11-09-p26-factory.md`) — Standardtakt 15 s nicht gemessen |
| AC-P26-3 Modus project | 🟢 | `securesight-project.test.ts`, Regression `securesight.test.ts` (Modus repo) |
| AC-P26-4 K9 | 🟢 | E2E „Störung ist laut“ (kaputtes JSON, Schema 9), Messlauf 514 ms Median; fehlendes Binary im Connector-Test |
| AC-P26-5 Außenwirkung | 🟢 | Integrationstests: Agent-Token 403 (`factory.control`), Allowlist-Ablehnung, Audit auf beiden Sessions, Betriebsart a nur mit Bestätigung; E2E Dialog |
| AC-P26-6 K7 | 🟢 | E2E „Hub-Crash mitten im Lauf“; Messlauf 8× SIGKILL, 824 ms Median, Ids/Verknüpfung/Seqs unverändert |
| AC-P26-7 Secrets | 🟢 | Integrationstest „Secrets und Schreibgrenze“ (kein Schlüssel in Events/API, Projektbaum byte-gleich) |
| AC-P26-8 Namen | 🟢 | `npm run check:names` im Gate (Allowlist: `.harnez/`-Fallback, `harnez-exec-*`, Retros/ADRs) |
| AC-P26-9 Fähigkeiten | 🟢 | Harness-Wahl ausgeblendet mit Grund (T26.7); `factory capabilities` existiert nicht — kein Rateversuch |
| AC-P26-10 manuelle Abnahme | ⚪ `not_run` | braucht die echte Factory und Jan; Ablauf wie im AC beschrieben |

**Ehrliche Grenzen:** Alle Läufe nutzen die Attrappe `e2e/support/bin/factory`; die echte Factory (Trust-/Berechtigungs-Hänger, echte Fehlerbelege) ist ungeprüft. Der Messlauf lief mit Takt 500 ms und Fremdlast.
**Offen:** T26.11 (Abnahme, in P35 T35.16 gebündelt zu führen), Fähigkeitsabfrage der Factory (Wunsch 1–3 in §3.6).
