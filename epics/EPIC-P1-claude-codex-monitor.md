# EPIC-P1 — Adapter claude + codex, Monitor-Dashboard, Chat-Tail mit Filtern

**Status:** abgeschlossen 2026-11-18 (Code + automatisierte Tests grün) — Menschen-Abnahme nach P000 verschoben · **Phase:** P1 · **Dauer:** 1–1,5 Agenten-Wochen · **Abhängigkeit:** P0 grün
**Ziel-Machines:** Omarchy (Prio 1), home-server (Prio 2, gleiches Image)

---

## 1. Ziel

Der Hub steuert die zwei wichtigsten Provider real an und zeigt deren Aktivität mobil an:
Claude Code über `claude -p --output-format stream-json` (Referenz-Adapter) und Codex
über `codex exec` JSON-Events. Dazu kommen das Monitor-Dashboard (Rechner → Projekt →
Session) und der Session-Tail mit drei Filter-Presets.

## 2. Scope

### In
- Adapter `claude`: stream-json-Parsing, Thinking/Tool-Calls als separate NormalizedEvents,
  `total_cost_usd`-Extraktion, Session-Resume via `session_id`
- Adapter `codex`: exec-JSON-Events, Pinning der CLI-Version, Format-Change-Detection
- Contract-Tests mit Record/Replay (gespeicherte CLI-Rohstreams als Fixtures)
- Monitor-Dashboard (S1): Rechner-Kacheln → Projekte → Sessions, Traffic-Light,
  Kosten-Zähler, „wartet auf mich"-Badge (Basis für Approval-Queue in P2)
- Chat-Tail (S2) mit Filter-Presets: Überwachen / Debuggen / Lesen; Filter-State pro
  Gerät in LocalStorage (kein Server-Roundtrip)
- Anker-Navigation: Tool-Call-Chip ↔ Tool-Result bidirektional verlinkt
- Heartbeat pro Adapter (30 s) + Push/Red-Badge bei Ausfall (Sensorik-Basis)

### Out
- Diff-Ansicht, Approvals, Budget-Enforcement — P2
- copilot/swarm/zai/local-llm/cursor — P3
- Sprach-Features — P3

## 3. Provider-Spezifika

### Claude Code (Referenz-Adapter, „goldener Pfad")
| Aspekt | Umsetzung |
|---|---|
| Spawn | `claude -p "<prompt>" --output-format stream-json --json-schema <optional>` im tmux-Worker |
| Event-Mapping | `init`→system, `assistant`→assistant, `thinking`-Block→thinking (gedimmt), `tool_use`→tool_use, `tool_result`→tool_result (K5-Cap!), `api_retry`→system-warning |
| Kosten | `total_cost_usd` aus Result-Event direkt übernehmen (keine Preis-Tabelle nötig) |
| Steer | Folge-Prompts via Session-Resume mit `session_id` |
| Risiko | Stream-Umfang bei langen Sessions → K5-Kapplung + Blob-Verlagerung ist Pflicht, nicht Option |

### Codex CLI
| Aspekt | Umsetzung |
|---|---|
| Spawn | `codex exec "<prompt>"` mit JSON-Event-Stream |
| Version-Pinning | `codex --version` im Adapter-Handshake; bei Mismatch Warnung, nicht Abbruch |
| Format-Change-Detection | Unbekannte Event-Typen → `system-warning` + `adapter.degraded`-Badge, niemals still droppen |
| Contract-Test | Fixture-Rohstreams einfrieren; neues CLI-Release → Fixture-Diff-Test |

## 4. Aufgaben

- [x] **T1.1** Event-Normalizer — bewusst **weiterhin nicht** als separate geteilte Bibliothek gebaut, jetzt mit zwei echten Adaptern final geprüft: der tatsächlich gemeinsame Code zwischen `adapter-claude/src/normalize.ts` und `adapter-codex/src/normalize.ts` ist nur `asString()`/`summarize()` (~15 Zeilen generisches String-Handling) — die eigentlichen Mapping-Tabellen sind pro Provider komplett verschieden (Content-Block-Arrays bei claude vs. flache `item.started`/`item.completed` bei codex). Ein geteiltes Paket (+ Workspace-Dependency + eigene ADR-Pflicht als Contract) für 15 Zeilen wäre teurer als die Duplikation. Bewusst dupliziert, nicht extrahiert.
- [x] **T1.2** Adapter `claude` — `packages/adapter-claude/` (Basis-Lifecycle + Steer(prompt) via `--resume`; Steer(resume) ohne Prompt ehrlich `ok:false`, kein `recover()`). Mapping-Ground-Truth: zwei echte `claude -p --output-format stream-json`-Captures (CLI 2.1.263, `test/fixtures/`), **nicht** die vereinfachte Tabelle in §3 — die kannte `hook_started`/`hook_response`/`rate_limit_event` nicht und unterschlug, dass `assistant`/`user` Content-Block-Arrays tragen statt flacher Typen. `thinking`-Mapping unverifiziert (kein Capture mit Extended Thinking vorhanden) — Vermerk in `normalize.ts`, gehört in den Fixture-Korpus von T1.4 nachgezogen.
- [x] **T1.3** Adapter `codex` — `packages/adapter-codex/` (Basis-Lifecycle + Steer(prompt) via `exec resume`, **inkl. Version-Pinning** via `codex --version`-Handshake bei jedem `start()` — Mismatch nur Warnung, nie Abbruch — **und Degraded-Modus**: jedes unbekannte `item`/Top-Level-`type` setzt `status().state = "degraded"`). Mapping-Ground-Truth: drei echte `codex exec --json`-Captures (codex-cli 0.153.4, `test/fixtures/`) — flacher `type` pro Zeile (`thread.started`/`turn.started`/`item.started`/`item.completed`/`turn.completed`), **kein natives Kosten-Feld** irgendwo im Stream (bestätigt: keine `$`-Zahl in `usage`, echte Kosten brauchen T1.11s eigene Preistabelle — seitdem umgesetzt, `capabilities().cost = true`). `reasoning`-Item-Typ unverifiziert (kein Capture mit sichtbarem Reasoning-Trace, `reasoning_output_tokens` war in allen drei Läufen 0).
- [x] **T1.4** Fixture-System — `scripts/capture-adapter-fixture.mjs` (aufzeichnen, Home-/Socket-Pfade anonymisieren, secret-scannen, **verweigert das Schreiben** bei Fund statt selbst zu entscheiden; smoke-getestet gegen die echte `claude`-CLI und gegen einen absichtlich sekret-haltigen Fake-Stream). Contract-Test-Eingang: `checkFixture()`/`loadFixtureLines()`/`assertFixtureEventsValid()` in `@ancientvoid/adapter-testkit` (bisher ungetestetes Paket, jetzt mit eigener Test-Suite) — `adapter-claude` und `adapter-codex` beide darauf umgestellt, Duplikation entfernt.
- [x] **T1.5** Monitor-Dashboard (`packages/pwa/src/Dashboard.tsx`) — Sortierung nach `updatedAt` ("zuletzt aktiv", neues Feld), Kosten-Aggregation via `costUsd` (ADR-0003: neues providerneutrales Event-Feld, `SessionManager` summiert), "wartet auf dich"-Badge bei `waiting_approval`, Traffic-Light über bestehende `.pill.<status>`-Farben (keine zweite, redundante Statusanzeige). **Bewusste Abweichung von §2:** Gruppierung nach **Projekt**, nicht "Rechner" — die Kachel-Hierarchie "Rechner → Projekte → Sessions" setzt Multi-Hub-Aggregation voraus, die nirgends existiert (eine PWA spricht mit genau einem Hub über relative `/api/*`-Pfade); Projekt ist der reale, vorhandene Gruppierungsschlüssel heute. Visuell im echten Browser verifiziert (Playwright, Screenshot). Dabei zwei echte, davor unentdeckte Bugs gefunden und gefixt: BUG-0006 (PWA-Onboarding komplett unerreichbar für ein neues Gerät — Auth-Lücke + falscher Bereitschafts-Check).
- [x] **T1.6** Filter-Engine (`packages/pwa/src/SessionTail.tsx`) — die drei echten Presets aus §2/AC-P1-4 (**Lesen/Überwachen/Debuggen**), nicht die vier ad-hoc aus P0 ("Alle"/"Tool-Calls"/"Denken"). Default **Überwachen**: versteckt `thinking` UND `tool_result`-Payloads > 2 KB (gemessen via `payload.bytes`, wenn K5-geblobbt, sonst JSON-Größenschätzung). LocalStorage, gerätespezifisch, kein Server-Roundtrip. Visuell im echten Browser geprüft (Playwright): alle drei Presets zeigen die erwartete Teilmenge.
- [x] **T1.7** Thinking-Rendering — gedimmt/kursiv (bestehendes `.event.thinking`-CSS), einklappbar (Default eingeklappt, zeigt nur die 200-Zeichen-Summary; ausgeklappt zeigt `payload.text`, falls der Adapter vollen Reasoning-Text mitschickt). In Überwachen ohnehin komplett ausgeblendet (T1.6) — Toggle wirkt praktisch nur in Debuggen.
- [x] **T1.8** Tool-Call-Chips — Status `running`/`ok`/`error` (aus dem Vorhandensein und `isError` des korrelierten `tool_result`), bidirektionale Anker-Navigation (Scroll-to) zwischen `tool_use` und `tool_result` über die gemeinsame `id`/`toolUseId`, die beide echten Adapter (claude, codex) schon konsistent setzen. **Nebenfund:** der `dummy`-Referenzadapter setzte diese Korrelation gar nicht — als Vorlage für neue Adapter unvollständig und machte T1.8 mit ihm untestbar. Nachgezogen (`packages/adapter-dummy/src/index.ts`), ohne die K5-Riesenoutput-Testfixtur zu verändern (die bleibt bewusst unkorreliert, da sie keinen echten Tool-Aufruf-Zyklus simuliert).
- [x] **T1.9** Adapter-Heartbeat (`SessionManager`, `packages/core/src/sessionmanager.ts`) — alle 30 s (`DEFAULT_HEARTBEAT_MS`, konfigurierbar für Tests) ein aktiver `adapter.status()`-Poll pro laufender Session, unabhängig vom passiven `WorkerProcess.onExit`-Pfad (der erkennt nur "Prozess ist weg", nicht "Prozess lebt, antwortet aber nicht mehr"). `down`/`broken` → `status="error"` + sichtbares `adapter.down`-System-Event (Detail, kein stilles Retry). Terminal-Sessions werden nicht erneut angefasst (kein doppeltes Event). Kein neuer Health-Endpunkt nötig — `/api/sessions`/`/api/sessions/:id` tragen den Live-Status schon, das rote Badge ist das bereits bestehende `.pill.error`-CSS (kein zweiter, redundanter Indikator). **Nicht umgesetzt: echte Push-Benachrichtigungen** (AC-P1-5 verlangt "Push-Meldung am Handy") — dafür existiert nirgends im Repo eine Web-Push-Infrastruktur (VAPID-Schlüsselpaar, Subscription-Speicherung, Service-Worker-`push`-Handler); das ist ein eigenständiges Feature, kein Nebenprodukt von T1.9, und bewusst zurückgestellt statt notdürftig nachgebaut.
- [x] **T1.10** K2-Lasttest: 30 Events/s über 10 min durch Dashboard + Tail, Lag < 200 ms — echter Chromium (Playwright) rendert das T1.5-Dashboard + T1.6-Tail live gegen einen echten Hub-Server, `data-seq`-Attribut auf jeder gerenderten Event-Zeile ermöglicht Server-Emit→DOM-Render-Zeitstempel-Matching (`scripts/k2-frame-lag.mjs`). Ergebnis: 18140/18154 Events gematcht, median 3ms, p95 4ms, max 8ms — 0 über dem 200ms-Budget (Messlauf: `docs/messlauf/2026-09-15-k2-frame-lag.md`). **Zweiter AC-P1-3-Teil (Drop-on-slow unter gedrosseltem Netz) fand einen echten Bug**: `dropped:true` reagierte nie auf ein echtes gedrosseltes Netz (Playwright-CDP-Throttling, 20kbit/s), nur auf In-Process-Überlast — behoben und regressionsgetestet, siehe [BUG-0007](../bugs/bug-0007-ws-drop-on-slow-not-network-aware.md).
- [x] **T1.11** Kosten-Schätzung für codex (Token-Counts × eigene Preis-Tabelle; „unbekannt" statt geraten — R9.7-Regel) — `packages/adapter-codex/src/pricing.ts`: sourced price table (`gpt-5.3-codex`: $1.75/$0.175/$14.00 pro 1M Input/Cached-Input/Output-Token, Quelle `developers.openai.com/api/docs/pricing`, abgerufen 2026-09-15 — die einzige dort gelistete Codex-Zeile; ein reines "gpt-5-codex" existiert dort nicht mehr). `spec.model` (bislang toter Wert) wird jetzt tatsächlich als `--model`/`-m` an die echte CLI durchgereicht (verifiziert: `codex exec --help` und `codex exec resume --help` akzeptieren beide `-m`), und derselbe Wert dient `estimateCostUsd()` als Preistabellen-Schlüssel — Modell und Abrechnung laufen also konsistent über dieselbe Quelle. Kein Modell angefragt oder Modell nicht in der Tabelle → `costUsd` bleibt komplett unbesetzt (nie 0, nie geraten) und `payload.costEstimated=false` macht das explizit sichtbar. `capabilities().cost` von `false` auf `true` gedreht (Fähigkeit ist jetzt real vorhanden, exakt wie schon bei `reasoning:true` üblich: real vorhanden, nicht auf jeder einzelnen Turn garantiert befüllt). **Bekannte Grenze, bewusst nicht adressiert:** `SessionRecord.costUsd` bleibt eine reine Summe bekannter Kosten — eine Session mit teils unbekannten Turns zeigt keinen sichtbaren Unterschied zu einer Session, die tatsächlich nichts gekostet hat (derselbe Overload, den der Feldkommentar in `contracts/session.ts` schon vor T1.11 benennt). Eine echte "teilweise unbekannt"-Kennzeichnung auf Session-/Dashboard-Ebene wäre ein Contract-/UI-Umbau über T1.11 hinaus und nicht Teil dieser Aufgabe.

## 5. Acceptance Criteria

- **AC-P1-1:** Task „füge eine Funktion hinzu und teste sie" an claude über Handy gestartet →
  Tail zeigt Thinking, mindestens einen tool_use + tool_result, Abschluss-Event; Kosten im
  Dashboard sichtbar und plausibel (±10 % zur claude-eigenen `total_cost_usd`).
- **AC-P1-2:** Gleicher Flow mit codex ohne einzige Zeile UI-Anpassung (Adapter-Abstraktion
  bewiesen).
- **AC-P1-3 (K2): 🟢 erfüllt.** 30 Events/s über 10 min → kein Frame-Lag > 200 ms
  (18140/18154 gematcht, max 8ms, `docs/messlauf/2026-09-15-k2-frame-lag.md`);
  drop-on-slow greift nachweisbar bei gedrosseltem Netz (3G-Throttling im
  Browser) — erst nach Fix von BUG-0007 (`socket.bufferedAmount`-Prüfung
  fehlte), siehe T1.10.
- **AC-P1-4:** Filter „Überwachen" versteckt Thinking und tool_results > 2 KB; State überlebt
  Reload und ist gerätespezifisch (Desktop zeigt andere Filter als Handy).
- **AC-P1-5: 🟡 teilweise.** Badge-Teil erfüllt: Heartbeat poll(t alle 30 s,
  weit unter 60 s) `adapter.status()` und setzt bei `down`/`broken` sichtbar
  `status=error` (rotes `.pill.error`) + `adapter.down`-Event (T1.9,
  unit-getestet mit simuliertem Ausfall). Push-Teil offen — keine
  Web-Push-Infrastruktur im Repo, siehe T1.9-Vermerk.
- **AC-P1-6:** Anonymisierte Fixtures enthalten keine Secrets (grep-basierter
  Secret-Scanner im CI als Gate).

## 6. Premortem

**Ende P1, gescheitert. Warum?**
1. *Codex-Stream ist instabiler als angenommen* (Issue #4219 in Bewegung) → halber Sprint
   geht in Parser-Rettung. Mitigation: Degraded-Modus von Tag 1, Fixture-Diffs telegrafieren
   Bruch sofort.
2. *Thinking-Streams sind riesig* → K5-Kappung verwässert R4 („voller Reasoning-Trace").
   Mitigation: Thinking landet vollständig im Blob, UI lädt on demand nach — „vollständig"
   heißt abrufbar, nicht sofort gerendert.
3. *Steer/Resume bei claude bricht bei Tool-Use-Sessions* → Mitigation: Resume-Matrix im
   Contract-Test (idle-resume, mid-tool-resume, post-approval-resume).
4. *Dashboard wird zum Generalfix für alle UI-Wünsche* → Scope-Creep. Mitigation: Jede
   Zusatz-UI braucht Ticket + Messlatten-Bezug.

## 7. Definition of Done

Alle ACs grün + beide Adapter als „proven" in der README-Matrix markiert + Kosten-Anzeige
mit Quellenangabe (claude: nativ / codex: eigene Tabelle, Datum) + Fixture-Repo-Hygiene
(Max-Größe, Anonymisierung dokumentiert).

## Retro

**Zeitraum:** T1.2 (`6c52763`) bis T1.11 (`3330af5`), 28 Commits im Bereich
`fbb1844..3330af5` (davon ein Teil interleaved P0-Retro-Action-Items, die
bereits im EPIC-P0-Retro verrechnet sind — hier nur die P1-Commits gezählt:
T1.2, T1.3, T1.4, T1.5, T1.6/7/8, T1.9, T1.10 + BUG-0007, T1.11 = 12
inhaltliche Commits + zugehörige Merge-Commits).

### AK-Matrix

**AC-P1-1:** 🟡 teilweise
Beleg: `packages/adapter-claude/src/normalize.ts:105` (`total_cost_usd`-Extraktion),
`packages/adapter-claude/test/normalize.test.ts` (`checkFixture()` gegen zwei
echte `claude -p --output-format stream-json`-Captures, T1.2).
Bemerkung: Die Mapping-Logik (Thinking/Tool-Calls/Kosten) ist gegen echte,
historisch aufgezeichnete claude-Ausgabe geprüft. Der volle Weg „Task über
Handy gestartet → echter claude-Prozess → Tail zeigt es live inkl.
±10%-Kostenvergleich" wurde in dieser Phase **nie als Live-Lauf
ausgeführt** — jeder Browser-Test in T1.5/T1.6/T1.10 lief gegen den
`dummy`-Adapter, nie gegen einen echten `claude`-Prozess.

**AC-P1-2:** 🟡 teilweise
Beleg: `packages/pwa/src/SessionTail.tsx` (`EventRow` verzweigt ausschließlich
über `event.type`, keine adapter-spezifische Verzweigung — bestätigt per
`grep` über `packages/pwa/src/*.tsx`), `packages/adapter-codex/test/normalize.test.ts`
(T1.3, ebenfalls fixture-geprüft).
Bemerkung: Die UI-Genericity ist strukturell belegt (kein Code-Pfad
unterscheidet nach Adapter-Id). Ein tatsächlicher Seite-an-Seite-Vergleich
„derselbe Flow, claude vs. codex, keine UI-Änderung" wurde nie gefahren —
die Aussage stützt sich auf Code-Inspektion, nicht auf einen ausgeführten
Vergleichslauf.

**AC-P1-3 (K2):** 🟢 erfüllt
Beleg: T1.10, `docs/messlauf/2026-09-15-k2-frame-lag.md` (18140/18154
Events gematcht, max 8ms — Budget 200ms), [BUG-0007](../bugs/bug-0007-ws-drop-on-slow-not-network-aware.md)
(Fix + Regressionstest `packages/server/test/ws.test.ts`).
Bemerkung: Beide Teile des ACs (Lag-Budget und Drop-on-slow unter echtem
Netzwerk-Throttling) real gemessen bzw. gefixt und regressionsgetestet.

**AC-P1-4:** 🟡 teilweise
Beleg: `packages/pwa/src/SessionTail.tsx` (`FILTERS`-Array, `loadFilter()`/
`localStorage`), Epic-Eintrag T1.6 („Visuell im echten Browser geprüft…
alle drei Presets zeigen die erwartete Teilmenge").
Bemerkung: Die Filterwirkung selbst (welche Events ein Preset zeigt/versteckt)
wurde im echten Browser geprüft. Reload-Persistenz und Gerätespezifität
sind durch die `localStorage`-Architektur strukturell gegeben (jede
Browser-Instanz hat eigenen Storage), aber nie durch einen tatsächlichen
Reload-Klick oder einen Zwei-Geräte-Vergleich beobachtet.

**AC-P1-5:** 🟡 teilweise (bereits im T1.9-Eintrag selbst so vermerkt)
Beleg: `packages/core/src/sessionmanager.ts` (Heartbeat, `DEFAULT_HEARTBEAT_MS`),
`packages/core/test/sessionmanager.test.ts` (Heartbeat-Test mit simuliertem
Ausfall).
Bemerkung: Badge-Teil real unit-getestet. Push-Teil fehlt vollständig
(keine Web-Push-Infrastruktur im Repo) — bewusst zurückgestellt, nicht
übersehen.

**AC-P1-6:** 🟡 teilweise
Beleg: `scripts/capture-adapter-fixture.mjs` (verweigert Schreiben bei
Sekret-Fund, T1.4), `.gitlab-ci.yml` (Stage `verify`: nur `typecheck`,
`lint`, `test`, `loadtest` — kein eigener Secret-Scan-Schritt).
Bemerkung: Der Scan existiert real, aber nur **zum Aufzeichnungszeitpunkt**
einer neuen Fixture. Der AC-Wortlaut verlangt „im CI als Gate" — eine
manuell editierte oder ohne das Capture-Skript hinzugefügte Fixture-Datei
würde von der aktuellen Pipeline nicht abgefangen.

### Erkenntnisse

1. **Ground-Truth-Disziplin zahlte sich aus.** Echte CLI-Captures statt
   Doku-Vermutung (T1.2/T1.3) fanden reale Abweichungen von der
   ursprünglichen §3-Tabelle: claude trägt Content-Block-Arrays statt
   flacher Typen, codex zeigte in keinem der drei Captures einen
   `reasoning`-Item-Typ. Beleg: Kommentare in beiden `normalize.ts`-Dateien.
2. **Echtes Browser-Testen fand reale Bugs, die reines `vite build` nie
   gefunden hätte.** BUG-0006 (Onboarding komplett unerreichbar) und
   BUG-0007 (Drop-on-slow reagiert nicht auf echtes Netzwerk-Throttling)
   wurden beide über tatsächliche Playwright-Chromium-Läufe gefunden, nicht
   über Code-Review. Beleg: `bugs/bug-0006-*.md`, `bugs/bug-0007-*.md`.
3. **Premortem-Risiko 1 („Codex-Stream instabiler als angenommen") trat
   nicht ein** — drei echte Captures reichten, der Degraded-Modus fing das
   vorgesehene Sicherheitsnetz wie geplant ab, kein „halber Sprint
   Parser-Rettung". Beleg: T1.3-Eintrag, keine entsprechenden Bug-Dateien.
4. **Premortem-Risiko 2 („Thinking-Streams sind riesig") ist unverifiziert,
   nicht „nicht eingetreten".** Kein einziger realer Capture enthielt
   überhaupt einen Extended-Thinking-Trace (`normalize.ts`: „`thinking`-Mapping
   unverifiziert"). Ob die geplante Mitigation („vollständig im Blob, UI
   lädt on demand nach") unter echten Bedingungen funktioniert, ist damit
   offen — es gibt schlicht noch keine Daten dazu.
5. **Premortem-Risiko 3 („Steer/Resume bricht bei Tool-Use-Sessions") wurde
   nur teilweise mitigiert.** Die geplante Resume-Matrix (idle-resume,
   mid-tool-resume, post-approval-resume) wurde nicht gebaut — es existiert
   genau ein Resume-Test (`packages/adapter-claude/test/adapter.test.ts`:
   „steer(prompt) spawns a resumed process using the captured session_id"),
   der dem idle-resume-Fall entspricht. Mid-tool- und
   post-approval-Resume sind ungetestet.

Premortem-Gesamtbild: 1 von 4 Risiken eindeutig nicht eingetreten (#1), 1
nicht eingetreten (#4, Dashboard-Scope-Creep — jede Abweichung wurde
explizit begründet, siehe T1.5-Eintrag „Bewusste Abweichung von §2"), 1
unverifizierbar mangels Daten (#2), 1 nur teilweise mitigiert (#3).

### Action Items

- **AI-P1-1:** Mindestens einen echten End-to-End-Lauf mit `claude` UND
  `codex` fahren (echter API-Call, über die PWA gestartet) und das Ergebnis
  dokumentieren, um AC-P1-1/AC-P1-2 von 🟡 auf 🟢 zu heben — zurück als:
  nächste Epic-Aufgabe (vor P2-Abschluss, da P2 auf denselben Adaptern
  aufbaut).
- **AI-P1-2:** Sekret-Scan als eigenständigen, wiederholten CI-Schritt in
  `.gitlab-ci.yml` ergänzen (nicht nur Schreibzeitpunkt-Check in
  `scripts/capture-adapter-fixture.mjs`), damit AC-P1-6 auch für manuell
  hinzugefügte oder editierte Fixtures gilt — zurück als: nächste
  Epic-Aufgabe.
- **AI-P1-3:** Resume-Matrix (idle-resume, mid-tool-resume,
  post-approval-resume) für `adapter-claude` nachbauen, wie im
  Premortem-Risiko 3 vorgesehen — besonders relevant, sobald P2 Approvals
  einführt und post-approval-resume erstmals ein echter Pfad wird — zurück
  als: nächste Epic-Aufgabe (P2).
- **AI-P1-4:** `SessionRecord.costUsd`s „teilweise unbekannt vs. tatsächlich
  0"-Overload (T1.11s bekannte Grenze) auflösen, sobald P2s
  Budget-Enforcement eine verlässliche Kostensumme braucht — zurück als:
  ADR + nächste Epic-Aufgabe (P2).

(BUG-0004, weiterhin offen, ist keine neue Erkenntnis dieser Retro — bereits
mit eigener Frist „vor T3.x" versehen, hier nur zur Vollständigkeit erwähnt.)

## Retro-Nachtrag Abnahmestand (2026-11-09)

Read-only-Abgleich der Epic-Datei gegen Repo-Stand (`git log`, Gate-Skripte, `epics/EPIC-P35-*.md` §8.1). Keine offenen MRs.

- **Status:** Code abgeschlossen, Live-Teile offen (T35.10/T35.12)
- **Belegt:** AC-P1-6 als Gate `npm run check:secrets` (MR !319); AC-P1-4 Reload-Persistenz per E2E (MR !319); Push-Code in `modules/push` (P8)
- **Offen:** AC-P1-1 Live-Handläufe + ±10-%-Kostenabgleich → T35.12; AC-P1-5 Geräte-Push → T35.10
- **Gating:** Nachfolger-Epics laufen unter der dokumentierten Umpriorisierung; die Restpunkte sind im P35-Endabnahme-Block gebündelt und werden dort abgenommen, nicht hier erneut abgehakt.
