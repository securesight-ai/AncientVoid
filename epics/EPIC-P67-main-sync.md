# EPIC-P67 — Main-Sync: frischer Main beim Start, laufende Synchronisation, einstellbar

**Status:** umgesetzt (T67.1–T67.9, PRs #149–#158, `verify` grün) — T67.10 Abnahme nach P000 · **Phase:** P67

Quelle: Nutzerauftrag vom 18.11.2026 (Folge der Qwen-Nacht, BUG-0209). Der
Haupt-Checkout stand 178 Commits hinter `origin/main`; jede neue Session
verzweigte davon, weil der Worktree-Manager am **lokalen** `HEAD` ansetzt und nie
fetcht. Gewünscht: (1) jede neue Session startet auf dem neuesten Main,
(2) Sessions werden danach selbständig synchronisiert oder der Nutzer bekommt
einen Vorschlag, (3) Zeitpunkt, Häufigkeit, autonom oder mit Bestätigung und
Auto-Merge von Main sind in den Einstellungen wählbar — mit dem Ziel, Konflikte
früh und klein zu halten.

## 1. Ziel

Kein Agent arbeitet unbemerkt auf einem veralteten Stand. Drei Stufen, jede
für sich auslieferbar:

1. **Frischer Start:** Eine neue Session legt ihren Worktree auf dem
   aktuellen `origin/<Hauptbranch>` an, nicht auf dem zufälligen lokalen
   Stand. Schlägt das fehl (offline, kein Remote, Auth), startet sie
   trotzdem — mit sichtbarem Event, nie still (AGENTS.md Regel 6).
2. **Laufende Synchronisation:** Der Hub prüft periodisch, wie weit
   Session-Branches hinter dem Hauptbranch liegen, und handelt nach Einstellung:
   nur melden, mit Bestätigung mergen oder autonom mergen.
3. **Einstellbar und sichtbar:** Ein Einstellungsabschnitt „Main-Synchronisation“
   (global, pro Projekt überschreibbar) und in der Session ein Hinweis
   „N Commits hinter main“ mit Aktionen. Konflikte werden vorab erkannt
   (Probelauf) und nie halb angewendet.

Messlatten: **K7** (Zustand aus JSONL + Settings rekonstruierbar, kein neuer
flüchtiger Zustand), **K10** (offline: lokaler Fallback + Zeitstempel des
letzten erfolgreichen Abgleichs, kein White-Screen), **K5** (Event-Payloads
≤ 4 KB, Dateilisten gekürzt), **K8** (Prüfungs-Takt darf Loadtest nicht
verfälschen: 20 Sessions ⇒ ein Fetch je Projekt, nicht je Session).

## 2. Scope (In / Out)

**In:**

- Stufe 1: `WorktreeManager.create` mit optionalem `git fetch` des Hauptbranchs
  (Timeout, Fehlerpfad) und Basis `origin/<Hauptbranch>`; Erkennung des
  Hauptbranchs (`origin/HEAD`, sonst konfigurierbar, sonst `main`).
- Stufe 2: Sync-Engine (Zählung hinter/vor, Probelauf per `git merge-tree
  --write-tree`, Merge von `origin/<Hauptbranch>` in den Session-Worktree,
  Abbruch bei Konflikt), Scheduler mit je-Projekt-Fetch, Modi `notify` /
  `ask` / `auto`, Gating „nur wenn die Session wartet“.
- Stufe 3: Einstellungen (Contract, Speicher, API, Policy), PWA-Abschnitt,
  Session-Indikator mit Aktionen, Benachrichtigung mit Aktionsknopf,
  `hubctl`-Befehl.
- ADR (nächste freie Nummer nach 0087) und Contract für Einstellungen und
  Events — vor dem Code (AGENTS.md Regel 1).

**Out:**

- Das Aktualisieren/Neustarten des **laufenden Hubs** selbst (Deployment des
  Haupt-Checkouts, `npm install`, PWA-Build, Service-Restart). Das ist ein
  eigener Ablauf mit Risiko (BUG-0209 entstand genau dort); ein Hinweis
  „Hub-Checkout ist N Commits hinter main“ ist höchstens Folgeaufgabe.
- Rebase/Force-Push der Session-Branches, jede History-Umschreibung.
- Auflösung von Merge-Konflikten durch den Hub (ein Agent oder der Mensch
  löst sie in der Session; der Hub erkennt und meldet nur).
- Fleet-übergreifender Sync (andere Hosts), Submodule, Nicht-Git-Projekte
  (bekommen wie heute `session.no_worktree_isolation`).
- Automatisches Pushen oder Mergen **nach** main — das bleibt `apply()`/PR.

## 3. Design-Details

### 3.1 Befund (Ist-Stand, Stand 2026-11-18)

`WorktreeManager.create` (`packages/core/src/modules/workspace/worktree.ts`)
ruft `headSha(projectPath)` und `git worktree add -b ancientvoid/<id> <path>
<baseSha>` auf; `baseSha` wird als `record.worktreeSha` gespeichert und für
Manifest-Auflösung (P29), Diff-Basis und `hasWork` benutzt. Es gibt kein
`fetch`, keinen Vergleich mit `origin` und keine Einstellung. Ein
`git merge` von Main in eine Session gibt es nirgends; `apply()` mergt in
Gegenrichtung.

### 3.2 Basis wählen (Stufe 1)

- Ziel-Ref: `origin/<Hauptbranch>`; Hauptbranch aus `refs/remotes/origin/HEAD`,
  Override in den Einstellungen.
- **Nur** umbasieren, wenn der Projektordner auf dem Hauptbranch steht (oder
  der Nutzer es für das Projekt erzwingt). Steht er auf einem Feature-Branch,
  bleibt die heutige Basis (lokaler `HEAD`) — bewusst, sonst würden Sessions auf
  Feature-Arbeit die Grundlage verlieren. Event `workspace.main_sync_skipped`
  mit Grund.
- Der lokale `main` im Projektordner wird **nie** angefasst (kann dirty sein,
  der Nutzer arbeitet dort). Der Worktree entsteht direkt auf `origin/main`;
  `apply()` mergt später ganz normal.
- `fetch` mit hartem Timeout (Vorschlag 10 s, einstellbar), ohne Credentials
  des Hubs — es gelten die vorhandenen Git-Zugangsdaten des Nutzers
  (SSH-Agent/Credential-Helper). Kein interaktiver Prompt (`GIT_TERMINAL_PROMPT=0`).
- Fehlerpfad: Fallback auf lokalen `HEAD`, Event `workspace.main_sync_failed`
  (Grund: offline/auth/timeout/kein Remote), Hinweis in der Session. Der Start
  wird nie blockiert (K10).
- Basis-SHA ist weiterhin `record.worktreeSha`; Manifest- und Diff-Pfade
  bleiben unverändert (sie lesen den SHA, nicht den Branchnamen).

### 3.3 Sync-Engine (Stufe 2)

- **Messen:** `rev-list --left-right --count HEAD...origin/<main>` im
  Worktree → `behind`/`ahead`, plus Zeitstempel des letzten Fetch.
- **Probelauf:** `git merge-tree --write-tree` (nur lesend, kein Index/Worktree
  berührt) liefert „sauber“ oder die Konfliktdateien (gekürzt, K5).
- **Anwenden:** `git merge origin/<main>` im Session-Worktree mit
  Commit-Notation-konformer Nachricht (`. a worktree: origin/main eingemischt`),
  damit der `commit-msg`-Hook greift, statt ihn zu umgehen. Bei Konflikt oder
  Fehler sofort `git merge --abort`; Worktree bleibt unverändert (Muster
  aus `apply()`).
- **Gating:** Angewendet wird nur, wenn die Session **nicht arbeitet**
  (`idle`/`parked`/`interrupted`, kein offener Zug, kein offener Prozess) und
  der Worktree sauber ist oder der Merge nachweislich keine ungesicherten
  Dateien berührt. Während `working` wird höchstens gemeldet. Ein Merge unter
  den Füßen eines laufenden Agenten ist ausgeschlossen.
- **Kein Prompt-Eingriff:** Der Hub schreibt nichts in den Prompt der
  Session; Ergebnis steht als Event im Verlauf (PRD §8.5). Der nächste Zug
  sieht den neuen Stand im Worktree.
- **Journal (K7):** `workspace.main_sync_checked {behind, ahead, clean}`,
  `…_applied {from, to, files}`, `…_conflict {files}`, `…_skipped {reason}`,
  `…_failed {reason}`. Der angezeigte Zustand wird aus Events + Git
  gefaltet; kein zusätzlicher Speicher.

### 3.4 Scheduler

- Ein Takt je **Projekt**, nicht je Session: ein `fetch`, dann Zählung für alle
  Sessions dieses Projekts (K8). Intervall einstellbar (Vorschlag 5 – 1440 min,
  Default 60), `0` = aus.
- Läuft nur, solange der Hub läuft; beim Start einmal nachholen (kein
  persistenter Timer-Zustand nötig, K7). Gleichzeitige Läufe pro Projekt
  werden zusammengefasst.
- Modi bei `behind > 0`:
  - `notify`: Benachrichtigung „Projekt X ist N Commits hinter main“ (ein
    Eintrag je Projekt und Stand, Anzahl der Sessions im Detail — BUG-0224:
    je Session meldeten 41 Sessions 41 identische Rows; erneut erst bei
    Änderung des Standes, nicht mit jedem Takt).
  - `ask`: wie `notify`, mit Aktionsknopf „Jetzt aktualisieren“ (Probelauf
    vorher sichtbar; führt zur Anker-Session des Projekts).
  - `auto`: Merge nach 3.3, sobald die Session wartet; Ergebnis als Event
    und Benachrichtigung (`info`, bei Konflikt `action`).
- Auto-Merge hat eine eigene Einstellung (siehe 3.5): `off` / `nur sauber` /
  `mit Rückfrage`.

### 3.5 Einstellungen

Contract `MainSyncSettings` in `packages/contracts/src/workspace/`
(Zod, additiv), global mit Überschreibung je Projekt:

| Feld | Werte | Default |
|---|---|---|
| `startSync` | `off` · `fetch-base` | `fetch-base` |
| `fetchTimeoutSec` | 2–60 | 10 |
| `defaultBranch` | Name oder leer (= `origin/HEAD`) | leer |
| `checkIntervalMin` | 0 (aus) · 5–1440 | 60 |
| `behindAction` | `notify` · `ask` · `auto` | `notify` |
| `autoMerge` | `off` · `clean-only` · `ask` | `off` |
| `onlyWhenIdle` | true | true (nicht abschaltbar im ersten Wurf) |

Die konservativen Defaults ändern bestehendes Verhalten nur an einer Stelle:
Stufe 1 ist **an** (sie ist der Kern des Auftrags und risikoarm, weil sie nur
die Basis eines neuen Worktrees wählt). Alles Autonome ist **aus**, bis der
Nutzer es wählt. Speicherort: bestehende `config`-Tabelle (wie
`/api/settings/gemini`), Recovery = Defaults bei fehlendem Eintrag (K7). Policy
`settings.manage`. Prüfung gegen Erweiterung ohne Contract-Bruch per
Contract-Test.

### 3.6 PWA und hubctl (Stufe 3)

- Einstellungen: Abschnitt „Main-Synchronisation“ (Baustein-Bibliothek aus
  P63, Tokens, Mobile ≥ 44 px), globaler Schalter-Block plus Projekt-Liste
  mit Überschreibungen; Erklärtexte nennen, was **nicht** passiert (kein
  Rebase, kein Push, kein Eingriff in laufende Züge).
- Session: Hinweis „N hinter main“ im Kopf/`WorkplaceBadge` (nur wenn
  `behind > 0`), Menü mit „Prüfen“ (Probelauf, Konfliktliste), „Aktualisieren“,
  Zeitstempel „zuletzt abgeglichen“ (K10-Stand offline).
- Benachrichtigung: gleiche Taxonomie wie P64/P65 (`action` bei Rückfrage/
  Konflikt, `info` bei erfolgreichem Auto-Merge); Aktionsknopf ruft denselben
  Endpunkt wie das Menü.
- `hubctl main-sync <sessionId|--project> [--check|--apply]` für Skripte und
  Agenten.
- API: `GET/PUT /api/settings/main-sync`, `GET /api/sessions/:id/main-sync`
  (Messung + Probelauf), `POST /api/sessions/:id/main-sync` (anwenden).

## 4. Aufgaben (Checkliste T67.m)

- [x] **T67.1** ADR-0088 + Contract `MainSyncSettings` und Event-Payloads (Zod, additiv, Contract-Test). Messlatte K5/K7. — **PR #149** (ADR-0088; `main-sync.ts` mit 20 Contract-Tests, additives Lesen beidseitig belegt).
- [x] **T67.2** Stufe 1: Basis-Ermittlung, `fetch` mit Timeout/`GIT_TERMINAL_PROMPT=0`, `create()` auf `origin/<main>`, Fehlerpfad + Events. — **PR #151** (12 Tests gegen echte Tmp-Repos mit Bare-„origin“: veraltet/offline/Timeout/Feature-Branch/no-remote/origin-HEAD/Override + SessionManager mit `worktreeSha`- und Event-Beleg).
- [x] **T67.3** Einstellungs-Speicher, API und Policy (global + Projekt-Override, Defaults, Validierung). Recovery-Test (K7). — **PR #152** (`MainSyncSettingsService` auf config-Tabelle, `GET/PUT /api/settings/main-sync`, 9+6 Tests inkl. K7-Recovery und 400/403/501).
- [x] **T67.4** Sync-Engine: Messung, Probelauf (`merge-tree`), Anwenden mit Abbruch, Gating, Journal-Events. — **PR #153** (11 Tests: sauber/FF/Merge mit Notation/Hash-Gleichheit nach Abbruch/dirty/up-to-date + SessionManager-Gating AC-P67-6 + K7-Faltung `lastSyncedAt`).
- [x] **T67.5** Scheduler: ein Fetch je Projekt, Intervall, Nachholen beim Start, Modi, Entprellen. K8-Test. — **PR #154** (8 Tests; 20 Sessions ⇒ **1 Fetch**; Intervall/aus; Debounce je Stand; realer Auto-Merge ohne zweiten Fetch; busy ⇒ kein `apply`).
- [x] **T67.6** Benachrichtigungen + Aktionsknopf (Taxonomie P64/P65), Anbindung an Policy. — **PR #155** (`NotificationAction` additiv + Migration 38; `pushNotification`; `GET/POST /api/sessions/:id/main-sync`; Policy `main-sync.apply` = Menschenfläche — Invariante „agent never writes directly“ per Nachtrag 29563e83; Glow/Sound action bei Rückfrage/Konflikt).
- [x] **T67.7** PWA-Einstellungsabschnitt (global + Projekt-Override) mit Spec. — **PR #155** (zweiter Commit; `main-sync-settings.spec.ts` 3 Tests gegen API gelesen; daneben `settings-layout.spec.ts` repariert, die seit P65 auf main rot war).
- [x] **T67.8** PWA-Session-Indikator + Menü (Prüfen/Aktualisieren/Konflikte) mit Spec; Layout-Nachweis mobil. — **PR #157** (`main-sync-session.spec.ts` 2 Tests gegen echtes Bare-„origin“: voller Ablauf inkl. live gespielter AC-P67-6-Verweigerung; Geometrie-Beweis 390 px, `elementFromPoint`).
- [x] **T67.9** `hubctl main-sync` + Eintrag in `docs/funktionsinventar.md`, Bedienhinweis, `docs/main-sync.md`. — **PR #158** (hubctl check/apply/--project/--settings, 4 Format-Tests; G75; how-to-Seite gelistet; Referenz regeneriert).
- [ ] **T67.10** Abnahme am echten Remote (Nutzeraufgabe): veralteter Haupt-Checkout, neue Session startet frisch; `ask`-Ablauf am Handy; Konfliktfall echt provoziert. — **Offen, Kai** — Schritte unten im Abschluss-Block. → nach P000 verschoben

Reihenfolge: T67.1 → T67.2 (Stufe 1 einzeln auslieferbar) → T67.3 → T67.4 →
T67.5/T67.6 → T67.7/T67.8 → T67.9 → T67.10. Je Aufgabe eigener Branch/PR.

## 5. Acceptance Criteria (AC-P67-k)

- **AC-P67-1:** Mit veraltetem lokalem `main` startet eine neue Session auf
  `origin/main` (Basis-SHA im Test belegt); `record.worktreeSha` und das
  Manifest-Verhalten (P29) bleiben konsistent.
- **AC-P67-2:** Offline/ohne Remote/Auth-Fehler/Timeout: Session startet
  trotzdem auf dem lokalen `HEAD`, mit sichtbarem `main_sync_failed`-Event
  und Hinweis; kein stilles Verschlucken (Regel 6, K10).
- **AC-P67-3:** Steht der Projektordner auf einem Feature-Branch, ändert sich
  die Basis nicht; `main_sync_skipped` nennt den Grund.
- **AC-P67-4:** Ein Takt erzeugt höchstens einen `fetch` je Projekt, auch bei
  20 Sessions (K8-Test).
- **AC-P67-5:** `notify`/`ask`/`auto` verhalten sich wie in 3.4 beschrieben
  (je Modus ein Test); Benachrichtigungen kommen je Session einmal, nicht je
  Takt.
- **AC-P67-6:** Ein Merge läuft nie in eine Session mit offenem Zug; der Test
  belegt, dass erst bei `idle` angewendet wird.
- **AC-P67-7:** Konflikt: der Probelauf nennt die Dateien, der Merge
  scheitert, `git merge --abort` hinterlässt einen unveränderten Worktree
  (Hash vorher = nachher); Event `main_sync_conflict`, Benachrichtigung
  `action`.
- **AC-P67-8:** Einstellungen überleben Reload und Hub-Restart; fehlender
  Eintrag ⇒ Defaults; Contract-Test erzwingt additive Kompatibilität (K7).
- **AC-P67-9:** Der Sync-Zustand einer Session ist nach Hub-Restart aus
  JSONL + Git identisch rekonstruierbar (K7-Test).
- **AC-P67-10:** PWA: Abschnitt „Main-Synchronisation“ erreichbar, Indikator
  und Menü funktionieren mobil ohne Überlappung (Layout-Beweis), Specs grün;
  Funktionsinventar-Eintrag vorhanden.
- **AC-P67-11:** Auto-Merge-Commits tragen eine notation-konforme Nachricht;
  kein Hook-Bypass.

## 6. Premortem (Failure-Modi + Mitigation)

1. **Fetch hängt oder fragt nach Passwort und blockiert den Session-Start.**
   → Harter Timeout, `GIT_TERMINAL_PROMPT=0`, nie auf dem Start-Pfad ohne
   Fallback; Test mit absichtlich nicht erreichbarem Remote.
2. **Auto-Merge zerstört laufende Arbeit oder erzeugt Konflikt-Marker in
   einer Session, die ein Agent gerade bearbeitet.** → Nur bei wartender
   Session, Probelauf vorher, `--abort` bei jedem Fehler, Default `off`;
   Hash-Gleichheit nach Abbruch ist Testkriterium (AC-P67-7).
3. **Die Basis „origin/main“ überrascht Nutzer, die absichtlich auf einem
   Feature-Branch arbeiten.** → Umbasieren nur auf dem Hauptbranch (3.2),
   sonst Skip-Event; Einstellung `startSync: off` je Projekt.
4. **Alle Sessions fetchen gleichzeitig (Takt × Flotte), Last und
   Rate-Limits des Git-Hosts.** → Ein Fetch je Projekt, zusammengefasste
   Läufe, Mindestintervall 5 min; K8-Test.
5. **Benachrichtigungsflut („N hinter main“ bei jeder Prüfung).** → Eine
   Meldung je Projekt und Zustand (erneut erst bei Änderung von `behind`);
   Konflikt-/Fehlerlagen je Session und Ursache genau einmal (BUG-0224);
   Zählung im Test.
6. **Commit-Hook lehnt die Merge-Nachricht ab (Commit-Notation) und der Sync
   bleibt hängen.** → Notation-konforme Nachricht (3.3), Hook-Ablehnung wird
   als `main_sync_failed` sichtbar, nicht verschluckt; Test mit aktivem Hook.
7. **Zustand lebt nur im Speicher und geht beim Restart verloren (K7).** →
   Alles aus Events + Git faltbar, Scheduler holt beim Start nach; kein
   persistenter Timer.
8. **Scope-Drift Richtung „Hub-Checkout automatisch aktualisieren und neu
   starten“.** → Ausdrücklich Out (Abschnitt 2); eigener Entwurf mit eigenem
   Premortem, falls gewünscht.

## 7. Definition of Done

Alle T67.* und AC-P67-* mit Evidenz. `npm run gate` lokal grün;
GitHub-Actions-Lauf (`verify`, `k8`, `e2e`) auf dem Abschluss-PR grün; rote
CI allein wegen Umgebung wird benannt, nie als Pass gezählt. Jede neue
UI-Funktion mit Spec in `e2e/specs/`; Eintrag in `docs/funktionsinventar.md`;
Einstellungen erreichbar und dokumentiert (`docs/main-sync.md`). K5/K7/K8/K10
nachweislich erfüllt; kein TODO ohne Epic-Bezug. T67.10 (Abnahme am echten
Remote) ist Nutzeraufgabe und steht im Abschluss-Block, nie als Pass
vorweggenommen.

## 8. Abschluss-Block (T67.1–T67.9, 2026-11-18)

**AC-Bilanz** (Belege in den genannten PRs; jede AC hat einen Test, der sie
ohne den Fix nicht bestanden hätte):

| AC | Beleg |
|---|---|
| AC-P67-1 | `worktree-main-sync.test.ts` „veralteter Checkout“: `baseSha` = origin/main (SHA + Datei des nachgeschobenen Commits im Worktree); `record.worktreeSha` identisch, Manifest liest den SHA weiter (#151) |
| AC-P67-2 | Offline/Timeout: lokaler HEAD + klassifiziertes `main_sync_failed`-Event, Start nie blockiert (K10; Timeout-Test mit nicht routbarem Remote, hart abgebrochen) (#151/#153) |
| AC-P67-3 | Feature-Branch: `not-main-branch` mit Branchname im Detail (#151), SessionManager-Event (#153) |
| AC-P67-4 | 20 Sessions ⇒ **genau 1 Fetch** je Takt (K8, Zähl-Test) (#154) |
| AC-P67-5 | Modi: notify/ask/auto je Test; Benachrichtigung je Session und Stand einmal, Fetch-Fehler entprellt (#154/#155) |
| AC-P67-6 | `session-busy`: kein Merge auf `working` — Unit (#153) **und** live durch die PWA gespielt (#157, zuerst abgewiesen, nach idle angewendet) |
| AC-P67-7 | Konflikt: Probelauf nennt Datei, `--abort`, Hash vorher = nachher, `status --porcelain` leer; Event + Benachrichtigung (#153/#154) |
| AC-P67-8 | Settings überleben Restart (K7-Recovery-Test: neue Instanz, derselbe Speicher); additives Lesen beidseitig (Contract-Tests) (#149/#152) |
| AC-P67-9 | `lastSyncedAt` faltet aus JSONL-Events, nicht aus Speicher (#153) |
| AC-P67-10 | PWA-Abschnitt + Indikator + Menü mobil ohne Überlappung (Geometrie- + `elementFromPoint`-Beweis, 390 px); Funktionsinventar **G75** (#155/#157/#158) |
| AC-P67-11 | Merge-Nachricht notation-konform (`. a worktree: origin/main eingemischt`), Fast-Forward bleibt Fast-Forward — kein Hook-Bypass (#153) |

**Gates:** jeder Merge-PR mit grünem GitHub-`verify` (Schneller Kern inkl.
Lint/Typecheck/Build); Nightly (`ci/full-suite`) fährt die volle Messlatte
inkl. K8 und E2E auf main — nach Nutzerentscheid 16.11.2026 laufen breite
Lokalläufe nicht im Arbeitsloop. Zwei Läufe waren rot und wurden behoben/
benannt: Runner-Flake `prompts-in-chat` (#149, einmal neu gestartet, grün) und
die echte Policy-Invarianten-Verletzung (#155, Nachtrag-Commit — Agenten
schreiben nie direkt).

**Abgrenzt (Out, unverändert):** Hub-Checkout selbst aktualisieren/neu
starten; Rebase/Force-Push; Konfliktlösung durch den Hub; Merge/Push nach
main; Fleet-übergreifender Sync.

## 9. T67.10 — Abnahme am echten Remote (Nutzeraufgabe, Kai)

1. **Frischer Start:** Haupt-Checkout eines Projekts absichtlich hinter
   `origin/main` lassen (z. B. einen Commit nicht pullen), im Handy eine neue
   Session starten → Kopf zeigt keinen Rückstand; `show`/Events enthalten
   kein `main_sync_failed`; `record.worktreeSha` (GET `/api/sessions/:id`)
   ist der origin-Stand, nicht der lokale.
2. **ask-Ablauf:** Einstellungen → Main-Synchronisation → „Bei Rückstand:
   fragen“, Takt 5 min; origin per Push vorrücken → Glocke: „N Commits hinter
   main" mit Knopf **„Jetzt aktualisieren"** → Knopf drücken → Session steht
   auf neuem Stand, „zuletzt abgeglichen" gesetzt.
3. **Konflikt echt:** in der Session eine Datei ändern und committen, die
   auch auf main geändert wurde; „Main einmischen" im ⋯-Menü → Ergebnis
   „Konflikt in <Datei> — nichts verändert", Worktree unverändert; Datei in
   der Session lösen, danach erneut einmischen.
4. **Offline-Fall (K10):** Netz/Remote kurz unerreichbar machen, neue Session
   starten → startet trotzdem (lokaler Stand), Verlauf nennt
   `workspace.main_sync_failed` mit Grund.
