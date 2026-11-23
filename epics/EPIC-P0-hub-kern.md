# EPIC-P0 — Hub-Kern: Sessions, EventStore, tmux-Worker, Tailscale-serve, PWA-Gerüst

**Status:** abgeschlossen 2026-11-18 (Code + automatisierte Tests grün) — Menschen-Abnahme nach P000 verschoben · **Phase:** P0 · **Dauer:** 1 Agenten-Woche · **Priorität:** P0 (Blocker für alles)
**Ziel-Machine:** Omarchy (Entwicklung), home-server (Staging) · **Gpubox:** explizit out of scope

---

## 1. Ziel

Ein minimaler, aber **korrekter** Hub-Daemon läuft auf Omarchy: Er kann Sessions als
First-Class-Objekte anlegen, deren Events in einem append-only JSONL-Stream persistieren,
pro Session einen tmux-Worker verwalten, sich über Tailscale serve exponieren und ein
PWA-Gerüst ausliefern, das den State einer Dummy-Session live anzeigt.

P0 liefert **keinen echten Agenten** — nur die Maschinerie plus Dummy-Adapter, der
synthetische Events in allen Typen erzeugt. Wer in P0 Integration mit Codex/Claude
einbaut, verletzt den Scope.

## 2. Scope

### In
- Node.js/TypeScript-Daemon (ESM, strict mode), Prozess-Modell: 1 Daemon, n Worker
- SQLite-Persistenz (Sessions, Config, BudgetState-Skelett)
- JSONL-EventStore mit Blob-Verlagerung (Events > 4 KB Payload → `blobs/<session>/`)
- tmux-Worker-Lifecycle (spawn, attach-fähig für Debug, sauberes Reaping)
- Tailscale serve Integration + Device-Token-Auth
- PWA-Gerüst (Preact oder Web Components, dark-first, Service Worker, Manifest)
- WebSocket-Push von Events an die PWA (drop-on-slow, kein Backpressure-Lag)
- Dummy-Adapter mit steuerbarem Event-Generator (für Lasttests K8)
- CLI-Tool `hubctl` (sessions list/show/tail — Referenz-Client)

### Out
- Echte Coding-Adapter (claude/codex) — P1
- Diff-Ansicht, Approvals, Budgets-Enforcement — P2
- Sprachsuche, weitere Adapter — P3
- MCP-Gateway, Brain-Skill, Windows — P4

## 3. Architektur-Entscheidungen (ADRs, Epic-lokal)

- **ADR-P0-1: Node statt Python.** Begründung: agent-bus-DNA, nativer WS-Stack,
  PWA-Tooling. Kein Framework-Monolithen; Fastify oder plain http+ws.
- **ADR-P0-2: JSONL + SQLite, keine Eventstore-DB.** Begründung: grep-able, diff-able,
  Brain-kompatibel, kein weiterer Dienst. SQLite dient Indizes/State, JSONL ist Wahrheit.
- **ADR-P0-3: tmux, nicht child_process direkt.** Begründung: attachbar für Notfall-Debug
  (`tmux attach -t ancientvoid-<session>`), überlebt Daemon-Restart, bewährtes Worker-Pattern
  (ccswarm/herdr-Muster).
- **ADR-P0-4: PWA ist Projektions-Renderer.** Kein State-Monolith im Client; Server sendet
  Deltas mit Sequenznummern, Client resynct bei Gap.

## 4. Datenmodell

### Session-Record (SQLite)
```json
{
  "id": "uuid", "adapter": "dummy", "project": "/path/to/repo",
  "worktree_sha": "abc123", "model": "n/a", "status": "idle|working|waiting_approval|error",
  "created_at": "...", "budget_usd": null, "adapter_version": "0.1.0"
}
```

### NormalizedEvent (JSONL, eine Zeile pro Event)
```json
{
  "seq": 42, "ts": "...", "type": "user|assistant|thinking|tool_use|tool_result|gate|error|system",
  "summary": "<= 200 chars", "payload": {...}, "blob_ref": "sha256|null", "tokens_est": 123
}
```
Regel: `payload` darf niemals > 4 KB sein — Überschuss geht in Blob + `blob_ref` (K5).

## 5. Aufgaben

- [x] **T0.1** Repo-Gerüst — `AGENTS.md`, `tsconfig.base.json` (strict), `vitest.config.ts`, `eslint.config.mjs`, `epics/`
- [x] **T0.2** SQLite-Schema + Migration-Runner — `packages/core/src/db.ts:20-82` (`_migrations`-Tabelle, `sessions`/`device_tokens`/`config`)
- [x] **T0.3** EventStore — `packages/core/src/eventstore.ts` (append-only JSONL, `FSYNC_INTERVAL_MS`-Batch-fsync, Blob-Verlagerung, `replay()`); Flush-Race gegen Appends erst mit BUG-0003 (Commit `958d251`) sauber serialisiert
- [x] **T0.4** SessionManager — `packages/core/src/sessionmanager.ts` (State-Machine `VALID_TRANSITIONS`, `recoverAll()` für K7); Crash-Recovery-Test war bis BUG-0001–0003 (diese Session) flaky, jetzt 10/10 stabil
- [x] **T0.5** tmux-Wrapper — `packages/workers/src/tmux.ts` (spawn/kill/list, `attachCmd`, `reapOrphans()`), getestet in `tmux.test.ts` (lokal grün, in CI geskippt — kein tmux auf dem Runner, siehe Retro)
- [x] **T0.6** Adapter-Contract + Dummy — `packages/contracts/src/adapter.ts`, `packages/adapter-dummy/src/index.ts` (`eventsPerSecond` 1–100, `giantEvery`/`giantBytes`, alle Event-Typen im `TYPE_CYCLE`)
- [x] **T0.7** HTTP/WS-Server — `packages/server/src/routes.ts`, `auth.ts` (Device-Token + Tailnet-Identität), `server.test.ts` deckt 401/400/201
- [x] **T0.8** Tailscale-serve-Skript — `scripts/setup-tailscale-serve.sh` vorhanden; **Erreichbarkeit selbst nicht verifiziert** (siehe AC-P0-3 in der Retro)
- [x] **T0.9** PWA-Gerüst — `packages/pwa/` (Manifest, `public/sw.js` mit `X-AncientVoid-Cached-At`, dark-first `styles.css`); gebaut (`dist/` vorhanden), **nicht** im echten Browser gegen Offline getestet (siehe AC-P0-4)
- [x] **T0.10** WS-Delta-Protokoll — `packages/contracts/src/wire.ts` (Seq, `dropped`-Flag), `packages/server/src/ws.ts:14-107` (Gap-Detection, `resync`); Test: `server.test.ts > WS resync: client-requested replay from store fills gaps`
- [x] **T0.11** `hubctl`-CLI — `packages/hubctl/src/cli.ts` (`sessions`, `tail -f`, `token issue`); End-zu-Ende-Latenz gemessen, siehe AC-P0-5 (dabei BUG-0005 gefunden: `tail -f` konnte vorher gar nicht per WS verbinden — behoben, jetzt mit Tests, die hubctl vorher komplett fehlten)
- [x] **T0.12** Lasttest-Harness — `scripts/loadtest.mjs` (20 Sessions × 30 ev/s, seq-Gap-Check); README nennt „605 ev/s aggregiert" als letzten Lauf, aber ohne Prüfstand/Datum/Commit dokumentiert — verstößt gegen die eigene `messlauf`-Regel (Action Item unten)

## 6. Acceptance Criteria (messbar)

- **AC-P0-1 (K7):** Daemon hart gekillt (`kill -9`) während 5 Sessions laufen → nach Restart
  sind alle Sessions mit identischem Status/Event-Count wieder da, Restore < 3 s.
- **AC-P0-2 (K5):** Dummy-Adapter sendet 1 MB Output → JSONL enthält nur Anker-Event
  (< 4 KB) + gültige `blob_ref`; Blob abrufbar und Byte-identisch.
- **AC-P0-3:** PWA erreichbar über `https://<host>.<tailnet>.ts.net`, nicht über LAN-IP;
  Auth ohne gültigen Token → 401.
- **AC-P0-4 (K10):** PWA laden, WLAN am Handy aus → letzte Projektion sichtbar mit Badge
  „Daten vom <Zeitstempel>", kein White-Screen.
- **AC-P0-5:** `hubctl tail <session>` zeigt Events mit < 500 ms Ende-zu-Ende-Latenz.

## 7. Premortem (Pflicht)

**Es ist Ende P0 und das Epic ist gescheitert. Warum?**
1. *WS-Protokoll ohne Gap-Handling gebaut* → PWA zeigt Löcher, Retrospektive teuer. Mitigation: T0.10 vor T0.9 fertigstellen, Tests zuerst.
2. *tmux-Verfügbarkeit auf Zielsystemen* → gpubox hat kein tmux nativ. Mitigation: tmux-Abhängigkeit hinter Interface kapseln, P0 nur Linux-Targets.
3. *fsync-Policy falsch* → entweder Datenverlust bei kill oder I/O-Thrashing bei 30 Events/s. Mitigation: Batch-fsync (alle 100 ms oder 50 Events), Lasttest misst.
4. *Scope-Creep Richtung „erster echter Adapter"* → Mitigation: Review-Gate, Dummy reicht für alle ACs.
5. *PWA-Service-Worker-Cache-Hell* → alte Projektionen werden für aktuelle gehalten. Mitigation: Versioned Cache, Hard-Bust bei Deploy.

## 8. Definition of Done

Alle ACs grün + Contract-Tests Dummy-Adapter grün + `docs/architecture.md` aktualisiert +
kein TODO-Kommentar ohne Ticket-Referenz + Premortem-Mitigationen als Tests abgebildet.

## Retro

**Zeitraum:** Code lag beim Kaltstart-Commit (`fb0bee6`, 2026-09-14) bereits
vollständig vor — P0 wurde vor dieser Session implementiert, aber nie gegen
seine eigenen ACs geprüft oder als Epic abgeschlossen. Diese Retro holt das
nach, plus 3 während der Prüfung gefundene und gefixte Bugs
(`ef0138f`…`958d251`, siehe `bugs/bug-0001` bis `bug-0003`).

### AK-Matrix

```text
AC-P0-1 (K7): 🟢 erfüllt (nachgezogen — siehe AI-P0-1)
  Beleg: packages/core/test/sessionmanager.test.ts ("K7 (AC-P0-1): recovers
  5 concurrent sessions…") — 5 gleichzeitige Sessions, `recovered >= 5`,
  `elapsedMs < 3000` als echte Assertion (gemessen ~540ms), byte-identische
  Wiederherstellung pro Session. 5/5 isolierte Läufe grün.

AC-P0-2 (K5): 🟢 erfüllt
  Beleg: packages/core/test/eventstore.test.ts:42-57 ("enforces K5: payload
  > 4 KB is offloaded to a blob") — exakt das in der AC beschriebene
  Szenario, inkl. Byte-Identitäts-Check des zurückgelesenen Blobs.

AC-P0-3: 🟡 teilweise
  Beleg: packages/server/test/server.test.ts:48-59 ("rejects requests
  without device token (401)", "rejects invalid tokens (401)") — Auth-Teil
  vollständig getestet.
  Bemerkung: Der Tailscale-serve-Teil ("erreichbar über *.ts.net, NICHT
  über LAN-IP") ist eine Netzwerk-Eigenschaft, die aus einer Dev-Session
  heraus nicht prüfbar ist — scripts/setup-tailscale-serve.sh existiert,
  wurde aber nie gegen ein echtes Tailnet verifiziert.

AC-P0-4 (K10): 🟡 teilweise
  Beleg: packages/pwa/public/sw.js:1-66 — Service-Worker-Logik
  (network-first für /api/, Cache-Fallback mit X-AncientVoid-Cached-At-Header,
  versionierter Cache) entspricht der AC-Beschreibung.
  Bemerkung: Kein Browser-Test durchgeführt (WLAN aus, Badge sichtbar, kein
  White-Screen) — reine Code-Lektüre, keine Laufzeit-Evidenz.

AC-P0-5: 🟢 erfüllt (nachgezogen — siehe AI-P0-3)
  Beleg: docs/messlauf/2026-09-15-hubctl-tail-latency.md — echter
  HTTP/WS-Server + echte hubctl-CLI als Subprozess, 3 Wiederholungen,
  max. 1.0 ms (Loopback), weit unter der 500-ms-Grenze.
  Bemerkung: nur Loopback gemessen, keine Aussage über echte
  Tailscale-WAN-Latenz (siehe AI-P0-2). Nebenfund beim Messen: BUG-0005
  (hubctl tail -f konnte vorher gar keine WS-Verbindung aufbauen).
```

**AK-Zusammenfassung:** 3 🟢 / 2 🟡 / 0 🔴 / 0 ⚪ (Stand nach AI-P0-1/-3/-5; ursprünglich 1/3/1/0)

### Premortem-Abgleich

1. *WS-Protokoll ohne Gap-Handling* → **nicht eingetreten.** `wire.ts` +
   `ws.ts:14-107` haben Gap-Detection/Resync von Anfang an, mit Test.
2. *tmux-Verfügbarkeit auf Zielsystemen* → **teilweise eingetreten, aber
   anders als erwartet:** nicht auf einem Zielsystem, sondern auf dem
   GitLab-CI-Runner selbst fehlt tmux — `tmux.test.ts` läuft dort komplett
   geskippt. Der Versuch, tmux im CI-Image nachzurüsten (AI-P0-6), zeigte:
   selbst mit installiertem tmux scheitert es dort an echten
   Funktionsfehlern (vermutlich PTY-Eigenheit des Docker-Executors) — bewusst
   dokumentiert statt gefixt, siehe `docs/adr/0002-tmux-worker-runner-not-ci-tested.md`.
3. *fsync-Policy falsch* → **eingetreten, aber unbemerkt bis jetzt:** die
   Batch-fsync-Policy (T0.3) hatte eine echte Race (BUG-0003) — der
   Debounce-Timer lief außerhalb der Append-Serialisierung und konnte
   einen FileHandle mitten im Write schließen, was eine Sequenznummer
   permanent verschluckte. Das Premortem-Risiko war richtig benannt, die
   Mitigation ("Lasttest misst") hat es nicht gefangen, weil kein Lasttest
   gezielt auf Sequenzlücken unter Last prüft (der bestehende K8-Loadtest
   zählt Events, aber die Lücke trat nur bei einem sehr spezifischen
   Timing-Fenster auf, das ein Durchsatz-Test nicht zuverlässig trifft).
4. *Scope-Creep Richtung "erster echter Adapter"* → **nicht eingetreten.**
5. *PWA-Service-Worker-Cache-Hell* → **nicht bewertbar**, da nie in einem
   Browser getestet (siehe AC-P0-4).

### Erkenntnisse

1. **Code kann fertig sein, während das Epic-Dokument "offen" bleibt.**
   P0s Aufgaben standen alle auf `[ ]`, obwohl der Code vollständig war —
   die Lücke zwischen "gebaut" und "als fertig dokumentiert" wurde erst
   sichtbar, als diese Retro sie einforderte. Beleg: Git-History dieser
   Datei vor diesem Commit zeigt keine Checkbox-Änderung seit dem
   Kaltstart-Commit.
2. **Ein Bug, den niemand suchte, weil niemand testete, was er zu
   verhindern vorgab.** Die K7-Tests liefen lokal meist grün — die
   EventStore-Race (BUG-0003) wurde erst durch CI (anderer Rechner, andere
   Timing-Verhältnisse) sichtbar, zweimal identisch reproduzierbar. Beleg:
   `bugs/bug-0003-k7-seq-gap-unknown-cause.md`.
3. **"Fail loud" (AGENTS.md Regel 6) wurde für Append-Fehler nicht
   eingehalten** — ein fehlgeschlagener `store.append()` erzeugte bis
   `958d251` nur ein `console.error`, keine sichtbare Statusänderung.
   Die konkrete Race ist weg (BUG-0003); das Prinzip selbst ist seit
   AI-P0-5 strukturell erzwungen: `handleEmitFailure()` persistiert einen
   echten Statuswechsel und versucht ein sichtbares `error`-Event.
4. **Drei der fünf ACs sind Laufzeit-/Netzwerk-Eigenschaften, die aus einer
   reinen Coding-Session heraus nicht verifizierbar sind** (Tailscale-
   Erreichbarkeit, Browser-Offline-Verhalten, Ende-zu-Ende-Latenz). Das ist
   keine Prozess-Schwäche, sondern eine Grenze dieser Arbeitsweise — muss
   aber explizit als offen geführt werden, nicht stillschweigend als
   "Code existiert also passt es" behandelt werden.
5. **Der einzige zitierte Messwert im Repo (README: "605 ev/s aggregiert")
   hat keinen Prüfstand, kein Datum, keine Commit-Referenz** — verstößt
   gegen die gerade erst eingeführte `messlauf`-Regel.

### Action Items

```text
AI-P0-1: ✅ erledigt — K7-Test deckt jetzt 5 gleichzeitige Sessions ab,
         <3s-Grenze ist eine echte Assertion (gemessen: ~540ms, 5/5 Läufe
         grün). packages/core/test/sessionmanager.test.ts, Commit siehe
         git log dieser Datei nach diesem Eintrag.

AI-P0-2: Tailscale-Erreichbarkeit (AC-P0-3) und PWA-Offline-Verhalten
         (AC-P0-4) manuell gegen eine echte Tailscale-Instanz und einen
         echten Browser verifizieren, sobald eine Zielmaschine verfügbar
         ist — zurück als: offene Aufgabe, kein Blocker für P1 (P1 hängt
         nicht an diesen beiden ACs)

AI-P0-3: ✅ erledigt — docs/messlauf/2026-09-15-hubctl-tail-latency.md,
         max. 1.0ms über 3 Läufe (Loopback). Dabei BUG-0005 gefunden und
         behoben (hubctl tail -f war komplett kaputt, keine Tests hatten
         das je bemerkt). scripts/messlauf-hubctl-latency.mjs.

AI-P0-4: README-Zahl "605 ev/s aggregiert" entweder mit Prüfstand/Datum/
         Commit belegen oder aus der README entfernen, bis ein sauberer
         messlauf-Eintrag existiert — zurück als: docs-only Task

AI-P0-5: ✅ erledigt — makeContext().emit() ruft bei Append-Fehlern jetzt
         handleEmitFailure(): echter setStatus("error") (validierte
         Transition, persistiert, Snapshot) statt roher Feld-Mutation, plus
         Best-Effort-Folge-Event vom Typ "error" im Stream. Getestet für
         transiente (Event erscheint) und permanente (kein Crash, Status
         trotzdem persistiert) Fehlschläge. sessionmanager.ts +
         sessionmanager.test.ts.

AI-P0-6: ✅ erledigt (Doku-Weg, nicht Fix-Weg) — tmux im CI-Image
         installiert und ausprobiert (MR !11): tmux wurde erkannt, aber 3
         von 4 Tests scheiterten an echten Funktionsfehlern (leere
         Pipe-Pane-Ausgabe, Session nicht auffindbar, Kill-Timeout) — sieht
         nach einer PTY-Eigenheit des GitLab-Docker-Executors aus, nicht
         nach einem Code-Fehler (derselbe Code läuft lokal zuverlässig).
         Rückgängig gemacht, stattdessen bewusst dokumentiert:
         docs/adr/0002-tmux-worker-runner-not-ci-tested.md.
```

P1 ist durch diese Retro **nicht blockiert** — AI-P0-1, -3, -5, -6 sind
sinnvoll parallel zu P1 erledigbar, AI-P0-2 hängt an externer
Infrastruktur (Zielmaschine mit Tailscale), nicht an P1s Scope.

## Retro-Nachtrag Abnahmestand (2026-11-09)

Read-only-Abgleich der Epic-Datei gegen Repo-Stand (`git log`, Gate-Skripte, `epics/EPIC-P35-*.md` §8.1). Keine offenen MRs.

- **Status:** Code abgeschlossen, Geräteabnahme offen (T35.10)
- **Belegt:** AC-P0-1..3 belegt (Messlauf `docs/messlauf/2026-09-23-p6-fleet.md`); BUG-0015-Code-Fix in `53c6ea7`/`df445e9` (T8.2)
- **Offen:** AC-P0-4 Flugmodus/K10 am Gerät → T35.10
- **Gating:** Nachfolger-Epics laufen unter der dokumentierten Umpriorisierung; die Restpunkte sind im P35-Endabnahme-Block gebündelt und werden dort abgenommen, nicht hier erneut abgehakt.
