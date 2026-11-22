# EPIC-P54 — Ralph-Loop für alle Adapter und LLMs (hub-getrieben)

**Status:** abgeschlossen 2026-11-22 (Code + automatisierte Tests grün — Belege je Task unten; Produktiv-Rauch T54.5) — **T54.6 Menschen-Abnahme nach P000 verschoben (T000.31)** · **Phase:** P54 · **Dauer:** ~1 Agenten-Tag Kern + Abnahme · **Abhängigkeit:** ADR-0038-Gerüst (P19), Beobachter-Connector `ralph` (PR #280) als Protokoll-Referenz; ADR-0110 entsperrt `agents: "hub"`. Neu-Beauftragung 22.11.2026 ersetzt den gesperrten Hermes-Dropdown-Entwurf (§2 Out).

## 1. Ziel

Die Ralph-Goal-Gate-Arbeitsweise ist aus jedem Hub startbar — mit **jedem**
Adapter/LLM, der per CLI einen Prompt nimmt (`claude -p`, `codex exec`,
`pi`, `opencode`, `aider`, …). Der Hub treibt die Schleife: Ziel (Epic/Bug)
wählen, Agenten-Befehl eintragen, Turn-Budget setzen — der Connector sät die
State-Datei aus der Epic-Datei, spawn`t pro Turn genau einen Agenten im
Session-Workdir, meldet Fortschritt als `loop.*`-Events und stoppt am
Menschen-Gate (`wartend`). Hermes bleibt ein Weg von zweien (Beobachter
unverändert), nicht mehr der einzige.

## 2. Scope (In / Out)

**In:** ADR-0110 + Contract-Kommentar (Entsperrung `agents: "hub"` mit
Leitplanken); `packages/loops/ralph-hub` (`@ancientvoid/loop-ralph-hub`):
State-Saat aus Epic-Datei, Ralph-Prompt, `ctx.spawnWorker`-Schleife,
`maxTurns`/`turnTimeoutMs`, pause/resume, stop/abort mit kill, K7-Cursor,
kompakte Events + Ausgabe als Blob (K5), loop.broken fail-loud; Unit-Tests
mit Agent-Attrappe; E2E am Test-Hub mit Stand-in-CLI über das Start-Formular;
Doku (docs/loops.md, docs/configuration.md).

**Out:** Der frühere P54-Entwurf (Hermes-Orchestrator-Dropdown +
`docs/hermes/orchestrator-onboarding.md`) — Folgeauftrag bei Bedarf, hier
nicht verbaut; Kind-Sessions oder SessionManager-steuerung pro Turn
(ADR-0110 verworfen); Auto-Merge/Auto-Push (Branch `ralph/<target>` +
Menschen-Gate bleiben); Persistenz der CLI-Ausgabe über den Blob hinaus.

## 3. Design-Details

### 3.1 Rollen (ADR-0110)

Connector = Schleife; die CLI = der Agent mit seinem LLM. Der Connector sieht
nur `AdapterContext` (spawnWorker, emit, blob, signal, workdir) — keine
Hub-Internas, keine zweiten Steuerinstanzen (P40-Regel). loops.start bleibt
Menschen-only.

### 3.2 State-Datei als Wahrheit

`<workdir>/.ralph/<target>-state.json` nach dem Ralph-Protokoll des
Hermes-Runners (tasks_total/done, current_task, status). Saat: Task-Ids aus
`epics/<target>*.md` (Checkbox-Zeilen). Ende: `wartend` (Level 1 — Abnahme
durch Menschen), `blocked`/`stopped` (Level 2). Pause stoppt neue Turns,
meldet den Zustand aber weiter (wie der Beobachter).

### 3.3 Prompt und Budget

Ein deterministischer Protokoll-Prompt pro Turn (Ziel, State-Pfad, aktuelle
Aufgabe, Turn n/max, letzter Exit-Code, Regeln 1–6 inkl.
Branch/kein-Main/Injection-Grenze). `command` nimmt `{prompt}` oder den
Prompt als letztes Argument. Budget: `maxTurns` (Default 40, Cap 1000) und
`turnTimeoutMs` (Default 1 h) — Überschreitung sichtbar, nie still.

## 4. Aufgaben (Checkliste T54.m)

- [x] **T54.1** ADR-0110 + `LoopCapabilities.agents`-Kommentar entsperren;
  ADR-0038-Statuszeile verweisen. Beleg: `docs/adr/0110-ralph-im-hub.md`,
  `packages/contracts/src/loops/connector.ts` (Kommentar), ADR-0038-Zeile.
- [x] **T54.2** Connector `packages/loops/ralph-hub` + Unit-Tests
  (Contract-Suite `agents: "hub"`, Saat aus Epic, Grind bis `wartend`,
  {prompt}-Substitution, Turn-Limit, pause/resume, stop/kill, broken, K5).
  Beleg: `packages/loops/ralph-hub/test/ralph-hub.test.ts` 8/8.
- [x] **T54.3** Workspaces/Lockfile; Doku `docs/loops.md` +
  `docs/configuration.md` (Beispiel-Registrierung).
- [x] **T54.4** E2E: Loop `ralph-hub` im Start-Formular mit Stand-in-CLI;
  Fortschritt und `wartend` sichtbar, Events kompakt.
  Beleg: `e2e/specs/ralph-hub.spec.ts` (2/2 mobile; Stand-in
  `e2e/support/ralph-agent.mjs`).
- [x] **T54.5** Registrierung am Produktiv-Hub (hub.config.json, lokal) und
  Rauch-Lauf mit einer promptbaren CLI. Beleg 2026-11-22: Config
  `loops[].id=ralph-hub` → Modul `@ancientvoid/loop-ralph-hub`; Hub-Neustart
  auf `acdb9f85` (`version.json` dirty:false, Journal
  `loop:ralph-hub@0.1.0`); Live-Session `56539e52-…` mit Stand-in
  `e2e/support/ralph-agent.mjs` → 2/2 Tasks, `loop.notify` status `wartend`
  (Level 1), Turn-Ausgabe als Blob (K5); Smoke-Token widerrufen (401).
- [ ] **T54.6** Menschen-Abnahme — nach P000 verschoben (Delegationsvermerk,
  `EPIC-000-testsuite-fuer-menschen.md` §3; geführt als **T000.31**, nur dort
  abgehakt): echter Grind mit echtem LLM, Gefühl für Turn-Budget/Prompt.

## 5. Acceptance Criteria (AC-P54-k)

- **AC-P54-1:** Eine Loop-Session `ralph-hub` mit beliebiger promptbarer CLI
  erreicht `wartend` mit Level-1-Notify; Unit + E2E belegen die Schleife.
- **AC-P54-2:** Die Saat entsteht aus der Epic-Datei vor dem ersten Turn;
  ohne Epic läuft der Grind mit leerer Liste trotzdem deterministisch.
- **AC-P54-3:** Budgetgrenzen sind sichtbar (Turn-Limit Level 2, Turn-Timeout
  als loop.broken) und der Prompt enthält sie.
- **AC-P54-4:** K5 bleibt (Events < 4 KB, Ausgabe als Blob, Prompt nie im
  Event); K7: Cursor mit Turn-Zähler überlebt Hub-Neustart.
- **AC-P54-5:** `ralph` (Hermes-Beobachter) und bestehende Loops regredieren
  nicht (bestehende Suite grün).

## 6. Premortem (Failure-Modi + Mitigation)

1. **Agent ignoriert das Protokoll** (State nicht gepflegt): Schleife läuft
   ins Turn-Limit → Level 2, sichtbar; Prompt wiederholt die Regeln je Turn.
2. **Endlosspawn bei crashender CLI:** spawn-Fehler ist loop.broken mit
   1-s-Bremse; maxTurns deckt den Rest ab.
3. **Zu großes Turn-Budget verbrennt Geld/Box:** Default 40, im Formular
   sichtbar setzbar; Timeout je Turn.
4. **Ralph committet auf main:** Prompt-Regel + Repo-Gates
   (Branch-Protection, commit-msg-Hook) erzwingen den Umweg über den Branch.
5. **Zwei Wahrheiten über Fortschritt:** nur die State-Datei; Events sind
   Abbild, Session-Snapshot führt nur Cursor.

## 7. Definition of Done

T54.1–T54.5 mit Evidenz, T54.6 delegiert (P000); `verify` auf dem PR grün;
docs/loops.md und configuration.md aktuell; kein TODO ohne Epic-Bezug.

## Retro

Zeitraum: 2026-11-22 · Commits: `8558424f`…`acdb9f85` (PR #281) + dieser
Abschluss · AK-Matrix: 5 🟢 / 0 🟡 / 0 🔴

### AK-Matrix

- AC-P54-1: 🟢 — Unit `ralph-hub.test.ts` (Grind → `wartend`), E2E
  `ralph-hub.spec.ts` (Start-Formular → Level-1-Notify), Live-Rauch
  Session `56539e52-…` (`loop.notify` / `wartend`).
- AC-P54-2: 🟢 — Unit „Saat aus Epic"; E2E legt `epics/EPIC-T1-*.md` und
  sieht `done:2/total:2`; Live-Rauch säte aus `EPIC-SMOKE`.
- AC-P54-3: 🟢 — Unit Turn-Limit Level 2; Prompt enthält Turn n/max;
  E2E Pflichtfeld blockiert leeren Befehl.
- AC-P54-4: 🟢 — Unit + E2E: Events < 4 KB, `outputBlob` statt Rohausgabe;
  Cursor speichert Turn-Zähler (`saveCursor`).
- AC-P54-5: 🟢 — `ralph.test.ts` 10/10 unverändert; Journal lädt
  `loop:ralph` und `loop:ralph-hub` parallel.

### Erkenntnisse

1. „Ralph für alle Adapter" war die richtige Schnitt: Der Connector spawnt
   CLI-Befehle, Adapter/LLM wählt der Nutzer im Formular — kein zweites
   Hub-Steuerwerk. Beleg: ADR-0110 + Live-Rauch mit Stand-in-CLI.
2. Produktiv-Deploy braucht PWA-Build vor dem Wachhund (`version.json` =
   PWA-Manifest); sonst falsch-negativer Non-Delivery. Beleg: PROGRESS-
   Lehre + Deploy auf `acdb9f85` dirty:false.
3. Premortem 1–3 abgefangen (Turn-Limit, broken+Bremse, Default 40); 4/5
   bleiben Prozessregeln (Branch-Prompt, State-Datei als Wahrheit) — echter
   LLM-Grind prüft sie unter T000.31.

### Action Items

- AI-P54-1: Echter Grind mit echtem LLM (Turn-Budget/Prompt-Gefühl) →
  T000.31 (P000).
- AI-P54-2: `e2e/specs/loops.spec.ts` Onboarding-Prefill (ADR-0045,
  `.form-grid > label`) war vorab rot auf main — eigener Fix, nicht P54.
