# Onboarding — frischer Klon bis laufender Hub

**Art:** how-to

Zielgruppe: Nutzer, die das Repo neu klonen und ohne Anpassungen am Code zum
Laufen bringen wollen — inklusive Anbindung eigener Provider, Harnesses,
Loops und Factories. **Erstmals hier? Beginne mit dem
[Tutorial „Erste 15 Minuten“](tutorial-erste-schritte.md)**; diese Seite ist
die vollständige Route dahinter und dupliziert die Detail-Doks nicht. Wer am
Repo mitarbeitet (Agenten, Beitragende): [`beitragen-als-agent.md`](beitragen-als-agent.md).

## 0. Was ist fertig, was nicht (ehrlich)

| Baustein | Status nach frischem Klon |
|---|---|
| Provider (OpenAI-kompatibel, eigene Adapter) | **fertig** — nur Endpunkt/Key eintragen |
| Klassische Harness-Adapter (claude, codex, cursor-clip, pi, aider, hermes, …) | **fertig** — CLI installieren, Config-Eintrag |
| ACP-Harnesses (copilot, opencode, dsh, maki, omp) | **fertig** — Preset, CLI installieren ([`adapters.md` §ACP](adapters.md)) |
| Session-Discovery/Übernahme (pi, oh-my-pi, maki) | **fertig** (P22/P24) |
| Loops (P19, `packages/loops/*`) | **fertig** — Onboarding je Loop in dessen Package |
| Factory-Integration (P26) | **Code umgesetzt; echte Factory-Abnahme offen** (T26.11/AC-P26-10), Stand in [`epics/EPIC-P26-factory-integration.md`](../epics/EPIC-P26-factory-integration.md) |
| Slash-Command-Brücke (maki live) | **behoben** — [BUG-0079](../bugs/bug-0079-maki-slash-bridge-fuehrt-commands-nicht-aus.md) |
| MCP-Gateway-Sidecar | **optional, default aus** — [`apps/gateway-mcp/README.md`](../apps/gateway-mcp/README.md) |
| Multi-Host-Fleet (P6) | teilweise — siehe [Audit](remote-control-audit-2026-09-21.md) |

## 1. Voraussetzungen

- Node 22.18+, 24 oder 26+ (CI verwendet 26; Matrix geprüft in [BUG-0133](../bugs/bug-0133-setup-node-mindestversion.md))
- npm, git, bash, curl; für den lokalen Daemon außerdem `setsid` (util-linux)
- optional tmux (Worker-Runner, Fallback `process`)
- Für Handy-Zugriff: Tailscale (Exposen **nur** via `tailscale serve`, nie Port öffnen)
- Für E2E-Gates: Playwright-Chromium (`npx playwright install chromium`; fehlt es, ist das Gate nicht bestanden)

## 2. Installieren

**Normalweg (ein Befehl, EPIC-P53):** `./setup.sh` — der Wizard prüft
Voraussetzungen, bindet als ersten Schritt den ersten Provider an, installiert,
baut die PWA, stellt ein Device-Token aus und startet den Hub (idempotent,
failt laut; Flags im Skript-Kopf; Hilfe: Skill `setup-wizard`). Die Schritte
3–5 unten erledigt er automatisch.

Manuell (Agenten/CI):

```bash
git clone <repo> && cd AncientVoid
npm install          # richtet auch den commit-msg-Hook ein
npm test             # Sanity; Skips separat prüfen, nicht als Pass zählen
```

## 3. Konfigurieren

```bash
cp apps/hub/hub.config.example.json hub.config.json
```

- Details/Felder: [`configuration.md`](configuration.md). Eigene Config ist
  git-ignored — **keine Secrets committen**.
- API-Keys gehören in Dateien und werden per `envFiles` referenziert
  (Beispiel maki: `"envFiles": { "ZHIPU_API_KEY": "~/.config/ancientvoid/glm-coding.key" }`)
  — Schlüssel stehen so nie in der Config. `envFiles` ist eine Option des
  ACP-Adapters, keine allgemeine Hub-Option. Native CLIs nutzen ihre eigene
  Anmeldung; der OpenAI-Beispieladapter liest `config.apiKeyEnv` aus der
  Umgebung des Hub-Prozesses.
- Alternativer Config-Pfad: `ANCIENTVOID_CONFIG=<pfad>`.

## 4. PWA bauen und starten

Der Wizard (`./setup.sh`) macht beides. Manuell:

```bash
npm -w @ancientvoid/pwa run build     # einmalig (config.server.pwaDir)
node apps/hub/src/main.ts      # Manuell
```

Als Dienst (`~/.config/systemd/user/ancientvoid-hub.service`, minimal):

```ini
[Unit]
Description=AncientVoid
[Service]
WorkingDirectory=<checkout>
ExecStart=<node> apps/hub/src/main.ts
Restart=on-failure
[Install]
WantedBy=default.target
```

Bereit ist der Hub, wenn `GET /api/health` und `/api/ready` grün antworten.

## 5. Verbinden

Beim manuellen Setup zuerst ein Token in der **Datenbank des gestarteten Hubs**
ausstellen (bei anderem `dataDir` den Pfad entsprechend ersetzen):

```bash
node apps/hubctl/src/cli.ts token issue "mein-geraet" --db data/hub.db
```

Einmalig angezeigtes Token in die PWA eingeben. Der Wizard verwendet das
konfigurierte `dataDir`; weitere manuelle `hubctl token`-Befehle benötigen
weiterhin den passenden `--db`-Pfad.

- **PWA:** `http://127.0.0.1:7373` (port wie config). Von unterwegs: Tailscale +
  `ANCIENTVOID_EXPOSE=1`-Hinweis in [`configuration.md` §Tailscale](configuration.md).
- **CLI:** `ANCIENTVOID_TOKEN=<device-token> node apps/hubctl/src/cli.ts sessions`

## 6. Eigene Tools anbinden (nichts am Code ändern)

1. **Beliebiger OpenAI-kompatibler Endpunkt** (llama.cpp, LM Studio, Ollama,
   vLLM): Beispiel-Adapter registrieren —
   [`examples/adapters/openai-compat/`](../examples/adapters/openai-compat/),
   `baseUrl` inklusive `/v1`, exakte Modell-ID des eigenen Servers, optional
   `apiKeyEnv` konfigurieren. Der Beispieladapter ist ein Chat-Client ohne
   Coding-Werkzeuge; bekannte Fehler: [BUG-0131](../bugs/bug-0131-openai-fehler-still-verworfen.md).
   Für Coding mit lokalem Modell einen Harness konfigurieren, siehe
   [`local-llm.md`](local-llm.md) (die dortigen gpubox-Adressen sind
   installationsspezifische Beispiele, keine erreichbaren Defaults).
2. **Harness-CLI** (Agent x deiner Wahl): Config-Eintrag wie in
   [`README.md` §„Eigene Endpunkte anbinden"](../README.md); welche CLI-Version
   welchen Funktionsumfang liefert, steht in [`harness-matrix.md`](harness-matrix.md).
   ACP-fähige Harnesses brauchen **keinen eigenen Adapter** — Preset genügt
   ([`adapters.md` §„ACP-Harnesses ohne eigenen Code"](adapters.md)).
3. **Laufende Sessions** von pi/oh-my-pi/maki werden erkannt und können
   übernommen werden (Discovery, P22/P24). Das ist Session-Erkennung, keine
   automatische Einrichtung von Modellserver, Zugangsschlüssel oder Provider.
4. **Loops/Factories:** Loop-Pakete (`packages/loops/*`) mitbringen bzw. per
   Config referenzieren. Die Factory-Steuerung ist gebaut; die manuelle
   Abnahme mit der echten Factory bleibt offen (P26, siehe Tabelle oben).

### Modellname, Katalog und Provider unterscheiden

- Der Wizard erkennt CLI-Binaries im PATH; das belegt weder Anmeldung noch
  einen erfolgreichen Modellaufruf. Zuerst die CLI selbst mit ihrer eigenen
  Anleitung einrichten; danach eine kurze Session im Hub prüfen.
- Der Modellkatalog kommt vom Harness (ACP bzw. `modelsCommand`, bei pi dessen
  Liste). Ein neuer Eintrag unter „Eigenes Modell“ ergänzt das Hub-Register;
  er richtet keinen Server ein und macht kein unbekanntes Modell verfügbar.
- Nur der pi-Provider-Weg schreibt eine native Provider-Konfiguration.
  Bei maki, omp und anderen Harnesses bleibt die eigene Provider-Datei nötig
  ([ADR-0060](adr/0060-eigene-modelle-und-endpunkte.md)).
- `gatekeeper.model`, `assistant.model`, STT und Vision sind getrennte
  Konfigurationen; die Session-Modellwahl richtet sie nicht mit ein.

### VoidWarden und lokale Sprache

Die [Kaskade in der README](../README.md#zusammenspiel-mit-voidwarden) richtet
Hub-Zugriff ein. VoidWarden verwendet feste Status-/Ansagetexte und optional
Kokoro-TTS (`voice.enabled`, `voice.url` in dessen Config), keinen eigenen
LLM-Chat. Kokoro muss separat bereitstehen; die Beispiel-Tailnet-Adresse gehört
zur Entwicklerinstallation. Ein lokales Coding-Modell im Hub aktiviert weder
Sprachausgabe noch Spracherkennung auf dem Kiosk.

Die Hub-eigene Sprachausgabe (EPIC-P75,
[ADR-0097](adr/0097-sprachausgabe-tts-hub-proxy.md)) ist davon getrennt: Sie
trägt in den PWA-Einstellungen unter „Sprachausgabe" die URL desselben lokalen
TTS-Dienstes ein (Hivemind `POST /tts`), mit Hörprobe — der Hub probed die
Verfügbarkeit echt und serialisiert Synthesen, damit die geteilte Box nicht
gestampet wird. Vorlesen passiert nur auf Knopfdruck an Assistant-Antworten und
offenen Fragen; ein automatisches Vorlesen neuer Nachrichten gibt es
bewusst nicht (P65-Sounds und VoidWardens Nyx-Ansagen decken „dass sich etwas
getan hat" ab).

`agent:` liest, `display:` entscheidet zulässige Freigaben. Optionsfragen
brauchen zusätzlich bewusst ausgestellte `--answer-questions`-Berechtigung
(ADR-0066); normale Display-Tokens enthalten sie nicht. `--voidwarden` nicht
blind wiederholen: derzeit entstehen zusätzliche Tokens
([BUG-0135](../bugs/bug-0135-setup-voidwarden-zweittokens.md)).

Weitere Setup-Grenzen und priorisierte Nacharbeit:
[Setup-/Modellanbindungs-Audit](2026-11-11-setup-modelle-audit.md).

Beitragen und Verifizieren (PR-Workflow, Gates, Stolpersteine) steht in
[`beitragen-als-agent.md`](beitragen-als-agent.md).
