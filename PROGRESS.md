# PROGRESS — AncientVoid (Lagebericht)

## Ziel
EPIC-P79 (Token-Tempo lokaler Inferenz in der PWA) fertigstellen und danach den
laufenden Hub auf den neuesten Stand bringen — ohne dass der Hub (und damit Kais
Handy-Zugang zum Agenten) wegbleibt.

## Erledigt (verifiziert)
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
- GitHub-Abgleich: `git fetch` + `origin/main` in den Branch mergen, damit der
  deployte Stand „neueste Version + P79“ ist. Push/PR ist blockiert: keine
  GitHub-Zugangsdaten auf dem Rechner (kein `gh`-Login, kein Token, kein
  SSH-Key hinterlegt).

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
