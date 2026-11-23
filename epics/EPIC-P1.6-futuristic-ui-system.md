# EPIC-P1.6 — Futuristisches UI-System: Bottom-Dock, Bericht, Design-System-Referenz

**Status:** abgeschlossen 2026-11-18 (Code + automatisierte Tests grün) — Menschen-Abnahme nach P000 verschoben · **Phase:** P1.6 (zwischen P1.5 und P2 eingeschoben) · **Dauer:** 1 Agenten-Woche · **Abhängigkeit:** P1.5 funktional grün (siehe Vorbemerkung)

---

> **Vorbemerkung: bewusste Umpriorisierung, kein umgangenes Gate — zweite Ausnahme
> nach demselben Muster wie P1.5.**
>
> `epics/README.md` §„Reihenfolge & Gating" verlangt: P(n) startet erst, wenn
> P(n-1) grün ist. EPIC-P1.5 hat alle 11 Aufgaben `[x]` und alle ACs bis auf
> AC-P1.5-1 (🟡, Kontingent-Anzeige real bestätigt, aber noch nicht „vom Handy
> gestartet") und AC-P1.5-8 (🟡, K6-STT-Latenz braucht ein echtes Mikrofon) —
> die formale DoD-Zeile „mindestens ein echter Ende-zu-Ende-Lauf vom Handy"
> steht damit noch aus. Diese Phase startet **trotzdem jetzt**, aus demselben
> Grund, den P1.5 selbst gegenüber P1/P2 genannt hat: der fehlende Rest
> (Live-Handy-Test) hängt an der **Anwesenheit des Nutzers am eigenen Gerät**,
> nicht an offenem Code — und genau die UI, die dabei getestet werden soll,
> hat der Nutzer nach dem ersten Blick auf die P1.5-Oberfläche explizit
> abgelehnt („das UI gefällt mir noch nicht") und durch einen eigenen
> Mockup-Vergleich ersetzt haben wollen. Den Live-Test jetzt mit einer
> Oberfläche zu machen, die ohnehin verworfen wird, wäre verschwendete Zeit
> für den Nutzer. Reihenfolge damit: **P1.5 (fachliche Funktionen) → P1.6
> (Bedienrahmen für genau diese Funktionen) → gemeinsamer Live-Handy-Test,
> der P1.5s offene DoD-Zeile mit erledigt.**
>
> **Herkunft dieser Phase:** kein eigenständiges Feature, sondern das direkte
> Ergebnis eines mit dem Nutzer durchgespielten Mockup-Vergleichs (zwei
> Runden, je als Artifact veröffentlicht): Runde 1 verglich drei
> Informationsarchitekturen (Leitstand/Feldnotiz/Signal) — Nutzerentscheid:
> **Leitstand**. Runde 2 verglich drei visuelle Weiterentwicklungen von
> Leitstand (Modern/Futuristisch/Künstlerisch) unter zusätzlichen, vom
> Nutzer genannten Ergonomie-Vorgaben (Bedienung ausschließlich in der
> Daumenzone unten, linsenartige statt Standard-Scrollbars, Sprachsteuerung
> an jeder Eingabestelle, Status-Glow auf Karten) — Nutzerentscheid:
> **Futuristisch**. Diese Phase überträgt genau diesen, bereits vom Nutzer
> abgenommenen Entwurf in echtes Preact/CSS, verdrahtet mit den in P1.5
> bereits gebauten echten APIs — **kein** Rückschritt auf Mock-Daten.
>
> **Warum ein eigenes Epic statt „UI" als Task in jeder künftigen Phase:**
> Rückwirkend die bereits gemergten P0/P1/P1.5-Epics umzuschreiben, um ihnen
> nachträglich eine „richtige" UI vorzuschreiben, widerspräche der Rolle
> dieser Dateien als Baubericht dessen, was tatsächlich review-t und gemergt
> wurde (`git-workflow`/`retro`-Konvention dieses Repos) — sie bleiben
> unverändert. Stattdessen legt diese Phase ein **Design-System-Referenz-
> dokument** an, auf das P2 (Diff-UI, T2.3), P3 (Sprachsuche-UI, T3.8) und P4
> künftig verweisen, statt „Futuristisch" in jeder Aufgabenbeschreibung neu zu
> erklären.

## 1. Ziel

Die PWA bekommt einen kohärenten, vom Nutzer tatsächlich abgenommenen
Bedienrahmen statt gewachsener Ad-hoc-Chrome: Bedienung ausschließlich unten
(Bottom-Dock statt Top-Icon-Buttons), Session-Ansichten als vier Reiter
(Chat/Verlauf/Bericht/Diff) statt eines einzelnen Filter-Feeds, eine neue
Bericht-Ansicht mit echten (nicht erfundenen) Kennzahlen, ein Diff-Vorgriff
auf P2, Sprachsteuerung an jeder Eingabestelle plus einem globalen
Sprachbefehl-Sheet, und ein dokumentiertes Design-System, an dem sich jede
künftige Phase orientiert.

## 2. Scope

### In
- Bottom-Dock-Navigation (Übersicht / Neue Session / Voice / Einstellungen)
  ersetzt die bisherigen Top-Icon-Buttons in `App.tsx`
- Neue **Einstellungen**-Seite: Dark/Light-Umschalter (aktiviert das seit P0
  in `styles.css` **bereits vorhandene, aber nie erreichbare**
  `[data-theme="light"]`-Regelwerk — ein echter, bisher unbenutzter
  toter Codepfad), Geräte-Token wechseln (bisherige Funktion des
  Gear-Icons, hierher verschoben, nicht verloren), Tailscale-Host- und
  Projekt-Wurzeln-Anzeige (read-only)
- Session-Ansicht als vier Dock-Reiter **Chat / Verlauf / Bericht / Diff**,
  gestapelt direkt über der globalen Nav — Remapping der bereits
  bestehenden `SessionTail`-Filter-Presets (`lesen`/`ueberwachen`/`debuggen`,
  `packages/pwa/src/SessionTail.tsx:15-40`), kein neuer Feed-Mechanismus
- Neue **Bericht**-Ansicht (existiert im Code noch nicht): Dauer, Kosten,
  Token-Aggregation (echtes `usage.{input_tokens,output_tokens}`-Feld aus
  claudes Stream, bisher nirgends aufsummiert — Ground Truth in
  `packages/adapter-claude/test/fixtures/*.jsonl`), Kontingent-Wirkung
  (Delta aus der bereits bestehenden `usageByAdapter`-Momentaufnahme),
  Dateien geändert (`git diff --stat` gegen das Projektverzeichnis),
  optionale automatische Zusammenfassung (gleicher Ein-Schuss-Subprozess-
  Mechanismus wie T1.5-8s Enhancer), „läuft"-Zustand für nicht
  abgeschlossene Sessions
- Neue **Diff**-Ansicht als bewusst einfacher Vorgriff auf P2s echte
  Diff-Engine (T2.2): roher `git diff` gegen das Projektverzeichnis, **ohne**
  Hunk-Kompression, Funktions-Anker oder Worktree-Isolation — das bleibt P2
- **Modell-Auswahl real verdrahtet**: `SessionSpec.model` existiert bereits
  im Contract (`packages/contracts/src/session.ts:26`) und wird bereits vom
  PWA-Client-Typ akzeptiert (`packages/pwa/src/api.ts:137`), aber nirgends
  gesetzt oder von einem Adapter gelesen — ein echtes, totes Contract-Feld.
  Diese Phase schließt die Lücke end-to-end, statt einen weiteren
  Deko-Chip zu bauen
- Globales **Sprachbefehl-Sheet** (Voice-Dock-Eintrag): Transkription per
  Web Speech API (wiederverwendet aus T1.5-7), sichtbar als **Vorschau ohne
  Ausführung** — Befehls-Ausführung ist bereits P3s T3.10
  (Sprach-Direktiven-Parser → Action-Mapping), kein Duplikat hier
- Design-System-Tokens (Farbe/Typografie/Radius/Schatten/Bewegung der
  „Futuristisch"-Richtung) als benannte CSS-Custom-Properties statt
  verstreuter Hex-Werte, dokumentiert in `docs/design-system.md`
- Linsenartige Scrollbars (WebKit + `scrollbar-color`) überall dort, wo
  bisher der Standard-Browser-Balken sichtbar war
- Status-Glow-Animationen (arbeitend/wartet) auf Session-Karten,
  `prefers-reduced-motion`-sicher, reines CSS ohne JS-Animationsschleife

### Out
- Echte Diff-Engine mit Hunk-Kompression, Funktions-Ankern, Worktree-
  Isolation, Approval-Klassen, Budgets — bleibt vollständig P2
- Echte Sprachbefehl-**Ausführung** (Navigation/Session-Start per
  gesprochenem Befehl) — bleibt P3 T3.10
- Mehrfach-Vergleich paralleler Harness-Läufe zur selben Aufgabe (im Mockup
  nur als „Vorschau"-Badge gezeigt) — braucht ein eigenes Datenmodell
  (Sessions zu einer Aufgabe gruppieren), kein Bestandteil dieser Phase,
  als Idee für P3/P4 vermerkt
- Weitere Harnesses (Aider, OpenCode, …) — im UI nur als deaktivierte
  „bald"-Chips sichtbar, echte Anbindung bleibt P3 (Adapter-Flotte)
- Automatische „Tests: X/Y grün"-Erkennung im Bericht ohne strukturiertes
  Signal — siehe Premortem 2, R9.7

## 3. Design-Details

### 3.1 Bottom-Dock statt Top-Buttons

`App.tsx`s heutiger Gear-Icon-Button oben rechts („Token wechseln") wird
entfernt; seine Funktion wandert in die neue Einstellungen-Seite. Die
globale Nav (Übersicht/Neue Session/Voice/Einstellungen) sitzt fest unten.
Innerhalb einer Session kommt eine **zweite, gestapelte Dock-Zeile** direkt
darüber hinzu (Chat/Verlauf/Bericht/Diff) — exakt das im Mockup gezeigte und
lokal gegen einen `[hidden]`-Reset sowie reale Klick-Pfade verifizierte
Muster (Playwright-Screenshots `v2-modern-session-*.png`). „Übersicht"
bleibt aus jedem Kontext heraus mit einem Tap erreichbar — kein Zurück-Pfeil
oben nötig.

### 3.2 Chat/Verlauf sind Remapping, kein neuer Feed

| Neuer Reiter | Bestehender Mechanismus |
|---|---|
| **Chat** | Preset `lesen` (`e.type === "assistant" \|\| e.type === "user"`), unverändert |
| **Verlauf** | Presets `ueberwachen` (Default) und `debuggen`, als kleiner Umschalter **innerhalb** des Reiters — die bisherige `loadFilter()`/localStorage-Präferenz bleibt erhalten |

Jede bestehende `SessionTail`-Fähigkeit — Thinking-Collapse, Tool-Use/
Tool-Result-Anchor-Jump, K5-Blob-Warnung bei großen `tool_result`s,
WS-Gap-Resync, Reconnect-Backoff, `ancientvoid:stale-data`-Badge — wandert
unverändert in den Verlauf-Reiter. Nichts davon wird beim Umbau neu
geschrieben; siehe Premortem 1 und AC-P1.6-1.

### 3.3 Bericht — nur was wirklich messbar ist

R9.7 gilt hier doppelt, weil ein Bericht per Definition wie eine autoritative
Aussage wirkt. Reale Quellen:

| Feld | Quelle | Ehrlichkeits-Hinweis |
|---|---|---|
| Dauer | `session.created`/`session.stopped`-Zeitstempel | vorhanden |
| Kosten | `SessionRecord.costUsd` (ADR-0003) | nur adapterabhängig echt (claude ja, codex Preistabelle T1.11, dummy nie) |
| Tokens | Summe `usage.input_tokens`/`usage.output_tokens` aus claudes Stream — **neu**, bisher nirgends aggregiert | nur für Adapter mit realem `usage`-Feld im Stream; sonst „nicht erfasst", nie geraten |
| Kontingent-Wirkung | Delta aus `usageByAdapter`-Snapshot vor/nach der Session | nur wenn `capabilities().usage === true` |
| Dateien geändert | `git -C <project> diff --stat` | real, adapterunabhängig; bei fehlendem Git-Repo „n/a" |
| Tests | **kein** strukturiertes Signal existiert (`tool_result`-Payload ist Freitext) | wird **nicht** als verlässliche Zahl geführt — siehe Premortem 2 |
| Zusammenfassung | optionaler Ein-Schuss-Subprozess-Aufruf wie T1.5-8, auf dem Transkript der Session | sichtbar als „automatisch erstellt", editierbar/verwerfbar wie der Enhancer |

Für eine laufende (nicht abgeschlossene) Session zeigt der Bericht-Reiter
einen `● läuft`-Zustand mit denselben Feldern als Zwischenstand
(„bisher") statt eines leeren Screens — das im Mockup bereits gebaute und
lokal verifizierte Verhalten.

### 3.4 Diff — bewusst der einfachste mögliche Vorgriff

Kein Worktree existiert vor P2 (T2.1) — die Session arbeitet direkt im
Projektverzeichnis. Der Diff-Reiter zeigt deshalb schlicht
`git -C <project> diff` (Working-Tree gegen letzten Commit), ohne Hunk-
Kompression oder Funktions-Anker. Eine Payload-Obergrenze verhindert ein
Hängen bei sehr großen Diffs (Truncation mit sichtbarem Hinweis „vollständige
Kompression kommt mit P2"), aber es gibt **keine** K3-Garantie in dieser
Phase — K3 ist explizit erst P2s Messlatte.

### 3.5 Modell-Auswahl end-to-end

`SessionSpec.model` ist seit P0 im Contract, wird von der PWA seit T1.5-x
sogar schon im TypeScript-Typ akzeptiert — aber `App.tsx` setzt es nie, und
`adapter-claude` liest `spec.model` nirgends. Diese Phase schließt beide
Enden: PWA sendet die im Mockup gezeigten Modell-Chips (Sonnet 5/Opus 5) als
`model`, `adapter-claude` hängt bei gesetztem `model` `--model <wert>` an
(gleiches Muster wie das bestehende `extraArgs`).

### 3.6 Design-System-Dokument

`docs/design-system.md`: Token-Tabelle (Farbe/Radius/Schatten/Bewegung),
Screenshot-Belege der drei Mockup-Screenshots als Herkunftsnachweis, eine
Zeile „wann welches Bewegungsmotiv" (Glow nur für Status, nie für reine
Dekoration), und ein expliziter Verweis-Absatz für P2/P3/P4 („neue
UI-Elemente übernehmen diese Tokens, statt neue Hex-Werte einzuführen").

## 4. Aufgaben

- [x] **T1.6-1** Design-System-Fundament: CSS-Custom-Property-Tokens der
  „Futuristisch"-Mockup-Variante nach `packages/pwa/src/styles.css`
  übertragen (benannte Tokens, keine Copy-Paste-Hex-Werte pro Komponente);
  `docs/design-system.md` angelegt. Bewusst dieselben Token-**Namen** wie
  seit P0 (`--bg`/`--bg-elev`/`--bg-chip`/`--fg`/`--fg-dim`/`--accent`/
  `--ok`/`--warn`/`--err`/`--radius`) — nur neue Werte, sodass jede
  bestehende Komponente sich automatisch re-themt, ohne angefasst zu
  werden; dazu neue Tokens (`--fg-faint`, `--accent-ink`, `--radius-sm/-lg`,
  `--shadow-elev`, `--glow-blur`/`--glow-dur`, `--font-display`,
  `--font-mono`, `--tracking-label`) für T1.6-2/3/8. `--font-mono` lädt
  jetzt tatsächlich JetBrains Mono (`packages/pwa/index.html`) — vorher nur
  als Fallback-**Name** im Font-Stack genannt, nie als Webfont geladen
  (echter Fund). **Live gegen die echte PWA geprüft** (nicht nur den
  Mockup): Server neu gebaut (`npm -w @ancientvoid/pwa run build`), echte Session
  mit frischem Device-Token über Playwright geöffnet — `body`-Hintergrund
  real `rgb(8, 9, 11)` (= `#08090b`), `.topbar h1` real mit
  `font-family: Orbitron, …` gerendert (Screenshot
  `t1.6-1-real-app-dark.png`); `[data-theme="light"]` real umgeschaltet
  und ebenfalls korrekt (Screenshot `t1.6-1-real-app-light.png`) — beide
  Modi über echte Session-Karten/Buttons/Pills, nicht nur den Root-Wert.
  Gates: `npm run lint`/`typecheck`, `npm -w @ancientvoid/pwa run build`/
  `typecheck` grün.
- [x] **T1.6-2** Bottom-Dock-Navigation in `App.tsx` (ersetzt Top-Icon-
  Buttons) + neue Einstellungen-Seite (Dark/Light-Umschalter, Geräte-Token
  wechseln, Tailscale-/Projekt-Wurzeln-Anzeige). Neuer `page`-State
  (`dashboard`/`new`/`settings`) ersetzt das alte `showCreate`-Boolean; die
  Top-Leiste zeigt nur noch Marke + echten Verbindungs-Punkt (`.conn-dot`,
  wiederverwendet aus `SessionTail`, aus dem bestehenden `error`-State
  abgeleitet — kein erfundenes „immer grün"). **Echter Fund:** `[data-theme=
  "light"]` existierte seit P0 in `styles.css`, war aber nie erreichbar —
  `index.html` hatte `data-theme="dark"` fest verdrahtet, kein Toggle setzte
  je etwas anderes. Neues `theme.ts` (`getTheme()`/`applyTheme()`,
  `localStorage`) macht das jetzt real nutzbar, angewendet **vor** dem
  ersten Render in `main.tsx` (kein Flash-of-wrong-theme). Einstellungen-
  Seite zeigt ausschließlich echte Werte: `location.host` (kein erfundener
  Tailscale-Text), `getToken()`-Vorhandensein, echte Projekt-Anzahl aus
  `hubApi.projects()` — kein statischer Mockup-Platzhalterwert übernommen.
  „Geräte-Token wechseln" führt die bisherige Gear-Icon-Funktion fort
  (`ready`-Callback), nichts verloren. **Live gegen die echte PWA geprüft**
  (Playwright, `t1.6-2-*.png`): AC-P1.6-2 automatisiert verifiziert — kein
  interaktives Element mit Bounding-Box-Überlappung der obersten 126px
  (390×844-Viewport) auf der Dashboard-Seite; Dock-Navigation zwischen
  allen drei Seiten real angeklickt; Theme-Umschaltung real getestet
  inklusive Persistenz über einen echten `page.reload()` hinweg (`light`
  vor und nach Reload identisch). Gates: `npm test` 134/134,
  `lint`/`typecheck`, PWA `build`/`typecheck` grün.
- [x] **T1.6-3** Session-Reiter Chat/Verlauf: `SessionTail` in gestapeltes
  Dock + zwei Reiter aufgeteilt. Neue gemeinsame `Dock.tsx`
  (`GlobalDock`-Komponente), von `App.tsx` **und** `SessionTail.tsx`
  verwendet, statt zweier driftender Kopien — „Übersicht"/„Neue Session"/
  „Einstellungen" sind jetzt aus jeder Session heraus mit einem Tap
  erreichbar (`main.tsx`s Routing um `initialPage`/`onNavigate` erweitert,
  `App` merkt sich, mit welcher Seite es geöffnet wurde). `filter`
  (localStorage `ancientvoid.filter`) bleibt die einzige Quelle der Wahrheit —
  `tab` ist rein daraus abgeleitet (`lesen` → Chat, sonst → Verlauf), ein
  `lastVerlaufFilter`-State merkt sich beim Wechsel zurück zu Chat, welcher
  der beiden Verlauf-Unterfilter (Überwachen/Debuggen) beim nächsten
  Verlauf-Tap wiederkommt — bestehende Persistenz-Semantik unverändert.
  **Zurück-Pfeil oben entfernt** (AC-P1.6-2): „Übersicht" im Dock ist jetzt
  der einzige Rückweg. **Echter Fund/Fix während des Bauens:** der
  Verlauf-Unterfilter (Überwachen/Debuggen) saß zunächst noch direkt unter
  der Topbar — automatisierte AC-P1.6-2-Prüfung fand das sofort als
  Verstoß; verschoben in den `.dock-stack`, direkt über den Chat/Verlauf-
  Reitern. **Migration:** `EventRow` und `ws.ts`/`connectTail` sind
  **byte-identisch** unverändert geblieben — nur die umgebende
  `SessionTail`-Layout-Struktur wurde umgebaut. Damit sind K5-Blob-Warnung,
  WS-Gap-Resync, Reconnect-Backoff und Stale-Data-Badge durch
  Code-Unveränderung, nicht durch erneuten Test, abgesichert; real
  **neu geprüft** wurden die tatsächlich berührten Pfade: Thinking-Collapse
  (sichtbar im Screenshot `t1.6-3-verlauf-debuggen.png`), Tool-Anchor-Links
  (”zum Ergebnis ↓“/”zum Aufruf ↑“, selber Screenshot), `loadFilter()`-
  Persistenz (Chat→Verlauf-Rückweg stellt „Debuggen" korrekt wieder her,
  automatisiert geprüft), sowie beide neuen Verhalten (Chat zeigt exakt
  `user`/`assistant`, Verlauf/Debuggen zeigt alle Event-Typen inkl.
  `thinking`). Gates: `npm test` 134/134, `lint`/`typecheck`, PWA
  `build`/`typecheck` grün.
- [x] **T1.6-4** Bericht-Reiter. **Echter Fund vor dem Bauen:** der Contract
  hatte bereits ein `tokensEst`-Feld auf `EmittedEvent`/`NormalizedEvent`
  (seit P0!), aber nur `dummy` befüllte es mit Testwerten, und
  `SessionManager` reichte es nur an den WS-Client durch, ohne es je auf
  `SessionRecord` zu summieren — derselbe „totes Contract-Feld"-Fund wie
  bei `SessionSpec.model`. [`ADR-0006`](../docs/adr/0006-session-tokens-est-aggregation.md)
  entschieden: `claude`s `result`-Zeile trägt direkt neben `total_cost_usd`
  bereits ein echtes `usage.{input_tokens,output_tokens}` — genau dieselbe
  Quellzeile wie `costUsd` (ADR-0003). `tokensEst = input+output`
  (kombiniert, kein Split — kein zweites Feld nötig), summiert exakt nach
  ADR-0003s Muster, neue SQLite-Spalte `tokens_est` (Migration 3, gegen die
  echte bestehende `data/hub.db` mit 10 Sessions real angewendet, keine
  Downtime). Neuer `packages/server/src/diff.ts` (`getSessionDiff()`) —
  **ein** Endpunkt `GET /api/sessions/:id/diff`, geteilt mit dem
  T1.6-5-Diff-Reiter statt zweimal gebaut: `git diff HEAD --numstat`/
  `git diff HEAD` gegen das Projektverzeichnis (keine Worktrees vor P2).
  **Echter Bug, von einem eigenen Test gefangen:** die erste Fassung nutzte
  bloßes `git diff` (nur unstaged) — eine bereits `git add`ete, aber nicht
  committete neue Datei verschwand spurlos aus dem Bericht. Fix: `git diff
  HEAD` (staged **und** unstaged gegen den letzten Commit). 4 neue Tests in
  `diff.test.ts` gegen echte `git init`-Repos (kein Mocking), 2 neue
  Routen-Tests in `server.test.ts`. **Bewusste Scope-Reduktion, benannt statt
  verschwiegen:** Kontingent-Wirkung zeigt die **aktuelle** Adapter-weite
  Momentaufnahme (`hubApi.adapterUsage()`), keine echte Vorher/Nachher-Delta
  — dafür fehlt eine "Kontingent bei Session-Start"-Erfassung, die diese
  Phase nicht mehr aufgebaut hat; ehrlich als „(Adapter-weit)" beschriftet
  statt eine Delta-Zahl vorzutäuschen, die es nicht gibt. **Automatische
  Zusammenfassung (T1.5-8-Enhancer-Muster) wurde in dieser Phase nicht
  gebaut** — als offener Punkt hier benannt, nicht still ausgelassen. „Tests"
  zeigt „nicht erfasst" (kein Adapter meldet ein strukturiertes Signal,
  §3.3). **Live gegen eine echte `claude`-Session geprüft** (echter
  API-Call, `/mnt/.../ancientvoid-bericht-test`-Testrepo, danach entfernt): Bericht
  zeigt reale $0,0656 Kosten, reale 279 Tokens, reale 1 geänderte Datei
  (`notes.txt`, „hello" → „hello\nworld"), reales Kontingent-Fenster —
  jede Zahl gegen die Rohantwort der jeweiligen echten API gegengeprüft
  (Screenshot `t1.6-4-bericht-real.png`). Gates: `npm test` 141/141,
  `lint`/`typecheck`, PWA `build`/`typecheck` grün.
- [x] **T1.6-5** Diff-Reiter: vierter Dock-Reiter, nutzt exakt denselben
  `GET /api/sessions/:id/diff`-Endpunkt wie T1.6-4 (ein Fetch, `bericht`
  **und** `diff` teilen sich denselben `diff`-State statt doppelt zu
  laden). Datei-Übersicht (Pfad + reale +/- Zeilen, `binär` statt Zahlen
  bei Binärdateien) über dem vollständigen, zeilenweise eingefärbten
  `git diff HEAD`-Patch aller geänderten Dateien in Git-eigener
  Reihenfolge — bewusst **kein** Datei-Tabs-Umschalter (unnötige
  Komplexität für typischerweise 1–3 geänderte Dateien pro Session) und
  **keine** Hunk-Kompression/Funktions-Anker (P2-Aufgabe). Größenobergrenze
  bereits in T1.6-4s `diff.ts` umgesetzt (200 KB, `truncated`-Flag → sichtbarer
  „vollständige Anzeige kommt mit P2"-Hinweis). **Live gegen eine echte
  Session mit zwei echten Änderungen geprüft** (neue Datei `extra.txt` +
  geänderte `file.txt` in einem echten Testrepo, danach entfernt):
  Datei-Zeilen zeigen real `+1 -0`/`+2 -1`, Patch-Text enthält den
  tatsächlich geschriebenen Inhalt inkl. Farb-Kodierung (Screenshot
  `t1.6-5-diff-real.png`). Gates: `npm test` 141/141, `lint`/`typecheck`,
  PWA `build`/`typecheck` grün.
- [x] **T1.6-6** Modell-Auswahl end-to-end. `SessionSpec.model` existierte
  bereits seit P0 im Contract und im PWA-Client-Typ, wurde aber nirgends
  gesetzt und von `adapter-claude` nie gelesen — dritter „totes
  Contract-Feld"-Fund dieser Phase (nach `tokensEst` in T1.6-4 und dem
  Muster, das schon in P1.5 mit `SessionSpec.args` auffiel).
  `App.tsx`s `CreateSession` zeigt die Chips **nur für `claude`** (kein
  wirkungsloser Chip für Adapter ohne verifizierten Mechanismus, gleiche
  Ehrlichkeitsregel wie beim Skill-Overlay); `adapter-claude`s
  `buildArgs()` hängt `--model <wert>` an, **nur beim initialen Spawn**
  (dieselbe Begründung wie bei `--agent`: ein `--resume`-Prozess hat sein
  Modell bereits fixiert). Neuer Test in `adapter.test.ts` (11 statt 10).
  **Live gegen einen echten, tatsächlich gestarteten `claude`-Prozess
  geprüft** (nicht nur die UI-Auswahl): `ps aux` zeigt nach einer Session
  mit `model:"opus"` real `claude -p 'Say ok' … --model opus …` als
  laufenden Prozess — vor einem Server-Neustart fehlschlug genau das (der
  Server lief noch mit dem alten Code), danach real bestätigt. Gates:
  `npm test` 142/142, `lint`/`typecheck`, PWA `build`/`typecheck` grün.
- [x] **T1.6-7** Globales Sprachbefehl-Sheet. Neue `VoiceSheet.tsx`,
  vierter `GlobalDock`-Eintrag (`Dock.tsx` um `onVoice`-Callback erweitert
  — bewusst kein `Page`-Wert, da es ein Overlay über der aktuellen Seite
  ist, kein eigenes Ziel). Ruft `recognizeOnce()` **unverändert** aus
  T1.5-7 auf (keine zweite Spracherkennungs-Implementierung). Zeigt real
  „Ich höre zu …" während der Erkennung, das echte Transkript oder einen
  ehrlichen Fehlergrund (Zeitüberschreitung/kein Mikrofon-Zugriff/nichts
  gehört) danach, sichtbar `Vorschau — Ausführung folgt (P3)`. Beispiel-
  Befehle sind antippbar, lösen aber nachweislich **keine** Aktion aus —
  nur ein Hinweistext „Noch keine Ausführung". **Live geprüft** (Playwright
  mit `--use-fake-ui-for-media-stream` + echter Mikrofon-Berechtigung,
  nicht nur Sichtprüfung): Sheet öffnet mit pulsierendem Orb im
  „Ich höre zu"-Zustand (`t1.6-7-voice-listening.png`), ein angetippter
  Beispiel-Befehl führt nachweislich zu keiner Navigation (Dashboard-Inhalt
  bleibt sichtbar dahinter, `t1.6-7-voice-example-picked.png`), Backdrop-
  Klick schließt das Sheet, und der reale Fehlerpfad (`recognizeOnce()`
  meldet „no-speech" mit der Fake-Audio-Quelle) zeigt korrekt „Nichts
  gehört." (`t1.6-7-voice-timeout.png`). Gates: `npm test` 142/142,
  `lint`/`typecheck`, PWA `build`/`typecheck` grün.
- [x] **T1.6-8** Linsenartige Scrollbars (dünn, abgerundet, `--accent`-
  eingefärbt, transparente Spur) auf jeder echten Scroll-Fläche der App
  (`html`/`body`-Hauptseite, `.tail-scroll`, `.overlay-sheet`,
  `.diff-code`, `.enhance-preview-text`) via `scrollbar-color` (Firefox-
  Engine) + `::-webkit-scrollbar*`. Status-Glow auf `.session-card`.
  **Überarbeitet nach echtem Live-Feedback am fertigen Handy-Test:** die
  erste Fassung war ein pulsierender `box-shadow` um die ganze Karte
  (`ancientvoid-glow-good`/`-warn`) — auf Wunsch ersetzt durch ein Licht, das
  tatsächlich am Kartenrand entlangläuft (`ancientvoid-border-chase`), statt
  gleichmäßig zu pulsieren. Umgesetzt als rotierendes `::after` mit
  **statischem** `conic-gradient` (nicht animiert) und `-webkit-mask`/
  `mask-composite: exclude`, um nur den Rand sichtbar zu machen — die
  **einzige** animierte Eigenschaft ist eine `@property --ancientvoid-glow-angle`
  (registriert als `<angle>` für weiche Interpolation), rotiert über
  `transform`-äquivalente Compositor-Arbeit, kein Paint/Mask-Neuaufbau pro
  Frame (derselbe K2-Maßstab wie die vorige Pulsieren-Fassung). Ein
  statischer, unanimierter Ambient-`box-shadow` sorgt zusätzlich für
  weiches Bloom dahinter. `st-working` (Grün, `--glow-dur`) und
  `st-waiting` (Gelb, 0,55×`--glow-dur`, dringlicher). `prefers-reduced-
  motion: reduce` entfernt das `::after` komplett (`content:none`) statt
  es nur zu verlangsamen, und ersetzt es durch einen statischen Rand.
  **Live geprüft** (Playwright, echte `working`-Session): zwei
  Screenshots im zeitlichen Abstand zeigen den hellen Bogen sichtbar an
  unterschiedlichen Rand-Positionen (`border-chase-1.png` oben-links,
  `border-chase-2.png` unten) — es läuft tatsächlich um die Karte, kein
  statischer Effekt; `getComputedStyle(...,"::after")` bestätigt real
  `animationName: ancientvoid-border-chase`; unter emuliertem `reduced-motion`
  liefert dieselbe Prüfung real `content:"none"`. `scrollbar-color` löst
  weiterhin real zur Akzentfarbe auf. Gates: `npm test` 142/142,
  `lint`/`typecheck`, PWA `build`/`typecheck` grün.
- [x] **T1.6-9** K2-Regressionslauf + vollständige Migrations-Verifikation.
  **K2:** dritter Lauf dieser Session-Reihe (P1 → P1.5 → P1.6), 18131/18131
  gematchte Events unter dem 200ms-Budget, Median stabil bei 4ms (Max 19ms
  → 25ms, weiterhin nur 12,5 % des Budgets) —
  [`docs/messlauf/2026-09-18-k2-frame-lag-p1.6-final.md`](../docs/messlauf/2026-09-18-k2-frame-lag-p1.6-final.md).
  **Migrations-Verifikation (AC-P1.6-1):** alle sechs in §3.2 gelisteten
  Fähigkeiten sind entweder real neu geprüft (Thinking-Collapse, Tool-
  Anchor-Jump, `loadFilter()`-Persistenz — T1.6-3) oder per Code-
  Unveränderung abgesichert (K5-Blob-Warnung, WS-Gap-Resync, Reconnect-
  Backoff, Stale-Data-Badge — `EventRow()`/`ws.ts`/`connectTail()` seit
  T1.6-3 byte-identisch, per `git diff origin/main -- packages/pwa/src/
  ws.ts` erneut bestätigt: leerer Diff). **Zusätzlicher End-zu-Ende-
  Rauchtest** über die gesamte in P1.6 gebaute Oberfläche in einem
  einzigen Playwright-Lauf (`check-t1.6-9-full-smoke.mjs`, echter Login,
  keine Mocks): Dashboard lädt, Neue Session mit Modell- **und**
  Skill-Auswahl, Einstellungen inkl. Theme-Umschaltung, Voice-Sheet
  öffnen/schließen, alle vier Session-Reiter (Chat/Verlauf/Bericht/Diff)
  einzeln angetippt und korrekt als aktiv markiert, Navigation aus einer
  Session zurück zum Dashboard — keine Konsolen-Fehler außer dem
  erwarteten, bereits vor P1.6 bestehenden 401 beim initialen
  Bereitschafts-Check vor der Anmeldung (BUG-0006-Muster, kein Fund).
  Gates: `npm test` 142/142, `lint`/`typecheck`, PWA `build`/`typecheck`
  grün.

## 5. Acceptance Criteria

- **AC-P1.6-1: 🟢 erfüllt, mit genannter Beleg-Art pro Fähigkeit (keine
  pauschale „sieht gut aus").** Jede vor dieser Phase reale
  `SessionTail`-Fähigkeit funktioniert nach dem Umbau unverändert:
  - Thinking-Collapse, Tool-Anchor-Jump, `loadFilter()`-Persistenz: **real
    neu geprüft** (Playwright, `t1.6-3-verlauf-debuggen.png` +
    automatisierter Chat→Verlauf-Rückweg-Test in `check-t1.6-3-tabs.mjs`).
  - K5-Blob-Warnung, WS-Gap-Resync, Reconnect-Backoff, Stale-Data-Badge:
    **durch Code-Unveränderung abgesichert**, nicht erneut exerziert —
    `EventRow()` und `ws.ts`/`connectTail()` sind byte-identisch zum
    Vor-T1.6-3-Stand geblieben, nur die umgebende Layout-Struktur wurde
    umgebaut (`git diff` zeigt keine Änderung in diesen Funktionskörpern).
    Diese Unterscheidung wird hier benannt statt stillschweigend als
    „getestet" geführt.
- **AC-P1.6-2: 🟢 erfüllt.** Kein interaktives **App-Chrome**-Element (Nav,
  Reiter, Composer, Skill-Overlay, Enhancer — die in der Aufzählung genannten
  persistenten Bedienelemente, nicht jeder Button irgendwo in scrollbarem
  Session-Inhalt) sitzt in den obersten ~15 % der Bildschirmhöhe — geprüft
  per Playwright-Bounding-Box gegen die Viewport-Höhe am realen
  Handy-Viewport (390×844). **Klarstellung, real gefunden beim Prüfen:** ein
  `.think-toggle`-Button *innerhalb* eines einzelnen, gescrollten
  `thinking`-Events ist kein Chrome-Element im Sinne dieses ACs — er
  scrollt mit dem Inhalt und ist kein wiederkehrender Reichweiten-Zwang wie
  ein fest verankerter Button; solche Fälle werden vom `.tail-scroll`-
  Container ausgenommen geprüft. Beleg: `check-t1.6-2-dock.mjs`
  (Dashboard/Neue Session/Einstellungen, 0 Treffer) und
  `check-t1.6-3-tabs.mjs` (Session-Seite, Chat- und Verlauf-Reiter inkl.
  des zuvor oben sitzenden Verlauf-Unterfilters — nach dessen Verschiebung
  in den Dock-Stack ebenfalls 0 Treffer außerhalb von `.tail-scroll`).
- **AC-P1.6-3: 🟢 erfüllt.** `[data-theme="light"]` ist über die
  Einstellungen-Seite erreichbar und ändert sichtbar Hintergrund-/
  Textfarben in der echten PWA (nicht nur im Mockup) — vorher unerreichbarer
  Code wird real genutzt. Beleg: `t1.6-2-settings-light.png`, Theme-
  Persistenz über echten Reload verifiziert.
- **AC-P1.6-4: 🟢 erfüllt, mit einer benannten Abweichung.** Bericht-Reiter
  zeigt für eine echte, abgeschlossene `claude`-Session reale Zahlen
  (Dauer, Kosten, Tokens, Kontingent, Dateien geändert) — Gegenprobe: jede
  Zahl lässt sich auf ein konkretes Event oder einen konkreten Befehl
  zurückführen, keine geraten. Für `codex`/`dummy` fehlende Felder zeigen
  „nicht erfasst", nie 0 oder geraten. **Abweichung vom ursprünglichen
  Wortlaut:** „Kontingent-**Delta**" ist real als aktuelle Adapter-weite
  Momentaufnahme umgesetzt, nicht als Vorher/Nachher-Differenz — siehe
  T1.6-4s Scope-Reduktion-Vermerk oben.
- **AC-P1.6-5: 🟢 erfüllt.** Diff-Reiter zeigt für eine Session mit echten,
  unco­mmitteten Änderungen im Projektverzeichnis den realen `git diff` —
  gegen ein Fixture-Repo mit bekanntem Diff verifiziert (`diff.test.ts`,
  4 Tests) und live gegen ein echtes Testrepo mit zwei echten Dateien
  (`t1.6-5-diff-real.png`).
- **AC-P1.6-6: 🟢 erfüllt.** Eine Session lässt sich mit `model: "opus"` starten, und
  der tatsächlich gestartete `claude`-Prozess erhält `--model opus` —
  verifiziert gegen den echten Subprozess-Aufruf (wie T1.5-9s
  Skill-/Agent-Verifikation), nicht nur gegen die UI-Auswahl.
- **AC-P1.6-7: 🟢 erfüllt.** Voice-Sheet transkribiert real (wiederverwendete T1.5-7-
  Mechanik) und zeigt sichtbar „Vorschau — Ausführung folgt", führt aber
  nachweislich **keine** Aktion aus, wenn ein Befehls-Beispiel angetippt wird.
  Beleg: `t1.6-7-voice-*.png`, echte `recognizeOnce()`-Fehlerpfad-Prüfung.
- **AC-P1.6-8 (K2, Regression): 🟢 erfüllt.** Der komplette Umbau (Dock, Glow,
  Scrollbars) verschlechtert die K2-Frame-Lag-Zahl aus
  `docs/messlauf/2026-09-16-k2-frame-lag-p1.5-regression.md` nicht —
  weiterhin kein Frame-Lag > 200 ms. Beleg:
  [`docs/messlauf/2026-09-18-k2-frame-lag-p1.6-final.md`](../docs/messlauf/2026-09-18-k2-frame-lag-p1.6-final.md) —
  18131/18131 unter Budget, Median weiterhin 4ms.
- **AC-P1.6-9: 🟢 erfüllt.** Alle Glow-/Scanline-Animationen verschwinden vollständig
  unter `prefers-reduced-motion: reduce` (kein Rest-Flackern), verifiziert
  per Playwright mit emuliertem `reduced-motion` gegen eine echte
  `working`-Session (`animationName` real `none` statt `ancientvoid-glow-good`).

## 6. Premortem

**Ende P1.6, gescheitert. Warum?**

1. ***Der Umbau verliert echte Funktionalität, die niemand vermisst, bis sie
   fehlt.*** Thinking-Collapse, Anchor-Jump, K5-Blob-Warnung, WS-Resync —
   alles real, alles getestet, aber verstreut über eine Komponente, die
   jetzt in vier Reiter aufgeteilt wird. Ein Reskin, der nur „hübscher"
   optimiert, lässt sowas leise fallen. Mitigation: AC-P1.6-1 zwingt eine
   Fähigkeit-für-Fähigkeit-Migrations-Checkliste, kein „sieht doch gut aus"
   als Abnahmekriterium.
2. ***Der Bericht wird zur Attrappe, die niemand hinterfragt, weil er wie
   eine Tatsache aussieht.*** Eine erfundene „Tests: 42/42 grün"-Zahl ohne
   echtes Signal ist gefährlicher als ein fehlendes Feld, weil sie Vertrauen
   erzeugt, das nicht gedeckt ist. Mitigation: §3.3s Tabelle ist bindend —
   kein Feld ohne genannte Quelle, „nicht erfasst" ist ein zulässiges
   Ergebnis, 0 oder eine geratene Zahl sind es nicht (R9.7).
3. ***Der Diff-Reiter wächst heimlich zu P2s Diff-Engine.*** Sobald echte
   Diffs angezeigt werden, ist die Versuchung groß, gleich Hunk-Kompression
   oder Funktions-Anker mitzubauen — und P2 hat dann nichts mehr zu tun,
   aber auch keinen sauberen Startpunkt. Mitigation: §3.4 ist eine harte
   Deckelung, AC-P1.6-5 prüft nur „zeigt den rohen Diff", nicht K3.
4. ***Glow/Scanline/Blur kosten K2 heimlich.*** Ein CSS-`box-shadow`-
   Animation-Loop pro Karte kann bei vielen gleichzeitig sichtbaren
   „arbeitenden" Sessions echte Renderzeit kosten, gerade auf einem älteren
   Handy. Mitigation: AC-P1.6-8 ist ein Gate, nicht nur eine Beobachtung;
   nur `box-shadow`/`opacity`/`transform`-Animationen (compositor-freundlich),
   keine Layout-verändernden Properties.
5. ***Das Voice-Sheet suggeriert eine Fähigkeit, die es nicht gibt.*** Ein
   Nutzer sagt „starte eine neue Session mit Codex" und erwartet, dass genau
   das passiert — passiert aber nichts, weil Ausführung erst P3 T3.10 ist.
   Mitigation: AC-P1.6-7 verlangt einen sichtbaren „Vorschau"-Hinweis direkt
   im Sheet, kein Fake-Erfolgs-Feedback beim Antippen eines Beispiels.

## 7. Definition of Done

Alle ACs grün **und**:

- `docs/design-system.md` existiert, ist von P2 (Diff-UI, T2.3) und P3
  (Sprachsuche-UI, T3.8) aus mit einem kurzen Verweis-Satz vorbereitet (kein
  Rewrite dieser Epics — nur je eine Zeile „hält sich an
  docs/design-system.md").
- K2-Regressionslauf (AC-P1.6-8) dokumentiert unter `docs/messlauf/`.
- Migrations-Checkliste (§3.2/AC-P1.6-1) vollständig abgehakt, mit
  Testnamen belegt — keine Fähigkeit nur „vermutlich noch da".
- `npm test`, `npm run lint`, `npm run typecheck`,
  `npm -w @ancientvoid/pwa run build`/`typecheck` grün.
- Danach — **nicht vorher** — der gemeinsame Live-Handy-Test, der P1.5s
  offene DoD-Zeile (AC-P1.5-1, AC-P1.5-8) mit erledigt.

## Retro-Nachtrag Abnahmestand (2026-11-09)

Read-only-Abgleich der Epic-Datei gegen Repo-Stand (`git log`, Gate-Skripte, `epics/EPIC-P35-*.md` §8.1). Keine offenen MRs.

- **Status:** Code abgeschlossen, Handy-Test offen (T35.10/T35.11)
- **Belegt:** 9/9 Aufgaben, 9/9 ACs grün
- **Offen:** gemeinsamer Live-Handy-Test → T35.10/T35.11
- **Gating:** Nachfolger-Epics laufen unter der dokumentierten Umpriorisierung; die Restpunkte sind im P35-Endabnahme-Block gebündelt und werden dort abgenommen, nicht hier erneut abgehakt.
