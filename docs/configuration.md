# Konfiguration

**Art:** referenz

Der Hub liest `ANCIENTVOID_CONFIG` (Pfad) oder standardmäßig `./hub.config.json`.
Vorlage: `apps/hub/hub.config.example.json`. Die eigene Config ist
git-ignored — keine Secrets committen. Alle Felder mit Typ und Default
(generiert aus dem Schema): [`referenz-config.md`](referenz-config.md).

```jsonc
{
  "dataDir": "./data",                    // SQLite, JSONL, Blobs, Worker-Logs
  "workerRunner": "tmux",                 // "tmux" (Fallback auf "process", wenn tmux fehlt) | "process"
  "projectRoots": [],                     // T1.5-4: Host-Pfade, deren direkte
                                           // Unterverzeichnisse mit .git als
                                           // Session-Projekte angeboten werden
                                           // (GET /api/projects). Leer → PWA
                                           // fällt auf ein Freitextfeld zurück.
  "server": {
    "host": "127.0.0.1",                  // loopback! Exposen nur via tailscale serve
    "port": 7373,
    "enforceTailnetIdentity": false,      // true: Requests brauchen Tailscale-Header
    "pwaDir": "../pwa/dist"               // gebaute PWA; fehlt → nur API
  },
  "adapters": [
    {
      "id": "dummy",                      // Name für SessionSpec.adapter
      "module": "@ancientvoid/adapter-dummy",    // npm-Paket oder relativer Dateipfad
      "enabled": true,
      "config": { "eventsPerSecond": 5 }  // adapterspezifisch (zod-validiert im Adapter)
    }
  ]
}
```

## Freigaben und Modus (`defaultPermissionMode`, `toolApprovals`)

Zwei getrennte Einstellungen in `hub.config.json`:

| Schlüssel | Werte | Wirkung |
|---|---|---|
| `defaultPermissionMode` | Name eines Modus, Standard `"auto"` | In diesem Modus startet jede neue Session, deren Adapter ihn kennt (Claude: `auto`, `manual`, `plan`, `acceptEdits`, `dontAsk`, `bypassPermissions`). `"manual"` stellt das Nachfragen wieder her. In der App pro Session wählbar (ADR-0033). |
| `toolApprovals` | `"ask"` (Standard) · `"auto"` | `"ask"`: jede Tool-Anfrage eines Providers geht aufs Handy; kritische verlangen einen Passkey. `"auto"`: jede Tool-Anfrage wird sofort erlaubt und steht im Verlauf als „Automatisch erlaubt — …“. Rückfragen an dich (`AskUserQuestion`) werden weiter gestellt. |

`"auto"` ist für einen Hub gedacht, auf dem du den Agenten vertraust (eigenes Tailscale-Netz, eigene
Rechner). Es gibt dann keine Freigabe-Karten und keinen Passkey für Tool-Anfragen. Aktionen
am Hub selbst (Tokens, Budget-Erhöhung, Schritt-Freigaben mit `requireStepApprovals`) bleiben davon unberührt.

Passkeys (`destructive`-Freigaben) funktionieren nur, wenn `webauthn.rpId` und `webauthn.origin` zur
Adresse passen, unter der die App geöffnet wird — bei Tailscale also der MagicDNS-Name mit HTTPS. Mit dem
Standard (`localhost`) ist eine Registrierung auf dem Handy nicht möglich.

## Projekt-Wurzeln (`projectRoots`)

```jsonc
"projectRoots": ["/home/user/repos"]
```

`GET /api/projects` listet genau die direkten Unterverzeichnisse eines
konfigurierten Roots, die ein `.git` enthalten (Tiefe 1, kein rekursiver
Scan). Ein nicht existierender Root erzeugt eine sichtbare Warnung statt
einer stillen Leerliste. Jeder `project`-Pfad, der bei `POST /api/sessions`,
`GET /api/skills` oder `POST /api/prompt-enhance` ankommt, wird gegen dieselbe
Root-Liste geprüft (`isProjectPathAllowed()`, symlink-sicher — ein Symlink
innerhalb eines Roots, der nach außen zeigt, wird abgelehnt) — dasselbe
Nie-dem-Client-Pfad-vertrauen-Muster wie ADR-0001. Leere `projectRoots`
(Default) bedeutet: kein Root konfiguriert, die PWA fällt auf ein
Freitextfeld für den Projektpfad zurück, kein Endpunkt lehnt dann etwas ab.

## Loops (`loops[].config`)

```jsonc
"loops": [
  {
    "id": "securesight-factory",
    "module": "@ancientvoid/loop-securesight-factory",
    "config": {
      "models": {                       // optional — überschreibt die Standardliste
        "anthropic": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
        "zai": ["glm-5.3", "glm-5.3-flash"]
      }
    }
  },
  {
    "id": "ralph-hub",                   // EPIC-P54 / ADR-0110: Ralph über jede promptbare CLI
    "module": "@ancientvoid/loop-ralph-hub",
    "config": { "turnTimeoutMs": 3600000, "maxTurns": 40 }
  }
]
```

Details und Start-Optionen der Ralph-Loops (hub-getrieben und
Hermes-Beobachter): [loops.md](loops.md).


Die Modellwahl steht im Anbindungs-Formular („Factory-Projekt einrichten“)
direkt bereit — Wert `anbieter/modell`, Vorgabe „Standard-Routing der
Factory“ schreibt nichts. Eine gewählte Modell bestimmt auch den Provider
für `factory init` und wird als Projekt-Override
`<projekt>/policies/modell-routing.json` geschrieben (der factory-eigene,
dokumentierte Mechanismus — die Factory lädt den Projekt-Override als
Ganzes; kein Eingriff in die Factory-Installation). Gilt für alle drei
Stufen (planung/mittel/einfach). `python`, `pollMs`, `staleAfterS` und
`hermesDir` sind weitere Connector-Optionen.

## Device-Tokens

```bash
node apps/hubctl/src/cli.ts token issue "pixel-9" --db data/hub.db
node apps/hubctl/src/cli.ts token list --db data/hub.db
node apps/hubctl/src/cli.ts token revoke "pixel-9" --db data/hub.db
```

Plaintext-Token nur einmal sichtbar; in der DB liegt der SHA-256-Hash.
Verwendung: `Authorization: Bearer <token>` (REST) bzw. `?token=` (WS).

## Exposition fürs Handy (Tailscale)

```bash
scripts/setup-tailscale-serve.sh        # tailscale serve --bg --https=443 → 127.0.0.1:7373
curl -s https://<host>.<tailnet>.ts.net/api/health
```

Kein öffentlicher Port, keine Port-Weiterleitung. Optional
`enforceTailnetIdentity: true` setzen, damit nur Tailnet-identifizierte
Requests durchgehen.

## Umgebungsvariablen

| Var | Default | Zweck |
|---|---|---|
| `ANCIENTVOID_CONFIG` | `./hub.config.json` | Config-Pfad |
| `ANCIENTVOID_LOG` | `info` | Fastify-Log-Level |
| `ANCIENTVOID_EXPOSE` | – | `1` = auf 0.0.0.0 binden (Container; eigenes Risiko) |
| `ANCIENTVOID_URL` / `ANCIENTVOID_TOKEN` | – | hubctl-Ziel + Auth |
