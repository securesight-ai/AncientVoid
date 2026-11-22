# PROGRESS — AncientVoid (Lagebericht)

## Ziel
Die Suche des Hubs war zu billig (nur Markdown, nur ein Projekt). Sie sucht
jetzt den ganzen Fundus: **Sessiontexte — Fragen und Antworten** — plus Doku,
in einem Feld. Implementierung, Tests und E2E sind fertig und am laufenden
Interface verifiziert (Branch `feat/suche-sessiontexte`, 5 Commits). Fertig und **live**: PR
**#276** ist gemergt (Merge-Commit `00dc288c`, Quellzweig gelöscht), Gate
`verify` **pass 3m19s**. Hub neu gestartet (Wachhund `systemctl --user restart`):
health 200 nach 3 s, `version.json` sha `00dc288c`, `dirty:false`, Hub-Log
`search: Sessiontext-Index 17247 Zeilen (fts5)`. Nachweis am laufenden Hub:
`GET /api/search/all?q=flowkey&scope=all` → `mode and`, `sessionStatus ready`,
`sessionTotal 2`, Fundstellen seq 19 (Frage) und 474 (Antwort) mit markiertem
Fundwort; Indexzeile in der PWA „17283 Texte aus 5 Sitzungen". Für den Nachweis
gelegtes Gerätetoken ist widerrufen (`token revoke`, Route antwortet danach 401).
Der Deploy bringt auch **P75 Sprachausgabe** auf den Hub (main enthielt es seit
11:46; der Live-Hub stand vorher auf `5701180b`).

## Erledigt (verifiziert)
- **Sessiontext-Index (Core)** `packages/core/src/modules/search/session-text-index.ts`
  plus Migration 40 (`transcript_lines`, `transcript_state`): FTS5 über die
  echten `events.jsonl` **inkl. Blob-Payloads** (K5-Offload — ohne Blob-Read
  wären lange Antworten unauffindbar), rollengetrennt (user/assistant/thinking/
  tool/system), rollengewichtet, Snippet mit Markerzeichen, Präfix + Umlaut-
  Faltung, AND→OR-Rückfall sichtbar als `mode`, Projekt-/Projektbaum-Filter,
  Rückfall `engine:"scan"` ohne FTS5, `CROSS JOIN`-Zwang (sonst: „unable to use
  function snippet“).
- **Drei Suchstufen** (`SessionSearchMode` in den Verträgen): `and` (Begriff als
  Präfixwort) → `teil` (Begriff als Teilwort, alle zusammen) → `or` (Begriffe
  einzeln). Ohne `teil` war „Angebot" in „Sonderangebot" unauffindbar — FTS5-
  Präfixe greifen nur am Wortanfang, und deutsch stellt Begriffe ans Wortende.
  Die Stufe wird per Sonde vor dem Ausliefern entschieden, also bleibt sie über
  alle Seiten gleich; die PWA nennt sie sichtbar. Nebenbefund aus dem Fixture-
  Hub: `eventText` indexierte Frage + Kurzzeile doppelt, wenn die Kurzzeile den
  Wortlaut wiederholte — jetzt nur, was nicht schon drinsteht.
- Tests `packages/core/test/transcript-search.test.ts` **17/17** und
  `apps/hub/test/modules/search/search-sessions.routes.test.ts` **8/8**,
  `docs-local.test.ts` **5/5**. Am **echten Bestand** gemessen (Kopie von
  `data/`, 5 Sessions): 15 329 Zeilen in 1,2 s, Abfragen 1–3 ms, inkrementeller
  Nachlauf nach einer neuen Zeile in < 1 s, Fragen und Antworten zuerst.
- **Verträge** `packages/contracts/src/search/search.ts` (SessionTextHit,
  SearchIndexState, UnifiedSearchResponse, DocSearchHit/Engine, Snippet-Marker).
- **Routen**: `GET /api/search/transcript` und `GET /api/search/all`
  (Doku + Sessions in einer Antwort, `scope`, Rollen-Chips, Facetten, Paging),
  `/api/search` antwortet ohne qmd mit lokalem Markdown-Durchlauf
  (`engine:"local"`) statt 501. Hub verdrahtet den Index in `main.ts`
  (Nachlauf alle 5 s, `unref`, Shutdown räumt auf) und an der Route mit
  250 ms Frische — ein Zug, der gerade fertig wurde, ist sofort findbar.
- **PWA-Suche** (`apps/pwa/src/features/search/`): ein Feld für den ganzen
  Fundus, Bereichsumschalter Alles / Sitzungen / Doku, Rollen-Chips mit
  Facettenzahl (Standard: Frage + Antwort; Denken/Werkzeug opt-in), „nur dieses
  Projekt“, Fundwort als `<mark>` (Markerzeichen → Preact-Knoten, nie
  innerHTML), Sitzungsblöcke mit Titel/Projekt/seq, „mehr laden“, Stufen-Hinweis
  (`teil`/`or`) und Indexzeile („15 329 Texte aus 5 Sitzungen im Index“).
  Fundstelle in der **eigenen** Sitzung springt im Chat zur Nachricht und holt
  vorher die älteren Seiten nach.
- **E2E**: `e2e/specs/search-sessions.spec.ts` **4/4** (tablet + desktop) —
  Frage und Antwort derselben Sitzung, Markierung, Sprung in den Chat,
  Bereichsumschalter, „nur dieses Projekt“, Dock-Abstand als Zahl. dazu
  `apps/pwa/test/features/search-hits.test.ts` **9/9** und CSS-Ratchet **14/14**.
- **Am laufenden Interface verifiziert** (Krater-Hub auf einer Kopie von `data/`
  mit echtem Bestand, Port 7399, Chromium): Sprung auf seq 19 einer 54 000-
  Ereignisse-Sitzung — ältere Seiten nachgeladen (`minSeq` 5), Fundstelle im
  Viewport (`top` 234, `inViewport` true); „Kurbelwelle Träger“ traf die
  Teilwortstufe und markierte beide Fragmente; Suchfeld ohne UA-✕, letzte Karte
  75 px über der Dock-Leiste (gemessen 496 vs. 571). Screenshots gesehen.
- **P79 im Live-Hub deployed** (`systemctl --user restart ancientvoid-hub`, health 200
  nach 2 s, kein Rückfall): Konfiguration `inference.engines` mit Strata
  (`http://127.0.0.1:8080/metrics`, Schlüssel nur als Dateireferenz), Hub-Log:
  `inference: 1 Engine-Quelle (strata)`, Request-Historie schreibt
  `data/inference-requests.jsonl` (K7). API live geprüft: 932 Anfragen, Prompt
  129,2 Mio, gelesen 2,38 Mio, wiederverwendet 126,8 Mio (Rechnung geht auf),
  KV-Reuse 98,2 %, Decode p50 81,4 / p90 91,7 / Spitze 107,1 (1 Ausreißer,
  ohne Ausr. 93,7), Grenzlaufrate 3.377 tok/s bei R² 1,00, Antwort 7,5 KB.
- **P79 Backend** (Commit `4e92c233`, Branch `feat/p79-inferenz-token-tempo`):
  Vertrag `packages/contracts/src/inference/tempo.ts` (Quellenliste, Snapshot,
  Verteilungszeilen, K5-Kappen), Kern `packages/core/src/modules/inference/`
  (Strata/Halogen/llama.cpp-Adapter, Prometheus-Parser mit Zähler-Deltas,
  Request-Historie als JSONL mit Quellen-Tag, Perzentile mit Tukey-Ausreißern),
  Les-API `GET /api/inference/sources` und `…/snapshot?id=&fenster=`.
  Tests: `packages/core/test/inference.test.ts` **12/12**,
  `apps/hub/test/modules/inference/routes.test.ts` **5/5** (leere Konfiguration →
  leere Liste, unbekannte Id → 404 mit Liste, fehlende Id → 400).
- **P79 PWA** (Commits `1badf763`, `8fffada0`): `features/inference/` (Seite +
  format.ts), **eigener Menüpunkt** „Inferenz“ (Route `/inferenz`, Dock, Sidebar,
  ToolPane), `57-inference.css`, i18n de/en. Im Browser an der ausgelieferten
  Seite geprüft (1280 / 710 / 390 px): Seitenüberlauf null
  (`documentElement.scrollWidth` == Viewport), Tabellenrahmen `scrollWidth ==
  clientWidth` (vorher 893 > 702 — Spitze abgeschnitten), Vollbreiten-Kacheln,
  Leerlauf zeigt „Engine im Leerlauf“ statt nackter „— tok/s“, TTFT-Kachel nennt
  „letzte Anfrage“, Datenalter heißt „gerade gemessen“ / „Daten 2 s alt“.
  E2E `e2e/specs/inference-tempo.spec.ts` **5/5** (Menüpunkt, Verteilung nur bei
  Einzel-Requests, Gegenwerte erklären sich, tote Quelle bleibt sichtbar K9,
  Key nur als Dateireferenz). Format-Tests `apps/pwa/test/inference-format.test.ts`
  **9/9**.
- Gates grün: `lint`, `typecheck` (Hub+PWA), `check:arch`, `check:i18n`,
  `check:context` (nach `npm run docs:reference`).
- tokdeck (extern, `~/repos/tokdeck`) hat jetzt auch einen **Halogen-Adapter**
  (Prometheus + `/health` + `/cache`), 28/28 Tests.

## Bekannte Probleme, die der Live-Betrieb gefunden und behoben hat
- `accept: application/json, text/plain` brachte **Strata dazu, seine
  Prometheus-Exposition statt JSON** zu liefern (`# HELP vll…`). Accept sitzt
  jetzt pro Quellenart; Test hält den Kopf fest.
- Der Tracker wurde in `main.ts` **nach** dem Deps-Objekt erzeugt — die Route sah
  ihn nie („keine Engines konfiguriert“). Erzeugung liegt jetzt vor `createHubApp`.
- Mio-Großzahlen ≥ 100 Mio waren **um Faktor 10 zu klein** (127 Mio → „12,7 Mio“).
- Verlaufslinien zeichneten bei konstanter Serie eine flache Linie (= „stabil“
  vorgetäuscht); jetzt null. Zähler-Engines melden „keine Hardware-Werte gemeldet“,
  die PWA zeigt eine Grenzen-Karte mit den Gründen der Quelle.

## In Arbeit
- **`teil`-Stufe am echten Bestand zeigen**: ein zusammengesetzter Begriff, der
  im Bestand nur in Zusammensetzungen steckt (z. B. „Angebot" dort, wo nur
  „Sonderangebot" steht) — im Fixture und am Kopie-Bestand belegt, am Live-Bestand
  bisher nur `and` beobachtet.
- **Token-Hygiene auf dem Hub**: `p79-vergleich2`, `p79-vergleich3`, `p79-v4`
  liegen seit 21.11. in `data/hub.db`, zwei davon nie benutzt — widerrufen, wenn
  sie nicht mehr gebraucht werden. Und: der GitHub-Zugang auf diesem Rechner ist
  ein klassischer Token mit allen Scopes; ein feingranularer mit Resource owner
  `securesight-ai` (Contents + Pull requests + Issues) wäre angemessener.
- **Lehre fürs Gate** (gemessen, 22.11.): ein PR mit **Merge-Konflikt** zum
  Base-Zweig bekommt **keinen** Workflow-Lauf — GitHub kann den Merge-Commit
  nicht bilden. Da main inzwischen P75 (Sprachausgabe) enthält, stritten sich
  beide Zweige in `apps/pwa/src/shared/api.ts` (Importzeile). Deshalb: nie
  zuerst Actions verdächtigen, erst `pulls/<nr>.mergeable` und Rebase prüfen.
  Nach Rebase + Force-Push lief das Gate sofort.
- **Zugang**: `gh`-Login im GNOME-Keyring (Konto KaiFelixBennett). Fein-granulare
  Token mit Resource owner = persönliches Konto können Org-Repos **nie**
  schreiben (`securesight-ai/AncientVoid` gehört der Organisation) — das war der
  erste Fehlversuch. funktionierend: klassischer Token. Achtung: der aktuelle hat
  alle Scopes; nach Erledigten auf einen feingranularen mit owner
  `securesight-ai` (Contents + Pull requests + Issues) umstellen und rotieren.

## Bekannte Probleme / Risiken
- **Zwei parallele Agenten-Turns derselben Session** haben zeitgleich am Repo
  gearbeitet (der ältere `pi`-Prozess 219360 lief 35 min weiter, während der
  neue 237769 begann). Folge: doppelte i18n-Keys und doppelte api-Methoden,
  jetzt bereinigt. Der Alt-Prozess ist beendet. Meldung des Hub dazu:
  Session-Status wechselte kurz, Hub bleibt gesund (`/api/health` 200).
- Hub-Prozess (PID 59548) ist **Elter des Agentenprozesses**: ein Neustart kann
  diese Agentensitzung beenden. Deshalb: Statusdatei zuerst, Neustart nur
  abgesetzt (`setsid`/`systemd-run --user`) mit Health-Check und Rückrollpfad.
- tokdeck liegt weiter lokal (Port 7474, nur Loopback + Tailscale), kein Remote.

## Betriebswissen auf dem Hub-Rechner (betrifft nicht das Repo, aber den Zugang)
- **Fernzugriff war 21.11. ab 14:20 UTC tot, obwohl alles lief.** GNOME-Leerlauf
  (`idle-delay` 300 s) aktivierte den Screensaver; mutter/xdg-desktop-portal-gnome
  verweigern dann das Erzeugen von Remote-Desktop-Sessions
  (`Session creation inhibited`) — deshalb fielen **Deskflow (InputCapture-Portal)
  und gnome-remote-desktop (RDP) gleichzeitig** aus, während SSH und Hub gesund
  waren. Behoben: `idle-delay 0`, `idle-activation-enabled false`,
  `idle-dim false`, `sleep-inactive-ac-type 'nothing'`, Super+L entbunden, plus
  Keep-Awake-Watchdog (`~/.config/systemd/user/gnome-keep-awake.{service,timer}`,
  30 s, ruft `~/.local/bin/gnome-keep-awake`). Rot-dann-grün bewiesen: Blank
  erzwungen → 7 Portal-Fehler in 10 s → Watchdog deaktiviert → 0 Fehler in 12 s.
- RDP-Port: **3389 = System-Instanz (Greeter), 3390 = echte Wayland-Sitzung.**
  Monitor an `card1-DP-2` angeschlossen lassen — ohne Output kein RDP.
- RAM/VRAM der Modellseite: `strata-host` hält ~92 GiB von 125,7 GiB
  (Expert-Arena, pinned KV, conversation cache), VRAM ~30,2/31,9 GiB, PSI 0.
  Anzeigewahrheit: `MemTotal − MemAvailable` (≈98 GiB) und die klassische
  Formel (≈59 GiB) sind verschiedene Rechnungen — `Mlocked` ≈ 26,6 GiB und
  Shmem werden doppelt gezählt. Werkzeug: Skill `linux-ram-attribution`.

## Live genommen + Skill für den Neustart (22.11., verifiziert)
- PR #270 gemerged (`5701180b`), Hub live auf genau diesem Stand: `version.json` == HEAD,
  `dirty:false`, Health 200 nach 2 s, Inference-Route antwortet (401 ohne Token).
- Live im Browser belegt: Pane-Titel **„Inferenz“** (kein roher Schlüssel mehr), Prompt-Cache
  zeigt nur noch gemeldete Zeilen (6 statt 12), **0** „—“-Werte in den Kacheln, kein
  Overflow; „Im Moment“ zeigt während eines laufenden Requests gehaltene Token 97.316.
- Review-Token widerrufen, Datei geshreddert, ohne Token wieder 401; Browser geschlossen.
- Neuer Skill `hub-neustart-live` (Wachhund, version.json gegen HEAD, K7-Rekonstruktion,
  PWA-Cache beim Blick, Token-Widerruf) + README-Zeile; `check:skills`-Budget 4316 → 4560
  (243 Zeichen neue Beschreibung). `check:skills` OK (19 Skills).

## Titel als roher Schlüssel — Gate-Lücke geschlossen (22.11., verifiziert)
- Live zeigte der Pane-Titel `COMMON.INFERENCE`: P61-Commit `338a82e9` hat
  `common.inference`/`common.inference_title` aus den Katalogen gelöscht. de/en-Parität
  (`check:i18n`) konnte das nicht sehen — beide Kataloge verloren den Schlüssel zugleich.
- Neu im Gate: jeder literal benutzte `t("…")`-Schlüssel muss im de-Katalog stehen
  (Prüfung über `.ts` **und** `.tsx`; die Strings-Ratchet bleibt bei `.tsx`, damit ihre
  Baseline gültig bleibt). Rot-dann-grün belegt: ohne Schlüssel meldet der Gate
  „4 fehlende Schlüssel — ROT“ und die E2E fällt; mit Schlüssel beides grün.
- Außerdem: Prompt-Cache/Gerät/Summen-Kacheln zeigen nicht gemeldete Zeilen nicht mehr
  (kein `—`-Stapel), und eine Karte ganz ohne Messwert wird gar nicht gerendert.
- Belege: `check:i18n` OK, Playwright `inference-tempo` 5/5 (neu: kein roher Schlüssel,
  keine Halogen-Cache-Zeilen bei Strata), Vitest 60/60, Typecheck/Lint/arch/context grün.

## Nachzug P79 — zweite Runde (22.11., verifiziert)
Vier Defekte, die erst der Blick auf die **live gerenderte Seite** gezeigt hat:
- **Auslastung 10.000 %** und **CPU 860 %**: die Engines sind uneinheitlich — Strata
  meldete `gpu_util` schon als 0,87 und als 100, `cpu` als 56 und als 860 (Summe über
  alle Kerne). Neu: `anteilNormalisieren()` im Kern (0..1, 0..100, Kern-Summe),
  unplausibel bleibt null. Live jetzt 6 % / 1,8 %.
- **Verlaufs-Linien liefen aus ihrer Box**: `verlauf()` zeichnet in 32 Höhe, der
  `viewBox` der neuen Karte hatte 26 → LinienMal überlappen die Beschriftung. Gemessen:
  SVG-Höhe jetzt 32, Reihen ohne Überlappung.
- **`pcie_frac` kam als String** (`"0.15"`) → Feld verschwand still. `num()` nimmt jetzt
  zahlenreiner Text, sonst null.
- **„Letzte Anfragen" ohne Zeit**: die Requests standen anonym da, obwohl `at` im Vertrag
  liegt und der i18n-Schlüssel existierte. Jetzt erste Spalte `Zeit` (HH:MM:SS, hour12:false).
- Layout: Container-Breakpoints auf 560/700/1024 (Seitenpane ist schmaler als der Viewport —
  bei Viewport 710 misst das Pane nur 362 px, dort ist einspaltig richtig), drei Werte-Spalten
  erst ab 1024 px, Live-Kachel hält zwei breite Spalten für Textwerte (Phase).
Belege: Kern 17/17, PWA-Format 10/10, Playwright `inference-tempo` 5/5 (Desktop + Mobile,
inkl. Zeitspalte), Typecheck/Lint/i18n/arch/context grün, Screenshots 1280/710/390 ohne
Überlauf und ohne geklemmte Zellen.

## Nachzug P79 (22.11., verifiziert)
- Inferenz-Seite war gegen tokdeck unvollständig. Nachgezogen und im Live-JSON des
  echten Strata geprüft: Engine-Bauart (Kontext, KV `int8`, Experten 10 116/24 576,
  Arena 47 962 MiB, Batch-Slots, Drafting `mtp`, Spec 6, Vorbehandlungskappe,
  Pool-Worker, PCIe-Anteil), Slot-Halt (größter Slot), CPU 56 % + Disk, RAM live statt
  Verlaufsrest, Sekunden-Reihen als eigene Karte, PCIe getrennt nach **Slot-Max Gen 4
  × 16 bei Karte Gen 5** — der Engpass sitzt im Mainboard, nicht in der GPU.
- Messlatte: Kern 15/15, PWA-Format 9/9, E2E `inference-tempo` 5/5 (neue Assertions),
  Typecheck/Lint/i18n/arch/context grün.

## Einsatzstand (21.11., verifiziert)
- PR #264 ist gemerged (`11aeb4fe`), Quellzweig gelöscht. Der Hub läuft auf `main`
  (`4fa1f921`), ausgelieferte `version.json` == HEAD, `dirty:false`, health 200 nach 2 s.
- Nach dem Neustart rekonstruiert der Tracker die Request-Historie aus dem JSONL
  (`inference: 179 Requests rekonstruiert`) und schreibt weiter — K7 im Live-Betrieb.
- Wachhund: `/tmp/hub-neustart.sh` (Rückfall auf den zuletzt gesunden Stand, danach
  `git checkout main`).

## Wiederaufnahme nach Hub-Neustart (falls diese Antwort abbricht)
- Der Hub ist ein systemd-User-Service (`ancientvoid-hub.service`, `Restart=always`,
  `KillMode=process`) — Session-Worker überleben, der Hub kommt von allein hoch.
- Nach dem Neustart prüfen: `systemctl --user is-active ancientvoid-hub`,
  `curl -s 127.0.0.1:7373/api/health`, `curl -s 127.0.0.1:7373/version.json`
  (sha muss auf `feat/p79-inferenz-token-tempo` zeigen), `/tmp/hub-neustart.log`.
- Falls der Wachhund zurückgerollt hat (`HEAD` = Rückfall-Stand): `git checkout main`,
  Ursache im Log suchen, dann neu starten. Der Zweige-Zweig `feat/p79-…` existiert
  nicht mehr — P79 liegt in `main` (PR #264).
- Konfigurations-Backup: `/tmp/hub.config.vor-p79.json`.

## Nächste Schritte
1. `git fetch origin` → `origin/main` in `feat/p79-inferenz-token-tempo` mergen,
   Gates erneut (lint/typecheck/gezielte Tests).
2. `npm run -w @ancientvoid/pwa build`.
3. `hub.config.json`: Abschnitt `inference` ergänzen.
4. Neustart-Skript `/tmp/hub-sicher-neustart.sh` (detached): stoppen, starten,
   Health-Check; bei Ausfall Rückkehr auf den vorherigen Stand und erneuter
   Start. Log: `/tmp/hub-neustart.log`.
5. Live-Review der Seite im Browser (1280 / 710 / 365 px) mit echten
   Strata-Zahlen; Mängel beheben.
6. Push/PR, sobald GitHub-Zugang vorhanden.

## Entscheidungen
- **Eigene Spur neben `aimetrics` (P59), nicht dort andocken**: P59 liefert
  skalarisierte Felder im 10-s-Takt; Verteilungen brauchen eine engmaschige
  Request-Historie. Preis: ein zusätzlicher `/metrics`-Abruf je Engine und Takt.
  Begründung im Epic `epics/EPIC-P79-inferenz-token-tempo.md`.
- **Historie pro Quelle getrennt** (Feld `source` in jedem Request-Datensatz):
  gemischte Perzentile über zwei Engines wären eine falsche Aussage — durch den
  Test gefunden und korrigiert.
- **Keine erfundenen Verteilungen**: Engines ohne Einzel-Requests (llama.cpp,
  Halogen) liefern `features.perRequest=false`, die Seite zeigt den Grund.
- **PWA im Hautton der App**, nicht als schwarzes Terminal: übernommen ist die
  Disziplin (Herkunft an jeder Zahl, fehlende Blöcke verschwinden), nicht die
  Green-on-Black-Optik von tokdeck.
