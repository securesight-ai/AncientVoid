# EPIC-P4.5 — Testing, Logging und Monitoring

**Status:** abgeschlossen 2026-11-18 (Code + automatisierte Tests grün) — Menschen-Abnahme nach P000 verschoben · **Phase:** P4.5 · **Dauer:** 0,5–1 Agenten-Wochen · **Abhängigkeit:** P4 soweit autonom grün (T4.1/T4.2/T4.6/T4.7/T4.9/T4.10). P4s externe Restpunkte (T4.3/T4.4/T4.5/T4.8/T4.11) sind bewusst offen und laufen in EPIC-P35 (Endabnahme-Block) T35.13/T35.14.

**Vorbemerkung (2026-09-21) — bewusste Umpriorisierung, kein umgangenes Gate:**
P5–P12 sind Planungsentwürfe und laut Index erst nach vollständig grünem P4/G0
umsetzbar. Der Nutzer hat ausdrücklich angeordnet, *zuerst* ein Querschnitts-Epic
für Tests, Logging und Monitoring zu bauen und erst danach P5–P12 nacheinander
abzuarbeiten. Begründung: ohne Testpyramide, strukturierte Logs und Health/Metrics
sind die späteren ACs (Handoff, Flotte, Parität, Offline, Dauerlauf) nicht ehrlich
abnehmbar — sie würden weiter nur „grün per Pakettest“ behaupten. P12 (T12.2)
übernimmt die Messlatten- und Geräteabnahme, erfindet die Infrastruktur hier nicht
noch einmal. Muster wie P1.5/P1.6: Ausnahme dokumentiert, Vorgänger-Restarbeit
bleibt unter ihren IDs.

## 1. Ziel

Jeder Agent und jeder Mensch kann in diesem Repo Unit-, Integrations- und
E2E-Tests nach demselben Schema schreiben. Der laufende Hub sagt strukturiert,
was er tut, und ein Health-/Metrics-Endpunkt macht K7/K8/K9-relevante Zustände
beobachtbar — lokal, ohne Cloud-Telemetrie. Bezug: PRD §8/§9, K5/K7/K8/K9/K10;
Audit G15/G17; Skills-Index („browser-e2e bewusst nicht übernommen, weil die
Suite fehlt").

## 2. Scope (In / Out)

**In:**
- Skill `write-tests` für Agenten (Unit / Integration / E2E, wo welche Datei
  hingehört, wie rot-dann-grün, wie CI).
- Testpyramide im Repo: bestehende vitest-Unit/Contract-Tests bleiben;
  Integrations-Konvention; erste echte E2E-Suite (Playwright, skip ohne Browser
  analog tmux).
- Lücken im Bestand schließen, die ohne neuen Fachumfang testbar sind
  (Logger-Redaction, Health, WS-Resync, PWA-Theme, Ready-Probe).
- Strukturiertes Logging in Core + Server (JSON-Lines, Secret-Redaction,
  `sessionId`/`adapter`/`reqId`).
- Lokales Monitoring: `/api/health` ehrlich (Checks, Session-Zähler),
  `/api/ready` (503 wenn nicht bereit), `/api/metrics` (auth, In-Process-Zähler).
- CI/Gates/AGENTS.md auf die neuen Kommandos und den Skill verweisen.

**Out:**
- Prometheus/OpenTelemetry/Cloud-APM (YAGNI, local-first, kein Egress).
- 24-h-Dauerlauf und volle K1–K10-Geräteabnahme (P12).
- Neue Fachfeatures (Discovery, Flotte, Voice, Desktop).
- Umbenennen/Aufsplitten aller bestehenden `*.test.ts` — Konvention gilt ab jetzt.

## 3. Design-Details

### Testpyramide

| Schicht | Wo | Runner | Wann |
|---|---|---|---|
| Unit / Contract | `packages/*/test/**/*.test.ts` | vitest (forks) | immer, CI-Gate |
| Integration | dieselbe Lage, Dateiname `*.integration.test.ts` oder bestehender Server-/Gateway-Test | vitest, echter `createHubApp` + Dummy | immer, CI-Gate |
| E2E | `e2e/**/*.test.ts` | vitest + Playwright Chromium | lokal Pflicht wenn Browser da; CI skippt ohne Browser (ADR-0002-Muster), nicht still |

`@ancientvoid/adapter-testkit` bleibt die Adapter-Naht. Ein Bug-Fix-Test muss ohne Fix
scheitern (`architecture-best-practices`). Timing-Tests warten auf ein Signal,
nicht auf `setTimeout`.

### Logging

Kein zweites Framework. `HubLogger` in `@ancientvoid/contracts` ist die Naht;
Implementierung in `@ancientvoid/core` schreibt JSON-Lines nach stdout. Fastify behält
pino, mit Redaction von `authorization`/`cookie`/`token`. `AdapterContext.log`
ändert die Signatur nicht — Core leitet in den HubLogger weiter. Default in Tests
bleibt console-kompatibel, damit bestehende Suites nicht umgeschrieben werden.

Redaction ist Pflicht: Tokens, Authorization-Header, Cookie, Password, Secret.
Kein Log darf ein Bearer-Token im Klartext enthalten — Test beweist das.

### Monitoring

`/api/health` bleibt unauthentifiziert (Tailnet-Probe, `hubctl health`) und
additiv: `ok`, `adapters`, `serverTime` bleiben; dazu `status`, `uptimeSec`,
`sessions`, `checks.database`, `checks.eventStore`. HTTP 200 auch bei
`status=degraded`, damit bestehende Monitoren nicht umkippen; `ok=false` nur
wenn der Hub nicht sinnvoll dienen kann.

`/api/ready` ist die Bereitschaftsprobe (DB + EventStore). 200 oder 503.

`/api/metrics` ist auth-pflichtig (Session-Zähler sind Betriebsdaten, keine
öffentliche Fläche). JSON, Prozesslebenszeit, keine persistente Time-Series
(K7 gilt für Hub-State, nicht für flüchtige Zähler — nach Restart bei 0,
ehrlich dokumentiert).

### Erreichbarkeit

Health/Ready/Metrics sind in `hubctl`, PWA-`hubApi.health` (additiv) und
README/AGENTS registriert. Ein Endpunkt ohne Client und ohne Test zählt nicht.

## 4. Aufgaben

- [x] **T4.5-1 — Skill und Konvention.** Skill `write-tests` nach
  `skill-template`; Skills-Index, `AGENTS.md`, `gates` und `architecture-best-practices`
  verweisen darauf. Unit/Integration/E2E, Dateilagen, Kommandos, Skip-Muster,
  rot-dann-grün, Adapter-Testkit, kein Cloud-Egress im Test. K5/K7.
- [x] **T4.5-2 — Observability-Contract + ADR.** `HubLogger`, `HubMetrics`,
  `HubHealthReport` in `@ancientvoid/contracts`; ADR-0010. Keine Änderung an
  `AdapterContext.log`. K5/K7.
- [x] **T4.5-3 — Logger und Metrics im Kern.** JSON-Logger mit Redaction;
  In-Process-Zähler; SessionManager/main ersetzen Roh-`console.*` an den
  bekannten Stellen (Adapter-Log, Emit-Failure, Recovery-Warnung, Boot).
  Default bleibt testkompatibel. K7/K9.
- [x] **T4.5-4 — Health / Ready / Metrics.** Echte Checks (SQLite `SELECT 1`,
  EventStore-Probe), Session-Zähler, WS-Connect/Drop-Zähler. Auth-Ausnahmen
  nur health+ready. Tests: Token-Redaction, 401 auf metrics, 503 auf ready
  wenn Check rot. K7/K8/K9.
- [x] **T4.5-5 — Bestandstests und E2E.** Unit: Logger-Redaction, Metrics,
  Theme, WS-Resync-Lücke. Integration: health-Form, ready, metrics, bestehender
  Server-Pfad bleibt grün. E2E: TokenGate → gültiges Token → Dashboard
  („AncientVoid") gegen echten Hub + gebaute PWA; skip ohne Chromium. K10 (Auth-Hülle).
- [x] **T4.5-6 — CI und Erreichbarkeit.** `npm test` schließt Unit+Integration
  plus E2E-Skip ein; `npm run test:e2e` explizit. `hubctl health` verträgt
  additive Felder. README/AGENTS/gates aktualisieren. K8-loadtest unverändert.

## 5. Acceptance Criteria

- **AC-P4.5-1:** Skill `write-tests` ist im Index und in `AGENTS.md` verlinkt.
  Ein Agent findet darin Unit-, Integrations- und E2E-Rezept ohne weitere
  Repo-Archäologie.
- **AC-P4.5-2:** `GET /api/health` ohne Token liefert `ok`, `status`,
  `checks.database`, `checks.eventStore`, `sessions`. `GET /api/ready` ist
  offen; `GET /api/metrics` ohne Token ist 401, mit Token ein JSON-Snapshot
  inkl. `events_appended` nach einer Dummy-Session.
- **AC-P4.5-3:** Ein Log mit `authorization: "Bearer secret-token"` erscheint
  als `[redacted]`; der Klartext kommt in keiner Zeile vor. Beweis: Unit-Test.
- **AC-P4.5-4:** E2E startet Hub + PWA, zeigt TokenGate ohne Token, nach
  gültigem Token die Übersicht. Ohne Playwright-Browser skippt der Test
  sichtbar, er wird nicht still als Pass gezählt.
- **AC-P4.5-5:** `npm test`, `npm run lint`, `npm run typecheck` grün;
  bestehende Server-/Core-/Adapter-Suiten bleiben grün. PWA-Build bei den
  PWA-Änderungen grün.

## 6. Premortem

1. **Zwei Logger, keiner rot:** Fastify-pino und HubLogger laufen parallel,
   Redaction nur auf einem. Mitigation: derselbe Key-Satz, Test gegen
   HubLogger *und* gegen Fastify-`redact`-Config (Keys in einer Quelle).
2. **Health immer `ok: true`:** Checks werden geschönt, damit Monitoren
   nicht nerven. Mitigation: Ready-Test mit kaputter/abwesender Probe muss
   503 liefern; Health-`ok` folgt den Checks.
3. **E2E „grün" ohne Browser:** wie ADR-0002 vor der Dokumentation.
   Mitigation: skip zählt als skip, CI-Log zeigt die Zahl; Skill und Epic
   nennen das Muster.
4. **Metrics werden zur persistierten State-Quelle ohne Recovery (K7-Falle):**
   Mitigation: Zähler sind Prozessspeicher, ADR sagt das, Restart → 0 ist
   spezifiziert, kein Snapshot.

## 7. Definition of Done

Alle ACs mit benannten Tests belegt; Skill und Endpunkte erreichbar
(Index, hubctl, API); `npm test`, `npm run lint`, `npm run typecheck` grün;
PWA-Build nach UI-/Client-Änderungen; Contracts + ADR-0010; keine Cloud-
Telemetrie; Premortem gegengeprüft. Commit/MR gemäß Repo-Workflow; kein
lokaler Merge nach main.

## 8. Gaps während der Umsetzung

- **Health ohne `store`:** `collectHealth` markiert `eventStore` als
  `ok: true, detail: "not probed"`, wenn kein EventStore übergeben wird.
  Production (`main.ts`) übergibt ihn immer. Tests ohne `store` dürfen
  `/api/ready` nicht als echte Store-Abnahme lesen.
- **E2E braucht einmalig `npx playwright install chromium`.** Ohne Browser
  skippt die Suite — analog ADR-0002, nicht still grün.
- **Metrics sind Prozessspeicher.** Nach Restart 0; kein Dashboard in der
  PWA in dieser Phase (nur API + `hubctl health`).
- **Zwei Logger-Kanäle bleiben:** Fastify/pino (HTTP) und `HubLogger`
  (Core/Boot). Redaction-Keys sind geteilt; eine vollständige
  Zusammenführung wäre YAGNI.
- **Tmux FileTailer suchte EOF an (P0-Worker, sichtbar in P4.5).**
  `FileTailer.start()` setzte `offset = st.size` und verlor die Ausgabe
  eines bereits beendeten `echo $GREETING`. Test
  `passes a legal env var through` war rot, nicht flaky. Fix: ab Byte 0
  lesen + Replay-Puffer für späte `onStdout`-Subscriber. Betrifft
  P12-T12.2 („tmux-Test-Unzuverlässigkeit").
- **Skill-Inventar-Test ist eine harte Namensliste**
  (`packages/core/test/skills.test.ts`). Ein neuer Skill muss dort
  mitgezählt werden — `write-tests` hat das live gebrochen und ist
  nachgezogen. Kein Auto-Glob, damit versehentliche Templates weiter
  ausgeschlossen bleiben.

## 9. Retro (2026-09-21)

| AC | Status | Beleg |
|---|---|---|
| AC-P4.5-1 | 🟢 | `.claude/skills/write-tests/SKILL.md`; Index-Zeile in `.claude/skills/README.md`; `AGENTS.md` Testing |
| AC-P4.5-2 | 🟢 | `packages/server/test/observability.integration.test.ts` (health/ready/metrics/401/503) |
| AC-P4.5-3 | 🟢 | `packages/core/test/logger.test.ts` (`replaces authorization with [redacted]`) |
| AC-P4.5-4 | 🟢 | `e2e/pwa-token-gate.test.ts` — 2 Tests grün mit Chromium; skip ohne Browser |
| AC-P4.5-5 | 🟢 | `npm test` 348/348, lint, typecheck, PWA-Build grün |

Premortem: Redaction-Keys sind eine Quelle (`REDACT_LOG_KEYS`); Ready-503 ist getestet; E2E skippt sichtbar; Metrics ohne Snapshot (ADR-0010).

Action Items: P12-T12.2 kann den FileTailer-Fix als erledigt streichen, sobald ein Dauerlauf denselben Pfad nochmal sieht. Kein neues Epic.

## Retro-Nachtrag Abnahmestand (2026-11-09)

Read-only-Abgleich der Epic-Datei gegen Repo-Stand (`git log`, Gate-Skripte, `epics/EPIC-P35-*.md` §8.1). Keine offenen MRs.

- **Status:** grün, 24-h-Dauerlauf offen (T35.15)
- **Belegt:** T4.5-1..6, AC-P4.5-1..5 belegt (siehe §9)
- **Offen:** 24-h-Dauerlauf bestätigt FileTailer-Fix → T35.15
- **Gating:** Nachfolger-Epics laufen unter der dokumentierten Umpriorisierung; die Restpunkte sind im P35-Endabnahme-Block gebündelt und werden dort abgenommen, nicht hier erneut abgehakt.
