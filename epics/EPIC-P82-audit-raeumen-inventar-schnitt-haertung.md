# EPIC-P82 — Audit-Räumen: Inventar, Monolith-Schnitt, Härtungsdetails

**Status:** Planungsentwurf (Nutzerauftrag 24.11.2026), Umsetzung offen · **Phase:** P82 · **Dauer:** 1–2 Agenten-Wochen · **Abhängigkeit:** keine blockierende (Quer-Epic wie P80/P81); P81 Abschluss-Gate und P79/P80 Ausläufe bleiben unberührt, P30/P31 On hold ebenfalls. Tracker-Issue: #412. Grundlagen: repo-weiter Audit-Scan vom 24.11.2026 (Ergebnis im Session-Protokoll; die sicherheitsrelevante Postur — Secrets, Auth, Pfad-Injection, K5, Adapter-Isolation — wurde grün befunden; dieses Epic arbeitet nur die Restbefunde ab).

## 1. Ziel & Entscheidung

Die drei Befundklassen des Audits, die kein laufender Bug sind, aber als
Unordnung oder Divergenz im Bestand liegen, werden abgeräumt und bleiben
abgeräumt:

1. **Inventar:** der Knip-Bestand (~16 ungenutzte Exporte, ~20 ungenutzte
   Typen) wird bereinigt und `check:knip` wandert hinter der Bereinigung ins
   Gate — sonst läuft der Bestand nur wieder auf.
2. **Monolith-Schnitt:** `session-manager.ts` (3757 Zeilen) wird entlang
   bestehender Modulnaht geteilt — Verhalten unverändert, Contracts
   unverändert.
3. **Härtungs-Restpunkte:** WS-Revocation-Recheck aus dem aufgelösten Auth
   statt aus dem Query-Parameter; Session-Tail auf kurzlebige Tickets wie
   STT/Terminal; SQL-Whitelist-Stellen kommentieren.

**Entscheidung gegen Neubaustellen:** Der Audit-Scan hat keine neue
Sicherheitslücke ergeben; dieses Epic erfindet keine Features — es ist der
aufgabengemessene Aufräum- und Härtungsblock, der in keinen bestehenden
Epicscope passt.

## 2. Scope (In / Out)

### In
- Knip-Inventar leeren oder verorten (jeder Export bewusst: löschen,
  verwenden oder als öffentliche API im Code begründen); danach
  `check:knip` als Gate-Eintrag in `package.json` + `AGENTS.md`-Kommandos.
- `packages/core/src/modules/sessions/session-manager.ts` entlang der
  Modulnaht teilen (nur Verschieben + Re-Export, kein Verhaltensdelta).
- `apps/hub/src/modules/sessions/ws.ts`: Revoke-Recheck aus dem vom
  Auth-Hook aufgelösten Token speisen, nicht aus `req.query` (bisher nur
  Query-Verbindungen; Header-Verbindungen bleiben nach Widerruf stehen).
- Session-Tail-Authentifizierung per kurzlebigem Ticket nach dem Muster
  STT-Stream/Terminal-Stream (BUG-0028/ADR-0087): das wiederverwendbare
  Device-Token verlässt die URL. Beteiligte Clients: PWA
  (`apps/pwa/src/shared/ws.ts`), `hubctl` (`apps/hubctl/src/cli.ts`).
- Whistleblow-Kommentare an den drei SQL-Interpolationsstellen
  (`modules/statistics/rollup.ts`, `modules/sessions/session-manager.ts`,
  `modules/approvals/operations.ts`): `IN`-Platzhalter und Spaltennamen
  sind nur aus Whitelist-Konstanten erlaubt.

### Out
- Keine Contract-Änderung ohne ADR; wird die Ticket-Lösung ein
  Auth-Grenzfall an `contracts`/`platform/auth.ts`, schreibt sie vorher
  ein ADR (AGENTS-Regel 1).
- Keine Aufteilung von `apps/pwa/src/shared/api.ts` (1741 Zeilen) oder der
  i18n-Kataloge (Generatredundanz de/en, bewusst).
- Kein `eslint --max-warnings`-Ratchet nach unten (Gates-Skill: es gibt
  noch keine Baseline-Dateien).
- Die vier Ursachenklassen von BUG-0170 (Windows-Suite) — eigener
  Bugfix-Zweig, nicht Teil dieses Epics.

## 3. Design-Details

### Knip ins Gate
Reihenfolge zwingend: erst Inventar leer (löschen/verwenden/begründen),
dann Gate-Aufnahme — sonst blockiert das Gate jeden PR. `knip.json` bleibt
die Ausnahmestelle; jede Zeile `ignore` braucht einen Grund im Commit.

### Monolith-Schnitt
Verschieben nach `packages/core/src/modules/sessions/` (bestehende Ordner
wie `sessions/`-Nachbarn nutzen), `session-manager.ts` bleibt die
öffentliche Fassade über Re-Exports, damit kein Import umgeschrieben werden
muss. Kein neues Modul unter `contracts` (keine API-Formänderung).

### Revoke-Recheck
Der Auth-Hook (`apps/hub/src/platform/auth.ts`) löst den Token bereits auf;
bei WS-Upgrades wird das Ergebnis (Token-Label/Hash) an den Handler
durchgereicht, `ws.ts` stellt den Recheck daraus — unabhängig davon, ob der
Token aus Header oder Query kam. `TOKEN_RECHECK_MS` bleibt.

### Session-Tail-Ticket
Muster precise duplicationfrei nach STT (`/api/stt/stream`) und Terminal
(ADR-0087): einmaliges, kurlebiges Ticket per POST holen, URL trägt nur das
Ticket; Auth-Hook lässt nur die Ticket-Route durch, die Route prüft selbst
und weist Ungültiges mit 4401 ab. Log-Redaction (`redactUrl`) bleibt
unverändert Pflichtverteidigung. Kompatibilität: Umschaltung an PWA und
hubctl gleichzeitig umstellen, alte Query-Token-Route sichtbar abschalten
(nicht stillschweigend doppelt akzeptieren).

## 4. Aufgaben (Checkliste)

- [ ] **T82.1** Knip-Inventar räumen (löschen/verwenden/begründen, ~36
  Einträge); Messlatte: `npx knip` meldet 0; keine Contracts-Exports ohne
  Begründung gelöscht.
- [ ] **T82.2** `check:knip` ins Gate (`package.json`, `AGENTS.md`); nur
  grün wenn T82.1 erledigt ist (Reihenfolge ist Teil der Aufgabe).
- [ ] **T82.3** `session-manager.ts` teilen ohne Verhaltensdelta; Messlatte:
  keine Datei > ~1500 Zeilen, keine geänderten Tests, volle Suite im
  Abschluss-PR grün.
- [ ] **T82.4** Revoke-Recheck aus aufgelöstem Auth; Test rot ohne Fix
  (Header-authentifizierte WS-Verbindung stirbt nach Widerruf innerhalb
  `TOKEN_RECHECK_MS`).
- [ ] **T82.5** Session-Tail-Tickets nach STT-/Terminal-Muster (ADR wenn
  nötig); PWA und hubctl umgestellt; Test: Ticketbindung an Ziel-Session,
  ungültiges Ticket → 4401.
- [ ] **T82.6** SQL-Whitelist-Kommentare an den drei Stellen (nur
  Kommentare, `.`-Commit).

## 5. Acceptance Criteria (AC-P82-k)

- **AC-P82-1:** `npx knip` meldet 0 Einträge und `check:knip` ist im
  `gate`-Skript; jede Ausnahme in `knip.json` hat einen Grund.
- **AC-P82-2:** Kein Datei-Monolith > ~1500 Zeilen in `packages/core`
  (außer generierte Dateien); `session-manager`-Fassade unverändert
  importierbar; kein Test wurde wegen des Schnitts geändert.
- **AC-P82-3:** Revoke-Recheck greift nach Header- UND Query-Auth;
  Regressions-test rot ohne Fix, grün mit Fix.
- **AC-P82-4:** Session-Tail-URLs von PWA und hubctl tragen kein
  Device-Token mehr; nur Tickets; Log-Redaction unverändert grün.
- **AC-P82-5:** Die drei SQL-Stellen tragen den Whitelist-Kommentar;
  keine Verhaltensänderung (Diff enthält nur Kommentare).

## 6. Premortem (Failure-Modi + Mitigation)

1. **Knip räumt öffentliche API weg** (Prüfpunkt 1): gelöschte Exporte sind
   doch Referenz für Adapter/PWA. → Contracts bleiben unverändert; jeder
   Löschkandidat wird einzeln gegen Importstellen geprüft, nicht en bloc;
   Gate kommt erst nach leerem Inventar ins Skript.
2. **Der Monolith-Schnitt berührt K7-Recovery-Pfade** und wird doch kein
   reines Verschieben. → bei geringster Verhaltensfrage bleibt die
   Funktionsgruppe wo sie ist; volle Suite (Tier A+B) im Abschluss-PR;
   kein Test darf sich ändern.
3. **Der scharf geschaltete Revoke-Recheck trennt Verbindungen, die vorher
   stehen blieben** — Nutzer erleben Trennungen als neuen Fehler. → der
   4401-Pfad existiert und ist dokumentiert (ADR-0017); Reconnect-Verhalten
   von PWA/hubctl wird Teil des Tests, nicht der Hoffnung.
4. **Ticket-Umstellung zerlegt bestehende Clients** (ältere hubctl-Tag gegen
   neuen Hub oder umgekehrt). → Umschaltung Hub + beide Clients in einem
   Zug; alte Query-Token-Zugangswege werden sichtbar abgeschaltet (401/4401),
   nicht stillschweigend mitlaufen lassen; CHANGELOG-Eintrag im PR-Body.

## 7. Definition of Done

- Alle sechs Tasks umgesetzt oder mit Grund im Status auf teillos gestellt;
  `npm run check:epics` und `npm run check:context` grün; diese
  Statuszeile und `epics/README.md` auf echtem Stand.
- Jeder Task mit Verhaltensänderung (T82.4, T82.5) mit rot-dann-grün-Test;
  betroffene Specs in `e2e/specs/` ergänzt/wiederholt.
- `npm run gate` lokal grün auf dem Abschluss-PR; GitHub-Actions-Lauf
  (`verify`) grün; volle Messlatte im Nightly (`ci/full-suite`). Rote CI
  allein wegen der Umgebung wird benannt, nie als Pass gezählt
  (`docs/ci-runbook.md`).
- Erreichbarkeit: `check:knip` im Gate sichtbar; Doku-Kommentare an den
  SQL-Stellen vorhanden; kein TODO ohne Epic-Referenz zurückgelassen.
