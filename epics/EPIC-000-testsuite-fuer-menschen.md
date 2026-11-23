# EPIC-P000 — Testsuite für Menschen (Abnahmen durch Nutzer und Contributor)

**Status:** permanent — Geräte-/Live-Abnahmen offen (Nachfolger des P35-Endabnahme-Blocks) · **Phase:** P000 · **Dauer:** laufend, öffnet nie · **Abhängigkeit:** keine

---

## 1. Ziel

Sammelstelle für alles, was ein Mensch abnehmen oder verifizieren muss —
die „Testsuite für den Nutzer". Fachepics schließen sauber, sobald Code und
automatisierte Tests fertig sind (das ist die messbare Messlatte); alles, was
echte Geräte, echte Stimmen, echte Remotes oder die Nutzerfreigabe braucht,
wandert hierher als prüfbarer Eintrag mit Herkunftsbezug. Damit bleibt der
Epics-Counter ehrlich (offen = noch Arbeit am Produkt), und die
Menschen-Arbeit liegt gesammelt an einem Ort, statt in sechzig Epics zu
vergammeln. Dieses Epic übernimmt den Endabnahme-Block aus EPIC-P35 §8
(2026-11-18) und wächst weiter.

## 2. Scope

**Hierher gehört:** (a) Epics schließen und haben als einzigen Rest eine
Menschen-Abnahme → der Einzug wird hier als Eintrag geführt; (b) Bugs im
Status `fixed`, deren Verifikation einen Menschen braucht (Gerät, frischer
Clone, echtes Auge); (c) Entscheidungstore mit echtem Testtermin.
**Nicht hierher:** Agentenarbeit (bleibt im Ursprungsepic, das bleibt dann
offen), reine Go/No-Go-Entscheidungen ohne Testanteil (P30/P31 und die
Entscheidungstore bleiben offen), Doku-Pflege.

## 3. Design-Details

* **Eintragsformat:** `- [ ] **T000.n — Titel.** (Herkunft: …) Vorgehen.
  Messlatte. Beleg: Messlauf/Checklisten-Zeile mit Datum.`
* **Führen:** abgehakt wird **nur hier**; das Ursprungsepic trägt nach dem
  Umzug nur noch den Delegationsvermerk in der Checkboxzeile
  („nach P000 verschoben") — ein Eintrag, ein Ort zum Abhaken.
* **Ausführung:** Externe Contributor und Nutzer führen passende Einträge selbst
  aus — bei einschlägigen Issues oder nach Vereinbarung; interne Abnahmetermine
  finden auf Zuruf oder nach Agendapunkt statt;
  [`docs/p12-abnahme-checkliste.md`](../docs/p12-abnahme-checkliste.md)
  bleibt das Ausführungsprotokoll für die Legacy-P12-Zellen; neue Belege als
  `docs/messlauf/`-Dateien.
* **Statuszeile:** dieses Epic zeigt im Explorer den H-Punkt (blocked =
  „braucht Menschen") und bleibt im Counter offen, solange es Einträge gibt.

## 4. Aufgaben (Inventar)

### Übernommen aus EPIC-P35 §8 (Endabnahme-Block)

- [ ] **T000.1 — Geräte-Abnahme Handy über WAN.** (Herkunft: T12.1/T12.4/T12.7,
  T16.5, AC-P0-4, AC-P1-5, AC-P1.5-1, P1.6-DoD) Echtes Pairing über
  Tailnet/WAN, PC↔Handy↔PC-Kontinuität, Session vom Handy starten und
  Kontingent sehen, Offline/Flugmodus mit K10-Zeitstempel, Push im
  Hintergrund/Sperrbildschirm, 200 % Text, TalkBack/VoiceOver, Anhang aus
  dem Teilen-Menü, zweiter Origin (Fleet/Handoff/Entwürfe), Fairphone
  (gesperrt, Flugmodus), Gerätetokens einspielen und rotieren. K1/K7/K10.
- [ ] **T000.2 — Sprach- und K6-Gerätemessung.** (Herkunft: T12.4/AI-P10-1,
  T12.10, AC-P1.5-8, AC-P3-3, AC-P10-2) ≥ 20 Fachbegriff-Diktate je
  Zielgerät mit echter Stimme: Headset, Störgeräusch, Permission-Deny,
  Coldstart, WAN. Streaming-STT mit endpointing/VAD auf Zielhosts
  installieren/konfigurieren und je Gerät 100 warme Kurzbefehle messen
  (erstes Teiltranskript p95 ≤ 500 ms ab Sprachbeginn); `stt.streaming`
  danach erst standardmäßig an. K6.
- [ ] **T000.3 — Provider-Handläufe und Swarm.** (Herkunft: T12.4/AI-P5-1,
  T12.8, AC-P1-1-Rest, T3.1, T3.3-Rest, T7.5-Rest) Handläufe Claude Code,
  Codex, Copilot über die PWA inkl. ±10-%-Kostenabgleich, danach deren
  Resume-Zellen `verified`; Swarm-Adapter live gegen das Cockpit (braucht
  Admin-Credential/`swarm_cockpit`-Freischaltung und eine echte
  Lauf-JSONL); aider live mit dem lokalen Modell (`--yes-always` braucht
  ausdrückliche Nutzerfreigabe); Live-Probe des OpenAI-kompatiblen
  Beispiel-Adapters gegen die echte llama.cpp-Instanz. K1/K2.
- [ ] **T000.4 — Externe Systeme und WSL.** (Herkunft: T4.3, T4.4, T4.5,
  AC-P4-4, AI-P6-1/AC-P6-5-WSL-Teil) Hermes-Skill `agent-hub` dünn gegen
  echten Hermes; Gengar-Status-Board-Anbindung mit realen Zugangsdaten;
  WSL-Host in die Flotte aufnehmen und Hub-in-WSL2 vom Handy aus abnehmen.
  Der Host ist noch nicht bestimmt — **bmax ist ausdrücklich kein
  Kandidat** (Trading-Maschine, nicht als Host eingetragen; Nutzentscheid
  2026-11-07). gpubox muss dafür wieder erreichbar sein (siehe EPIC-P59).
- [ ] **T000.5 — Release-Entscheidungen.** (Herkunft: T4.8, T4.11; Lizenz ist
  erledigt — PolyForm Noncommercial 1.0.0, `LICENSE` committet 2026-11-09)
  v0.1-Tag + Changelog + Fixtures-Hygiene-Abschluss (der Repo-weite
  Secret-Scan steht seit MR !319 als Gate). Öffentliche, schwer rückgängig
  zu machende Aktionen nur mit expliziter Bestätigung.
- [ ] **T000.6 — Betriebs-Abnahmen.** (Herkunft: T12.2, T12.3, T12.5, T12.12,
  P14-Rest) 24-h-Dauerlauf mit ≥ 20 Sessions inkl. Netz-/Hub-/Modell-Ausfall
  (bestätigt nebenbei den FileTailer-Fix aus EPIC-P4.5 §8); K2/K8 unter
  echter Sprachlast; Restore-Latenz/ENOSPC/Retention-Löschlauf; Update &
  Rollback der Produktivinstanz; Desktop-Leck-Messung 0/50 am echten
  Hyprland-Desktop; produktiver `hubctl worktrees prune --apply` (löscht
  Daten — Entscheidung Jan). K2/K7/K8/K9/K10.
- [ ] **T000.7 — Abnahme der gebauten UI-Flows.** (Herkunft: P19, P22, P24,
  P26 T26.11/AC-P26-10, T25.6, AC-P34-13, AC-P35-7; plus P43 AI-P43-5:
  echtes Tablet, zweiter Bildschirm, TalkBack/Orca) Loop-Abnahme mit echtem
  Repo/Token, wartender Frage am Handy und K1 gesamt;
  Session-Entdeckung/Übernahme live am Handy; pi/omp/maki Live-Abnahme;
  Slash-Command-CLI-Listen live verifizieren (`capabilities().commands`);
  Arbeitsfläche/Eigene Fenster am Desktop mit Jan abnehmen (**AC-P34-13 +
  AC-P35-7 gemeinsam in einem Termin**, Präzedenz P1.5/P1.6).
- [ ] **T000.8 — Abschluss.** Abnahme-Checkliste vollständig, jede
  Herkunfts-AK am Ursprungsepic als `erfüllt via P000` vermerkt (oder mit
  dokumentierter Nutzentscheidung ⚪), K1–K10-Matrix belegt, Retro am
  Epic-File.

### Übernommene Bug-Verifikationen (Mensenaugen nötig)

- [ ] **T000.9 — BUG-0153 verifizieren.** Fix auf `main`; Verifikation braucht
  zwei frische Clones mit Standard-Wizard und leerer `projectRoots` —
  erste Session muss ohne Projektwurzel startbar sein, Tutorial-Schritt
  vorhanden. Beleg: Messlauf-Zeile mit Datum.
- [ ] **T000.10 — BUG-0187 verifizieren.** Fix auf `main`; Diff-Review-,
  Dateien- und Arbeitsort-Rahmen im hellen Thema prüfen — keine fremden
  Fallback-Farben mehr, alles bei leerem und gefülltem Zustand. Am Gerät
  und am Desktop. Beleg: Screenshot oder Checklisten-Zeile mit Datum.

### Einzelne Live-Abnahmen (nachträglich eingetragen, 2026-11-18)

- [ ] **T000.11 — Scratch-Repo-Abnahme beide Varianten.** (Herkunft: EPIC-P38
  T38.6) Runbook `docs/workplace-runbook.md` §3 mit echtem Harness
  durchlaufen: eigener Worktree und Projekt direkt, Sandbox getrennt.
- [ ] **T000.12 — Live-Lauf mit echtem Hermes-Koordinator.** (Herkunft:
  EPIC-P40, P39-Endabnahme) Orchestrierung live am Gerät.
- [ ] **T000.13 — Übersicht Sessions/Projekte/Hosts am echten Gerät.**
  (Herkunft: EPIC-P47)
- [ ] **T000.14 — Repo-Graph und Popout am echten Gerät.** (Herkunft:
  EPIC-P48, Popout-Rest aus EPIC-P46 T46.8)
- [ ] **T000.15 — Knowledge Vault Notizen am echten Gerät.** (Herkunft:
  EPIC-P49)
- [ ] **T000.16 — Vault-Erreichbarkeit/Tastatur am echten Gerät.**
  (Herkunft: EPIC-P51)
- [ ] **T000.17 — Main-Sync-Abnahme am echten Remote.** (Herkunft: EPIC-P67
  T67.10, Nutzeraufgabe) Veralteter Haupt-Checkout, neue Session startet
  frisch; `ask`-Ablauf am Handy; Konfliktfall echt provoziert — Schritte im
  Epic-Abschluss-Block.

### Übernommen aus dem Epics-Status-Sync (2026-11-21)

- [ ] **T000.18 — Roll-out-Verifikation Flotte (P18/P20/P21).** (Herkunft:
  EPIC-P18/P20/P21, DoD „Hub neu gestartet" + AI-P21-3) Hubs aller
  Flotten-Hosts auf demselben `main`-Stand (`/api/health` je Host), gpubox
  einschließen; Desktop-Kürzel einmal live in Chromium und Firefox prüfen.
- [ ] **T000.19 — GitLab-Job-Trace-Lesbarkeit.** (Herkunft: EPIC-P37 T37.6)
  Wenn das Runner-Kontingent wieder läuft: Trace-Lesbarkeit eines echten
  Pipeline-Jobs gegen das Testprojekt prüfen (war als SKIP berichtet, nie als
  Pass).
- [ ] **T000.20 — Geräteteile Projekt-Explorer.** (Herkunft: EPIC-P46
  T46.1/T46.9) Pixel-/Geräte-Spike Viewer und Geräte-K2/K8 am echten Gerät.
- [ ] **T000.21 — Galaxie-Geräteabnahme.** (Herkunft: EPIC-P52 T52.7)
  Repo-Galaxie am echten Handy (AC-P52-4-Anteil); p95-Nachtrag bleibt als
  T52.8 im Epic.
- [ ] **T000.22 — Statistiken-Acceptance an echten Daten.** (Herkunft:
  EPIC-P56 T56.6, EPIC-P66 Abschlussnotiz) Statistiken-Seite und
  Metrik-Konsolidierung mit dem Nutzer an echten Daten abnehmen.
- [ ] **T000.23 — KI-Server-Metriken live gegen echtes llama.cpp.**
  (Herkunft: EPIC-P59) gpubox ist erreichbar gemacht: Karten zeigen echte
  Proben, Ausfall einer Quelle bleibt sichtbar (K10), Fail-loud-Pfad belegt.
- [ ] **T000.24 — Guide-Videos aufnehmen und veröffentlichen.** (Herkunft:
  EPIC-P62 T62.5) Nach Runbook `docs/demo-media.md`: ≥ 8 Clips aufnehmen,
  veröffentlichen, Playlist anlegen, Links im Repo registrieren;
  Domain-Anbindung `void.securesight.ai` (ADR-0082, github.io-Fallback zählt).
- [ ] **T000.25 — Status-Sounds am Gerät.** (Herkunft: EPIC-P65 T65.6)
  PC-Hintergrund-Tab, Handy-Bildschirm-aus, offline (Flugmodus im lokalen
  Netz); Klangbild-Nachweis über die Varianten-Auswahl.
- [ ] **T000.26 — Prompt-Enhance live am echten llama.cpp.** (Herkunft:
  EPIC-P68 T68.8) Einmal frei, einmal ausgelastet verbessern; Engine/Grund
  und Projektbezug prüfen; vorhandenen Skill lesen, Vorschlag prüfen,
  bewusst speichern.
- [ ] **T000.27 — Entscheidung ADR-0034 (P15).** Go/No-Go: Hub-Sessions als
  Hintergrund-Sessions (`claude --bg`/`attach`) für echten Live-Sync, ersetzt
  `claude -p` pro Zug. Der Entwurf ist synchron; ohne Entscheid bleibt P15
  auf dieser Entscheidung sitzen (Herkunft: T15.4).
- [ ] **T000.28 — Skill-Kur: Automation live und Pilot-Nachlauf.** (Herkunft:
  EPIC-P72 DoD) Am laufenden Hub die tägliche Automation
  `npm run skills:curate` einrichten und einen Lauf `succeeded` im Report
  nachweisen; beim nächsten Kur-Lauf die Pilotkosten head-n/sort vor/nach
  über `turn_metrics` messen. Der Erstlauf-Report
  (`docs/2026-11-21_skill-curation-erstlauf.md`) ist die Ausgangsmessung.
- [ ] **T000.29 — K6-Messlauf mit `en`.** (Herkunft: EPIC-P61 T61.9)
  Sprachwechsel-Messlatze (K6): Lastlauf `npm run loadtest` gegen einen
  Hub mit eingestellter Sprache `en` auf gpubox; Durchsatz / p95 wie in
  EPIC-P61 §3.1 festgelegt. Gerät war offline; Code und Tests sind grün.

### Übernommen aus EPIC-P75 (2026-11-22)

- [ ] **T000.30 — Sprachausgabe am Gerät hören.** (Herkunft: EPIC-P75 T75.8)
  Echte Stimme am Handy-Lautsprecher und am PC: Assistant-Antwort und offene
  Frage vorlesen, Voxtral-Langtext-Fühlprobe (Synthesezeit gegen das Timeout),
  Hörprobe direkt nach dem Settings-Eintrag, Verhalten bei Doppelklicks
  (Serialisierung/429) fühlen. Messlatten: K2 (kein Lag beim Auslösen), K5
  bleibt. Beleg: Checklisten-Zeile mit Datum.

### Übernommen aus EPIC-P54 (2026-11-22)

- [ ] **T000.31 — Ralph-hub mit echtem LLM grinden.** (Herkunft: EPIC-P54 T54.6)
  Loop `ralph-hub` am Produktiv-Hub mit einer echten Agenten-CLI
  (`claude -p {prompt}`, `codex exec {prompt}`, `pi {prompt}`, …) über
  mehrere Turns: Turn-Budget und Prompt-Regeln fühlen, State-Datei und
  Menschen-Gate `wartend` prüfen, Branch-Disziplin (`ralph/<target>`) und
  dass Events kompakt bleiben (K5). Stand-in-Rauch (T54.5) zählt nicht als
  Abnahme. Beleg: Checklisten-Zeile mit Datum.

### Übernommen aus BUG-0167 (2026-11-23)

- [ ] **T000.32 — fastify entpinnt am macOS-Host nachweisen (BUG-0167).**
  (Herkunft: bugs/bug-0167-fastify-update-macht-zughistorie-flaky.md)
  Auf gpubox den Repeat-Lauf `npx playwright test e2e/specs/progress.spec.ts
  -g Zughistorie --repeat-each=30` gegen den entpinnten Stand (fastify
  5.12.8+) fahren — grün heißt Pin bleibt weg, rot heißt Playwright-Trace
  (`--trace on`) anlegen und BUG-0167 wieder öffnen. Beleg: Laufzeile mit
  Datum und fastify-Version.

### Übernommen aus EPIC-P81 (2026-11-23)

- [ ] **T000.33 — Host-Monitoring freischalten und am Handy abnehmen.**
  (Herkunft: EPIC-P81-host-monitoring-strom.md T81.13)
  omarchy: `scripts/host-monitoring-setup.sh` mit `modules drivetemp nct6775` und
  `rapl <benutzer>`, danach Neustart; evox2: `modules nct6775 it87`. Prüfen: CPU-Watt
  auf omarchy ist eine Zahl statt „keine Berechtigung“, alle vier Hosts stehen unter
  Statistik → Hosts, Kurven füllen sich. Beleg: Checklisten-Zeile mit Datum.

## 5. Acceptance Criteria

* **AC-P000-1:** Jedes migrierte Epic, dessen einziger Rest eine
  Menschen-Abnahme war, steht im Counter abgeschlossen (delegierte
  Checkboxen statt offener) — der Counter zeigt nur noch echte Produktarbeit
  und die Entscheidungstore.
* **AC-P000-2:** Jeder Eintrag hat Herkunft und messbares Kriterium; kein
  Eintrag ohne Vorgehensbezug (Checkliste, Runbook oder Messlatte).
* **AC-P000-3:** Ein Abnahmetermin gilt als erbracht, wenn alle Einträge des
  Termins belegt sind oder sichtbar als „nicht geschafft" zurückliegen —
  kein stiller Rückfall.

## 6. Premortem (was schiefläuft, wenn das hier scheitert)

1. **Friedhofseffekt:** Der Sammelordner wächst, niemand räumt ihn, und nach
   sechs Monaten ist er das, was die offenen Checkboxen vorher waren.
   Gegenmittel: Aufnahme nur für echte Menschenarbeit (Aufnahmeregel §2),
   Termin auf Zuruf, Inventar bleibt kurz und ausführbar.
2. **Doppelbuchung:** Eintrag wird hier UND im Ursprungsepic geführt und
   driftet. Gegenmittel: abhaken nur hier (Delegationsprinzip §3);
   `epic-status` zählt Delegationszeilen nicht als offen.
3. **Überdehnung:** Agentenarbeit wird als „Menschenarbeit“ umgelagert und
   blockiert die Produktarbeit — oder Entscheidungen gehen hier ein und
   fehlen im Entscheidungsprozess.
   Gegenmittel: Aufnahmeregelung §2; Gegenprobe ist der epics-Counter —
   er muss nach Migration nur noch echte Arbeit und Tore zeigen.
4. **Referenzrot:** Umbenennung/Umnummerierung von Herkunfts-Tasks lässt die
   Bezüge verwaisen. Gegenmittel: voller Dateiname als Herkunft, ID im Klartext.

## 7. Definition of Done (permanent)

Dieses Epic hat keinen globalen Abschluss — es ist leer, wenn der letzte
Eintrag mit Beleg (Messlauf, Checklisten-Zeile mit Datum, Testname) erledigt
oder per dokumentierter Nutzentscheidung geschlossen ist. Jede Aufnahme und
jede Erledigung ist ein Commit mit Verweis auf die Eintrags-ID.
