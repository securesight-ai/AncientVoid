# PROGRESS — AncientVoid (Lagebericht)

## Ziel
EPIC-P79 (Token-Tempo lokaler Inferenz in der PWA) fertigstellen und danach den
laufenden Hub auf den neuesten Stand bringen — ohne dass der Hub (und damit Kais
Handy-Zugang zum Agenten) wegbleibt.

## Erledigt (verifiziert)
- **P79 Backend** (Commit `4e92c233`, Branch `feat/p79-inferenz-token-tempo`):
  Vertrag `packages/contracts/src/inference/tempo.ts` (Quellenliste, Snapshot,
  Verteilungszeilen, K5-Kappen), Kern `packages/core/src/modules/inference/`
  (Strata/Halogen/llama.cpp-Adapter, Prometheus-Parser mit Zähler-Deltas,
  Request-Historie als JSONL mit Quellen-Tag, Perzentile mit Tukey-Ausreißern),
  Les-API `GET /api/inference/sources` und `…/snapshot?id=&fenster=`.
  Tests: `packages/core/test/inference.test.ts` **12/12**,
  `apps/hub/test/modules/inference/routes.test.ts` **5/5** (leere Konfiguration →
  leere Liste, unbekannte Id → 404 mit Liste, fehlende Id → 400).
- **P79 PWA** (Commit `1badf763`): `features/inference/` (Seite + format.ts),
  **eigener Menüpunkt** „Inferenz“ (Route `/inferenz`, Dock, Sidebar, ToolPane),
  `57-inference.css`, i18n de/en je 106 Keys.
- Gates grün: `lint`, `typecheck` (Hub+PWA), `check:arch`, `check:i18n`,
  `check:context` (nach `npm run docs:reference`).
- tokdeck (extern, `~/repos/tokdeck`) hat jetzt auch einen **Halogen-Adapter**
  (Prometheus + `/health` + `/cache`), 28/28 Tests.

## In Arbeit
- Live-Nahme im Hub: Konfigurationsabschnitt `inference.engines` (Strata auf
  `http://127.0.0.1:8080/metrics`, Schlüssel als Dateireferenz
  `~/repos/tokdeck/tokdeck.env.key`), PWA-Build, **ein** Hub-Neustart.
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
