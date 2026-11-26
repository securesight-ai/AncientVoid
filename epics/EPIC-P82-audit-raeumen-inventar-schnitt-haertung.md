# EPIC-P82 — Audit-Räumen: Inventar, Monolith-Schnitt, Härtungsdetails

**Status:** Abgeschlossen (25.11.2026) · **Phase:** P82 · **Dauer:** 1–2 Agenten-Wochen · **Abhängigkeit:** keine blockierende (Quer-Epic wie P80/P81); P81 Abschluss-Gate und P79/P80 Ausläufe bleiben unberührt, P30/P31 On hold ebenfalls. Tracker-Issue: #412 (bei Anlage des Entwurfs durch PR #413 geschlossen). Grundlagen: repo-weiter Audit-Scan vom 24.11.2026 (Ergebnis im Session-Protokoll; die sicherheitsrelevante Postur — Secrets, Auth, Pfad-Injection, K5, Adapter-Isolation — wurde grün befunden; dieses Epic arbeitet nur die Restbefunde ab).

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
3. **Härtungs-Restpunkte:** WS-Revocation-Recheck anhand des vom Auth-Hook
   aufgelösten Token-Hashes; Session-Tail auf kurzlebige Tickets wie
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
Der Auth-Hook (`apps/hub/src/platform/auth.ts`) reicht den aufgelösten
Token-Hash an die Tail-Route weiter. Für Ticket-Upgrades kommt der Hash
vom Ticket-Aussteller. `tail-access.ts` prüft beide alle zwei Sekunden
und beendet die Verbindung bei Widerruf mit 4401.

### Session-Tail-Ticket
PWA und hubctl holen ein kurzlebiges Einmal-Ticket per POST mit
Bearer-Header. Die WebSocket-URL enthält `?ticket=`. Session-Tail,
STT und Terminal nutzen denselben Ticket-Speicher. Beim Upgrade
prüft der Handler die Zielbindung und den Aussteller. Ungültige
Tickets führen zu 4401. `redactUrl` maskiert Tickets in Request-Logs.
Hub, PWA und hubctl werden gemeinsam aktualisiert. Flotten-Hubs
authentifizieren ihre Upstream-Verbindungen per Bearer-Header.

## 4. Aufgaben (Checkliste)

- [x] **T82.1** Knip-Inventar räumen (löschen/verwenden/begründen, ~36
  Einträge); Messlatte: `npx knip` meldet 0; keine Contracts-Exports ohne
  Begründung gelöscht.
- [x] **T82.2** `check:knip` ins Gate (`package.json`, `AGENTS.md`); nur
  grün wenn T82.1 erledigt ist (Reihenfolge ist Teil der Aufgabe).
- [x] **T82.3** `session-manager.ts` teilen ohne Verhaltensdelta; Messlatte:
  keine Datei > ~1500 Zeilen, keine geänderten Tests, volle Suite im
  Abschluss-PR grün.
- [x] **T82.4** Revoke-Recheck aus aufgelöstem Auth; Test rot ohne Fix
  (Header-authentifizierte WS-Verbindung stirbt nach Widerruf innerhalb
  `TOKEN_RECHECK_MS`).
- [x] **T82.5** Session-Tail-Tickets nach STT-/Terminal-Muster (ADR wenn
  nötig); PWA und hubctl umgestellt; Test: Ticketbindung an Ziel-Session,
  ungültiges Ticket → 4401.
- [x] **T82.6** SQL-Whitelist-Kommentare an den drei Stellen (nur
  Kommentare, `.`-Commit).

## 5. Acceptance Criteria (AC-P82-k)

- **AC-P82-1:** `npx knip` meldet 0 Einträge und `check:knip` ist im
  `gate`-Skript; jede Ausnahme in `knip.json` hat einen Grund.
- **AC-P82-2:** Kein Datei-Monolith > ~1500 Zeilen in `packages/core`
  (außer generierte Dateien); `session-manager`-Fassade unverändert
  importierbar; kein Test wurde wegen des Schnitts geändert.
- **AC-P82-3:** Revoke-Recheck greift nach Header-Auth und Query-Ticket;
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


## 8. Implementierungsnachweis

- T82.1/T82.2. Knip prüft Dateien, Abhängigkeiten und Exporte. Der Check
  läuft im lokalen Gate und im PR-Job `verify`.
- T82.3. Die Fassade exportiert dieselbe Klasse und dieselben Typen. Workspace,
  Lebenszyklus und Ereignis-/Worker-Laufzeit liegen in drei Quelldateien
  mit je unter 1500 Zeilen. Der Schnitt ändert keine Tests.
- T82.4/T82.5. [ADR-0124](../docs/adr/0124-session-tail-tickets.md) beschreibt
  Header-Auth für Hub-zu-Hub-Zugriffe, browser- und CLI-seitige Tickets sowie
  den Widerruf. Regressionen in `server.test.ts`, `fleet-routing.test.ts`,
  `fleet-pairing.test.ts` und `session.spec.ts` prüfen den realen Transport.
- T82.6. Kommentare bei den festen SQL-Spalten- und Tabellennamen sowie den
  `IN`-Platzhaltern dokumentieren die Bindungsgrenze.

### Knip-Ausnahmen

| Ausnahme in `knip.json` | Begründung |
| --- | --- |
| `apps/pwa/public/**` | Vite kopiert diese statischen Assets. Manifest, Service Worker und Worklet werden zur Laufzeit per URL geladen. |
| `scripts/fixtures/check-i18n/*.tsx`, `scripts/fixtures/check-i18n-keys/*.tsx` | Die Skripttests lesen die absichtlich fehlerhaften und korrekten TSX-Beispiele als Text. |
| `e2e/fixtures/ds-probe/DsProbe.tsx` | Die Design-System-Probe wird von `ds-probe.test.ts` statisch gelesen und geprüft. |
| `scripts/hub.sh` | Der Launcher ist ein Shell-Skript. Die Messläufe übergeben seinen Pfad relativ zum Prozessverzeichnis an `execFileSync`. |
| `@fontsource/*` | Die PWA lädt die Schriften über CSS. |
| `@ancientvoid/loop-ralph-hub` | Der Hub lädt den Connector dynamisch aus `loops[].module`. |
| `adb`, `chromium`, `codex`, `dsh`, `ffmpeg`, `foot`, `mosquitto`, `mosquitto_passwd`, `opencode`, `rg`, `script`, `tesseract`, `wl-copy`, `yt-dlp` | Installierte Plattformbefehle für Geräte-, Adapter-, Terminal-, Medien- und Werkzeugpfade. Sie werden als Systemprogramme installiert. |

## 9. Retro (25.11.2026)

| AC | Ergebnis | Beleg |
| --- | --- | --- |
| AC-P82-1 | erfüllt | `npm run check:knip` ohne Befund, im `gate` und in `ci.yml`; Ausnahmen in §8 |
| AC-P82-2 | erfüllt | größte Datei in `packages/core/src` 1391 Zeilen; der Schnitt (`b8fb34a6`) ändert keine Tests |
| AC-P82-3 | erfüllt | `server.test.ts`: Widerruf bei Header-Auth und bei Ticket endet mit 4401 |
| AC-P82-4 | erfüllt | `session.spec.ts` „frisches Ticket“, `server.test.ts` (PWA, hubctl, Hub-Neustart), `log-redaction.test.ts` |
| AC-P82-5 | erfüllt | `646f1445` enthält nur Kommentare |

Premortem 3 und 4 trafen zu: Die Abschlussprüfung fand, dass `hubctl tail -f` einen Hub-Neustart nicht überlebte.

Die volle E2E-Suite war schon auf `09eb3eec` rot (Nightly 45512916766). Behoben wurden drei Produktfehler
(BUG-0284, BUG-0285, BUG-0286) und veraltete oder zu frühe Abfragen in den Specs. Kein Action Item offen.
