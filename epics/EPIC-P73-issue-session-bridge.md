# EPIC-P73 — Issue-Session-Bridge und sichtbare Auto-Jobs

**Status:** abgeschlossen 21.11.2026 (Status-Sync, Live-Beleg und Retro-Fazit am Dateiende) · **Phase:** P73 · **Dauer:** ~1 Agenten-Tag · **Abhängigkeit:** keine blockierende — Quer-Epic wie P58–P72; P71 (Issue-Lebenszyklus) umgesetzt, liefert die Label/Triage-Basis. P30/P31 bleiben On hold und unberührt. ADR: [docs/adr/0094](../docs/adr/0094-issue-session-bridge-outbound-poll.md).

## 1. Ziel

Ein GitHub-Issue mit Trigger-Label bekommt automatisch eine eigene Session, die es
abarbeitet (Nutzerauftrag: „sobald ein Issue angelegt wird, dafür eine separate Session
starten"). Die Bridge pollt outbound (kein Webhook, keine neue Angriffsfläche), das Label
ist das Freigabe-Gate (Schreibrechte nötig — Prompt-Injektions-Grenze PRD §8.5 bleibt
gewahrt). Zusätzlich zeigt die Automatismen-Ansicht der PWA die automatischen Jobs, die
außerhalb des Hubs laufen — GitHub-Actions-Workflows wie `nightly-bugs` („Bug anlegen,
wenn eine Pipeline failed") und den Zustand der Bridge selbst. Und: Wird zu einem Issue
eine `bugs/bug-NNNN.md` angelegt, tragen Frontmatter (`forge:` + `labels:`) und Index die
Sync-Marker (Issue + Tag), damit Tracker und SSOT auseinanderhalten können, was schon
angerufen wurde.

## 2. Scope (In / Out)

**In:**

- ADR-0094 (Outbound-Poll, Label-Gate, ExternalJobInfo-Anzeige).
- Contracts: `ExternalJobInfo` (flach: Quelle, Name, Status, Detail, URL, Zeitpunkt) —
  bewusst kein `external`-Automation-Target.
- Core-Modul `issues`: GitHub-REST-Client (fetch, tokenFile), Bridge-Service
  (Poll-Loop mit Jitter, Session-Start, Start-/Ergebnis-Kommentar), Journal-Store
  (JSONL + Snapshot, K7).
- Hub: `issues`-Config-Sektion (repo, tokenFile, triggerLabel, adapter, project, model?,
  pollIntervalMs?), Wiring in `main.ts`, `GET /api/automations/external`.
- PWA: Sektion „Externe Automatismen" in der Automatismen-Ansicht (GitHub-Actions-Läufe
  + Bridge-Zustand + Issue-Sessions mit Links), Offline-Kopie erweitert (K10).
- bug-report-Skill + `docs/issues.md`: Label-Konvention und `labels:`-Frontmatter als
  Sync-Marker dokumentiert; Session-Prompt der Bridge trägt die SSOT-Regel mit.

**Out:**

- Kein Webhook/Tunnel/öffentlicher Hub-Port; keine Änderung an `AutomationDefinition`/
  Scheduler; keine automatische Triage oder Auto-Close von Issues durch die Bridge;
- kein GitHub-Projects-/Board-Sync (P71-Out bleibt Out);
- CI-Bug-Issues (#100–#104) bekommen das Label NICHT automatisch — ob Nightly-Fails
  automatisch Sessions starten sollen, ist eine separate Entscheidung des Nutzers
  (Kosten-/Risikoabwägung), nicht dieser Epic.

## 3. Design-Details

### 3.1 Architektur (ADR-0094)

Hub pollt alle `pollIntervalMs` (Standard 60 000, Jitter ±20 %) offene Issues mit
`labels=<triggerLabel>` und `since` = letzter erfolgreicher Poll. Neue Issue-Nummer →
`sessions.create({ adapter, project, prompt, workspaceMode: "worktree" },
"bridge:issue-<nr>")` → Journal-Eintrag `dispatched` mit Session-ID → Kommentar auf dem
Issue mit Session-Link. Pro Poll-Tick werden laufende Issue-Sessions inspiziert (dieselbe
turn_end-Ableitung wie Automations-`inspect`); Endet eine, folgt der Ergebnis-Kommentar
(succeeded/failed/timeout/cancelled) und der Journal-Eintrag `settled`. Fehler bei
Poll/Kommentar/Session-Start: Journal `error` + sichtbarer Status am Endpunkt (fail
loud), nie still.

### 3.2 Prompt-Aufbau (Injektions-Grenze)

Der Prompt besteht aus festen Arbeitsaufträgen (Repo-Regeln: `AGENTS.md` gilt, Defekte
nach `bugs/` via Skill `bug-report`, PR mit `Fixes #<nr>`, Abschluss = Kommentar auf dem
Issue) und darunter dem Issue als klar abgegrenztem Datenblock (Nummer, Titel, Labels,
Body, URL). Der Body wird unverändert übernommen — die Session arbeitet im Worktree am
konfigurierten Projekt (projectRoots-Check beim Start der Bridge).

### 3.3 ExternalJobInfo

`GET /api/automations/external` → `{ at, staleError|null, jobs: ExternalJobInfo[] }`.
Quellen: (a) GitHub-Actions: je Workflow der letzte Run (Name, Event, Status/conclusion,
URL, Zeitpunkt) — TTL-Cache 60 s, bei Fehler letzte gute Daten mit Zeitstempel +
Fehlerklasse (K10, Muster `ForgeService.cached`); (b) Bridge: ein Eintrag je Issue-Session
(Quelle `issue-bridge`, Status dispatched/running/settled/error, Session- und Issue-URL).
PWA rendert eine Liste mit Status-Pill und Link; Offline-Kopie unter dem vorhandenen
Automations-Snapshot-Schlüssel (Version bumpen).

### 3.4 Messlatten-Bezug

- K7 (State-Restore): Bridge-Journal ist aus JSONL + Snapshot rekonstruierbar; nach
  Neustart gelten dispatchte Issue-Sessions als laufend und werden wieder inspiziert.
- K10 (PWA-Offline): Externe-Jobs-Ansicht hat eine Offline-Kopie mit Zeitstempel und
  ehrlichem `staleError`.
- K5: Bridge-Kommentare und Events bleiben klein (Ergebnis-Klasse + Links, kein Log-Dump).
- PRD §8.5: Label-Gate + Datenblock-Prompt (§3.2).

## 4. Aufgaben (Checkliste)

- [x] **T73.1** ADR-0094 + dieses Epic + `epics/README.md`-Zeile. — Commit 11b08724.
- [x] **T73.2** Contracts: `ExternalJobInfo` in `packages/contracts/src/automations/`
  (+ Export), Unit-Test Grenzen (Status-Art, Längen). — Commit bbe4b9c8, `contracts/test/automations/*.test.ts` grün.
- [x] **T73.3** Core `modules/issues`: GitHub-Client (list labeled open issues seit X,
  Kommentar anlegen, Workflow-Runs lesen; fetch injectable), Journal-Store (K7),
  Bridge-Service (Poll-Loop, Session-Start, Inspect, Kommentare) — Unit-Tests mit Fake-
  fetch/Fake-Session-Manager: neue Issue → Session + Kommentar; erneuter Poll → Dedupe;
  Session-Ende → Ergebnis-Kommentar; Poll-Fehler → fail loud, kein Zustandsverlust. — PR #186 (`c8321751`), `core/test/modules/issues/` grün (21.11.2026 erneut gelaufen).
- [x] **T73.4** Hub: `issues`-Config (Zod, tokenFile, projectRoots-Prüfung beim Start),
  Wiring in `main.ts`, `GET /api/automations/external` (501-Stub ohne Deps), Route-Tests. — Route in `automations.routes.ts`, Token-Seite PR #187, Config-Referenz d8bc2ca6; Route-/Config-Tests grün.
- [x] **T73.5** PWA: `api.externalJobs()`, Sektion „Externe Automatismen" in
  `AutomationsPane` (Status-Pills, Links, konfiguriert/nicht konfiguriert ehrlich),
  Offline-Kopie erweitert; Unit-Tests + E2E-Spec (`e2e/specs/`), die die Sektion gegen
  den E2E-Hub (Bridge unkonfiguriert → ehrlicher Zustand; Actions-Liste via Stub)
  prüft. — `ExternalJobsSection.tsx`, CSS c115f376, `e2e/specs/external-jobs.spec.ts`.
- [x] **T73.6** Sync-Doku: `.claude/skills/bug-report/SKILL.md` (labels-Frontmatter) und
  `docs/issues.md` (Anlage-Klasse + Label-Konvention); Bridge-Prompt verweist darauf. — beides vorhanden (Bedingungs-Zusatz im Skill ab ADR-0094; neue Bridge-Bugs tragen `labels:` im Frontmatter).
- [x] **T73.7** Retro gegen die AC; Erkenntnisse hier anhängen. — Retro-Fazit am Dateiende (Status-Sync 21.11.2026).

## 5. Acceptance Criteria (AC-P73-k)

1. **AC-P73-1 (Bridge):** Mit konfigurierter `issues`-Sektion startet der Hub für ein
   neu angelegtes, gelabeltes Issue genau eine Session (Dedupe über Neustarts), und auf
   dem Issue erscheinen Start- und Ergebnis-Kommentar mit Session-Link. Beleg:
   Unit-Tests (Fake-GitHub/Fake-Sessions) + **Live-Nachweis 19.11.2026: Test-Issue #190
   (Label \`session\`) → Dispatch in \`data/issues/journal.jsonl\` (seq 89, Session
   \`fdb360bb\`, omp, Worktree) → Start-Kommentar → \`settled: succeeded\` (seq 91) →
   Ergebnis-Kommentar; ~70 s Sessions-Laufzeit.**
2. **AC-P73-2 (Label-Gate):** Issues ohne Trigger-Label bekommen keine Session; der
   Issue-Body reist als Datenblock unter festen Arbeitsaufträgen. Beleg: Unit-Test +
   Prompt-Bau-Test.
3. **AC-P73-3 (Sichtbarkeit):** Die Automatismen-Ansicht zeigt GitHub-Actions-Jobs und
   Bridge-Zustand mit Status und Links, offline mit Zeitstempel. Beleg: E2E-Spec +
   Unit-Tests.
4. **AC-P73-4 (Sync-Marker):** bug-report-Skill und `docs/issues.md` dokumentieren
   `forge:` + `labels:`; der Bridge-Prompt enthält die SSOT-Regel. Beleg: Diff.
5. **AC-P73-5 (Grenzen):** Ohne Config ändert sich nichts (Endpunkt meldet nur Actions,
   Sektion zeigt „nicht konfiguriert"); kein eingehender Port; Token nur aus tokenFile.
   Beleg: Route-Tests + Config-Test.

## 6. Premortem (Failure-Modi + Mitigation)

1. **Fremde Issues spamen die Bridge.** → Nur gelabelte Issues; Labeln braucht
   Schreibrechte; Rate: ein Poll-Minimum-Intervall, max. eine Session je Issue (Dedupe
   im Journal, K7). Zusätzlich Out-of-Scope-Note: CI-Bugs labeln nicht automatisch.
2. **Prompt-Injektion über den Issue-Body.** → Body als Datenblock unter festen
   Aufträgen; Session im Worktree; `Fixes #`-Merge bleibt menschliche CI-gated
   Entscheidung; AGENTS-Regeln (§8.5) gelten im Session-Worktree unverändert.
3. **GitHub-Ratelimit/Netz-Ausfall macht die Bridge taub.** → Fehler sichtbar am
   ExternalJobInfo-Endpunkt (fail loud), Zustand im Journal bleibt; keine Session geht
   verloren (dispatched bleibt dispatched bis inspect etwas anderes sagt).
4. **Die neue Sektion verrottet als zweite halbgewartete Liste.** → Ein Endpunkt, ein
   Typ, eine Quelle je Zeile; GitHub-Actions kommen aus demselben Client wie die Bridge
   (ein Token, ein Cache); Offline-Kopie hängt am bestehenden Snapshot (kein zweiter
   Mechanismus).
5. **Session läuft endlos (kein turn_end).** → Inspect behandelt `unknown` ehrlich
   (Status am Endpunkt), greift aber nicht eigenmächtig ein — Stop bleibt Nutzerhandlung
   (gleiche Haltung wie Automations-Resolve).

## 7. Definition of Done

- `npm run gate` lokal grün (check:* inkl. `check:context`, Typecheck, Lint, Suite);
  neue Unit-/Route-Tests rot-dann-grün belegt; E2E-Spec für die neue Ansicht grün.
- GitHub-Actions (`verify`) auf dem Abschluss-PR grün; ein Live-Nachweis der Bridge
  gegen ein echtes Test-Issue (Kommentar-Links) oder die ehrliche Benennung, was noch
  aussteht (Token/Repo-Konfiguration liegt beim Nutzer).
- AC-P73-1 bis -P73-5 mit Belegen hier vermerkt; `epics/README.md` aktualisiert;
  Menschen-Abnahme (Handy-Blick auf die neue Sektion) nach P000 verschoben, wenn nötig.
- Keine Contract-Änderung ohne ADR (ADR-0094 deckt `ExternalJobInfo` ab).

## Retro (Status-Sync 21.11.2026)

Raum: Auftrag 19.11., Umsetzung über PRs #186/#187 plus ADR/Doku-Commits,
Live-Beleg AC-P73-1 am selben Tag (Test-Issue #190, Dispatch → Kommentar →
settled). AC-P73-2–5 durch Unit-/Route-/E2E-Tests abgedeckt (21.11. erneut
gegrünt). Erkenntnisse: (1) Outbound-Poll war die richtige Wahl — der
Poll-Intervall-Deal steht im ADR und trägt; (2) der Dedupe-Journal-Pfad
(K7) hat einen SIGKILL-Fall überlebt, gut; (3) die Bridge war beim Status-Sync
der einzige Epic mit lebendem GitHub-Verkehr — Label-Konvention und
bug-report-Skill haben im Alltag gegriffen. Retro-Fazit hier, formellen Lauf via
Skill `retro` war durch den Sammel-Status-Sync ersetzt (Auftrag vom Nutzer).
