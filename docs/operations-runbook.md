# Installation, Update und Rückkehr

**Art:** how-to

Dieses Runbook beschreibt den unterstützten Linux-Pfad für einen neuen Hub
und dessen Aktualisierung. Unterstützt ist Node.js 22.18+, 24 oder 26+ (23 und 25 nicht);
geprüft mit frischem Klon, siehe BUG-0133. Jeder echte Provider braucht zusätzlich
seine eigene CLI und einen gültigen Login auf genau diesem Host.

## Desktop-App (Omarchy/Chromium)

Der Launcher liegt **außerhalb des Repos** auf dem Host (`~/.local/…`) und
wird von Hand angelegt — der Start Baut auf dem systemd-Hub auf:

- `~/.local/bin/ancientvoid-app` — wartet auf `http://127.0.0.1:7373`,
  startet bei Bedarf `systemctl --user start ancientvoid-hub.service`
  (kein eigener Node-Prozess, kein zweiter Hub!) und übergibt die URL an
  `omarchy-launch-webapp` (Chromium-`--app`-Fenster, Standard-Profil mit
  Device-Token).
- `~/.local/share/applications/ancientvoid.desktop` — Name „AncientVoid“,
  Icon `~/.local/share/icons/ancientvoid.png` (aus
  `apps/pwa/public/icons/icon-512.png`).
- Nach einem PWA-Rebuild (`npm -w @ancientvoid/pwa run build`) + Hub-Restart
  das App-Fenster **komplett schließen und neu öffnen** — ein laufendes
  Fenster lädt auch über „Neustart des Fensters“ nicht automatisch neu
  (beobachtet 2026-11-06: null Asset-Anfragen im Hub-Log). Im Zweifel im
  Fenster einmal Strg+R drücken; der Service Worker ist network-first.

## Neuer Hub

```sh
git clone <repo-url> AncientVoid
cd AncientVoid
node --version                  # 22.18+, 24 oder 26+
npm ci
npm -w @ancientvoid/pwa run build
cp apps/hub/hub.config.example.json hub.config.json
chmod 600 hub.config.json
```

Passe `hub.config.json` an: `dataDir` auf einen dauerhaften Pfad setzen,
`projectRoots` auf die erlaubten Projektwurzeln begrenzen und nur installierte
Provider als Adapter registrieren. Provider-Logins und API-Schlüssel bleiben
außerhalb dieser Datei beziehungsweise in geschützten Dateien/Umgebungsvariablen.
Claude erhält standardmäßig Hub-Freigaben; OpenCode für native Freigaben über
ACP mit `preset: "opencode"`. Keine Bypass-Flags wie `--auto` oder
`--dangerously-skip-permissions` konfigurieren.

Für einen lokalen Entwicklungs-Hub:

```sh
scripts/hub.sh start
scripts/hub.sh status
```

### Dauerbetrieb auf dem eigenen Rechner (systemd)

`scripts/hub.sh` ist ein Entwicklungs-Daemon (PIDfile in /tmp) und
überlebt keinen Neustart. Für einen Hub, der beim Boot automatisch
startet, legt ein User-Unit an — gleiche Weise wie
[`fleet-deploy.sh`](../scripts/fleet-deploy.sh) es auf Peers tut:

```ini
# ~/.config/systemd/user/ancientvoid-hub.service  (Pfade anpassen)
[Unit]
Description=AncientVoid
After=network-online.target

[Service]
WorkingDirectory=/pfad/zum/AncientVoid
Environment=ANCIENTVOID_CONFIG=/pfad/zum/AncientVoid/hub.config.json
Environment=PATH=%h/.local/share/mise/shims:%h/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=%h/.local/share/mise/shims/node apps/hub/src/main.ts
UMask=0077
# BUG-0037: on-failure ließ den Hub nach sauberem SIGTERM-Exit (status 0)
# down — always startet neu; explizites `systemctl --user stop`
# unterdrückt Restart weiterhin.
Restart=always
RestartSec=3
# BUG-0072: die tmux-Worker liegen im cgroup dieses Dienstes. Der Standard (control-group) tötet sie bei
# jedem Neustart und jedem Absturz und bricht laufende Züge ab. "process" stoppt nur den Hub selbst,
# der neue Hub übernimmt die Worker (ADR-0014).
KillMode=process

[Install]
WantedBy=default.target
```

```sh
systemctl --user daemon-reload
loginctl enable-linger "$USER"   # startet auch ohne Anmeldung beim Boot
systemctl --user enable --now ancientvoid-hub.service
```

Ist die Unit installiert, delegieren `scripts/hub.sh start|stop|status`
nur bei gleicher Checkout-/Config-Identität an `systemctl`. Aus einem
Worktree oder mit anderer `ANCIENTVOID_CONFIG` wird die Steuerung verweigert;
isolierte Test-Hubs ausdrücklich mit `HUB_LOCAL=1` betreiben (BUG-0156).
`logs` liest weiterhin das Journal. Nie zwei Hubs auf einem Port.

Vor Auslieferung vollständiges Gate und aktiven Session-Stand prüfen;
danach Checkout aktualisieren, PWA neu bauen und den Hub geordnet neu starten.
`/api/health` und `/api/ready` melden unter `deployment` laufenden Hub-SHA,
Checkout-SHA und PWA-Build-SHA. Die Statusseite zeigt dieselbe Zuordnung;
ein Merge oder Service-Neustart allein aktualisiert keinen Browser-Build.
Wiederaufnahme und registrierte externe Arbeit:
[Unterbrochene Sessions](interrupted-sessions.md), ADR-0074.

Für einen dauerhaften Fleet-Peer nutze
[`fleet-deploy.sh`](../scripts/fleet-deploy.sh): der User-Service heißt
`ancientvoid-hub`, braucht aktives `loginctl enable-linger` und bindet an die
Tailnet-IP. Der Heim-Hub bleibt auf Loopback und wird für HTTPS mit
`scripts/setup-tailscale-serve.sh` veröffentlicht; keine Router-Portfreigabe
und kein öffentlicher Bind.

Gib ein Gerätetoken aus und speichere es sofort geschützt; der CLI-Befehl zeigt
den Klartext nur einmal:

```sh
umask 077
mkdir -p ~/.config/ancientvoid/device-tokens
DATA_DIR=/path/to/data
node apps/hubctl/src/cli.ts token issue phone --db "$DATA_DIR/hub.db" \
  > ~/.config/ancientvoid/device-tokens/phone.txt
chmod 600 ~/.config/ancientvoid/device-tokens/phone.txt
```

Öffne die Hub-PWA am Gerät und verbinde es mit dem Token. Für einen Fleet-Peer
folge [`fleet.md`](fleet.md): Einmalcode vom Peer erzeugen, im Heim-Hub
einlösen, danach müssen beide Hosts unter `/api/fleet` erreichbar sein.
Prüfe die erste Session vom Zielgerät aus, nicht nur mit einem Loopback-Aufruf.

## Diagnose

Der Hub hat derzeit keinen separaten `doctor`-Befehl. Diese Prüfungen zeigen
den Dienst-, Datenbank- und Adapterzustand:

```sh
# Lokaler Entwicklungsdienst
scripts/hub.sh status

# Fleet-/systemd-Dienst
systemctl --user status ancientvoid-hub
journalctl --user -u ancientvoid-hub --since -15min --no-pager

# Authentifizierte Hub-Prüfungen
ANCIENTVOID_URL=http://127.0.0.1:7373 ANCIENTVOID_TOKEN=<device-token> \
  node apps/hubctl/src/cli.ts health
ANCIENTVOID_URL=http://127.0.0.1:7373 ANCIENTVOID_TOKEN=<device-token> \
  node apps/hubctl/src/cli.ts adapters
```

`health` muss Datenbank und EventStore als gesund melden. `adapters` muss die
konfigurierten Adapter und deren Fähigkeiten ausgeben. Bei einem Fleet-Peer
zusätzlich `/api/fleet` prüfen; ein unerreichbarer oder inkompatibler Peer ist
kein erfolgreicher Installationsnachweis.

**Speicher-Wächter (BUG-0074/0075):** `/api/health` meldet unter `checks.memory` den Heap-Füllstand
des Hub-Prozesses. Ab 60 % des V8-Heap-Limits steht `status: "degraded"` mit Klartext, ab 80 % ist die
Stufe `critical`. Der Hub schreibt Stufenwechsel (`hub heap ok → warn`) ins Log, alle 30 s geprüft. Ein
dauerhaft steigender Wert ist ein Leck: Hub neu starten (Worker überleben, `KillMode=process`) und den
Verlauf in der Bug-Datei festhalten.

### Provider-Fehler im Chat lesen (ADR-0015, ADR-0115)

Ein `provider.error` ist keine rohe CLI-Zeile, sondern zentral klassifiziert
(`packages/contracts/src/harness/provider-error.ts`); der Rohtext bleibt im
EventStore unter `payload.raw`. Nach Kategorie handeln:

- `quota` / `rate_limit`: Kontingent oder Zeitfenster erschöpft — warten oder
  übergeben; ab der Freigabezeit darf der Hub automatisch fortsetzen.
- `context` (BUG-0265): der Verlauf passt nicht mehr ins Modell
  („exceeds the context window", „maximum context length"). Neuanmelden hilft
  hier nicht — Sitzung übergeben oder ein Modell mit größerem Kontext wählen.
- `auth`: Anmeldung oder Schlüssel sind wirklich kaputt — am PC neu anmelden.
- `network` / `server`: Hub-Netzwerk bzw. gestörter Provider.

Titel und Rohtext passen nicht zusammen? Befund mit `payload.raw` in einer
Bug-Datei melden — eine falsch klassifizierte Pleite schickt Menschen auf die
falsche Fährte (genau das war BUG-0265).

## Session-Worktrees aufräumen (EPIC-P14)

Jede isolierte Session hat einen Git-Worktree unter `data/worktrees/<id>`.
Archivieren räumt ihn auf, wenn die Session zwischen zwei Zügen steht, kein
langlebiger Worker darin läuft und er keine Arbeit enthält. Ältere oder von
einem Worker gehaltene Worktrees zeigt und räumt `hubctl` (lokal, neben der DB):

```sh
node apps/hubctl/src/cli.ts worktrees --db data/hub.db            # Liste mit Zustand und Größe
node apps/hubctl/src/cli.ts worktrees prune --db data/hub.db      # Trockenlauf
node apps/hubctl/src/cli.ts worktrees prune --apply --db data/hub.db
```

`work` heißt: uncommittete Dateien oder Commits, die dem Projekt fehlen. Solche
Worktrees und solche mit einem Prozess im Verzeichnis (`/proc`-cwd) bleiben
immer stehen; laufende und nicht archivierte Sessions auch. Ein später
fortgesetzter Prompt legt einen fehlenden Worktree am selben Pfad neu an, mit
dem aktuellen Projekt-HEAD als Basis. Entfernen heißt `git worktree remove` und
`branch -D` im jeweiligen Projekt-Repo, nie `rm -rf`.

## Session außerhalb des Hubs fortsetzen (ADR-0036)

Adapter mit belegtem Resume-Pfad deklarieren ihn (`capabilities().resume`).
`hubctl show <sessionId>` nennt den konkreten Befehl, aktuell:

| Adapter | Fortsetzung |
|---|---|
| claude | `claude --resume <session-id>` |
| codex | `codex resume <session-id>` |
| opencode | `opencode --session <session-id>` |
| hermes | `hermes --resume <session-id>` |

Die `<session-id>` ist die Provider-Session-ID (bei claude z. B. über den
„PC offen"-Hinweis der PWA oder `claude agents` erfahrbar). Adapter ohne
Eintrag haben keinen belegten Pfad — dann bleibt die Fortsetzung über den
Hub („Weiter") der einzige Weg.

## Update und Rollback

Vor jedem Update sichere die Daten und Konfiguration verschlüsselt. Stoppe
aktive Provider-Züge vorher im Hub; ein geplanter Stop lässt tmux-Worker
absichtlich weiterlaufen.

1. Hub sauber stoppen (`scripts/hub.sh stop` oder
   `systemctl --user stop ancientvoid-hub`).
2. Mit [`backup-restore.md`](backup-restore.md) ein verschlüsseltes Backup
   erstellen und dessen Schlüssel separat sichern.
3. Auf den geprüften Commit aktualisieren (`git fetch`, dann den gewünschten
   Commit auschecken). Auf Fleet-Peers aktualisiert
   `scripts/fleet-deploy.sh` den Code und startet den User-Service neu.
4. `npm ci`, PWA-Build und `npm run gate` auf dem neuen Stand ausführen.
5. Hub starten; Migrationen laufen beim Öffnen der Datenbank vor Annahme neuer
   Anfragen. `/api/health`, `/api/adapters`, die Session-Recovery und jeden
   Fleet-Peer prüfen.

SQLite-Migrationen sind vorwärtsgerichtet; automatische `down`-Migrationen
gibt es nicht. Für eine Rückkehr stoppe den neuen Hub, checke den vorherigen
Code-Commit aus und stelle das Vor-Update-Backup in ein **neues leeres**
Datadir wieder her. Passe `dataDir` in einer Kopie der alten Konfiguration an,
starte damit den alten Code und prüfe Health, Adapter und Session-Recovery.
Das alte Datadir bleibt bis zur bestätigten Wiederherstellung unangetastet.

Fleet-Verbindungen prüfen beim Koppeln die Protokollversion. Ein Peer mit
abweichender Version wird sichtbar als inkompatibel abgewiesen; aktualisiere
Heim-Hub und Peers aus demselben geprüften Commit-Satz, bevor du neue
Funktionen erwartest. Die PWA wird aus demselben Commit wie die Hub-API gebaut
und ausgeliefert; ein unabhängiger PWA-/API-Kompatibilitätsvertrag ist nicht
implementiert. Ein grüner lokaler Gate-Lauf ersetzt keine echte
Provider-, Handy-, WAN- oder Wiederherstellungsabnahme.
