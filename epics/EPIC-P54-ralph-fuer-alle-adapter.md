# EPIC-P54 — Ralph-Loop für alle Adapter und LLMs (hub-getrieben)

**Status:** in Umsetzung (Neu-Beauftragung 22.11.2026: „Ralph-Loop nicht nur mit Hermes, sondern mit allem anderen auch"; ersetzt den gesperrten Entwurf „Hermes als Orchestrator im Dropdown" — dessen Rest siehe §2 Out) · **Phase:** P54
**Dauer:** ~1 Agenten-Tag Kern + Abnahme
**Abhängigkeit:** ADR-0038-Gerüst (P19, läuft), Beobachter-Connector `ralph` (PR #280) als Protokoll-Referenz; ADR-0110 (neu) entsperrt `agents: "hub"`.

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
- [ ] **T54.5** Registrierung am Produktiv-Hub (hub.config.json, lokal) und
  Rauch-Lauf mit einer echten CLI. (Config-Eintrag steht; Neustart + Rauch-Lauf
  nach Merge des Code-PRs.)
- [ ] **T54.6** Menschen-Abnahme — nach P000 verschoben (echter Grind mit
  echtem LLM, Gefühl für Turn-Budget/Prompt; Delegationsvermerk, nur dort
  abgehakt).

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
